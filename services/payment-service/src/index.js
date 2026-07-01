/**
 * ============================================================
 * PAYMENT SERVICE — Entry Point
 * ============================================================
 * 
 * Demonstrates: IDEMPOTENCY PATTERN
 * 
 * This service processes payments with idempotency guarantees:
 * - Uses Redis to store idempotency keys
 * - Uses PostgreSQL unique constraints as a safety net
 * - Publishes saga events on success/failure
 * - Listens for saga commands (process payment, refund)
 * 
 * ============================================================
 */

const express = require('express');
const { Sequelize } = require('sequelize');
const Redis = require('ioredis');
const { connectWithRetry } = require('../../../shared/retry');
const { connectRabbitMQ, publishEvent, consumeEvents } = require('../../../shared/rabbitmq');
const { createLogger } = require('../../../shared/logger');
const { definePaymentModel } = require('./models/payment');
const { createPaymentRoutes } = require('./routes');

const app = express();
app.use(express.json());

const logger = createLogger('PaymentService');
const PORT = process.env.PAYMENT_SERVICE_PORT || 3002;

const startUp = async () => {
    logger.info('🚀 Starting Payment Service...');

    // ─── Connect to PostgreSQL ───
    const sequelize = await connectWithRetry(async () => {
        const seq = new Sequelize(process.env.PG_URI, {
            logging: false,
            dialect: 'postgres'
        });
        await seq.authenticate();
        return seq;
    }, 'PostgreSQL');

    // Define models and sync
    const Payment = definePaymentModel(sequelize);
    await sequelize.sync({ alter: true });
    logger.success('Database models synced');

    // ─── Connect to Redis ───
    const redis = await connectWithRetry(async () => {
        const client = new Redis(process.env.REDIS_URI);
        await client.ping();
        return client;
    }, 'Redis');

    // ─── Connect to RabbitMQ ───
    const { channel } = await connectRabbitMQ(process.env.RABBITMQ_URI);

    // ─── Listen for saga commands ───
    // The saga orchestrator publishes 'command.payment.process' and 'command.payment.refund'
    await consumeEvents(
        channel,
        'payment_commands',
        ['command.payment.*'],
        async (message) => {
            const { type, data } = message;
            const correlationLogger = logger.withCorrelation(data.sagaId);

            if (type === 'command.payment.process') {
                correlationLogger.info('📨 Received saga command: process payment', {
                    orderId: data.orderId,
                    amount: data.amount
                });

                try {
                    // Simulate processing
                    await new Promise(resolve => setTimeout(resolve, 1500));

                    // 10% simulated failure rate
                    if (Math.random() < 0.1) {
                        throw new Error('Payment processor declined');
                    }

                    const payment = await Payment.create({
                        orderId: data.orderId,
                        amount: data.amount,
                        currency: data.currency || 'USD',
                        status: 'COMPLETED',
                        idempotencyKey: data.idempotencyKey || `saga-${data.sagaId}`,
                        metadata: { sagaId: data.sagaId }
                    });

                    publishEvent(channel, 'payment.success', {
                        sagaId: data.sagaId,
                        orderId: data.orderId,
                        paymentId: payment.id,
                        amount: data.amount
                    }, data.sagaId);

                } catch (err) {
                    correlationLogger.error('Payment failed', { error: err.message });
                    publishEvent(channel, 'payment.failed', {
                        sagaId: data.sagaId,
                        orderId: data.orderId,
                        reason: err.message
                    }, data.sagaId);
                }

            } else if (type === 'command.payment.refund') {
                correlationLogger.info('📨 Received saga command: refund payment', {
                    paymentId: data.paymentId
                });

                try {
                    const payment = await Payment.findOne({
                        where: { orderId: data.orderId, status: 'COMPLETED' }
                    });

                    if (payment) {
                        payment.status = 'REFUNDED';
                        payment.refundedAt = new Date();
                        await payment.save();

                        correlationLogger.success('💸 Payment refunded', {
                            paymentId: payment.id
                        });
                    }

                    publishEvent(channel, 'payment.refunded', {
                        sagaId: data.sagaId,
                        orderId: data.orderId,
                        paymentId: payment?.id
                    }, data.sagaId);

                } catch (err) {
                    correlationLogger.error('Refund failed', { error: err.message });
                }
            }
        }
    );

    // ─── Setup HTTP routes ───
    const paymentRoutes = createPaymentRoutes(Payment, redis, channel, publishEvent);
    app.use('/', paymentRoutes);

    // ─── Start HTTP server ───
    app.listen(PORT, () => {
        logger.success(`🏦 Payment Service running on port ${PORT}`);
    });
};

startUp().catch(err => {
    logger.error('Failed to start Payment Service', { error: err.message });
    process.exit(1);
});
