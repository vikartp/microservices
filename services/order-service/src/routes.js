/**
 * Order Service Routes
 * 
 * Creates orders and initiates the saga flow.
 * Also handles saga commands (cancel order, update status).
 */

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { createLogger } = require('../../../shared/logger');

const logger = createLogger('OrderRoutes');

const createOrderRoutes = (Order, channel, publishEvent) => {
    const router = express.Router();

    /**
     * POST /orders
     * 
     * Create a new order and kick off the saga.
     * 
     * Body:
     *   {
     *     customerId: "customer-123",
     *     items: [
     *       { productId: "prod-1", quantity: 2, price: 29.99 },
     *       { productId: "prod-2", quantity: 1, price: 49.99 }
     *     ]
     *   }
     */
    router.post('/orders', async (req, res) => {
        const { customerId, items } = req.body;

        if (!customerId || !items || items.length === 0) {
            return res.status(400).json({
                error: 'Missing required fields',
                required: ['customerId', 'items']
            });
        }

        try {
            // Calculate total
            const totalAmount = items.reduce((sum, item) => {
                return sum + (item.price * item.quantity);
            }, 0);

            const sagaId = uuidv4();

            // Create order in database
            const order = await Order.create({
                id: uuidv4(),
                customerId,
                items,
                totalAmount: totalAmount.toFixed(2),
                status: 'CREATED',
                sagaId
            });

            logger.success('📦 Order created — initiating saga', {
                orderId: order.id,
                sagaId,
                totalAmount,
                itemCount: items.length
            });

            // ─── SAGA STARTS HERE ───
            // Publish order.created event → saga orchestrator picks it up
            publishEvent(channel, 'order.created', {
                sagaId,
                orderId: order.id,
                customerId,
                items,
                totalAmount: parseFloat(totalAmount.toFixed(2)),
                currency: 'USD'
            }, sagaId);

            res.status(201).json({
                orderId: order.id,
                sagaId,
                status: order.status,
                totalAmount,
                message: 'Order created — processing via saga'
            });

        } catch (err) {
            logger.error('Failed to create order', { error: err.message });
            res.status(500).json({ error: 'Failed to create order' });
        }
    });

    /**
     * GET /orders/:id
     * 
     * Get order with current saga status.
     * Useful for polling after order creation.
     */
    router.get('/orders/:id', async (req, res) => {
        try {
            const order = await Order.findByPk(req.params.id);
            if (!order) {
                return res.status(404).json({ error: 'Order not found' });
            }
            res.json(order);
        } catch (err) {
            res.status(500).json({ error: 'Failed to fetch order' });
        }
    });

    /**
     * GET /orders
     * 
     * List recent orders
     */
    router.get('/orders', async (req, res) => {
        try {
            const orders = await Order.findAll({
                order: [['created_at', 'DESC']],
                limit: 50
            });
            res.json(orders);
        } catch (err) {
            res.status(500).json({ error: 'Failed to fetch orders' });
        }
    });

    /**
     * GET /health
     */
    router.get('/health', (req, res) => {
        res.json({ status: 'healthy', service: 'order-service' });
    });

    return router;
};

module.exports = { createOrderRoutes };
