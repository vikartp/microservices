# Interview Questions — Senior Developer / Architect

This document contains 50+ interview questions organized by topic and difficulty.
Each question includes a **model answer** suitable for a senior developer or architect role.

---

## 1. Idempotency (17 Questions)

### Basic

**Q1: What is idempotency? Can you give a simple example?**

> An operation is idempotent if performing it multiple times has the same effect as performing it once. Example: Setting a thermostat to 72°F — pressing the button 10 times still results in 72°F. In APIs, GET is idempotent (reading data doesn't change it), while POST is typically not (each call creates a new resource).

**Q2: Which HTTP methods are idempotent by specification?**

> GET, PUT, DELETE, HEAD, and OPTIONS are idempotent. POST is not. PATCH may or may not be depending on implementation — `PATCH { age: 30 }` is idempotent, but `PATCH { age: age + 1 }` is not.

**Q3: Why is idempotency important in distributed systems?**

> Network failures, timeouts, and message redelivery are inevitable in distributed systems. Without idempotency, retries can cause duplicate operations — charging a customer twice, creating duplicate records, or sending duplicate emails. Idempotency ensures safe retries.

**Q4: What is an idempotency key?**

> A unique identifier sent with a request (usually as an HTTP header) that allows the server to recognize duplicate requests. If the server sees the same key again, it returns the cached response instead of re-processing. Stripe, for example, requires an `Idempotency-Key` header on all POST requests.

### Intermediate

**Q5: How would you implement idempotency for a REST API?**

> (1) Require clients to send an `Idempotency-Key` header. (2) On first request: store the key in Redis with status "processing". (3) Process the request and cache the response with the key. (4) On duplicate requests: return the cached response. (5) Use a database unique constraint on the key as a safety net. (6) Set a TTL (e.g., 24 hours) to prevent unbounded storage growth.

**Q6: Why use both Redis AND a database unique constraint for idempotency?**

> Defense in depth. Redis provides fast O(1) lookups for the common case. The database unique constraint catches duplicates if Redis is unavailable or the cache is flushed. This dual-layer approach ensures idempotency even during infrastructure failures.

**Q7: How do you handle concurrent requests with the same idempotency key?**

> Use Redis `SET NX` (Set if Not eXists) — an atomic operation. The first request acquires the "lock" by setting the key. Concurrent requests see the key exists with status "processing" and receive a 409 Conflict response. This prevents double-processing without distributed locks.

**Q8: What should happen when a previously-failed request is retried with the same idempotency key?**

> Allow the retry. When a request fails (5xx), mark the key as "failed" in the cache. On retry with the same key, detect the "failed" status and allow re-processing. Only "completed" requests should return cached responses. Failed operations should be retryable.

**Q9: What is the difference between idempotency and deduplication?**

> Idempotency means the operation itself has the same effect regardless of how many times it's called. Deduplication means detecting and discarding duplicate messages/requests. Idempotency is a property of the operation; deduplication is a mechanism to prevent duplicates. They're related but distinct — deduplication is one way to achieve idempotent behavior.

### Advanced

**Q10: Design an idempotency system for a high-throughput payment gateway (100K TPS).**

> Architecture: (1) Redis Cluster for sub-ms lookups, sharded by key hash. (2) Each payment processor instance checks Redis before processing. (3) Use `SET NX` with TTL for atomic lock acquisition. (4) Database unique constraint per-region as fallback. (5) Idempotency keys include region prefix for geographic routing. (6) 24h TTL with lazy cleanup. (7) Monitor cache hit ratio — high ratio indicates excessive retries, investigate root cause. (8) Circuit breaker on Redis — if Redis fails, fall through to database constraint.

**Q11: How does idempotency interact with event sourcing?**

> In event sourcing, every state change is an event with a unique ID. Idempotency is natural: if you try to append an event with a duplicate ID, the event store rejects it. However, you still need idempotency at the API level — the event store prevents duplicate events, but you need to prevent duplicate API processing that would generate those events. Use the event ID or command ID as the idempotency key.

**Q12: A client didn't receive a response due to a timeout. They retry with the same idempotency key. How do you know whether the original request completed?**

> Check the idempotency key in the cache: (1) If status is "completed" — return the cached response. The client missed it, but the operation succeeded. (2) If status is "processing" — the original might still be running. Return 409 or wait briefly. (3) If not found — the original failed before caching. Allow the retry. This is why we cache the FULL response, not just a success/failure flag.

**Q13: How would you implement idempotency for a GraphQL mutation?**

> GraphQL doesn't have built-in idempotency semantics. Options: (1) Accept an `idempotencyKey` as a mutation argument. (2) Use a custom HTTP header. (3) Implement at the resolver level — hash the mutation + variables to generate a natural idempotency key. (4) For subscriptions triggering mutations, include a client-generated request ID.

---

## 2. Saga Pattern (17 Questions)

### Basic

**Q14: What is the saga pattern?**

> The saga pattern manages distributed transactions across multiple microservices. It breaks a distributed transaction into a sequence of local transactions, each with a compensating transaction. If any step fails, completed steps are compensated in reverse order, maintaining data consistency across services.

**Q15: Why can't we use traditional ACID transactions in microservices?**

> Each microservice owns its own database (database-per-service pattern). Traditional transactions require a single transaction manager with access to all databases. In microservices, databases are isolated — different types (SQL, NoSQL), different networks, different trust boundaries. Distributed transactions (2PC) exist but are blocking, slow, and not supported by all databases.

**Q16: What is a compensating transaction?**

> A compensating transaction is the semantic reverse of a completed action. If a payment was processed, the compensation is a refund (not a database rollback). If inventory was reserved, the compensation releases the reservation. Key point: compensations are forward actions that undo the business effect, not technical rollbacks.

**Q17: Explain orchestration vs choreography in sagas.**

> Orchestration: A central coordinator (saga orchestrator) directs the saga — tells each service what to do and manages state. Like a conductor directing an orchestra. Choreography: Each service listens to events and acts independently. Like dancers following music. Orchestration is easier to understand and debug; choreography is more decoupled but harder to trace.

### Intermediate

**Q18: How do you handle a compensation that fails?**

> Options, in order of preference: (1) Retry with exponential backoff — compensations should be idempotent and eventually succeed. (2) Dead letter queue — store failed compensations for manual or automated retry. (3) Human intervention — alert operations for manual resolution. (4) Forward recovery — if compensation is impossible, complete the saga forward instead. Design compensations to be as reliable as possible — simpler logic, fewer dependencies.

**Q19: How do you ensure saga steps are idempotent?**

> (1) Use unique saga IDs as idempotency keys. (2) Check if a step was already completed before executing (using saga state). (3) Use database constraints (unique orderId in payment table). (4) Design operations to be naturally idempotent (e.g., `SET status = 'CANCELLED'` is idempotent, `INSERT INTO` is not without unique constraint).

**Q20: What is the difference between a saga and a workflow?**

> A saga focuses on maintaining data consistency across services with compensating transactions. A workflow is a broader concept for orchestrating business processes that may include human tasks, timers, and complex branching. Sagas are a specific type of workflow optimized for distributed transaction management. Workflow engines (Temporal, Camunda) can implement sagas as one of their patterns.

**Q21: When should you NOT use the saga pattern?**

> (1) When a single database transaction suffices. (2) When strong consistency is required and eventual consistency is unacceptable (e.g., financial settlements). (3) For simple CRUD that doesn't span services. (4) When the overhead of managing compensations exceeds the benefit. (5) When operations can't be compensated (e.g., physical goods already shipped).

**Q22: How do you handle timeouts in sagas? What if a step never responds?**

> (1) Set a timeout for each step — if no response within N seconds, treat as failure. (2) Implement a saga timeout — if the entire saga doesn't complete in X minutes, auto-compensate. (3) Run a "stuck saga monitor" that periodically checks for sagas stuck in a pending state. (4) Use message TTL in the broker — expired messages trigger failure handling.

### Advanced

**Q23: Design a saga for a travel booking system (flight, hotel, car, insurance).**

> Steps with compensations and ordering rationale:
> 1. Check availability (all) → no compensation needed (read-only)
> 2. Reserve flight → Cancel flight reservation
> 3. Reserve hotel → Cancel hotel reservation  
> 4. Reserve car → Cancel car reservation
> 5. Process payment → Refund payment
> 6. Purchase insurance → Cancel insurance policy
> 7. Send confirmation → no compensation (best-effort)
> 
> Rationale: Check availability first (fail fast). Reserve resources before payment (don't charge if unavailable). Payment before insurance (don't insure if payment fails). Notification last (best-effort).
> 
> Consider: Parallel execution of steps 2-4 if they're independent. Step timeouts for external APIs. Partial success handling (what if flight is available but hotel isn't?).

