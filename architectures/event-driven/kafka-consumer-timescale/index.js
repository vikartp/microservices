/**
 * ============================================================
 * KAFKA CONSUMER → TimescaleDB
 * ============================================================
 *
 * Consumes PARTITION 1 of the "telemetry" topic.
 * Partition 1 contains server CPU/memory/disk metrics.
 *
 * Writes each data point to TimescaleDB (PostgreSQL + hypertables).
 *
 * TIMESCALEDB KEY CONCEPTS:
 *   - It's PostgreSQL with a time-series extension
 *   - "Hypertable": Automatically partitions data by time
 *   - You write normal SQL INSERTs, but under the hood TimescaleDB
 *     optimizes storage and queries for time-series access patterns
 *   - Great for: dashboards, aggregations, downsampling
 *
 * INFLUXDB vs TIMESCALEDB:
 *   InfluxDB: Purpose-built for time-series. Custom query language (Flux).
 *             Better for high-write IoT/sensor workloads.
 *   TimescaleDB: PostgreSQL extension. Standard SQL.
 *                Better when you need JOINs, complex queries, or
 *                already use PostgreSQL.
 *
 * ============================================================
 */

const express = require('express');
const { Kafka } = require('kafkajs');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.EXPRESS_PORT || 8084;
const TOPIC = process.env.TOPIC || 'telemetry';
const PARTITION = parseInt(process.env.PARTITION || '1');

// ─── Kafka Setup ───
const kafka = new Kafka({
    clientId: 'timescale-consumer',
    brokers: (process.env.KAFKA_BROKERS || 'localhost:9092').split(','),
    retry: { initialRetryTime: 3000, retries: 10 }
});

const consumer = kafka.consumer({ groupId: 'timescale-consumer-group' });

// ─── TimescaleDB Setup ───
const pool = new Pool({
    connectionString: process.env.TIMESCALE_URI || 'postgres://admin:adminpassword@localhost:5433/telemetry'
});

// ─── Stats ───
let stats = {
    totalConsumed: 0,
    writtenToTimescale: 0,
    errors: 0,
    lastMessageAt: null,
    lastError: null
};

// ─── Batch buffer ───
let batch = [];
const BATCH_FLUSH_SIZE = 50;
const BATCH_FLUSH_INTERVAL_MS = 3000;

/**
 * Initialize TimescaleDB: create table + hypertable.
 *
 * The hypertable automatically partitions data by "time" column,
 * giving us blazing fast time-range queries.
 */
const initializeDatabase = async () => {
    const client = await pool.connect();
    try {
        // Create the metrics table
        await client.query(`
            CREATE TABLE IF NOT EXISTS server_metrics (
                time        TIMESTAMPTZ NOT NULL,
                device_id   TEXT NOT NULL,
                location    TEXT NOT NULL,
                cpu_usage   DOUBLE PRECISION,
                memory_usage DOUBLE PRECISION,
                disk_io     DOUBLE PRECISION,
                network_in  BIGINT,
                network_out BIGINT
            );
        `);

        // Convert to a TimescaleDB hypertable (if not already)
        // This is the MAGIC — under the hood it creates time-based partitions
        await client.query(`
            SELECT create_hypertable('server_metrics', 'time', if_not_exists => TRUE);
        `);

        console.log('✅ TimescaleDB table "server_metrics" ready (hypertable)');
    } finally {
        client.release();
    }
};

/**
 * Flush the batch buffer to TimescaleDB.
 * Uses a multi-row INSERT for efficiency.
 */
const flushBatch = async () => {
    if (batch.length === 0) return;

    const toFlush = [...batch];
    batch = [];

    const client = await pool.connect();
    try {
        // Build multi-row INSERT
        const values = [];
        const params = [];
        let paramIndex = 1;

        for (const data of toFlush) {
            values.push(
                `($${paramIndex++}, $${paramIndex++}, $${paramIndex++}, ` +
                `$${paramIndex++}, $${paramIndex++}, $${paramIndex++}, ` +
                `$${paramIndex++}, $${paramIndex++})`
            );
            params.push(
                data.timestamp,
                data.deviceId,
                data.location,
                data.readings.cpuUsage,
                data.readings.memoryUsage,
                data.readings.diskIO,
                data.readings.networkIn,
                data.readings.networkOut
            );
        }

        const query = `
            INSERT INTO server_metrics (time, device_id, location, cpu_usage, memory_usage, disk_io, network_in, network_out)
            VALUES ${values.join(', ')}
        `;

        await client.query(query, params);
        stats.writtenToTimescale += toFlush.length;

        console.log(
            `📥 TimescaleDB: Flushed ${toFlush.length} rows | ` +
            `Total written: ${stats.writtenToTimescale}`
        );
    } catch (err) {
        stats.errors++;
        stats.lastError = err.message;
        console.error('❌ TimescaleDB batch insert error:', err.message);
        // Put failed items back for retry
        batch = [...toFlush, ...batch];
    } finally {
        client.release();
    }
};

