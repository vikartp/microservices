# Event-Driven Architecture — RabbitMQ + Kafka

Two complete event-driven systems running side-by-side:

1. **RabbitMQ** — Simple producer/consumer message flow (original example)
2. **Kafka** — High-throughput telemetry pipeline with partitioned consumers writing to InfluxDB and TimescaleDB

---

## 🏗️ Architecture

### RabbitMQ Flow (Original)

```
  ┌──────────┐       ┌────────────┐       ┌──────────┐
  │ Producer │──────▶│  RabbitMQ  │──────▶│ Consumer │
  │ (8081)   │       │(5672/15672)│       │  (8080)  │
  │[Postgres]│       └────────────┘       │[MongoDB] │
  └──────────┘                            └──────────┘
```

### Kafka Flow (Telemetry Pipeline)

```
                                     Partition 0
  ┌──────────────┐    ┌─────────┐    ┌────────────┐    ┌──────────┐
  │  Telemetry   │    │         │───▶│  Consumer   │───▶│ InfluxDB │
  │  Producer    │───▶│  Kafka  │    │  (Influx)  │    │  (8086)  │
  │   (8082)     │    │ (9092)  │    │   (8083)   │    └──────────┘
  │              │    │         │    └────────────┘
  │ Generates:   │    │ Topic:  │
  │ • Temp data  │    │"telemetry"    Partition 1
  │ • CPU metrics│    │         │    ┌────────────┐    ┌────────────┐
  └──────────────┘    │         │───▶│  Consumer   │───▶│TimescaleDB │
                      └─────────┘    │(Timescale) │    │   (5433)   │
                                     │   (8084)   │    └────────────┘
                                     └────────────┘
```

**Kafka UI** is available at http://localhost:8090 to visualize topics, partitions, and messages.

---

## 🐳 Full Container List

| Container | Port | Purpose |
|-----------|------|---------|
| **RabbitMQ** | 5672 / 15672 | Message broker |
| **Kafka** | 9092 | Event streaming (KRaft mode, no Zookeeper) |
| **Kafka UI** | 8090 | Visualize Kafka topics & messages |
| **MongoDB** | 27017 | RabbitMQ consumer store |
| **PostgreSQL** | 5432 | RabbitMQ producer store |
| **Redis** | 6379 | Cache (for experiments) |
| **InfluxDB** | 8086 | Time-series DB for temperature data |
| **TimescaleDB** | 5433 | Time-series DB for server metrics |
| RabbitMQ Producer | 8081 | Sends messages to RabbitMQ |
| RabbitMQ Consumer | 8080 | Receives from RabbitMQ |
| Kafka Producer | 8082 | Generates telemetry → Kafka |
| Kafka Consumer (Influx) | 8083 | Partition 0 → InfluxDB |
| Kafka Consumer (Timescale) | 8084 | Partition 1 → TimescaleDB |

---

## 🚀 Quick Start

```powershell
# From the event-driven-architecture/ directory
cd event-driven-architecture

# Build and start all 13 containers
docker-compose up --build
```

Wait for health checks to pass (watch logs for ✅ messages).

---

## 🧪 Test the Kafka Pipeline

### 1. Producer auto-starts — check stats

The producer starts generating 50 telemetry points per second automatically.

```powershell
# Check producer stats
curl http://localhost:8082/stats

# View all endpoints
curl http://localhost:8082/
```

### 2. Send a manual batch

```powershell
curl -X POST http://localhost:8082/send-batch `
  -H "Content-Type: application/json" `
  -d '{"batchSize": 100}'
```

### 3. Check consumer stats

```powershell
# InfluxDB consumer (partition 0)
curl http://localhost:8083/stats

# TimescaleDB consumer (partition 1)
curl http://localhost:8084/stats
```

### 4. Query TimescaleDB directly

```powershell
# Last 10 data points
curl http://localhost:8084/query

# Average CPU/memory per device (last 5 minutes) — uses time_bucket()
curl http://localhost:8084/query/avg
```

### 5. Query InfluxDB

Open http://localhost:8086 in your browser:
- Username: `admin`, Password: `adminpassword`
- Go to **Data Explorer** → select bucket `telemetry`
- Query temperature readings across devices

### 6. Explore Kafka UI

Open http://localhost:8090:
- View the `telemetry` topic
- See messages in partition 0 (temperature) and partition 1 (metrics)
- Watch offsets move as consumers process messages

### 7. Control the producer

```powershell
# Stop producing
curl -X POST http://localhost:8082/stop

# Start producing again
curl -X POST http://localhost:8082/start
```

---

## 🧪 Test the RabbitMQ Flow (Original)

```powershell
# Send a message
curl http://localhost:8081/

# Send a custom message
curl "http://localhost:8081/send?msg=Hello+from+Producer"

# Create a user (via queue)
curl -X POST http://localhost:8081/user `
  -H "Content-Type: application/json" `
  -d '{"name":"John Doe","email":"john@example.com","password":"secret123"}'
```

**RabbitMQ UI:** http://localhost:15672 (user / password)

---

## 📊 RabbitMQ vs Kafka — Key Differences

| Feature | RabbitMQ | Kafka |
|---------|----------|-------|
| **Model** | Message broker (push) | Event log (pull) |
| **Message retention** | Deleted after ack | Retained for configured time |
| **Ordering** | Per queue | Per partition |
| **Throughput** | ~50K msg/s | ~1M+ msg/s |
| **Consumer groups** | Competing consumers | Parallel partition readers |
| **Replay** | ❌ Cannot replay | ✅ Replay from any offset |
| **Best for** | Task queues, RPC, routing | Event streaming, logs, telemetry |

---

## 🛠️ Development

### Hot Reload
All services use `nodemon -L` with volume mounts — edit any `.js` file and it reloads automatically.

### View Logs
```powershell
# All Kafka services
docker-compose logs -f kafka-producer kafka-consumer-influx kafka-consumer-timescale

# All RabbitMQ services
docker-compose logs -f producer consumer

# Everything
docker-compose logs -f
```

### Stop & Clean
```powershell
docker-compose down        # Stop
docker-compose down -v     # Stop + delete data
```

---

## ⚠️ Port Conflicts

If running the main microservices stack (parent directory), stop it first:
```powershell
cd ..
docker-compose down
cd event-driven-architecture
docker-compose up --build
```

Container names use `eda_` prefix to avoid name collisions.

---

## 📚 Notes

For detailed notes on Docker, RabbitMQ, and microservices concepts, see [notes.md](./notes.md).

## ➡️ Next Step

Head to the [main project](../Readme.md) for **Idempotency**, **Saga Pattern**, and **Circuit Breaker** patterns.
