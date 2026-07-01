/**
 * ============================================================
 * SAGA ORCHESTRATOR — Entry Point
 * ============================================================
 * 
 * The central coordinator for all sagas.
 * This service:
 * 1. Listens for events that trigger new sagas (e.g., order.created)
 * 2. Listens for step completion events (success/failure)
 * 3. Advances the saga or triggers compensations
 * 
 * It does NOT have an HTTP server — it's purely event-driven.
 * 
 * ============================================================
 */

const Redis = require('ioredis');
const { connectWithRetry } = require('../../../shared/retry');
const { connectRabbitMQ, publishEvent, consumeEvents } = require('../../../shared/rabbitmq');
const { createLogger } = require('../../../shared/logger');
const { SagaEngine } = require('./saga-engine');
const { orderSagaSteps } = require('./sagas/order-saga');

const logger = createLogger('SagaOrchestrator');

const startUp = async () => {
    logger.info('🚀 Starting Saga Orchestrator...');

    // ─── Connect to Redis (saga state store) ───
    const redis = await connectWithRetry(async () => {
        const client = new Redis(process.env.REDIS_URI);
        await client.ping();
        return client;
    }, 'Redis');

    // ─── Connect to RabbitMQ ───
    const { channel } = await connectRabbitMQ(process.env.RABBITMQ_URI);

    // ─── Initialize Saga Engine ───
    const engine = new SagaEngine(redis, channel, publishEvent);

    // Register saga definitions
    engine.registerSaga('order', orderSagaSteps);

    // ─── Listen for saga trigger events ───
    // When an order is created, start the order saga
    await consumeEvents(
        channel,
        'saga_triggers',
        ['order.created'],
        async (message) => {
            const { data, correlationId } = message;
            const sagaId = data.sagaId || correlationId;
            const correlationLogger = logger.withCorrelation(sagaId);

            correlationLogger.info('🎬 New order received — starting order saga', {
                orderId: data.orderId,
                totalAmount: data.totalAmount
            });

            await engine.startSaga('order', sagaId, {
                orderId: data.orderId,
                customerId: data.customerId,
                items: data.items,
                totalAmount: data.totalAmount,
                currency: data.currency || 'USD',
                idempotencyKey: `order-${data.orderId}`
            });
        }
    );

    // ─── Listen for step completion events ───
    // These are the responses from each service

    // Payment events
    await consumeEvents(
        channel,
        'saga_payment_events',
        ['payment.success', 'payment.failed'],
        async (message) => {
            const { type, data } = message;
            const sagaId = data.sagaId;

            if (type === 'payment.success') {
                await engine.handleStepSuccess(sagaId, 'payment', {
                    paymentId: data.paymentId,
                    amount: data.amount
                });
            } else if (type === 'payment.failed') {
                await engine.handleStepFailure(sagaId, 'payment', data.reason);
            }
        }
    );

    // Inventory events
    await consumeEvents(
        channel,
        'saga_inventory_events',
        ['inventory.reserved', 'inventory.failed'],
        async (message) => {
            const { type, data } = message;
            const sagaId = data.sagaId;

            if (type === 'inventory.reserved') {
                await engine.handleStepSuccess(sagaId, 'inventory', {
                    reserved: data.reserved
                });
            } else if (type === 'inventory.failed') {
                await engine.handleStepFailure(sagaId, 'inventory', data.reason);
            }
        }
    );

    // Notification events
    await consumeEvents(
        channel,
        'saga_notification_events',
        ['notification.sent', 'notification.failed'],
        async (message) => {
            const { type, data } = message;
            const sagaId = data.sagaId;

            if (type === 'notification.sent') {
                await engine.handleStepSuccess(sagaId, 'notification', {});
            } else if (type === 'notification.failed') {
                // DESIGN DECISION: Notification failure does NOT fail the saga.
                // The order is still confirmed — we just log the notification failure.
                logger.withCorrelation(sagaId).warn(
                    '⚠️ Notification failed but order is still confirmed (best-effort notification)'
                );
                // Treat as success — the order goes through
                await engine.handleStepSuccess(sagaId, 'notification', {
                    notificationFailed: true
                });
            }
        }
    );

    logger.success('🎯 Saga Orchestrator is running and listening for events');
    logger.info('  Registered sagas: order');
    logger.info('  Listening for: order.created, payment.*, inventory.*, notification.*');
};

startUp().catch(err => {
    logger.error('Failed to start Saga Orchestrator', { error: err.message });
    process.exit(1);
});