**Q24: How would you implement sagas in an event-sourced system?**

> In event sourcing, the saga orchestrator is an event handler that: (1) Receives domain events (OrderCreated). (2) Issues commands to other aggregates (ProcessPayment). (3) Stores saga state as events in the event store. (4) On failure, issues compensation commands. The event store naturally provides: durability (events are persisted), replayability (can reconstruct saga state), and idempotency (duplicate events are rejected).

**Q25: Compare saga pattern implementations: AWS Step Functions, Temporal, and custom with RabbitMQ.**

> | Feature | AWS Step Functions | Temporal | Custom (RabbitMQ) |
> |---------|-------------------|----------|-------------------|
> | Complexity | Low (managed) | Medium | High |
> | Control | Limited to AWS | Full | Full |
> | Visibility | Built-in UI | Built-in UI | Custom |
> | Cost | Pay per state transition | Self-hosted | Self-hosted |
> | Long-running | Yes (up to 1 year) | Yes (unlimited) | Requires custom |
> | Language support | JSON/YAML/CDK | Many SDKs | Any |
> | Best for | AWS-native | Complex workflows | Simple sagas |

**Q26: How do you handle the "dual write" problem in sagas?**

> The dual write problem: a service needs to update its database AND publish an event. If the database update succeeds but event publishing fails (or vice versa), inconsistency occurs. Solutions: (1) Transactional outbox pattern — write events to a database table in the same transaction, then a separate process publishes them. (2) Event sourcing — the event IS the database write. (3) CDC (Change Data Capture) — use database log to generate events (Debezium). The outbox pattern is most common for sagas.

