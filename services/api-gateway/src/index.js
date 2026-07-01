/**
 * ============================================================
 * API GATEWAY — Entry Point
 * ============================================================
 * 
 * Demonstrates: CIRCUIT BREAKER PATTERN
 * 
 * The single entry point for all external traffic.
 * Routes requests to downstream services with circuit breakers.
 * 
 * All requests go through: Client → API Gateway → Service
 *   - If service is healthy → request proxied normally
 *   - If service is failing → circuit opens → fallback response
 *   - After timeout → circuit half-opens → tests with one request
 *   - If test succeeds → circuit closes → normal operation
 * 
 * ============================================================
 */

const express = require('express');
const { createLogger } = require('../../../shared/logger');
const { createGatewayRoutes } = require('./routes');

const app = express();
app.use(express.json());

const logger = createLogger('APIGateway');
const PORT = process.env.API_GATEWAY_PORT || 3000;

// ─── Request logging middleware ───
app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
        const duration = Date.now() - start;
        const color = res.statusCode >= 400 ? 'warn' : 'info';
        logger[color](`${req.method} ${req.path} → ${res.statusCode} (${duration}ms)`);
    });
    next();
});

// ─── CORS for browser access ───
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Idempotency-Key');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE');
    if (req.method === 'OPTIONS') return res.sendStatus(200);
    next();
});

// ─── Setup routes ───
const gatewayRoutes = createGatewayRoutes();
app.use('/', gatewayRoutes);

// ─── Root endpoint ───
app.get('/', (req, res) => {
    res.json({
        service: 'API Gateway',
        message: 'Microservices Mastery — Learning Project',
        endpoints: {
            orders: {
                'POST /api/orders': 'Create order (starts saga)',
                'GET /api/orders': 'List orders',
                'GET /api/orders/:id': 'Get order status'
            },
            payments: {
                'POST /api/payments': 'Process payment (idempotent — use Idempotency-Key header)'
            },
            inventory: {
                'GET /api/inventory': 'List products',
                'GET /api/inventory/:productId': 'Check stock'
            },
            notifications: {
                'POST /api/notify': 'Send notification (circuit-breaker protected)'
            },
            monitoring: {
                'GET /api/circuit-status': 'Circuit breaker dashboard',
                'GET /api/health': 'Gateway health'
            },
            chaos: {
                'POST /api/chaos/enable': 'Enable chaos on notification service',
                'POST /api/chaos/disable': 'Disable chaos',
                'POST /api/chaos/config': 'Configure chaos (failureRate, latencyMaxMs)'
            }
        }
    });
});

// ─── Start server ───
app.listen(PORT, () => {
    logger.success(`🌐 API Gateway running on port ${PORT}`);
    logger.info('  All traffic enters through this gateway');
    logger.info('  Circuit breakers are protecting downstream services');
    logger.info(`  Visit http://localhost:${PORT} for endpoint listing`);
});
