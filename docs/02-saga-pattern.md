# Deep Dive: Saga Pattern

## 📖 What is the Saga Pattern?

**A saga is a sequence of local transactions where each step has a compensating transaction. If any step fails, the previously completed steps are undone by executing their compensations in reverse order.**

### The Problem It Solves: Distributed Transactions

In a monolithic application, you'd use a single database transaction:

```sql
BEGIN TRANSACTION;
  INSERT INTO orders (...);
  INSERT INTO payments (...);
  UPDATE inventory SET quantity = quantity - 1;
COMMIT;  -- All or nothing!
```

**In microservices, each service has its OWN database.** You can't use a single transaction across multiple databases. That's where the saga pattern comes in.

### Real-World Analogy

Think of booking a vacation:
1. **Book flight** ✅ → If hotel fails, **cancel flight** ↩️
2. **Book hotel** ✅ → If car rental fails, **cancel hotel** ↩️, **cancel flight** ↩️
3. **Book car rental** ✅ → All done!

If step 3 fails, you undo step 2, then undo step 1. Each undo is a **compensating transaction**.

---

## 🤔 Why Not Use 2-Phase Commit (2PC)?

### 2-Phase Commit (The Old Way)

```
Coordinator: "Everyone prepare!"
  Service A: "I'm ready"  ✅
  Service B: "I'm ready"  ✅
  Service C: "I'm ready"  ✅
Coordinator: "Everyone commit!"
  All services commit simultaneously.
```

### Problems with 2PC in Microservices

| Issue | Why It's a Problem |
|-------|-------------------|
| **Blocking** | All participants hold locks until coordinator says commit/rollback |
| **Single point of failure** | If coordinator dies during commit, everyone is stuck |
| **Performance** | Network round-trips between all participants for each transaction |
| **Not all DBs support it** | MongoDB, Redis, etc. don't support distributed XA transactions |
| **Tight coupling** | All services must participate in the same transaction protocol |

### Saga (The Microservices Way)

```
Saga: "Service A, do your thing"
  Service A: "Done!" ✅
Saga: "Service B, do your thing"
  Service B: "Failed!" ❌
Saga: "Service A, UNDO your thing" ↩️
  Service A: "Undone!" ✅
```

**Key difference:** Each step commits immediately. There are no distributed locks. If a later step fails, we compensate (undo) the earlier steps.

---

## 🏗️ Two Approaches: Orchestration vs Choreography

### Orchestration (What We Implement)

A central **Saga Orchestrator** tells each service what to do.

```
                    ┌─────────────────┐
            ┌──────│  Saga           │──────┐
            │      │  Orchestrator   │      │
            │      └──────┬──────────┘      │
            │             │                 │
     "Process       "Reserve          "Send
     Payment"       Inventory"        Notification"
            │             │                 │
            ▼             ▼                 ▼
     ┌──────────┐  ┌──────────┐      ┌──────────┐
     │ Payment  │  │Inventory │      │Notifica- │
     │ Service  │  │ Service  │      │tion Svc  │
     └──────────┘  └──────────┘      └──────────┘
```

