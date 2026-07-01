/**
 * API Gateway Routes
 * 
 * All external traffic enters through this gateway.
 * Each downstream service call is protected by a circuit breaker.
 */

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { createCircuitBreaker, getCircuitStatus, makeHttpRequest } = require('./circuit-breaker');
const { createLogger } = require('../../../shared/logger');

const logger = createLogger('APIGateway');

const createGatewayRoutes = () => {
    const router = express.Router();

    // ─── Service URLs ───
    const ORDER_SERVICE = process.env.ORDER_SERVICE_URL || 'http://order-service:3001';
    const PAYMENT_SERVICE = process.env.PAYMENT_SERVICE_URL || 'http://payment-service:3002';
    const INVENTORY_SERVICE = process.env.INVENTORY_SERVICE_URL || 'http://inventory-service:3003';
    const NOTIFICATION_SERVICE = process.env.NOTIFICATION_SERVICE_URL || 'http://notification-service:3004';

    // ─── Create Circuit Breakers for each downstream service ───

    const orderBreaker = createCircuitBreaker(
        'order-service',
        (url, opts) => makeHttpRequest(url, opts),
        { timeout: 10000 }  // Orders can take longer
    );
    orderBreaker.fallback(() => ({
        error: 'Order service is temporarily unavailable',
        fallback: true,
        message: 'Please try again in a few seconds'
    }));

    const paymentBreaker = createCircuitBreaker(
        'payment-service',
        (url, opts) => makeHttpRequest(url, opts),
        { timeout: 10000 }
    );
    paymentBreaker.fallback(() => ({
        error: 'Payment service is temporarily unavailable',
        fallback: true,
        message: 'Your payment will be processed when service recovers'
    }));

    const inventoryBreaker = createCircuitBreaker(
        'inventory-service',
        (url, opts) => makeHttpRequest(url, opts)
    );
    inventoryBreaker.fallback(() => ({
        error: 'Inventory service is temporarily unavailable',
        fallback: true,
        message: 'Unable to check stock at the moment'
    }));

    const notificationBreaker = createCircuitBreaker(
        'notification-service',
        (url, opts) => makeHttpRequest(url, opts),
        {
            timeout: 5000,
            errorThresholdPercentage: 40,  // More sensitive — open earlier
            resetTimeout: 10000
        }
    );
    notificationBreaker.fallback(() => ({
        error: 'Notification service is temporarily unavailable',
        fallback: true,
        message: 'Notification will be retried later'
    }));

    // ─── ORDER ENDPOINTS ───

    /**
     * POST /api/orders
     * Create a new order (proxied to order-service, circuit-protected)
     */
    router.post('/api/orders', async (req, res) => {
        try {
            const result = await orderBreaker.fire(
                `${ORDER_SERVICE}/orders`,
                { method: 'POST', body: req.body }
            );

            const statusCode = result.fallback ? 503 : 201;
            res.status(statusCode).json(result);
        } catch (err) {
            logger.error('Order creation failed', { error: err.message });
            res.status(500).json({ error: 'Failed to create order' });
        }
    });

    /**
     * GET /api/orders/:id
     * Get order status
     */
    router.get('/api/orders/:id', async (req, res) => {
        try {
            const result = await orderBreaker.fire(
                `${ORDER_SERVICE}/orders/${req.params.id}`
            );
            const statusCode = result.fallback ? 503 : 200;
            res.status(statusCode).json(result);
        } catch (err) {
            res.status(500).json({ error: 'Failed to fetch order' });
        }
    });

    /**
     * GET /api/orders
     * List orders
     */
    router.get('/api/orders', async (req, res) => {
        try {
            const result = await orderBreaker.fire(`${ORDER_SERVICE}/orders`);
            const statusCode = result.fallback ? 503 : 200;
            res.status(statusCode).json(result);
        } catch (err) {
            res.status(500).json({ error: 'Failed to fetch orders' });
        }
    });

    // ─── PAYMENT ENDPOINTS ───

    /**
     * POST /api/payments
     * Process a payment (with idempotency key forwarding)
     */
    router.post('/api/payments', async (req, res) => {
        const idempotencyKey = req.headers['idempotency-key'] || uuidv4();
        try {
            const result = await paymentBreaker.fire(
                `${PAYMENT_SERVICE}/payments`,
                {
                    method: 'POST',
                    body: req.body,
                    headers: { 'Idempotency-Key': idempotencyKey }
                }
            );
            const statusCode = result.fallback ? 503 : 201;
            res.status(statusCode).json(result);
        } catch (err) {
            res.status(500).json({ error: 'Failed to process payment' });
        }
    });

    // ─── INVENTORY ENDPOINTS ───

    /**
     * GET /api/inventory
     * List all products
     */
    router.get('/api/inventory', async (req, res) => {
        try {
            const result = await inventoryBreaker.fire(`${INVENTORY_SERVICE}/inventory`);
            const statusCode = result.fallback ? 503 : 200;
            res.status(statusCode).json(result);
        } catch (err) {
            res.status(500).json({ error: 'Failed to fetch inventory' });
        }
    });

    /**
     * GET /api/inventory/:productId
     * Check stock for a product
     */
    router.get('/api/inventory/:productId', async (req, res) => {
        try {
            const result = await inventoryBreaker.fire(
                `${INVENTORY_SERVICE}/inventory/${req.params.productId}`
            );
            const statusCode = result.fallback ? 503 : 200;
            res.status(statusCode).json(result);
        } catch (err) {
            res.status(500).json({ error: 'Failed to fetch inventory' });
        }
    });

    // ─── NOTIFICATION ENDPOINTS ───
    // These are the most interesting for circuit breaker demo!

    /**
     * POST /api/notify
     * Send a notification through the flaky notification service.
     * This is where you'll see the circuit breaker in action!
     */
    router.post('/api/notify', async (req, res) => {
        try {
            const result = await notificationBreaker.fire(
                `${NOTIFICATION_SERVICE}/notify`,
                { method: 'POST', body: req.body }
            );
            const statusCode = result.fallback ? 503 : 200;
            res.status(statusCode).json({
                ...result,
                circuitState: notificationBreaker.opened ? 'OPEN' : 
                    (notificationBreaker.halfOpen ? 'HALF_OPEN' : 'CLOSED')
            });
        } catch (err) {
            res.status(500).json({
                error: 'Notification failed',
                circuitState: notificationBreaker.opened ? 'OPEN' : 'CLOSED'
            });
        }
    });

    /**
     * POST /api/chaos/enable, /api/chaos/disable
     * Control chaos on the notification service through the gateway
     */
    router.post('/api/chaos/enable', async (req, res) => {
        try {
            const result = await makeHttpRequest(
                `${NOTIFICATION_SERVICE}/chaos/enable`,
                { method: 'POST' }
            );
            res.json(result);
        } catch (err) {
            res.status(500).json({ error: 'Failed to enable chaos' });
        }
    });

    router.post('/api/chaos/disable', async (req, res) => {
        try {
            const result = await makeHttpRequest(
                `${NOTIFICATION_SERVICE}/chaos/disable`,
                { method: 'POST' }
            );
            res.json(result);
        } catch (err) {
            res.status(500).json({ error: 'Failed to disable chaos' });
        }
    });

    router.post('/api/chaos/config', async (req, res) => {
        try {
            const result = await makeHttpRequest(
                `${NOTIFICATION_SERVICE}/chaos/config`,
                { method: 'POST', body: req.body }
            );
            res.json(result);
        } catch (err) {
            res.status(500).json({ error: 'Failed to update chaos config' });
        }
    });

    // ─── MONITORING ENDPOINTS ───

    /**
     * GET /api/circuit-status
     * 
     * Dashboard data: shows the state of ALL circuit breakers.
     * This is what you'd display on a monitoring dashboard.
     */
    router.get('/api/circuit-status', (req, res) => {
        res.json({
            timestamp: new Date().toISOString(),
            breakers: getCircuitStatus()
        });
    });

    /**
     * GET /api/health
     * Gateway health check
     */
    router.get('/api/health', (req, res) => {
        const circuitStatus = getCircuitStatus();
        const anyOpen = Object.values(circuitStatus).some(b => b.state === 'OPEN');

        res.json({
            status: anyOpen ? 'degraded' : 'healthy',
            service: 'api-gateway',
            circuits: circuitStatus
        });
    });

    return router;
};

module.exports = { createGatewayRoutes };
