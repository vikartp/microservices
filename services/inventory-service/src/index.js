/**
 * ============================================================
 * INVENTORY SERVICE — Entry Point
 * ============================================================
 * 
 * Manages product inventory with reserve/release operations.
 * Demonstrates COMPENSATING TRANSACTIONS in the saga pattern:
 * - Reserve inventory (forward action)
 * - Release inventory (compensation when later steps fail)
 * 
 * ============================================================
 */

const express = require('express');
const mongoose = require('mongoose');
const { connectWithRetry } = require('../../../shared/retry');
const { connectRabbitMQ, publishEvent, consumeEvents } = require('../../../shared/rabbitmq');
const { createLogger } = require('../../../shared/logger');
const { Product } = require('./models/product');
const { createInventoryRoutes } = require('./routes');

const app = express();
app.use(express.json());

const logger = createLogger('InventoryService');
const PORT = process.env.INVENTORY_SERVICE_PORT || 3003;

const startUp = async () => {
    logger.info('🚀 Starting Inventory Service...');

    // ─── Connect to MongoDB ───
    await connectWithRetry(async () => {
        await mongoose.connect(process.env.MONGO_URI);
    }, 'MongoDB');

    // ─── Connect to RabbitMQ ───
    const { channel } = await connectRabbitMQ(process.env.RABBITMQ_URI);

    // ─── Listen for saga commands ───
    await consumeEvents(
        channel,
        'inventory_commands',
        ['command.inventory.*'],
        async (message) => {
            const { type, data } = message;
            const correlationLogger = logger.withCorrelation(data.sagaId);

            if (type === 'command.inventory.reserve') {
                correlationLogger.info('📨 Received saga command: reserve inventory', {
                    orderId: data.orderId,
                    itemCount: data.items?.length
                });

                try {
                    const reserved = [];
                    const failed = [];

                    for (const item of data.items) {
                        const product = await Product.findOneAndUpdate(
                            {
                                productId: item.productId,
                                quantity: { $gte: item.quantity }
                            },
                            {
                                $inc: { quantity: -item.quantity, reserved: item.quantity },
                                $push: {
                                    reservations: {
                                        orderId: data.orderId,
                                        sagaId: data.sagaId,
                                        quantity: item.quantity
                                    }
                                }
                            },
                            { new: true }
                        );

                        if (product) {
                            reserved.push({ productId: item.productId, quantity: item.quantity });
                        } else {
                            failed.push({ productId: item.productId, quantity: item.quantity });
                        }
                    }

                    if (failed.length > 0) {
                        // Rollback any partial reservations
                        for (const item of reserved) {
                            await Product.findOneAndUpdate(
                                { productId: item.productId },
                                {
                                    $inc: { quantity: item.quantity, reserved: -item.quantity },
                                    $pull: { reservations: { orderId: data.orderId } }
                                }
                            );
                        }

                        correlationLogger.warn('❌ Inventory reservation failed', { failed });
                        publishEvent(channel, 'inventory.failed', {
                            sagaId: data.sagaId,
                            orderId: data.orderId,
                            reason: 'Insufficient stock',
                            failed
                        }, data.sagaId);
                    } else {
                        correlationLogger.success('✅ Inventory reserved', { reserved });
                        publishEvent(channel, 'inventory.reserved', {
                            sagaId: data.sagaId,
                            orderId: data.orderId,
                            reserved
                        }, data.sagaId);
                    }

                } catch (err) {
                    correlationLogger.error('Reservation error', { error: err.message });
                    publishEvent(channel, 'inventory.failed', {
                        sagaId: data.sagaId,
                        orderId: data.orderId,
                        reason: err.message
                    }, data.sagaId);
                }

            } else if (type === 'command.inventory.release') {
                // COMPENSATING TRANSACTION
                correlationLogger.info('📨 Received saga command: release inventory (compensation)', {
                    orderId: data.orderId
                });

                try {
                    const products = await Product.find({ 'reservations.orderId': data.orderId });

                    for (const product of products) {
                        const reservation = product.reservations.find(
                            r => r.orderId === data.orderId
                        );
                        if (reservation) {
                            await Product.findOneAndUpdate(
                                { productId: product.productId },
                                {
                                    $inc: { quantity: reservation.quantity, reserved: -reservation.quantity },
                                    $pull: { reservations: { orderId: data.orderId } }
                                }
                            );
                            correlationLogger.info(`  ↩️ Released ${reservation.quantity}x ${product.productId}`);
                        }
                    }

                    publishEvent(channel, 'inventory.released', {
                        sagaId: data.sagaId,
                        orderId: data.orderId
                    }, data.sagaId);

                } catch (err) {
                    correlationLogger.error('Release error', { error: err.message });
                }
            }
        }
    );

    // ─── Setup HTTP routes ───
    const inventoryRoutes = createInventoryRoutes(channel, publishEvent);
    app.use('/', inventoryRoutes);

    // ─── Start HTTP server ───
    app.listen(PORT, () => {
        logger.success(`📦 Inventory Service running on port ${PORT}`);
    });
};

startUp().catch(err => {
    logger.error('Failed to start Inventory Service', { error: err.message });
    process.exit(1);
});
