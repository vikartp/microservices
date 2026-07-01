/**
 * Inventory Service Routes
 * 
 * Demonstrates COMPENSATING TRANSACTIONS in the saga pattern.
 * 
 * Reserve stock → if later step fails → Release stock (compensate)
 */

const express = require('express');
const { createLogger } = require('../../../shared/logger');
const { Product } = require('./models/product');

const logger = createLogger('InventoryRoutes');

const createInventoryRoutes = (channel, publishEvent) => {
    const router = express.Router();

    /**
     * POST /inventory/reserve
     * 
     * Reserve inventory for an order.
     * This is a FORWARD action in the saga.
     * Uses MongoDB's atomic operations to prevent overselling.
     * 
     * Body: { orderId, sagaId, items: [{ productId, quantity }] }
     */
    router.post('/inventory/reserve', async (req, res) => {
        const { orderId, sagaId, items } = req.body;
        const correlationLogger = logger.withCorrelation(sagaId);

        if (!orderId || !items || items.length === 0) {
            return res.status(400).json({ error: 'Missing orderId or items' });
        }

        correlationLogger.info('📦 Attempting to reserve inventory', {
            orderId,
            itemCount: items.length
        });

        const reserved = [];
        const failed = [];

        try {
            for (const item of items) {
                // Atomic operation: decrement quantity only if sufficient stock
                const product = await Product.findOneAndUpdate(
                    {
                        productId: item.productId,
                        quantity: { $gte: item.quantity }  // Only if enough stock
                    },
                    {
                        $inc: {
                            quantity: -item.quantity,   // Decrease available
                            reserved: item.quantity      // Increase reserved
                        },
                        $push: {
                            reservations: {
                                orderId,
                                sagaId,
                                quantity: item.quantity,
                                reservedAt: new Date()
                            }
                        }
                    },
                    { new: true }
                );

                if (product) {
                    reserved.push({
                        productId: item.productId,
                        quantity: item.quantity,
                        remainingStock: product.quantity
                    });
                    correlationLogger.info(`  ✅ Reserved ${item.quantity}x ${item.productId}`, {
                        remaining: product.quantity
                    });
                } else {
                    const existing = await Product.findOne({ productId: item.productId });
                    failed.push({
                        productId: item.productId,
                        requested: item.quantity,
                        available: existing ? existing.quantity : 0,
                        reason: existing ? 'Insufficient stock' : 'Product not found'
                    });
                    correlationLogger.warn(`  ❌ Failed to reserve ${item.productId}`, {
                        requested: item.quantity,
                        available: existing?.quantity || 0
                    });
                }
            }

            // If ANY item failed, roll back ALL reservations for this order
            if (failed.length > 0) {
                correlationLogger.warn('⚠️ Partial reservation failed — rolling back all reservations');

                // Release all items we just reserved
                for (const item of reserved) {
                    await Product.findOneAndUpdate(
                        { productId: item.productId },
                        {
                            $inc: {
                                quantity: item.quantity,
                                reserved: -item.quantity
                            },
                            $pull: {
                                reservations: { orderId, sagaId }
                            }
                        }
                    );
                }

                return res.status(409).json({
                    error: 'Inventory reservation failed',
                    failed,
                    orderId,
                    sagaId
                });
            }

            correlationLogger.success('✅ All inventory reserved successfully', {
                orderId,
                reservedItems: reserved.length
            });

            res.json({
                orderId,
                sagaId,
                reserved,
                status: 'RESERVED'
            });

        } catch (err) {
            correlationLogger.error('Reservation error', { error: err.message });
            res.status(500).json({ error: 'Failed to reserve inventory' });
        }
    });

    /**
     * POST /inventory/release
     * 
     * COMPENSATING TRANSACTION: Release previously reserved inventory.
     * Called by the saga orchestrator when a later step fails.
     * 
     * This is the "undo" for /inventory/reserve.
     * 
     * Body: { orderId, sagaId }
     */
    router.post('/inventory/release', async (req, res) => {
        const { orderId, sagaId } = req.body;
        const correlationLogger = logger.withCorrelation(sagaId);

        correlationLogger.info('📦 Releasing reserved inventory (compensation)', { orderId });

        try {
            // Find all products with reservations for this order
            const products = await Product.find({
                'reservations.orderId': orderId
            });

            const released = [];

            for (const product of products) {
                const reservation = product.reservations.find(
                    r => r.orderId === orderId
                );

                if (reservation) {
                    // Restore the reserved quantity back to available
                    await Product.findOneAndUpdate(
                        { productId: product.productId },
                        {
                            $inc: {
                                quantity: reservation.quantity,
                                reserved: -reservation.quantity
                            },
                            $pull: {
                                reservations: { orderId }
                            }
                        }
                    );

                    released.push({
                        productId: product.productId,
                        quantity: reservation.quantity
                    });

                    correlationLogger.info(`  ↩️ Released ${reservation.quantity}x ${product.productId}`);
                }
            }

            correlationLogger.success('✅ Inventory released', {
                orderId,
                releasedItems: released.length
            });

            res.json({
                orderId,
                sagaId,
                released,
                status: 'RELEASED'
            });

        } catch (err) {
            correlationLogger.error('Release error', { error: err.message });
            res.status(500).json({ error: 'Failed to release inventory' });
        }
    });

    /**
     * GET /inventory/:productId
     * Check stock level for a product
     */
    router.get('/inventory/:productId', async (req, res) => {
        try {
            const product = await Product.findOne({
                productId: req.params.productId
            });
            if (!product) {
                return res.status(404).json({ error: 'Product not found' });
            }
            res.json({
                productId: product.productId,
                name: product.name,
                available: product.quantity,
                reserved: product.reserved,
                totalStock: product.quantity + product.reserved
            });
        } catch (err) {
            res.status(500).json({ error: 'Failed to fetch inventory' });
        }
    });

    /**
     * GET /inventory
     * List all products with stock levels
     */
    router.get('/inventory', async (req, res) => {
        try {
            const products = await Product.find({}).lean();
            res.json(products.map(p => ({
                productId: p.productId,
                name: p.name,
                price: p.price,
                available: p.quantity,
                reserved: p.reserved
            })));
        } catch (err) {
            res.status(500).json({ error: 'Failed to fetch inventory' });
        }
    });

    /**
     * GET /health
     */
    router.get('/health', (req, res) => {
        res.json({ status: 'healthy', service: 'inventory-service' });
    });

    return router;
};

module.exports = { createInventoryRoutes };
