/**
 * ============================================================
 * CIRCUIT BREAKER — Implementation using opossum
 * ============================================================
 * 
 * This is the CORE LEARNING PIECE for the Circuit Breaker pattern.
 * 
 * ANALOGY: Electrical Circuit Breaker
 * - In your house, a circuit breaker OPENS when too much current flows
 * - This PREVENTS damage to your appliances
 * - After the problem is fixed, you MANUALLY reset the breaker
 * - In software, it works the same way — but resets AUTOMATICALLY
 * 
 * THREE STATES:
 * 
 *   ┌──────────┐     failure threshold    ┌──────────┐
 *   │  CLOSED  │────────exceeded────────▶│   OPEN   │
 *   │ (normal) │                          │ (failing)│
 *   └──────────┘                          └──────────┘
 *        ▲                                     │
 *        │                              timeout expires
 *        │                                     │
 *        │        success                ┌──────────┐
 *        └─────────────────────────────◀│HALF-OPEN │
 *                                        │ (testing)│
 *                                        └──────────┘
 *                                             │
 *                                     failure again
 *                                             │
 *                                        ┌──────────┐
 *                                        │   OPEN   │
 *                                        └──────────┘
 * 
 * CLOSED (Normal Operation):
 *   - All requests pass through to the downstream service
 *   - Failures are counted
 *   - When failure rate exceeds threshold → switch to OPEN
 * 
 * OPEN (Service Down):
 *   - ALL requests are immediately rejected (fast fail)
 *   - No requests sent to failing service (gives it time to recover)
 *   - Returns fallback response immediately
 *   - After timeout expires → switch to HALF-OPEN
 * 
 * HALF-OPEN (Testing Recovery):
 *   - Let ONE request through to test if service has recovered
 *   - If success → switch to CLOSED (service recovered!)
 *   - If failure → switch back to OPEN (not recovered yet)
 * 
 * WHY USE IT?
 *   Without circuit breaker:
 *   - Client sends request → waits 30s for timeout → gets error
 *   - 1000 clients × 30s = 30,000 seconds of wasted resources
 *   - Cascading failure: YOUR service becomes slow because downstream is slow
 * 
 *   With circuit breaker:
 *   - First few failures → circuit opens
 *   - Remaining clients get instant fallback response (<1ms)
 *   - Downstream service gets breathing room to recover
 *   - Your service stays fast and responsive
 * 
 * ============================================================
 */

const CircuitBreaker = require('opossum');
const { createLogger } = require('../../../shared/logger');

const logger = createLogger('CircuitBreaker');

// Store all circuit breakers for monitoring
const breakers = new Map();

/**
 * Create a circuit breaker that wraps an HTTP call to a downstream service.
 * 
 * @param {string} serviceName - Name of the downstream service (for logging)
 * @param {Function} requestFn - Async function that makes the actual HTTP request
 * @param {Object} options - Circuit breaker configuration
 * @returns {CircuitBreaker} - opossum circuit breaker instance
 */
const createCircuitBreaker = (serviceName, requestFn, options = {}) => {
    const config = {
        timeout: parseInt(process.env.CB_TIMEOUT) || 5000,           // If request takes > 5s, count as failure
        errorThresholdPercentage: parseInt(process.env.CB_ERROR_THRESHOLD) || 50, // Open circuit when 50%+ requests fail
        resetTimeout: parseInt(process.env.CB_RESET_TIMEOUT) || 15000,  // Try again after 15s
        rollingCountTimeout: 10000,    // Time window for failure counting (10s)
        rollingCountBuckets: 10,       // Divide window into 10 buckets
        volumeThreshold: 3,            // Need at least 3 requests before calculating error %
        ...options
    };

    const breaker = new CircuitBreaker(requestFn, config);

    // ─── Event Listeners (Great for monitoring and debugging) ───

    breaker.on('success', (result) => {
        logger.info(`✅ [${serviceName}] Request succeeded`, {
            state: breaker.status.stats ? 'active' : 'unknown'
        });
    });

    breaker.on('timeout', () => {
        logger.warn(`⏰ [${serviceName}] Request TIMED OUT after ${config.timeout}ms`);
    });

    breaker.on('reject', () => {
        logger.warn(`🚫 [${serviceName}] Request REJECTED — circuit is OPEN`);
    });

    breaker.on('open', () => {
        logger.error(`🔴 [${serviceName}] Circuit OPENED — too many failures! Requests will be rejected for ${config.resetTimeout}ms`, {
            stats: breaker.stats
        });
    });

    breaker.on('halfOpen', () => {
        logger.warn(`🟡 [${serviceName}] Circuit HALF-OPEN — testing with one request...`);
    });

    breaker.on('close', () => {
        logger.success(`🟢 [${serviceName}] Circuit CLOSED — service recovered!`);
    });

    breaker.on('fallback', (result) => {
        logger.info(`🔄 [${serviceName}] Fallback response returned`);
    });

    // Store for monitoring
    breakers.set(serviceName, breaker);

    logger.info(`⚡ Circuit breaker created for '${serviceName}'`, {
        timeout: `${config.timeout}ms`,
        errorThreshold: `${config.errorThresholdPercentage}%`,
        resetTimeout: `${config.resetTimeout}ms`
    });

    return breaker;
};

/**
 * Get the status of all circuit breakers.
 * Useful for monitoring dashboards.
 */
const getCircuitStatus = () => {
    const status = {};
    for (const [name, breaker] of breakers) {
        const stats = breaker.stats;
        status[name] = {
            state: breaker.opened ? 'OPEN' : (breaker.halfOpen ? 'HALF_OPEN' : 'CLOSED'),
            stats: {
                successes: stats.successes,
                failures: stats.failures,
                timeouts: stats.timeouts,
                rejects: stats.rejects,
                fallbacks: stats.fallbacks,
                latencyMean: stats.latencyMean ? `${Math.round(stats.latencyMean)}ms` : 'N/A'
            },
            config: {
                timeout: breaker.options.timeout,
                errorThresholdPercentage: breaker.options.errorThresholdPercentage,
                resetTimeout: breaker.options.resetTimeout
            }
        };
    }
    return status;
};

/**
 * Make an HTTP request using Node's built-in fetch.
 * This is what gets wrapped by the circuit breaker.
 */
const makeHttpRequest = async (url, options = {}) => {
    const response = await fetch(url, {
        method: options.method || 'GET',
        headers: {
            'Content-Type': 'application/json',
            ...options.headers
        },
        body: options.body ? JSON.stringify(options.body) : undefined,
        signal: AbortSignal.timeout(10000)  // Hard timeout as safety net
    });

    if (!response.ok) {
        const error = new Error(`HTTP ${response.status}: ${response.statusText}`);
        error.status = response.status;
        error.body = await response.json().catch(() => null);
        throw error;
    }

    return response.json();
};

module.exports = { createCircuitBreaker, getCircuitStatus, makeHttpRequest };
