# Microservices Mastery — Architecture Overview

## 🎯 What You'll Learn

This project teaches three critical microservices patterns through a **real e-commerce order processing system**:

| Pattern | Service | Why It's Needed |
|---------|---------|----------------|
| **Idempotency** | Payment Service | Prevent double-charging when retries happen |
| **Saga Pattern** | Saga Orchestrator | Coordinate multi-service transactions with rollbacks |
| **Circuit Breaker** | API Gateway | Protect system when downstream services fail |

---

## 🏗️ Architecture

```
                    ┌──────────────────┐
                    │   API Gateway    │ ← Circuit Breaker on all downstream calls
                    │    (port 3000)   │
                    └────────┬─────────┘
                             │
            ┌────────────────┼───────────────────┐
            │                │                   │
   ┌────────▼───────┐ ┌─────▼──────┐ ┌──────────▼────────┐
   │ Order Service   │ │  Payment   │ │ Notification Svc  │
   │  (port 3001)    │ │  Service   │ │   (port 3004)     │
   │  [PostgreSQL]   │ │(port 3002) │ │ ⚡ Deliberately   │
   └────────┬────────┘ │[PostgreSQL]│ │    Flaky!         │
            │          │  [Redis]   │ └───────────────────┘
            │          └─────┬──────┘
            │                │
   ┌────────▼────────────────▼───────┐
   │          RabbitMQ               │ ← Event Bus
   │     (ports 5672, 15672)         │
   └────────┬────────────────────────┘
            │
   ┌────────▼───────┐  ┌────────────────┐
   │     Saga       │  │   Inventory    │
   │  Orchestrator  │  │    Service     │
   │   [Redis]      │  │  (port 3003)   │
   └────────────────┘  │   [MongoDB]    │
                       └────────────────┘
```

### The Order Flow (Saga)

```
Customer places order
        │
        ▼
  ┌─────────────┐      ┌───────────┐      ┌──────────┐      ┌──────────────┐
  │ 1. Create   │─────▶│ 2. Process│─────▶│ 3. Reserve│─────▶│ 4. Send      │
  │    Order    │      │  Payment  │      │ Inventory │      │ Notification │
  └─────────────┘      └───────────┘      └──────────┘      └──────────────┘
                       If fails: ↩️        If fails: ↩️
                       Cancel Order        Refund Payment
                                           Cancel Order
```

---

## 🐳 Infrastructure

| Container | Image | Port | Purpose |
|-----------|-------|------|---------|
| `ms_rabbitmq` | rabbitmq:3.13-management | 5672, 15672 | Event bus for saga events |
| `ms_postgres` | postgres:15 | 5432 | Orders & payments (ACID transactions) |
| `ms_mongodb` | mongo:6.0 | 27017 | Inventory (flexible schema) |
| `ms_redis` | redis:7.0 | 6379 | Idempotency keys + saga state |

---

## 🚀 Quick Start

### Prerequisites
- Docker Desktop (or Rancher Desktop with dockerd)
- Node.js 20+ (for running test scripts locally)

### 1. Start Everything

```powershell
docker-compose up --build
```

Wait until all health checks pass (watch the logs for ✅ messages).

### 2. Seed Test Data

```powershell
# Install mongoose locally for the seed script
npm install mongoose --prefix scripts

# Run the seed script
node scripts/seed-data.js
```

### 3. Run the Demos

```powershell
# Demo 1: Idempotency
node scripts/test-idempotency.js

# Demo 2: Saga Pattern
node scripts/test-saga.js

# Demo 3: Circuit Breaker
node scripts/test-circuit-breaker.js
```

### 4. Explore

- **API Gateway**: http://localhost:3000 (lists all endpoints)
- **RabbitMQ UI**: http://localhost:15672 (user/password)
- **Circuit Status**: http://localhost:3000/api/circuit-status

---

## 📚 Learning Path

Read the guides in order:

1. **[Idempotency](./01-idempotency.md)** — Start here. Simplest pattern to understand.
2. **[Saga Pattern](./02-saga-pattern.md)** — The core orchestration pattern.
3. **[Circuit Breaker](./03-circuit-breaker.md)** — Protection against cascading failures.
4. **[Exercises](./04-exercises.md)** — Hands-on practice.
5. **[Interview Questions](./05-interview-questions.md)** — Prep for senior/architect interviews.

---

## 📁 Project Structure

```
microservices/
├── docker-compose.yaml          # All 10 containers
├── .env                         # Environment variables
│
├── services/
│   ├── api-gateway/             # 🛡️ Circuit Breaker Pattern
│   ├── order-service/           # 📦 Saga initiator
│   ├── payment-service/         # 💳 Idempotency Pattern
│   ├── inventory-service/       # 📦 Compensating transactions
│   ├── notification-service/    # ⚡ Deliberately flaky
│   └── saga-orchestrator/       # 🎯 Saga state machine
│
├── shared/                      # Shared utilities
│   ├── rabbitmq.js              # RabbitMQ connection helper
│   ├── retry.js                 # Retry with backoff
│   └── logger.js                # Structured logging
│
├── scripts/                     # Demo & test scripts
│   ├── seed-data.js             # Seed inventory
│   ├── test-idempotency.js      # Idempotency demo
│   ├── test-saga.js             # Saga demo
│   └── test-circuit-breaker.js  # Circuit breaker demo
│
├── docs/                        # Learning guides
│   ├── 00-overview.md           # This file
│   ├── 01-idempotency.md
│   ├── 02-saga-pattern.md
│   ├── 03-circuit-breaker.md
│   ├── 04-exercises.md
│   └── 05-interview-questions.md
│
└── event-driven-architecture/   # Original producer/consumer code and future Kafka examples
    ├── producer/
    ├── consumer/
    └── notes.md
```
