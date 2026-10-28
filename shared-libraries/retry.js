/**
 * Shared Retry Utility
 * 
 * Extracted from the original producer/consumer code.
 * Provides configurable retry logic with exponential backoff
 * for connecting to external services (RabbitMQ, databases, etc.).
 */

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Retry a connection function with configurable backoff.
 * 
 * @param {Function} connectFn - Async function that attempts the connection
 * @param {string} serviceName - Name for logging (e.g., 'RabbitMQ', 'PostgreSQL')
 * @param {Object} options - Configuration options
 * @param {number} options.maxRetries - Maximum number of retry attempts (default: 15)
 * @param {number} options.initialDelay - Initial delay in ms (default: 2000)
 * @param {number} options.maxDelay - Maximum delay in ms (default: 30000)
 * @param {number} options.backoffMultiplier - Multiplier for exponential backoff (default: 1.5)
 * @returns {Promise<*>} - Result of the connectFn
 */
const connectWithRetry = async (connectFn, serviceName, options = {}) => {
    const {
        maxRetries = 15,
        initialDelay = 2000,
        maxDelay = 30000,
        backoffMultiplier = 1.5
    } = options;

    let delay = initialDelay;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const result = await connectFn();
            console.log(`✅ ${serviceName} connected successfully (attempt ${attempt})`);
            return result;
        } catch (err) {
            console.error(`❌ ${serviceName} connection failed (attempt ${attempt}/${maxRetries}): ${err.message}`);

            if (attempt === maxRetries) {
                throw new Error(`Failed to connect to ${serviceName} after ${maxRetries} attempts: ${err.message}`);
            }

            console.log(`⏳ Retrying ${serviceName} in ${delay}ms...`);
            await sleep(delay);
            delay = Math.min(delay * backoffMultiplier, maxDelay);
        }
    }
};

module.exports = { connectWithRetry, sleep };
