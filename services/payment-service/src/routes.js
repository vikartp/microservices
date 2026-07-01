/**
 * Payment Service Routes
 * 
 * Demonstrates the IDEMPOTENCY pattern in action.
 * 
 * Key endpoints:
 * - POST /payments     — Process a payment (protected by idempotency middleware)
 * - POST /payments/:id/refund — Refund a payment (compensating transaction for saga)
 * - GET  /payments/:id — Get payment status
 */

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { createLogger } = require('../../../shared/logger');
const { createIdempotencyMiddleware } = require('./idempotency');

const logger = createLogger('PaymentRoutes');

const createPaymentRoutes = (Payment, redisClient, channel, publishEvent) => {
    const router = express.Router();

    // Apply idempotency middleware to payment creation
    const idempotencyMiddleware = createIdempotencyMiddleware(redisClient);

    /**
     * POST /payments
     * 
     * Process a payment. This endpoint is IDEMPOTENT:
     * - First request: processes payment, returns result
     * - Duplicate request (same Idempotency-Key): returns cached result
     * - Concurrent request (same key): returns 409 Conflict
     * 
     * Headers:
     *   Idempotency-Key: <unique-key>  (required for idempotency)
     * 
     * Body:
     *   { orderId, amount, currency, sagaId }
     */
    router.post('/payments', idempotencyMiddleware, async (req, res) => {
        const { orderId, amount, currency = 'USD', sagaId } = req.body;
        const idempotencyKey = req.headers['idempotency-key'];

        if (!orderId || !amount) {
            return res.status(400).json({
                error: 'Missing required fields',
                required: ['orderId', 'amount']
            });
        }

        const correlationLogger = logger.withCorrelation(sagaId || idempotencyKey);

        try {
            correlationLogger.info('💳 Processing payment...', { orderId, amount, currency });

            // ─── Simulate payment processing delay ───
            // In real life, this would call Stripe/PayPal/etc.
            // The delay makes it easy to test concurrent requests
            await new Promise(resolve => setTimeout(resolve, 2000));

            // ─── Simulate occasional payment failures (10% failure rate) ───
            if (Math.random() < 0.1) {
                correlationLogger.error('Payment processing failed (simulated)');

                // Publish failure event for saga
                if (sagaId && publishEvent) {
                    publishEvent(channel, 'payment.failed', {
                        sagaId,
                        orderId,
                        reason: 'Payment processor declined'
                    }, sagaId);
                }

                return res.status(402).json({
                    error: 'Payment declined',
                    orderId,
                    status: 'FAILED'
                });
            }

            // ─── Create payment record in database ───
            const payment = await Payment.create({
                id: uuidv4(),
                orderId,
                amount,
                currency,
                status: 'COMPLETED',
                idempotencyKey,
                metadata: { sagaId }
            });

            correlationLogger.success('✅ Payment processed successfully', {
                paymentId: payment.id,
                amount: `${currency} ${amount}`
            });

            // Publish success event for saga
            if (sagaId && publishEvent) {
                publishEvent(channel, 'payment.success', {
                    sagaId,
                    orderId,
                    paymentId: payment.id,
                    amount,
                    currency
                }, sagaId);
            }

            res.status(201).json({
                paymentId: payment.id,
                orderId,
                amount,
                currency,
                status: 'COMPLETED',
                message: 'Payment processed successfully'
            });

        } catch (err) {
            // Handle database unique constraint violation
            // This is the SAFETY NET — if Redis idempotency check fails,
            // the database constraint catches the duplicate
            if (err.name === 'SequelizeUniqueConstraintError') {
                correlationLogger.warn('🛡️ Database-level idempotency caught duplicate!');
                const existing = await Payment.findOne({ where: { idempotencyKey } });
                return res.status(200).json({
                    paymentId: existing.id,
                    orderId: existing.orderId,
                    amount: existing.amount,
                    status: existing.status,
                    message: 'Payment already processed (caught by database constraint)'
                });
            }

            correlationLogger.error('Payment processing error', { error: err.message });
            res.status(500).json({ error: 'Internal server error' });
        }
    });

    /**
     * POST /payments/:id/refund
     * 
     * COMPENSATING TRANSACTION for the saga pattern.
     * When inventory reservation fails AFTER payment succeeds,
     * the saga orchestrator calls this to refund the payment.
     */
    router.post('/payments/:id/refund', async (req, res) => {
        const { id } = req.params;
        const { sagaId, reason } = req.body;
        const correlationLogger = logger.withCorrelation(sagaId || id);

        try {
            const payment = await Payment.findByPk(id);

            if (!payment) {
                return res.status(404).json({ error: 'Payment not found' });
            }

            if (payment.status === 'REFUNDED') {
                correlationLogger.info('Payment already refunded (idempotent refund)');
                return res.status(200).json({
                    paymentId: payment.id,
                    status: 'REFUNDED',
                    message: 'Payment was already refunded'
                });
            }

            if (payment.status !== 'COMPLETED') {
                return res.status(400).json({
                    error: 'Cannot refund',
                    message: `Payment status is ${payment.status}, can only refund COMPLETED payments`
                });
            }

            // Process refund
            correlationLogger.info('💸 Processing refund...', {
                paymentId: id,
                amount: payment.amount,
                reason
            });

            payment.status = 'REFUNDED';
            payment.refundedAt = new Date();
            payment.metadata = { ...payment.metadata, refundReason: reason };
            await payment.save();

            correlationLogger.success('✅ Refund processed', { paymentId: id });

            // Publish refund event
            if (sagaId && publishEvent) {
                publishEvent(channel, 'payment.refunded', {
                    sagaId,
                    paymentId: id,
                    orderId: payment.orderId,
                    amount: payment.amount
                }, sagaId);
            }

            res.json({
                paymentId: payment.id,
                orderId: payment.orderId,
                amount: payment.amount,
                status: 'REFUNDED',
                refundedAt: payment.refundedAt
            });

        } catch (err) {
            correlationLogger.error('Refund error', { error: err.message });
            res.status(500).json({ error: 'Failed to process refund' });
        }
    });

    /**
     * GET /payments/:id
     * Get payment status
     */
    router.get('/payments/:id', async (req, res) => {
        try {
            const payment = await Payment.findByPk(req.params.id);
            if (!payment) {
                return res.status(404).json({ error: 'Payment not found' });
            }
            res.json(payment);
        } catch (err) {
            res.status(500).json({ error: 'Failed to fetch payment' });
        }
    });

    /**
     * GET /health
     * Health check
     */
    router.get('/health', (req, res) => {
        res.json({ status: 'healthy', service: 'payment-service' });
    });

    return router;
};

module.exports = { createPaymentRoutes };
