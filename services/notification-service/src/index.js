/**
 * ============================================================
 * NOTIFICATION SERVICE — Deliberately Flaky
 * ============================================================
 * 
 * This service exists to DEMONSTRATE the Circuit Breaker pattern.
 * 
 * It has configurable chaos:
 * - FAILURE_RATE: Percentage of requests that fail (0.0 to 1.0)
 * - LATENCY_MAX_MS: Maximum artificial latency in milliseconds
 * 
 * Chaos can be toggled at runtime via API:
 *   POST /chaos/enable   — Turn on failures
 *   POST /chaos/disable  — Turn off failures
 *   POST /chaos/config   — Configure failure rate and latency
 * 
 * LEARNING POINTS:
 * 1. Real services DO fail intermittently
 * 2. Without circuit breaker, callers waste resources on failing calls
 * 3. This simulates real-world scenarios:
 *    - Email service outage
 *    - SMS gateway rate limiting
 *    - Push notification service maintenance
 * 
 * ============================================================
 */

const express = require('express');
const { connectWithRetry } = require('../../../shared/retry');
const { connectRabbitMQ, publishEvent, consumeEvents } = require('../../../shared/rabbitmq');
const { createLogger } = require('../../../shared/logger');

const app = express();
app.use(express.json());

const logger = createLogger('NotificationService');
const PORT = process.env.NOTIFICATION_SERVICE_PORT || 3004;

// ─── Chaos Configuration ───
let chaosConfig = {
    enabled: true,
    failureRate: parseFloat(process.env.FAILURE_RATE || '0.5'),   // 50% failure by default
    latencyMaxMs: parseInt(process.env.LATENCY_MAX_MS || '3000'),  // Up to 3s latency
    errorCodes: [500, 502, 503]  // Randomly pick from these on failure
};

let stats = {
    totalRequests: 0,
    successful: 0,
    failed: 0,
    lastRequestAt: null
};

/**
 * POST /notify
 * 
 * Send a notification (simulated).
 * Subject to chaos configuration — may fail or be slow!
 */
app.post('/notify', async (req, res) => {
    const { orderId, customerId, type = 'email', message, sagaId } = req.body;
    const correlationLogger = logger.withCorrelation(sagaId || orderId);

    stats.totalRequests++;
    stats.lastRequestAt = new Date().toISOString();

    correlationLogger.info('📧 Notification request received', { orderId, type });

    // ─── Chaos: Artificial Latency ───
    if (chaosConfig.enabled && chaosConfig.latencyMaxMs > 0) {
        const delay = Math.floor(Math.random() * chaosConfig.latencyMaxMs);
        if (delay > 500) {
            correlationLogger.warn(`🐌 Artificial latency: ${delay}ms`);
        }
        await new Promise(resolve => setTimeout(resolve, delay));
    }

    // ─── Chaos: Random Failure ───
    if (chaosConfig.enabled && Math.random() < chaosConfig.failureRate) {
        const errorCode = chaosConfig.errorCodes[
            Math.floor(Math.random() * chaosConfig.errorCodes.length)
        ];

        stats.failed++;
        correlationLogger.error(`💥 CHAOS — Simulated failure (HTTP ${errorCode})`);

        return res.status(errorCode).json({
            error: 'Service temporarily unavailable',
            message: 'Notification service is experiencing issues (chaos mode)',
            statusCode: errorCode
        });
    }

    // ─── Success Path ───
    stats.successful++;
    correlationLogger.success('✅ Notification sent successfully', {
        orderId,
        customerId,
        type
    });

    res.json({
        notificationId: `notif-${Date.now()}`,
        orderId,
        customerId,
        type,
        status: 'SENT',
        sentAt: new Date().toISOString(),
        message: `${type} notification sent to customer ${customerId}`
    });
});

/**
 * Chaos control endpoints
 */
app.post('/chaos/enable', (req, res) => {
    chaosConfig.enabled = true;
    logger.warn('🔥 CHAOS MODE ENABLED', chaosConfig);
    res.json({ message: 'Chaos mode enabled', config: chaosConfig });
});

app.post('/chaos/disable', (req, res) => {
    chaosConfig.enabled = false;
    logger.info('✅ Chaos mode disabled');
    res.json({ message: 'Chaos mode disabled', config: chaosConfig });
});

app.post('/chaos/config', (req, res) => {
    const { failureRate, latencyMaxMs, enabled } = req.body;
    if (failureRate !== undefined) chaosConfig.failureRate = failureRate;
    if (latencyMaxMs !== undefined) chaosConfig.latencyMaxMs = latencyMaxMs;
    if (enabled !== undefined) chaosConfig.enabled = enabled;
    logger.info('⚙️ Chaos config updated', chaosConfig);
    res.json({ message: 'Chaos config updated', config: chaosConfig });
});

app.get('/chaos/config', (req, res) => {
    res.json({ config: chaosConfig, stats });
});

/**
 * Health check
 */
app.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        service: 'notification-service',
        chaos: chaosConfig,
        stats
    });
});

const startUp = async () => {
    logger.info('🚀 Starting Notification Service...');
    logger.warn('🔥 Chaos mode is ON by default', {
        failureRate: `${chaosConfig.failureRate * 100}%`,
        maxLatency: `${chaosConfig.latencyMaxMs}ms`
    });

    // ─── Connect to RabbitMQ ───
    try {
        const { channel } = await connectRabbitMQ(process.env.RABBITMQ_URI);

        // Listen for notification commands from saga
        await consumeEvents(
            channel,
            'notification_commands',
            ['command.notification.*'],
            async (message) => {
                const { type, data } = message;
                const correlationLogger = logger.withCorrelation(data.sagaId);

                if (type === 'command.notification.send') {
                    correlationLogger.info('📨 Received saga command: send notification');

                    // Apply same chaos logic
                    if (chaosConfig.enabled && Math.random() < chaosConfig.failureRate) {
                        correlationLogger.error('💥 CHAOS — Notification failed');
                        publishEvent(channel, 'notification.failed', {
                            sagaId: data.sagaId,
                            orderId: data.orderId,
                            reason: 'Service unavailable (chaos mode)'
                        }, data.sagaId);
                    } else {
                        correlationLogger.success('✅ Notification sent via saga');
                        publishEvent(channel, 'notification.sent', {
                            sagaId: data.sagaId,
                            orderId: data.orderId,
                            type: 'email'
                        }, data.sagaId);
                    }
                }
            }
        );
    } catch (err) {
        logger.warn('RabbitMQ not available — running in HTTP-only mode', { error: err.message });
    }

    // ─── Start HTTP server ───
    app.listen(PORT, () => {
        logger.success(`📧 Notification Service running on port ${PORT}`);
        logger.info(`  Chaos: ${chaosConfig.enabled ? 'ENABLED' : 'DISABLED'}`);
        logger.info(`  Failure Rate: ${chaosConfig.failureRate * 100}%`);
        logger.info(`  Max Latency: ${chaosConfig.latencyMaxMs}ms`);
    });
};

startUp().catch(err => {
    logger.error('Failed to start Notification Service', { error: err.message });
    process.exit(1);
});
