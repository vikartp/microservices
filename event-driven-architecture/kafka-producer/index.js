/**
 * ============================================================
 * KAFKA PRODUCER — Telemetry Data Generator
 * ============================================================
 *
 * Simulates a real-world IoT/telemetry pipeline:
 *   - Generates mock device sensor readings every INTERVAL_MS
 *   - Sends BATCH_SIZE data points per interval
 *   - Routes data to SPECIFIC PARTITIONS:
 *
 *     Partition 0 → Temperature/humidity readings → InfluxDB consumer
 *     Partition 1 → CPU/memory metrics            → TimescaleDB consumer
 *
 * WHY PARTITIONS MATTER:
 *   In Kafka, a partition is the unit of parallelism.
 *   By sending different data types to different partitions,
 *   we can have specialized consumers process each type
 *   independently and at their own pace.
 *
 * PRODUCER KEY CONCEPTS:
 *   - Topic:     A named feed/channel (like "telemetry")
 *   - Partition: A sub-queue within a topic (parallel lanes)
 *   - Key:       Determines which partition a message goes to
 *   - Message:   The actual data payload (JSON in our case)
 *
 * ============================================================
 */

const express = require('express');
const { Kafka, Partitioners } = require('kafkajs');

const app = express();
app.use(express.json());

const PORT = process.env.EXPRESS_PORT || 8082;
const TOPIC = process.env.TOPIC || 'telemetry';
const INTERVAL_MS = parseInt(process.env.INTERVAL_MS || '1000');
const BATCH_SIZE = parseInt(process.env.BATCH_SIZE || '50');

// ─── Kafka Client Setup ───
const kafka = new Kafka({
    clientId: 'telemetry-producer',
    brokers: (process.env.KAFKA_BROKERS || 'localhost:9092').split(','),
    retry: {
        initialRetryTime: 3000,
        retries: 10
    }
});

const producer = kafka.producer({
    createPartitioner: Partitioners.DefaultPartitioner
});

const admin = kafka.admin();

// ─── Stats ───
let stats = {
    totalSent: 0,
    partition0Sent: 0,
    partition1Sent: 0,
    batchesSent: 0,
    lastBatchAt: null,
    isRunning: false,
    errors: 0
};

// ─── Mock Device Registry ───
const devices = [
    { id: 'sensor-001', location: 'warehouse-A', type: 'temperature' },
    { id: 'sensor-002', location: 'warehouse-B', type: 'temperature' },
    { id: 'sensor-003', location: 'office-1F', type: 'temperature' },
    { id: 'sensor-004', location: 'server-room', type: 'temperature' },
    { id: 'sensor-005', location: 'cold-storage', type: 'temperature' },
    { id: 'server-001', location: 'rack-A1', type: 'metrics' },
    { id: 'server-002', location: 'rack-A2', type: 'metrics' },
    { id: 'server-003', location: 'rack-B1', type: 'metrics' },
    { id: 'server-004', location: 'rack-B2', type: 'metrics' },
    { id: 'server-005', location: 'rack-C1', type: 'metrics' },
];

/**
 * Generate a mock temperature/humidity reading.
 * → Goes to PARTITION 0 (InfluxDB)
 */
const generateTemperatureReading = (device) => ({
    deviceId: device.id,
    location: device.location,
    dataType: 'temperature',
    timestamp: new Date().toISOString(),
    readings: {
        temperature: parseFloat((20 + Math.random() * 15 + Math.sin(Date.now() / 60000) * 5).toFixed(2)),
        humidity: parseFloat((40 + Math.random() * 30).toFixed(2)),
        pressure: parseFloat((1010 + Math.random() * 20).toFixed(2))
    },
    unit: 'celsius'
});

/**
 * Generate a mock CPU/memory metric.
 * → Goes to PARTITION 1 (TimescaleDB)
 */
const generateMetricsReading = (device) => ({
    deviceId: device.id,
    location: device.location,
    dataType: 'metrics',
    timestamp: new Date().toISOString(),
    readings: {
        cpuUsage: parseFloat((10 + Math.random() * 80).toFixed(2)),
        memoryUsage: parseFloat((30 + Math.random() * 60).toFixed(2)),
        diskIO: parseFloat((Math.random() * 100).toFixed(2)),
        networkIn: Math.floor(Math.random() * 10000),
        networkOut: Math.floor(Math.random() * 8000)
    },
    unit: 'percent'
});

/**
 * Generate a batch of telemetry messages.
 * Each message is assigned to a SPECIFIC PARTITION based on data type.
 */