---

## 3. Circuit Breaker (16 Questions)

### Basic

**Q27: What is the circuit breaker pattern?**

> The circuit breaker prevents an application from repeatedly calling a service that's likely to fail. Like an electrical circuit breaker, it "opens" when too many failures occur, blocking further calls and returning fallback responses. After a timeout, it "half-opens" to test if the service recovered. Three states: CLOSED (normal), OPEN (failing, reject calls), HALF-OPEN (testing recovery).

**Q28: What problems does the circuit breaker solve?**

> (1) Cascading failures — when a slow service makes your service slow, which makes upstream services slow. (2) Resource exhaustion — threads/connections tied up waiting for timeouts. (3) Unnecessary load — bombarding a failing service prevents it from recovering. (4) Poor user experience — users wait 30s for a timeout instead of getting an instant response.

**Q29: What is a fallback response?**

> A pre-configured alternative response returned when the circuit is open. Examples: cached data, default values, degraded functionality message, or redirect to an alternative service. The fallback ensures the application degrades gracefully instead of failing entirely.

### Intermediate

**Q30: How do you choose circuit breaker configuration values?**

> (1) Error threshold: Start at 50%, adjust based on normal error rate. If service normally has 5% errors, set threshold at 20-30%. (2) Timeout: Set based on P99 latency + small buffer. If P99 is 500ms, set timeout to 2-3 seconds. (3) Reset timeout: 15-60 seconds — enough for the service to recover but not so long that you miss quick recovery. (4) Volume threshold: Based on traffic — at minimum 5-10 requests to avoid premature opening. (5) Rolling window: 10-60 seconds depending on traffic volume.

**Q31: What's the difference between circuit breaker and retry?**

> Retry handles transient failures by repeating the request. Circuit breaker handles persistent failures by stopping all requests. They complement each other: retry first (for transient issues), and if retries keep failing, the circuit breaker opens (for persistent issues). Retry without circuit breaker = hammering a dead service. Circuit breaker without retry = failing on first error.

**Q32: How does the HALF-OPEN state work? Why is it necessary?**

> After the reset timeout, the circuit transitions from OPEN to HALF-OPEN and allows ONE request through. If it succeeds, the circuit closes (service recovered). If it fails, the circuit opens again. Without HALF-OPEN, the circuit would stay open forever or close abruptly — potentially flooding a still-recovering service with all queued requests.

**Q33: What is the bulkhead pattern and how does it relate to circuit breakers?**

> Bulkhead isolates different parts of a system so that failure in one doesn't affect others. Named after ship compartments — if one floods, others stay dry. Example: separate thread pools for different downstream services. Circuit breaker + bulkhead: bulkhead prevents a slow service from consuming all threads, while circuit breaker prevents repeated calls to a failing service. They're complementary resilience patterns.

**Q34: How do you monitor circuit breakers in production?**

> (1) Expose circuit state via health endpoints. (2) Emit metrics: open/close events, failure counts, latency. (3) Dashboard showing all circuit states across services. (4) Alerts when circuits open — indicates a service outage. (5) Correlate circuit opens with deployments (auto-rollback trigger). (6) Track MTTR (Mean Time To Recovery) per circuit. (7) Monitor false positives — circuits opening when service is actually healthy.

