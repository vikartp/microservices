# Event-Driven Architecture — Producer / Consumer with RabbitMQ (and Kafka)

This is the **original** microservices learning project — a simple Producer → RabbitMQ → Consumer message flow with polyglot persistence (MongoDB + PostgreSQL + Redis).

> **Note:** This setup was the starting point before we built the full [Microservices Mastery](../Readme.md) project with Idempotency, Saga, and Circuit Breaker patterns.

---

## 🏗️ Architecture

```
  ┌──────────┐       ┌────────────┐       ┌──────────┐
  │ Producer │──────▶│  RabbitMQ  │──────▶│ Consumer │
  │ (8081)   │       │(5672/15672)│       │  (8080)  │
  │[Postgres]│       └────────────┘       │[MongoDB] │
  └──────────┘                            └──────────┘
```

| Service | Port | Database | Role |
|---------|------|----------|------|
| Producer | 8081 | PostgreSQL | Sends messages to RabbitMQ queues |
| Consumer | 8080 | MongoDB | Receives messages and creates users |
| RabbitMQ | 5672 / 15672 | — | Message broker |
| MongoDB | 27017 | — | Document store for user data |
| PostgreSQL | 5432 | — | Relational store for producer |
| Redis | 6379 | — | In-memory cache (available for experiments) |

---

## 🚀 Quick Start

### Prerequisites
- Docker Desktop (or Rancher Desktop with dockerd)

### 1. Start Everything

```powershell
# Make sure you're in the event-driven-architecture/ directory
cd event-driven-architecture

# Build and start all 6 containers
docker-compose up --build
```

Wait until you see both services log "connected successfully" messages.

### 2. Test the Message Flow

**Send a simple message:**
```powershell
curl http://localhost:8081/
# → { "message": "Message sent to queue!" }
```

**Send a custom message:**
```powershell
curl "http://localhost:8081/send?msg=Hello+from+Producer"
# → { "message": "Message sent to queue!" }
```

**Create a user (via queue):**
```powershell
curl -X POST http://localhost:8081/user `
  -H "Content-Type: application/json" `
  -d '{"name": "John Doe", "email": "john@example.com", "password": "secret123"}'
# → { "message": "User data sent to queue!" }
```

### 3. Verify

**Check consumer logs** — you should see the messages being received:
```powershell
docker-compose logs -f consumer
```

**Check consumer health:**
```powershell
curl http://localhost:8080/
# → { "message": "Hello World from Consumer Service!" }
```

**Check RabbitMQ Management UI:**
- URL: http://localhost:15672
- Username: `user`
- Password: `password`
- Look at Queues tab → `tasks` and `user_tasks`

---

## 📡 API Endpoints

### Producer (Port 8081)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/` | Send a default message to the `tasks` queue |
| GET | `/send?msg=your_message` | Send a custom message to the `tasks` queue |
| POST | `/user` | Send user data to the `user_tasks` queue |

### Consumer (Port 8080)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/` | Health check |

---

## 🔄 Message Flow

```
1. Client sends HTTP request to Producer (port 8081)
2. Producer publishes message to RabbitMQ queue
3. RabbitMQ stores message until consumed
4. Consumer listens to the queue (with prefetch=1)
5. Consumer processes message:
   - "tasks" queue → logs the message
   - "user_tasks" queue → creates user in MongoDB
6. Consumer acknowledges (ack) → RabbitMQ deletes message
```

---

## 🛠️ Development

### Hot Reload
Both services use `nodemon -L` (legacy watch mode) with volume mounts:
```yaml
volumes:
  - ./producer:/app       # Mount local code
  - /app/node_modules      # Preserve container's node_modules
```

Edit any file locally → nodemon detects the change → auto-restarts.

### View Logs
```powershell
# All services
docker-compose logs -f

# Specific service
docker-compose logs -f consumer
docker-compose logs -f producer
```

### Rebuild After package.json Changes
```powershell
docker-compose build producer
docker-compose up producer
```

### Stop & Clean Up
```powershell
# Stop everything
docker-compose down

# Stop and remove all data (clean slate)
docker-compose down -v
```

---

## ⚠️ Port Conflicts

If you're also running the new microservices stack (from the parent directory), you'll have port conflicts on 5672, 15672, 27017, 5432, and 6379.

**Stop the new stack first:**
```powershell
cd ..
docker-compose down
cd event-driven-architecture
docker-compose up --build
```

Or vice versa. The container names use a `eda_` prefix to avoid name collisions, but ports can only be bound by one container at a time.

---

## 📚 Learning Notes

For detailed notes on Docker, RabbitMQ, and microservices concepts, see [notes.md](./notes.md).

---

## ➡️ Next Step

Ready for advanced patterns? Head back to the [main project](../Readme.md) to learn **Idempotency**, **Saga Pattern**, and **Circuit Breaker** through a full e-commerce system.