**Pros:**
- Easy to understand the flow (it's all in one place)
- Easy to add new steps or change the order
- Centralized error handling and compensation logic
- Good for complex workflows

**Cons:**
- Orchestrator is a single point of coordination
- Can become complex as sagas grow
- Risk of becoming a "god service"

### Choreography (Alternative)

Each service listens to events and decides what to do next. No central coordinator.

```
Order Created ──▶ Payment Service listens ──▶ Payment Success ──▶ Inventory Service listens ──▶ ...
```

**Pros:**
- No central point of failure
- Looser coupling between services
- Each service is autonomous

**Cons:**
- Hard to understand the full flow (scattered across services)
- Circular dependencies can form
- Debugging is a nightmare
- Adding a new step means modifying multiple services

### When to Use Which?

| Scenario | Approach |
|----------|----------|
| < 5 steps, simple flow | Choreography works fine |
| > 5 steps, complex conditions | Orchestration is better |
| Need visibility into saga state | Orchestration |
| Extreme loose coupling required | Choreography |
| Most production systems | **Orchestration** (easier to maintain) |

---

## 🔧 How Our Implementation Works

### Our Saga: Order Processing

```
  ┌─────────────────────────────────────────────────────────────────┐
  │                     HAPPY PATH                                  │
  │                                                                 │
  │  order.created ──▶ payment.success ──▶ inventory.reserved      │
  │       │                  │                    │                  │
  │       ▼                  ▼                    ▼                  │
  │  ┌─────────┐      ┌─────────┐          ┌─────────┐            │
  │  │ Create  │      │ Process │          │ Reserve │    ──▶ DONE │
  │  │ Order   │      │ Payment │          │ Stock   │            │
  │  └─────────┘      └─────────┘          └─────────┘            │
  └─────────────────────────────────────────────────────────────────┘

  ┌─────────────────────────────────────────────────────────────────┐
  │                   FAILURE PATH (Inventory Fails)                │
  │                                                                 │
  │  order.created ──▶ payment.success ──▶ inventory.FAILED        │
  │       │                  │                    │                  │
  │       │                  │              COMPENSATION:            │
  │       │                  │                    │                  │
  │       ▼                  ▼                    ▼                  │
  │  ┌─────────┐      ┌─────────┐          ┌─────────┐            │
  │  │ Cancel  │ ◀─── │ Refund  │ ◀─────── │ (fail)  │            │
  │  │ Order   │      │ Payment │          │         │            │
  │  └─────────┘      └─────────┘          └─────────┘            │
  │  (compensation)   (compensation)                                │
  └─────────────────────────────────────────────────────────────────┘
```

### Saga Step Definitions

```javascript
// From services/saga-orchestrator/src/sagas/order-saga.js
const orderSagaSteps = [
    {
        name: 'payment',
        command: 'command.payment.process',      // Forward action
        successEvent: 'payment.success',          // Expected success event
        failureEvent: 'payment.failed',           // Expected failure event
        compensation: 'command.payment.refund'    // Undo action
    },
    {
        name: 'inventory',
        command: 'command.inventory.reserve',
        successEvent: 'inventory.reserved',
        failureEvent: 'inventory.failed',
        compensation: 'command.inventory.release'
    },
    {
        name: 'notification',
        command: 'command.notification.send',
        successEvent: 'notification.sent',
        failureEvent: 'notification.failed',
        compensation: null  // Best-effort — no rollback for notifications
    }
];
```

### State Management (Redis)

Every saga instance has its state stored in Redis:

```json
{
    "sagaId": "abc-123",
    "sagaType": "order",
    "status": "INVENTORY_PENDING",
    "currentStep": 1,
    "completedSteps": ["payment"],
    "data": {
        "orderId": "order-456",
        "paymentId": "pay-789",
        "amount": 99.99
    },
    "history": [
        { "action": "SAGA_STARTED", "timestamp": "..." },
        { "action": "STEP_EXECUTE", "step": "payment", "timestamp": "..." },
        { "action": "STEP_SUCCESS", "step": "payment", "timestamp": "..." },
        { "action": "STEP_EXECUTE", "step": "inventory", "timestamp": "..." }
    ]
}
```

### Event Flow (RabbitMQ)

```
Topic Exchange: "saga_events"

Events published:
  order.created          → Triggers saga start
  command.payment.process → Payment service executes
  payment.success         → Saga moves to next step
  payment.failed          → Saga starts compensation
  command.inventory.reserve → Inventory service executes
  inventory.reserved      → Saga moves to next step
  inventory.failed        → Saga compensates payment
  command.payment.refund  → Payment service refunds
  command.order.cancel    → Order service cancels
```

### Key Files to Study

1. **`services/saga-orchestrator/src/saga-engine.js`** — The state machine (READ FIRST)
2. **`services/saga-orchestrator/src/sagas/order-saga.js`** — Step definitions
3. **`services/saga-orchestrator/src/index.js`** — Event wiring
4. **`services/payment-service/src/index.js`** — How a service handles saga commands
5. **`services/inventory-service/src/index.js`** — Compensating transaction implementation

---

## 💡 Key Design Decisions

### 1. Compensating Transactions Are NOT Simple "Undo"

A compensating transaction is a **semantic reverse** — not a technical rollback.

| Action | Compensation | Why it's not simple undo |
|--------|-------------|--------------------------|
| Process payment | Refund payment | Can't delete the payment record — need a refund record for auditing |
| Reserve inventory | Release inventory | Need to track what was released and why |
| Send notification | (none) | Can't "unsend" an email! Best-effort only |
| Create order | Cancel order | Don't delete — mark as cancelled for history |

### 2. Notification Failure ≠ Saga Failure

In our implementation, if the notification fails, the order still goes through:

```javascript
if (type === 'notification.failed') {
    // Still treat as success — order is confirmed
    await engine.handleStepSuccess(sagaId, 'notification', {
        notificationFailed: true
    });
}
```

**Why?** A customer would be furious if their order was cancelled just because an email failed to send. Notification is **best-effort**.

### 3. Saga State Stored in Redis (Not Database)

- Sagas are short-lived (seconds to minutes)
- Redis is faster than PostgreSQL for frequent updates
- TTL naturally cleans up completed sagas
- In production, you might use a database for long-running sagas

### 4. Idempotent Saga Steps

Each saga step must be idempotent because:
- The orchestrator might retry failed commands
- RabbitMQ might redeliver messages
- Multiple orchestrator instances might process the same event

That's why the payment service uses `saga-{sagaId}` as the idempotency key.

---

## ⚠️ Edge Cases and Gotchas

### 1. Compensation Fails

**Problem:** What if the refund fails during compensation?

**Solution:** Options include:
- Retry the compensation with backoff
- Store failed compensations in a "dead letter" queue for manual resolution
- Alert operations team for manual intervention

### 2. Saga Orchestrator Crashes

**Problem:** Orchestrator crashes mid-saga.

**Solution:** 
- Saga state is in Redis (survives orchestrator restart)
- On restart, orchestrator can resume pending sagas
- Docker's `restart: on-failure` restarts the service

### 3. Out-of-Order Events

**Problem:** `payment.success` arrives before `order.created` is processed.

**Solution:**
- The orchestrator waits for events matching the current step
- Events for wrong steps are ignored (or requeued)
- RabbitMQ's per-queue ordering helps

### 4. Long-Running Sagas

**Problem:** A saga step takes 30 minutes (external API is slow).

**Solution:**
- Set saga timeout — if not completed in X minutes, auto-compensate
- Use polling instead of blocking for long steps
- Separate "saga timeout monitor" checks for stuck sagas

---

## 🎯 Interview Questions — Saga Pattern

### Basic Level

**Q: What is the saga pattern and why do we need it?**

> The saga pattern manages distributed transactions across multiple microservices. Since each service has its own database, we can't use traditional ACID transactions. A saga breaks the transaction into local transactions, each with a compensating transaction. If any step fails, completed steps are compensated in reverse order.

**Q: What's the difference between orchestration and choreography?**

> Orchestration uses a central coordinator (saga orchestrator) that tells each service what to do and when. Choreography has each service listen to events and react independently. Orchestration is easier to understand and debug but creates a central point. Choreography is more decoupled but harder to track and maintain.

**Q: What is a compensating transaction?**

> A compensating transaction is the semantic reverse of an action. It undoes the effect of a completed step. For example, if a payment was processed, the compensating transaction is a refund. It's not a database rollback — it's a new forward action that reverses the business effect.

### Intermediate Level

**Q: How do you handle a compensation that fails?**

> Options: (1) Retry with exponential backoff. (2) Store in a dead letter queue for manual resolution. (3) Implement a "compensation saga" — a sub-saga specifically for compensations. (4) Alert the operations team. In practice, compensations should be designed to be idempotent and always succeed (refunding a payment should always work if the payment exists).

**Q: How do you ensure saga steps are executed in order?**

> In orchestration: the orchestrator maintains state and only advances to the next step after receiving a success event. In choreography: each service publishes a specific event that the next service listens for. The saga state machine enforces the ordering.

**Q: When would you NOT use the saga pattern?**

> (1) When a single database transaction suffices (monolith or single service). (2) When strong consistency is required and eventual consistency is not acceptable. (3) For simple CRUD operations that don't span services. (4) When the complexity of compensations outweighs the benefits.

### Advanced / Architect Level

**Q: Design a saga for an e-commerce checkout that involves: payment, inventory, shipping, loyalty points, and email notification.**

> Steps with compensations: (1) Reserve inventory → Release inventory. (2) Process payment → Refund payment. (3) Award loyalty points → Revoke loyalty points. (4) Create shipment → Cancel shipment. (5) Send confirmation email → no compensation (best-effort). Order matters: reserve inventory first (fail fast if out of stock), then payment, then non-critical steps. Notification is always last and best-effort.

**Q: How would you handle a saga that needs to run for hours or days (e.g., travel booking with manual approval)?**

> (1) Use persistent state storage (database instead of Redis). (2) Implement a saga timeout monitor that checks for stuck sagas. (3) Support saga "parking" — pause and resume. (4) Use a workflow engine (like Temporal or Camunda) for complex long-running sagas. (5) Implement heartbeats for long-running steps.

**Q: In a high-throughput system, how do you prevent the saga orchestrator from becoming a bottleneck?**

> (1) Partition sagas across multiple orchestrator instances (shard by saga ID). (2) Use a topic exchange so events are distributed across consumers. (3) Make the orchestrator stateless — all state in Redis/database. (4) Scale horizontally — multiple orchestrator instances can handle different sagas. (5) Consider switching to choreography for the hottest paths if needed.

**Q: Compare saga pattern with the outbox pattern. When would you use each?**

> The outbox pattern ensures exactly-once event publishing by writing events to a database table in the same transaction as the data change, then a separate process publishes those events. The saga pattern coordinates multi-step transactions. They're complementary: use the outbox pattern WITHIN saga steps to ensure reliable event publishing. The outbox solves "how to reliably publish events" while the saga solves "how to coordinate distributed transactions."
