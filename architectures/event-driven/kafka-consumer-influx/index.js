/**
 * ============================================================
 * KAFKA CONSUMER → InfluxDB
 * ============================================================
 *
 * Consumes PARTITION 0 of the "telemetry" topic.
 * Partition 0 contains temperature/humidity sensor readings.
 *
 * Writes each data point to InfluxDB using the Line Protocol:
 *   measurement,tag1=val1,tag2=val2 field1=val1,field2=val2 timestamp
 *
 * Example InfluxDB point:
 *   temperature,deviceId=sensor-001,location=warehouse-A value=23.5,humidity=55.2 1704067200000000000
 *
 * CONSUMER KEY CONCEPTS:
 *   - Consumer Group: Multiple consumers sharing a group ID
 *     divide partitions among themselves (horizontal scaling)
 *   - Offset: The position in the partition. Kafka tracks where
 *     each consumer group has read up to.
 *   - Manual Partition Assignment: Instead of letting Kafka
 *     auto-assign partitions, we explicitly subscribe to partition 0
 *     because we want ONLY temperature data going to InfluxDB.
 *
 * ============================================================
 */

const express = require('express');
const { Kafka } = require('kafkajs');
const { InfluxDB, Point } = require('@influxdata/influxdb-client');

const app = express();
const PORT = process.env.EXPRESS_PORT || 8083;
const TOPIC = process.env.TOPIC || 'telemetry';
const PARTITION = parseInt(process.env.PARTITION || '0');

// ─── Kafka Setup ───
const kafka = new Kafka({
    clientId: 'influx-consumer',
    brokers: (process.env.KAFKA_BROKERS || 'localhost:9092').split(','),
    retry: { initialRetryTime: 3000, retries: 10 }
});

const consumer = kafka.consumer({ groupId: 'influx-consumer-group' });

// ─── InfluxDB Setup ───
const influxDB = new InfluxDB({
    url: process.env.INFLUX_URL || 'http://localhost:8086',
    token: process.env.INFLUX_TOKEN || 'my-super-secret-token'
});

const writeApi = influxDB.getWriteApi(
    process.env.INFLUX_ORG || 'myorg',
    process.env.INFLUX_BUCKET || 'telemetry',
    'ns'  // nanosecond precision
);

// ─── Stats ───
let stats = {
    totalConsumed: 0,
    writtenToInflux: 0,
    errors: 0,
    lastMessageAt: null,
    lastError: null
};

/**
 * Process a single telemetry message and write to InfluxDB.
 *
 * InfluxDB data model:
 *   Measurement: "temperature" (like a table name)
 *   Tags: deviceId, location (indexed, used for filtering)
 *   Fields: temperature, humidity, pressure (actual values)
 *   Timestamp: when the reading was taken
 */
const processMessage = async (message) => {
    try {
        const data = JSON.parse(message.value.toString());
        stats.totalConsumed++;
        stats.lastMessageAt = new Date().toISOString();

        // Create InfluxDB point
        const point = new Point('temperature')
            .tag('deviceId', data.deviceId)
            .tag('location', data.location)
            .floatField('temperature', data.readings.temperature)
            .floatField('humidity', data.readings.humidity)
            .floatField('pressure', data.readings.pressure)
            .timestamp(new Date(data.timestamp));

        writeApi.writePoint(point);
        stats.writtenToInflux++;

        // Log every 100th message to avoid log spam
        if (stats.totalConsumed % 100 === 0) {
            console.log(
                `📥 InfluxDB Consumer: ${stats.totalConsumed} messages consumed, ` +
                `${stats.writtenToInflux} written | ` +
                `Last: ${data.deviceId} temp=${data.readings.temperature}°C`
            );
        }
    } catch (err) {
        stats.errors++;
        stats.lastError = err.message;
        console.error('❌ Error processing message:', err.message);
    }
};

// ─── Periodic flush to InfluxDB ───
setInterval(() => {
    writeApi.flush().catch(err => {
        console.error('❌ InfluxDB flush error:', err.message);
    });
}, 5000);  // Flush every 5 seconds

// ─── HTTP Endpoints ───

app.get('/stats', (req, res) => {
    res.json({ stats, partition: PARTITION, target: 'InfluxDB' });
});

app.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        service: 'kafka-consumer-influx',
        partition: PARTITION,
        stats
    });
});

app.get('/', (req, res) => {
    res.json({
        service: 'Kafka Consumer → InfluxDB',
        description: 'Reads temperature data from Kafka partition 0, writes to InfluxDB',
        partition: PARTITION,
        endpoints: {
            'GET /stats': 'View consumption stats',
            'GET /health': 'Health check'
        }
    });
});

// ─── Startup ───

const startUp = async () => {
    console.log('🚀 Starting Kafka Consumer → InfluxDB...');
    console.log(`   Topic: ${TOPIC}, Partition: ${PARTITION}`);

    await consumer.connect();
    console.log('✅ Kafka consumer connected');

    // Subscribe to topic
    await consumer.subscribe({ topic: TOPIC, fromBeginning: false });

    // Run the consumer
    await consumer.run({
        eachMessage: async ({ topic, partition, message }) => {
            // Only process messages from our assigned partition
            if (partition === PARTITION) {
                await processMessage(message);
            }
        }
    });

    console.log(`📥 Listening on partition ${PARTITION} of topic '${TOPIC}'`);
    console.log('   Data type: Temperature/humidity readings');
    console.log('   Destination: InfluxDB');

    app.listen(PORT, () => {
        console.log(`📡 Stats API running on port ${PORT}`);
    });
};

startUp().catch(err => {
    console.error('Failed to start InfluxDB consumer:', err.message);
    process.exit(1);
});

// ─── Graceful shutdown ───
const shutdown = async () => {
    console.log('Shutting down...');
    await writeApi.close();
    await consumer.disconnect();
    process.exit(0);
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
