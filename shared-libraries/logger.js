/**
 * Shared Logger Utility
 * 
 * Structured JSON logging with correlation IDs.
 * Helps trace requests across services — critical for
 * understanding saga flows and debugging distributed systems.
 */

const createLogger = (serviceName) => {
    const log = (level, message, meta = {}) => {
        const entry = {
            timestamp: new Date().toISOString(),
            service: serviceName,
            level,
            message,
            ...meta
        };
        
        const color = {
            INFO: '\x1b[36m',    // Cyan
            WARN: '\x1b[33m',    // Yellow
            ERROR: '\x1b[31m',   // Red
            SUCCESS: '\x1b[32m', // Green
            DEBUG: '\x1b[90m',   // Gray
        }[level] || '\x1b[0m';

        const reset = '\x1b[0m';
        const bold = '\x1b[1m';

        // Pretty format for development
        const metaStr = Object.keys(meta).length > 0
            ? ` ${JSON.stringify(meta)}`
            : '';

        console.log(
            `${color}[${entry.timestamp}] ${bold}[${serviceName}]${reset}${color} ${level}: ${message}${metaStr}${reset}`
        );
    };

    return {
        info: (message, meta) => log('INFO', message, meta),
        warn: (message, meta) => log('WARN', message, meta),
        error: (message, meta) => log('ERROR', message, meta),
        success: (message, meta) => log('SUCCESS', message, meta),
        debug: (message, meta) => log('DEBUG', message, meta),

        // Log with a correlation/saga ID for tracing across services
        withCorrelation: (correlationId) => ({
            info: (message, meta) => log('INFO', message, { correlationId, ...meta }),
            warn: (message, meta) => log('WARN', message, { correlationId, ...meta }),
            error: (message, meta) => log('ERROR', message, { correlationId, ...meta }),
            success: (message, meta) => log('SUCCESS', message, { correlationId, ...meta }),
            debug: (message, meta) => log('DEBUG', message, { correlationId, ...meta }),
        })
    };
};

module.exports = { createLogger };
