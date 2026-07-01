/**
 * ============================================================
 * ORDER SERVICE — Entry Point
 * ============================================================
 * 
 * The order service creates orders and responds to saga events
 * to update order status throughout the saga lifecycle.
 * 
 * It listens for:
 * - command.order.cancel → Cancel an order (compensating transaction)
 * - order.status.update  → Update order status as saga progresses
 * 
 * ============================================================
 */

const express = require('express');
const { Sequelize } = require('sequelize');
const { connectWithRetry } = require('../../../shared/retry');
const { connectRabbitMQ, publishEvent, consumeEvents } = require('../../../shared/rabbitmq');
const { createLogger } = require('../../../shared/logger');
const { defineOrderModel } = require('./models/order');
const { createOrderRoutes } = require('./routes');

const app = express();
app.use(express.json());

const logger = createLogger('OrderService');
const PORT = process.env.ORDER_SERVICE_PORT || 3001;

const startUp = async () => {
    logger.info('🚀 Starting Order Service...');

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
    const Order = defineOrderModel(sequelize);
    await sequelize.sync({ alter: true });
    logger.success('Database models synced');

    // ─── Connect to RabbitMQ ───
    const { channel } = await connectRabbitMQ(process.env.RABBITMQ_URI);

    // ─── Listen for saga commands to update order status ───
    await consumeEvents(
        channel,
        'order_commands',
        ['command.order.*', 'order.status.*'],
        async (message) => {
            const { type, data } = message;
            const correlationLogger = logger.withCorrelation(data.sagaId);

            if (type === 'command.order.cancel') {
                // Compensating transaction: cancel the order
                correlationLogger.info('📨 Received saga command: cancel order', {
                    orderId: data.orderId
                });

                try {
                    const order = await Order.findByPk(data.orderId);
                    if (order && order.status !== 'CANCELLED') {
                        order.status = 'CANCELLED';
                        order.failureReason = data.reason || 'Saga compensation';
                        await order.save();
                        correlationLogger.success('❌ Order cancelled', {
                            orderId: order.id,
                            reason: order.failureReason
                        });
                    }

                    publishEvent(channel, 'order.cancelled', {
                        sagaId: data.sagaId,
                        orderId: data.orderId
                    }, data.sagaId);

                } catch (err) {
                    correlationLogger.error('Failed to cancel order', { error: err.message });
                }

            } else if (type === 'order.status.update') {
                // Update order status as saga progresses
                correlationLogger.info(`📋 Updating order status → ${data.status}`, {
                    orderId: data.orderId
                });

                try {
                    const order = await Order.findByPk(data.orderId);
                    if (order) {
                        order.status = data.status;
                        if (data.paymentId) order.paymentId = data.paymentId;
                        if (data.failureReason) order.failureReason = data.failureReason;
                        await order.save();
                    }
                } catch (err) {
                    correlationLogger.error('Failed to update order status', { error: err.message });
                }
            }
        }
    );

    // ─── Setup HTTP routes ───
    const orderRoutes = createOrderRoutes(Order, channel, publishEvent);
    app.use('/', orderRoutes);

    // ─── Start HTTP server ───
    app.listen(PORT, () => {
        logger.success(`📦 Order Service running on port ${PORT}`);
    });
};

startUp().catch(err => {
    logger.error('Failed to start Order Service', { error: err.message });
    process.exit(1);
});
