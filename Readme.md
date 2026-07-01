# 🎯 Microservices Mastery — Learn by Building

A **practical, hands-on guide** to master three critical microservices patterns through a real e-commerce order processing system.

> **Goal:** After completing this project, you should be fully prepared for **senior developer/architect interviews** on Idempotency, Saga Pattern, and Circuit Breaker.

## 🏗️ What You'll Build

An e-commerce order system with **6 microservices + 4 infrastructure services** running in Docker:

```
Customer → API Gateway → Order Service → Saga Orchestrator
              (Circuit          │                │
              Breaker)     ┌────┴────┐    ┌──────┴──────┐
                           │ Payment │    │  Inventory  │
                           │ Service │    │   Service   │
                           │(Idempotent)  │(Compensating│
                           └─────────┘    │Transactions)│
                                          └─────────────┘
```

| Pattern | Where | What You'll See |
|---------|-------|-----------------|
| **Idempotency** | Payment Service | Send the same payment 5x → only 1 charge |
| **Saga** | Saga Orchestrator | Order fails at inventory → payment automatically refunded |
| **Circuit Breaker** | API Gateway | Notification service goes down → instant fallback, auto-recovery |

## 🚀 Quick Start (5 Minutes)

### Prerequisites
- Docker Desktop (4GB+ RAM)
- Node.js 20+

### Launch

```powershell
# Start everything (10 containers)
docker-compose up --build -d

# Wait for health checks (~30 seconds)
docker-compose ps

# Seed inventory data
npm install mongoose --prefix scripts
node scripts/seed-data.js
```

### Run the Demos

```powershell
node scripts/test-idempotency.js      # Watch duplicate prevention
node scripts/test-saga.js             # Watch saga + compensation
node scripts/test-circuit-breaker.js  # Watch circuit open/close
```

### Explore

| URL | What |
|-----|------|
| http://localhost:3000 | API Gateway (lists all endpoints) |
| http://localhost:15672 | RabbitMQ Management UI (user/password) |
| http://localhost:3000/api/circuit-status | Circuit breaker dashboard |

## 📚 Learning Path

| # | Guide | Time | Difficulty |
|---|-------|------|------------|
| 0 | [Architecture Overview](docs/00-overview.md) | 10 min | ⭐ |
| 1 | [Idempotency Deep Dive](docs/01-idempotency.md) | 30 min | ⭐⭐ |
| 2 | [Saga Pattern Deep Dive](docs/02-saga-pattern.md) | 45 min | ⭐⭐⭐ |
| 3 | [Circuit Breaker Deep Dive](docs/03-circuit-breaker.md) | 30 min | ⭐⭐ |
| 4 | [Hands-On Exercises](docs/04-exercises.md) | 60 min | ⭐⭐⭐ |
| 5 | [Interview Questions (50+)](docs/05-interview-questions.md) | 90 min | ⭐⭐⭐⭐ |

Each guide includes:
- ✅ Theory with clear analogies
- ✅ Step-by-step code walkthrough
- ✅ ASCII diagrams for visual learners
- ✅ Edge cases and gotchas
- ✅ How big companies do it (Stripe, Netflix, AWS)
- ✅ Interview Q&A with model answers

## 🐳 Services

| Service | Port | Tech | Pattern |
|---------|------|------|---------|
| API Gateway | 3000 | Express + opossum | Circuit Breaker |
| Order Service | 3001 | Express + Sequelize + PostgreSQL | Saga Initiator |
| Payment Service | 3002 | Express + Sequelize + Redis | Idempotency |
| Inventory Service | 3003 | Express + Mongoose + MongoDB | Compensating Transactions |
| Notification Service | 3004 | Express | Chaos/Fault Injection |
| Saga Orchestrator | — | RabbitMQ + Redis | Saga State Machine |

### Infrastructure

| Service | Port | Purpose |
|---------|------|---------|
| RabbitMQ | 5672 / 15672 | Event bus (saga events) |
| PostgreSQL | 5432 | Orders + payments |
| MongoDB | 27017 | Inventory |
| Redis | 6379 | Idempotency keys + saga state |

## 📡 API Reference

### Orders (via API Gateway)
```
POST   /api/orders          Create order (starts saga)
GET    /api/orders           List all orders
GET    /api/orders/:id       Get order status
```

### Payments
```
POST   /api/payments         Process payment (use Idempotency-Key header!)
```

### Inventory
```
GET    /api/inventory        List products
GET    /api/inventory/:id    Check stock
```

### Notifications (Circuit Breaker Demo)
```
POST   /api/notify           Send notification (may fail!)
```

### Monitoring
```
GET    /api/circuit-status   All circuit breaker states
GET    /api/health           Gateway health
```

### Chaos Control
```
POST   /api/chaos/enable     Enable failures on notification service
POST   /api/chaos/disable    Disable failures
POST   /api/chaos/config     Configure failure rate & latency
```

## 🔧 Development

### Watch Logs (Best Way to Learn)
```powershell
# All services
docker-compose logs -f

# Saga flow
docker-compose logs -f saga-orchestrator order-service payment-service inventory-service

# Circuit breaker
docker-compose logs -f api-gateway notification-service
```

### Hot Reload
All services use nodemon with volume mounts. Edit any `src/*.js` file → changes apply automatically.

### Rebuild After Dependency Changes
```powershell
docker-compose build payment-service
docker-compose up payment-service
```

### Clean Restart
```powershell
docker-compose down -v    # Stop + remove data
docker-compose up --build  # Fresh start
```

## 📝 Event-Driven Architecture (Kafka / RabbitMQ)

The original producer/consumer code from our earlier learning is preserved in [`event-driven-architecture/`](event-driven-architecture/). The original notes are in [`event-driven-architecture/notes.md`](event-driven-architecture/notes.md). This section will also serve as a foundation for future Kafka examples.

## 📄 License

MIT — Built for learning. Break things. Experiment. Master it.