### Advanced

**Q35: Design a circuit breaker system for 50 microservices with 200 inter-service connections.**

> (1) Use service mesh (Istio) for infrastructure-level circuit breaking. (2) Application-level circuit breakers for critical paths needing custom fallbacks. (3) Centralized circuit state in Redis for consistency across instances. (4) Monitoring dashboard aggregating all circuit states. (5) Automated escalation: circuit open → page on-call → automated rollback if recent deployment. (6) Adaptive thresholds using ML on historical data. (7) Blast radius analysis — map dependency chains to predict cascading failures.

**Q36: How do circuit breakers work in a service mesh?**

> Service meshes (Istio, Linkerd) implement circuit breaking at the sidecar proxy level. In Istio, you configure a DestinationRule with `outlierDetection` settings. The Envoy proxy tracks errors per upstream host and ejects unhealthy hosts from the load balancing pool. Advantages: language-agnostic, no code changes, centralized management. Limitations: fallback logic still requires application code, less fine-grained than application-level.

**Q37: A circuit breaker keeps oscillating between OPEN and CLOSED rapidly. What's happening and how do you fix it?**

> This is "circuit breaker flapping." Causes: (1) Service is partially healthy — some requests succeed, some fail, oscillating around the threshold. (2) Threshold is too sensitive for the normal error rate. (3) Reset timeout is too short — circuit closes before service fully recovers. Fixes: (1) Increase error threshold (e.g., 50% → 70%). (2) Increase reset timeout (15s → 60s). (3) Implement "successive successes" — require N consecutive successes in HALF-OPEN before closing. (4) Use adaptive thresholds based on historical error rates.

---

## 4. Cross-Cutting & System Design (8+ Questions)

**Q38: How do all three patterns (idempotency, saga, circuit breaker) work together?**

