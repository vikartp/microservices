/**
 * Shared RabbitMQ Connection Utility
 * 
 * Reusable RabbitMQ connection helper with:
 * - Retry logic for initial connection
 * - Event publishing with correlation IDs
 * - Event consuming with automatic ack/nack
 * - Exchange and queue management
 */

const amqplib = require('amqplib');
const { connectWithRetry } = require('./retry');
const { createLogger } = require('./logger');
const { randomUUID } = require('crypto');

const logger = createLogger('RabbitMQ');

// Exchange name for saga events
const SAGA_EXCHANGE = 'saga_events';

/**
 * Connect to RabbitMQ with retry logic.
 * Sets up the saga exchange and returns connection + channel.
 */
const connectRabbitMQ = async (uri) => {
    let connection;
    let channel;

    await connectWithRetry(async () => {
        connection = await amqplib.connect(uri);
        channel = await connection.createChannel();

        // Create the main exchange for saga events (topic exchange for flexible routing)
        await channel.assertExchange(SAGA_EXCHANGE, 'topic', { durable: true });

        logger.success('Connected and exchange ready', { exchange: SAGA_EXCHANGE });
    }, 'RabbitMQ');

    // Handle connection errors
    connection.on('error', (err) => {
        logger.error('Connection error', { error: err.message });
    });

    connection.on('close', () => {
        logger.warn('Connection closed');
    });

    return { connection, channel };
};

/**
 * Publish an event to the saga exchange.
 * 
 * @param {Object} channel - AMQP channel
 * @param {string} routingKey - Event routing key (e.g., 'order.created', 'payment.success')
 * @param {Object} data - Event payload
 * @param {string} correlationId - Correlation ID for tracing (auto-generated if not provided)
 */
const publishEvent = (channel, routingKey, data, correlationId = null) => {
    const id = correlationId || randomUUID();
    const message = {
        id: randomUUID(),
        correlationId: id,
        type: routingKey,
        data,
        timestamp: new Date().toISOString()
    };

    channel.publish(
        SAGA_EXCHANGE,
        routingKey,
        Buffer.from(JSON.stringify(message)),
        {
            persistent: true,
            correlationId: id,
            messageId: message.id,
            timestamp: Date.now()
        }
    );

    logger.info(`Published event: ${routingKey}`, { correlationId: id });
    return message;
};

/**
 * Subscribe to events matching a routing pattern.
 * 
 * @param {Object} channel - AMQP channel
 * @param {string} queueName - Queue name
 * @param {string|string[]} routingPatterns - Routing key patterns (e.g., 'order.*', 'payment.#')
 * @param {Function} handler - Async function(message, rawMsg) to process the event
 * @param {Object} options - Additional options
 * @param {number} options.prefetch - Prefetch count (default: 1)
 */
const consumeEvents = async (channel, queueName, routingPatterns, handler, options = {}) => {
    const { prefetch = 1 } = options;

    // Assert queue
    await channel.assertQueue(queueName, { durable: true });

    // Bind queue to exchange with routing patterns
    const patterns = Array.isArray(routingPatterns) ? routingPatterns : [routingPatterns];
    for (const pattern of patterns) {
        await channel.bindQueue(queueName, SAGA_EXCHANGE, pattern);
        logger.info(`Queue '${queueName}' bound to pattern '${pattern}'`);
    }

    // Set prefetch
    channel.prefetch(prefetch);

    // Start consuming
    channel.consume(queueName, async (msg) => {
        if (!msg) {
            logger.warn('Consumer cancelled by server');
            return;
        }

        try {
            const message = JSON.parse(msg.content.toString());
            logger.info(`Received event: ${message.type}`, { correlationId: message.correlationId });

            await handler(message, msg);
            channel.ack(msg);
        } catch (err) {
            logger.error(`Error processing message: ${err.message}`, {
                queue: queueName,
                error: err.message
            });
            // Reject and don't requeue (send to dead letter queue if configured)
            channel.nack(msg, false, false);
        }
    });

    logger.success(`Consuming from queue '${queueName}'`);
};

module.exports = {
    connectRabbitMQ,
    publishEvent,
    consumeEvents,
    SAGA_EXCHANGE
};
