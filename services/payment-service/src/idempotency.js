/**
 * ============================================================
 * IDEMPOTENCY MIDDLEWARE
 * ============================================================
 * 
 * This is the CORE LEARNING PIECE for the idempotency pattern.
 * 
 * WHAT IS IDEMPOTENCY?
 * An operation is idempotent if performing it multiple times
 * produces the same result as performing it once.
 * 
 * WHY DO WE NEED IT?
 * In distributed systems, network failures can cause:
 * - Client retries (user clicks "Pay" twice)
 * - Message redelivery (RabbitMQ redelivers after timeout)
 * - Load balancer retries (upstream timeout, retry on different server)
 * 
 * Without idempotency, a payment could be charged MULTIPLE TIMES!
 * 
 * HOW IT WORKS:
 * 1. Client sends request with unique "Idempotency-Key" header
 * 2. Middleware checks Redis for this key
 * 3. If key exists + completed → return cached response (NO re-processing!)
 * 4. If key exists + processing → return 409 Conflict (concurrent request)
 * 5. If key doesn't exist → mark as "processing", proceed with handler
 * 6. After handler completes → cache the response with the key
 * 
 * REAL-WORLD EXAMPLES:
 * - Stripe: Requires Idempotency-Key header on POST requests
 * - AWS: Uses client tokens for idempotent API calls
 * - PayPal: Uses request-id for idempotent operations
 * 
 * ============================================================
 */

const { createLogger } = require('../../../shared/logger');
const logger = createLogger('Idempotency');

/**
 * Creates an idempotency middleware that uses Redis for key storage.
 * 
 * @param {Object} redisClient - ioredis client instance
 * @param {Object} options - Configuration
 * @param {number} options.ttlSeconds - How long to keep idempotency keys (default: 86400 = 24h)
 * @param {string} options.keyPrefix - Redis key prefix (default: 'idempotency:')
 * @returns {Function} Express middleware
 */
const createIdempotencyMiddleware = (redisClient, options = {}) => {
    const {
        ttlSeconds = 86400,    // 24 hours
        keyPrefix = 'idempotency:'
    } = options;

    return async (req, res, next) => {
        // ─── Step 1: Extract the idempotency key from the request header ───
        const idempotencyKey = req.headers['idempotency-key'];

        if (!idempotencyKey) {
            // No idempotency key provided — this is NOT idempotent!
            // In production, you might want to REQUIRE this header.
            logger.warn('No Idempotency-Key header provided — request is NOT idempotent');
            return next();
        }

        const redisKey = `${keyPrefix}${idempotencyKey}`;
        const correlationLogger = logger.withCorrelation(idempotencyKey);

        try {
            // ─── Step 2: Check if this key already exists in Redis ───
            const existing = await redisClient.get(redisKey);

            if (existing) {
                const cached = JSON.parse(existing);

                // ─── Step 3a: Key exists and is COMPLETED → return cached response ───
                if (cached.status === 'completed') {
                    correlationLogger.info('⚡ IDEMPOTENT HIT — Returning cached response (no re-processing!)', {
                        originalTimestamp: cached.completedAt,
                        statusCode: cached.statusCode
                    });

                    return res
                        .status(cached.statusCode)
                        .set('X-Idempotent-Replayed', 'true')  // Tell client this is a replay
                        .json(cached.body);
                }

                // ─── Step 3b: Key exists and is PROCESSING → concurrent request! ───
                if (cached.status === 'processing') {
                    correlationLogger.warn('⚠️ CONCURRENT REQUEST — Same idempotency key is currently being processed');

                    return res.status(409).json({
                        error: 'Conflict',
                        message: 'A request with this idempotency key is currently being processed. Please retry later.',
                        idempotencyKey
                    });
                }

                // ─── Step 3c: Key exists but FAILED → allow retry ───
                if (cached.status === 'failed') {
                    correlationLogger.info('Previous request with this key failed — allowing retry');
                    // Fall through to process the request again
                }
            }

            // ─── Step 4: New key — mark as "processing" in Redis ───
            // Use SET with NX (Not eXists) to prevent race conditions
            const lockAcquired = await redisClient.set(
                redisKey,
                JSON.stringify({
                    status: 'processing',
                    startedAt: new Date().toISOString(),
                    method: req.method,
                    path: req.path
                }),
                'EX', ttlSeconds,  // Set TTL
                'NX'               // Only set if not exists
            );

            if (!lockAcquired) {
                // Another request grabbed the lock between our GET and SET
                // This is a race condition — return conflict
                correlationLogger.warn('Race condition detected — another request grabbed the lock');
                return res.status(409).json({
                    error: 'Conflict',
                    message: 'A request with this idempotency key is currently being processed.',
                    idempotencyKey
                });
            }

            correlationLogger.info('🔑 New idempotency key — processing request');

            // ─── Step 5: Override res.json to capture the response ───
            // We intercept the response so we can cache it in Redis
            const originalJson = res.json.bind(res);

            res.json = async (body) => {
                try {
                    // Cache the successful response
                    await redisClient.set(
                        redisKey,
                        JSON.stringify({
                            status: 'completed',
                            statusCode: res.statusCode,
                            body,
                            completedAt: new Date().toISOString(),
                            method: req.method,
                            path: req.path
                        }),
                        'EX', ttlSeconds
                    );

                    correlationLogger.success('✅ Response cached for idempotency key', {
                        statusCode: res.statusCode,
                        ttlSeconds
                    });
                } catch (cacheErr) {
                    correlationLogger.error('Failed to cache response', { error: cacheErr.message });
                    // Don't fail the request — caching is best-effort
                }

                return originalJson(body);
            };

            // ─── Step 6: Attach error handler for failed requests ───
            // If the handler throws, mark the key as "failed" so retries are allowed
            const originalEnd = res.end.bind(res);
            res.on('finish', async () => {
                if (res.statusCode >= 500) {
                    try {
                        await redisClient.set(
                            redisKey,
                            JSON.stringify({
                                status: 'failed',
                                statusCode: res.statusCode,
                                failedAt: new Date().toISOString()
                            }),
                            'EX', ttlSeconds
                        );
                        correlationLogger.warn('Request failed — key marked as failed (retries allowed)');
                    } catch (err) {
                        // Best effort
                    }
                }
            });

            next();

        } catch (err) {
            correlationLogger.error('Idempotency middleware error', { error: err.message });
            // If Redis is down, let the request through (fail open)
            // This is a design decision — you could also fail closed (reject request)
            next();
        }
    };
};

module.exports = { createIdempotencyMiddleware };