const generateBatch = (batchSize) => {
    const messages = [];

    for (let i = 0; i < batchSize; i++) {
        const device = devices[Math.floor(Math.random() * devices.length)];

        if (device.type === 'temperature') {
            // ─── PARTITION 0: Temperature data → InfluxDB ───
            const reading = generateTemperatureReading(device);
            messages.push({
                key: device.id,
                value: JSON.stringify(reading),
                partition: 0,               // ← Explicit partition assignment!
                headers: {
                    'data-type': 'temperature',
                    'source': device.location
                }
            });
        } else {
            // ─── PARTITION 1: Server metrics → TimescaleDB ───
            const reading = generateMetricsReading(device);
            messages.push({
                key: device.id,
                value: JSON.stringify(reading),
                partition: 1,               // ← Explicit partition assignment!
                headers: {
                    'data-type': 'metrics',
                    'source': device.location
                }
            });
        }
    }

    return messages;
};

let intervalId = null;

/**
 * Start producing data at the configured interval.
 */
const startProducing = () => {
    if (intervalId) return;

    stats.isRunning = true;
    console.log(`🚀 Started producing ${BATCH_SIZE} messages every ${INTERVAL_MS}ms`);

    intervalId = setInterval(async () => {
        try {
            const messages = generateBatch(BATCH_SIZE);

            await producer.send({
                topic: TOPIC,
                messages
            });

            const p0Count = messages.filter(m => m.partition === 0).length;
            const p1Count = messages.filter(m => m.partition === 1).length;

            stats.totalSent += messages.length;
            stats.partition0Sent += p0Count;
            stats.partition1Sent += p1Count;
            stats.batchesSent++;
            stats.lastBatchAt = new Date().toISOString();

            console.log(
                `📤 Batch #${stats.batchesSent}: ` +
                `${messages.length} messages ` +
                `(P0→InfluxDB: ${p0Count}, P1→TimescaleDB: ${p1Count}) | ` +
                `Total: ${stats.totalSent}`
            );
        } catch (err) {
            stats.errors++;
            console.error('❌ Failed to send batch:', err.message);
        }
    }, INTERVAL_MS);
};

/**
 * Stop producing data.
 */
const stopProducing = () => {
    if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
        stats.isRunning = false;
        console.log('⏹️  Stopped producing');
    }
};

// ─── HTTP Endpoints ───

app.post('/start', (req, res) => {
    startProducing();
    res.json({ message: 'Producer started', stats });
});

app.post('/stop', (req, res) => {
    stopProducing();
    res.json({ message: 'Producer stopped', stats });
});

app.get('/stats', (req, res) => {
    res.json({ stats });
});

app.post('/send-batch', async (req, res) => {
    const batchSize = req.body.batchSize || BATCH_SIZE;
    try {
        const messages = generateBatch(batchSize);
        await producer.send({ topic: TOPIC, messages });

        const p0Count = messages.filter(m => m.partition === 0).length;
        const p1Count = messages.filter(m => m.partition === 1).length;

        stats.totalSent += messages.length;
        stats.partition0Sent += p0Count;
        stats.partition1Sent += p1Count;
        stats.batchesSent++;

        res.json({
            message: `Sent ${messages.length} messages`,
            partition0: p0Count,
            partition1: p1Count,
            stats
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/health', (req, res) => {
    res.json({ status: 'healthy', service: 'kafka-producer', stats });
});

app.get('/', (req, res) => {
    res.json({
        service: 'Kafka Telemetry Producer',
        endpoints: {
            'POST /start': 'Start auto-producing data',
            'POST /stop': 'Stop auto-producing',
            'POST /send-batch': 'Send one batch manually',
            'GET /stats': 'View production stats',
            'GET /health': 'Health check'
        },
        config: { topic: TOPIC, interval: `${INTERVAL_MS}ms`, batchSize: BATCH_SIZE }
    });
});

// ─── Startup ───

const startUp = async () => {
    console.log('🚀 Connecting to Kafka...');

    await producer.connect();
    console.log('✅ Kafka producer connected');

    // Create topic with 2 partitions if it doesn't exist
    await admin.connect();
    const topics = await admin.listTopics();
    if (!topics.includes(TOPIC)) {
        await admin.createTopics({
            topics: [{
                topic: TOPIC,
                numPartitions: 2,       // ← 2 partitions!
                replicationFactor: 1
            }]
        });
        console.log(`✅ Created topic '${TOPIC}' with 2 partitions`);
    } else {
        console.log(`📋 Topic '${TOPIC}' already exists`);
    }
    await admin.disconnect();

    app.listen(PORT, () => {
        console.log(`📡 Kafka Producer running on port ${PORT}`);
        console.log(`   Topic: ${TOPIC}`);
        console.log(`   Partition 0: Temperature data → InfluxDB`);
        console.log(`   Partition 1: Server metrics   → TimescaleDB`);
        console.log(`   Auto-start: POST /start`);
    });

    // Auto-start producing
    startProducing();
};

startUp().catch(err => {
    console.error('Failed to start Kafka Producer:', err.message);
    process.exit(1);
});