/**
 * Process a single Kafka message — add to batch buffer.
 */
const processMessage = async (message) => {
    try {
        const data = JSON.parse(message.value.toString());
        stats.totalConsumed++;
        stats.lastMessageAt = new Date().toISOString();

        batch.push(data);

        // Flush when batch is full
        if (batch.length >= BATCH_FLUSH_SIZE) {
            await flushBatch();
        }

        // Log every 100th message
        if (stats.totalConsumed % 100 === 0) {
            console.log(
                `📥 TimescaleDB Consumer: ${stats.totalConsumed} consumed, ` +
                `${stats.writtenToTimescale} written | ` +
                `Last: ${data.deviceId} cpu=${data.readings.cpuUsage}%`
            );
        }
    } catch (err) {
        stats.errors++;
        stats.lastError = err.message;
        console.error('❌ Error processing message:', err.message);
    }
};

// ─── Periodic flush ───
setInterval(flushBatch, BATCH_FLUSH_INTERVAL_MS);

// ─── HTTP Endpoints ───

app.get('/stats', (req, res) => {
    res.json({ stats, partition: PARTITION, target: 'TimescaleDB', batchBufferSize: batch.length });
});

app.get('/query', async (req, res) => {
    try {
        // Example: last 10 readings
        const result = await pool.query(`
            SELECT * FROM server_metrics
            ORDER BY time DESC
            LIMIT 10
        `);
        res.json({ rows: result.rows, count: result.rowCount });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/query/avg', async (req, res) => {
    try {
        // Average CPU/memory per device in the last 5 minutes
        // This is where TimescaleDB's hypertable shines!
        const result = await pool.query(`
            SELECT 
                device_id,
                location,
                time_bucket('1 minute', time) AS minute,
                AVG(cpu_usage) AS avg_cpu,
                AVG(memory_usage) AS avg_memory,
                COUNT(*) AS sample_count
            FROM server_metrics
            WHERE time > NOW() - INTERVAL '5 minutes'
            GROUP BY device_id, location, minute
            ORDER BY minute DESC, device_id
        `);
        res.json({ rows: result.rows, count: result.rowCount });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        service: 'kafka-consumer-timescale',
        partition: PARTITION,
        stats
    });
});

app.get('/', (req, res) => {
    res.json({
        service: 'Kafka Consumer → TimescaleDB',
        description: 'Reads server metrics from Kafka partition 1, writes to TimescaleDB',
        partition: PARTITION,
        endpoints: {
            'GET /stats': 'View consumption stats',
            'GET /query': 'Last 10 data points from TimescaleDB',
            'GET /query/avg': 'Average CPU/memory per device (last 5 min)',
            'GET /health': 'Health check'
        }
    });
});

// ─── Startup ───

const startUp = async () => {
    console.log('🚀 Starting Kafka Consumer → TimescaleDB...');
    console.log(`   Topic: ${TOPIC}, Partition: ${PARTITION}`);

    // Initialize TimescaleDB
    await initializeDatabase();

    // Connect Kafka consumer
    await consumer.connect();
    console.log('✅ Kafka consumer connected');

    await consumer.subscribe({ topic: TOPIC, fromBeginning: false });

    await consumer.run({
        eachMessage: async ({ topic, partition, message }) => {
            if (partition === PARTITION) {
                await processMessage(message);
            }
        }
    });

    console.log(`📥 Listening on partition ${PARTITION} of topic '${TOPIC}'`);
    console.log('   Data type: Server metrics (CPU, memory, disk, network)');
    console.log('   Destination: TimescaleDB');

    app.listen(PORT, () => {
        console.log(`📡 Stats API running on port ${PORT}`);
    });
};

startUp().catch(err => {
    console.error('Failed to start TimescaleDB consumer:', err.message);
    process.exit(1);
});

// ─── Graceful shutdown ───
const shutdown = async () => {
    console.log('Shutting down — flushing remaining batch...');
    await flushBatch();
    await consumer.disconnect();
    await pool.end();
    process.exit(0);
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