> In our order flow: (1) Client submits order through API Gateway (circuit breaker protects downstream calls). (2) Order service creates order, starts saga. (3) Saga orchestrator sends payment command (idempotency key: `saga-{sagaId}` prevents duplicate charges on retry). (4) If payment succeeds, saga sends inventory command. (5) If inventory fails, saga compensates by refunding payment (idempotent — won't double-refund). (6) Notification service call is circuit-breaker protected — if it's down, saga still completes. All three patterns are essential for a reliable distributed system.

**Q39: Design an order processing system for an e-commerce platform handling 10K orders/minute.**

> Architecture: (1) API Gateway with circuit breakers and rate limiting. (2) Order service writes to PostgreSQL with idempotency keys. (3) Saga orchestrator using Redis for state, RabbitMQ for events. (4) Payment service with idempotency middleware + database constraint. (5) Inventory service with optimistic locking (MongoDB findAndModify). (6) Notification service (non-critical, circuit breaker protected). 
> 
> Scaling: Horizontally scale each service independently. Shard sagas across orchestrator instances by saga ID. Use Redis Cluster for saga state. Partition RabbitMQ queues. 
> 
> Reliability: Idempotent saga steps. Compensating transactions for failures. Circuit breakers on all inter-service calls. Dead letter queues for failed messages. Monitoring and alerting on circuit states and saga failures.

**Q40: What is eventual consistency and how do sagas achieve it?**

> Eventual consistency means that after all updates complete, the system will be in a consistent state, but there may be a window where it's inconsistent. Sagas achieve this by: (1) Each step commits locally (immediate consistency within one service). (2) Between steps, the system may be in an intermediate state (order created, payment pending). (3) When the saga completes or compensates, the system reaches a consistent final state. The trade-off: we lose strong consistency but gain availability and partition tolerance (CAP theorem).

**Q41: How do you debug a failed saga in production?**

> (1) Correlation IDs — every event carries a saga ID, traceable across all services. (2) Saga state history — Redis stores every state transition with timestamps. (3) Structured logging — JSON logs with saga ID, step name, outcome. (4) Distributed tracing (Jaeger/Zipkin) — visualize the entire saga flow. (5) Dead letter queues — inspect failed messages. (6) Saga dashboard — show in-progress, completed, and failed sagas with drill-down.

**Q42: What is the outbox pattern and when would you use it with sagas?**

> The outbox pattern solves the dual-write problem: updating a database AND publishing an event atomically. Implementation: (1) Write the event to an "outbox" table in the SAME database transaction as the data change. (2) A separate process (CDC or poller) reads the outbox table and publishes events to the message broker. (3) Delete from outbox after successful publish. Use with sagas when: saga steps need to update their database AND publish events reliably. Without it, you risk publishing an event but failing the database write, or vice versa.

**Q43: Compare these resilience patterns: Retry, Circuit Breaker, Bulkhead, Timeout, Fallback.**

> | Pattern | Purpose | When It Activates |
> |---------|---------|-------------------|
> | **Timeout** | Limit wait time | After N seconds of no response |
> | **Retry** | Handle transient failures | After a single failure |
> | **Circuit Breaker** | Handle persistent failures | After threshold failures |
> | **Bulkhead** | Isolate failures | Always active (resource limits) |
> | **Fallback** | Degrade gracefully | When any of the above triggers |
> 
> They're layered: `Request → Timeout → Retry → Circuit Breaker → Bulkhead → Fallback`

**Q44: How would you implement distributed tracing across saga-managed services?**

> (1) Generate a correlation ID when the saga starts (use saga ID). (2) Propagate the ID in every message/HTTP header (W3C Trace Context or custom). (3) Each service logs with the correlation ID. (4) Use OpenTelemetry SDK to create spans for each saga step. (5) Send traces to Jaeger/Zipkin. (6) Visualize the complete saga flow as a distributed trace. (7) Add span tags for saga state, step name, and outcome. This gives you a timeline view of the entire saga across all services.

**Q45: A senior architect asks you: "Why not just use a monolith?" How do you respond?**

> A monolith is the right choice when: team is small, domain is simple, you need strong consistency. Microservices are the right choice when: multiple teams need independent deployment, different scaling requirements per component, polyglot persistence is beneficial, or resilience to partial failures is critical. The patterns we've discussed (saga, idempotency, circuit breaker) are the COST of microservices — they solve problems that monoliths don't have. Always start with the question: "Do the benefits of microservices outweigh the operational complexity for our specific case?"

---

## 5. Scenario-Based Questions

**Q46: You notice that orders are occasionally being double-charged. Walk through your debugging process.**

> (1) Check if idempotency keys are being sent — look for missing `Idempotency-Key` headers in API logs. (2) Check Redis — is the idempotency middleware working? Look for cache misses. (3) Check database — are there duplicate records with the same order ID but different idempotency keys? (4) Check saga orchestrator — is it retrying payment commands? Look for duplicate `command.payment.process` events. (5) Check message broker — is RabbitMQ redelivering messages? Check `redelivered` flag. Fix: Ensure all payment paths use idempotency keys, including saga-initiated payments.

**Q47: Your notification service is down, and the circuit breaker is open. Product management says notifications are critical. What do you do?**

> Immediate: (1) The saga should still complete (notifications are best-effort). (2) Queue failed notifications for retry when service recovers. Short-term: (3) Investigate the root cause of the outage. (4) Fall back to an alternative channel (SMS instead of email). (5) Once fixed, process the backlog. Long-term: (6) Reevaluate if notifications should be best-effort or required. (7) If required, add notifications to the saga with compensation. (8) Implement notification retry with exponential backoff.

**Q48: During peak traffic, the saga orchestrator is processing sagas too slowly. Orders are backing up. What do you do?**

> Immediate: (1) Scale saga orchestrator horizontally (it's stateless — state is in Redis). (2) Increase RabbitMQ prefetch count to process more events concurrently. (3) Monitor Redis for latency — consider Redis Cluster if single node is bottleneck. Short-term: (4) Partition sagas across orchestrator instances by saga ID hash. (5) Optimize saga state serialization. (6) Consider parallel step execution where dependencies allow. Long-term: (7) Evaluate using a purpose-built workflow engine (Temporal). (8) Consider event-driven choreography for the hottest paths.

**Q49: Your team wants to add a new step to the order saga (fraud check). How do you add it without downtime?**

> (1) Create the fraud check service and deploy it. (2) Add the fraud check step to the saga definition (after order creation, before payment). (3) Deploy the updated saga orchestrator. (4) The new step applies to NEW sagas only — existing in-progress sagas continue with the old definition. (5) Use saga versioning — store saga version in state, execute based on version. (6) Test the new flow with canary traffic before full rollout. No downtime because: existing sagas complete with old logic, new sagas use new logic.

**Q50: How would you migrate from choreography-based sagas to orchestration-based sagas?**

> (1) Identify all services involved in the saga and their event contracts. (2) Build the saga orchestrator, implementing the same step sequence. (3) Deploy orchestrator alongside existing choreography (both running). (4) Route new sagas through the orchestrator. (5) Let existing choreography-based sagas complete. (6) Once all old sagas complete, remove choreography event handlers. (7) Key risk: both systems processing the same events during migration. Use a feature flag or routing key to prevent overlap.
