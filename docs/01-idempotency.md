# Deep Dive: Idempotency Pattern

## 📖 What is Idempotency?

**An operation is idempotent if performing it multiple times produces the same result as performing it once.**

### Real-World Analogy
- **Idempotent**: Pressing an elevator button multiple times — the elevator is called once.
- **NOT idempotent**: Placing an online order — clicking "Buy" 3 times creates 3 orders!

### In Computing
- `GET /users/123` → Always returns the same user. **Idempotent.**
- `DELETE /users/123` → First call deletes user, second call returns 404. **Idempotent.** (Result is the same: user doesn't exist)
- `POST /payments` → Each call creates a NEW payment. **NOT idempotent by default!**

### HTTP Methods and Idempotency

| Method | Idempotent? | Why |
|--------|------------|-----|
| GET | ✅ Yes | Reading data doesn't change anything |
| PUT | ✅ Yes | Replaces entire resource — same input, same result |
| DELETE | ✅ Yes | Deleting already-deleted resource = same state |
| PATCH | ⚠️ Depends | `PATCH { age: 30 }` is idempotent, `PATCH { age: age + 1 }` is NOT |
| POST | ❌ No | Creates new resources — each call creates a new one |

---

## 🤔 Why Do We Need Idempotency?

### The Problem: Distributed Systems Are Unreliable

```
┌────────┐         ┌─────────────────┐         ┌────────────────┐
│ Client │────────▶│   API Gateway   │────────▶│ Payment Service│
│        │         │                 │         │                │
│        │ Timeout │                 │         │   ✅ Payment   │
│        │◀ ─ ─ ─ ─│   No response   │         │   created!     │
│        │         │                 │         │                │
│ Retry! │────────▶│                 │────────▶│   ❌ DUPLICATE │
│        │         │                 │         │   payment!!    │
└────────┘         └─────────────────┘         └────────────────┘
```

**What happened:**
1. Client sends payment request
2. Payment service processes it successfully
3. Response is lost (network timeout)
4. Client thinks it failed → retries
5. Payment service creates a SECOND payment → **DOUBLE CHARGE!**

### Where Retries Come From

1. **User retry** — User clicks "Pay" button again
2. **Client-side retry** — HTTP client automatically retries on timeout
3. **Load balancer retry** — ALB retries request on a different server
4. **Message redelivery** — RabbitMQ redelivers message after consumer timeout
5. **Saga retry** — Saga orchestrator retries a failed step

### Real-World Impact

| Company | Failure | Cost |
|---------|---------|------|
| Payment processor | Double charge | Customer charged $500 instead of $250 |
| E-commerce | Duplicate orders | Warehouse ships 2 items, customer only ordered 1 |
| Banking | Duplicate transfers | Money transferred twice |

---

## 🔧 How Our Implementation Works

### The Flow (Step by Step)

```
Step 1: Client sends request with Idempotency-Key header
        ┌──────────────────────────────────────┐
        │ POST /payments                        │
        │ Idempotency-Key: "pay-abc-123"       │
        │ Body: { orderId: "x", amount: 99.99 }│
        └──────────────┬───────────────────────┘
                       │
Step 2: Middleware checks Redis for this key
        ┌──────────────▼───────────────────────┐
        │ Redis: GET "idempotency:pay-abc-123" │
        └──────────────┬───────────────────────┘
                       │
           ┌───────────┴───────────┐
           │                       │
    Key NOT found             Key FOUND
           │                       │
           ▼                       ▼
Step 3a: First Request      Step 3b: Duplicate!
  ┌─────────────────┐      ┌─────────────────┐
  │ SET key =       │      │ status =        │
  │ "processing"    │      │ "completed"?    │
  │ in Redis        │      │ Return cached   │
  └────────┬────────┘      │ response!       │
           │               └─────────────────┘
           ▼
Step 4: Process payment
  ┌─────────────────┐
  │ Call Stripe,     │
  │ save to DB,      │
  │ etc.             │
  └────────┬─────────┘
           │
           ▼
Step 5: Cache response in Redis
  ┌─────────────────────────┐
  │ SET key = {             │
  │   status: "completed",  │
  │   response: {...},      │
  │   TTL: 24 hours         │
  │ }                       │
  └─────────────────────────┘
```

### Redis State Machine

```
  ┌─────────────────┐
  │  KEY NOT FOUND  │ ─── New request → create key as "processing"
  └────────┬────────┘
           │
           ▼
  ┌─────────────────┐
  │   PROCESSING    │ ─── Another request with same key → 409 Conflict
  └────────┬────────┘
           │
     ┌─────┴──────┐
     │            │
  Success      Failure
     │            │
     ▼            ▼
┌──────────┐ ┌──────────┐
│COMPLETED │ │  FAILED  │
│          │ │          │
│ Return   │ │ Allow    │
│ cached   │ │ retry    │
│ response │ │          │
└──────────┘ └──────────┘
```

### Key Files to Study

1. **`services/payment-service/src/idempotency.js`** — The middleware (READ THIS FIRST)
2. **`services/payment-service/src/routes.js`** — How the middleware is applied
3. **`services/payment-service/src/models/payment.js`** — Database safety net (unique constraint)
4. **`scripts/test-idempotency.js`** — Test script showing it in action

---

## 🔍 Code Walkthrough

### The Middleware (Simplified)

```javascript
const createIdempotencyMiddleware = (redis) => {
    return async (req, res, next) => {
        const key = req.headers['idempotency-key'];
        if (!key) return next(); // No key = not idempotent

        // 1. Check Redis
        const existing = await redis.get(`idempotency:${key}`);
        
        if (existing && existing.status === 'completed') {
            // DUPLICATE! Return cached response
            return res.status(existing.statusCode).json(existing.body);
        }
        
        if (existing && existing.status === 'processing') {
            // CONCURRENT! Another request is processing
            return res.status(409).json({ error: 'Conflict' });
        }
        
        // 2. New request — lock it
        await redis.set(`idempotency:${key}`, { status: 'processing' });
        
        // 3. Intercept the response to cache it
        const originalJson = res.json.bind(res);
        res.json = async (body) => {
            await redis.set(`idempotency:${key}`, {
                status: 'completed',
                statusCode: res.statusCode,
                body
            }, 'EX', 86400); // 24h TTL
            return originalJson(body);
        };
        
        next(); // Continue to the actual handler
    };
};
```

### Database Safety Net

```javascript
// In the Payment model:
idempotencyKey: {
    type: DataTypes.STRING,
    unique: true  // ← DATABASE-LEVEL constraint
}
```

Even if Redis fails and the middleware doesn't catch the duplicate, the database will reject it with a unique constraint violation. **Defense in depth!**

---

## 💡 Design Decisions

### Why Redis + Database?

| Layer | Purpose | What if it fails? |
|-------|---------|-------------------|
| **Redis** | Fast idempotency check (< 1ms) | Falls through to database |
| **Database** | Safety net (unique constraint) | Returns constraint error, we catch it |

This is **defense in depth** — two independent layers ensuring no duplicates.

### Why TTL on Idempotency Keys?

- Keys expire after 24 hours
- Without TTL: Redis fills up forever
- 24 hours is usually enough — if a retry happens days later, it's probably a new intentional request
- Stripe uses a 24-hour TTL too

### Why Allow Retry After Failure?

When a request fails (5xx), we mark the key as "failed" and allow retries:
- If payment processing crashed, the user should be able to retry
- Only "completed" requests are cached permanently
- "Failed" keys can be overwritten by a retry

### What About the Idempotency Key Itself?

Common strategies for generating keys:
1. **UUID per request** — Client generates a UUID (`Idempotency-Key: uuid-v4()`)
2. **Business key** — Use order ID (`Idempotency-Key: order-123-payment`)
3. **Hash of request body** — `Idempotency-Key: sha256(JSON.stringify(body))`

**Our approach**: Client provides the key. This gives maximum control.

---

## ⚠️ Edge Cases and Gotchas

### 1. Concurrent Requests

**Problem:** Two requests arrive at the exact same millisecond with the same key.

**Solution:** We use Redis `SET NX` (Set if Not eXists) — an atomic operation. Only one request can create the key.

```javascript
const locked = await redis.set(key, value, 'EX', ttl, 'NX');
// locked = 'OK' if we got the lock, null if someone else did
```

### 2. Response Changes After Caching

**Problem:** Database data changes between the original and replayed request.

**Solution:** We cache the RESPONSE, not the computation. The cached response is always what the original caller received.

### 3. Redis Goes Down

**Problem:** Redis is unavailable — can't check idempotency.

**Solution:** We "fail open" — let the request through. The database unique constraint is the safety net.

```javascript
catch (err) {
    // Redis is down — let request through (fail open)
    // Database unique constraint is our safety net
    next();
}
```

### 4. Non-JSON Responses

**Problem:** Some responses might be streams or files.

**Solution:** Our middleware only intercepts `res.json()`. Non-JSON responses are not cached. This is a known limitation — production systems handle this differently.

---

## 🏢 How Big Companies Do It

### Stripe
- Requires `Idempotency-Key` header on all POST requests
- Keys expire after 24 hours
- Concurrent requests with same key return 409
- [Stripe Docs](https://stripe.com/docs/api/idempotent_requests)

### AWS
- Uses `ClientToken` parameter for idempotent API calls
- Tokens are scoped to the API operation
- Different token for each unique request

### Google Cloud
- Uses `requestId` field in API requests
- Server-side deduplication based on the ID

---

## 🎯 Interview Questions — Idempotency

### Basic Level

**Q: What is idempotency? Give examples of idempotent and non-idempotent operations.**

> An operation is idempotent if performing it N times has the same effect as performing it once. GET, PUT, DELETE are idempotent by nature. POST is not idempotent by default because each call typically creates a new resource. Making POST idempotent requires explicit implementation using idempotency keys.

**Q: Why is idempotency important in microservices?**

> In distributed systems, network failures, timeouts, and retries are inevitable. Without idempotency, these retries can cause duplicate operations — like charging a customer twice. Idempotency ensures that retrying a failed operation doesn't create unwanted side effects.

**Q: What HTTP methods are idempotent by specification?**

> GET, PUT, DELETE, HEAD, OPTIONS are idempotent. POST and PATCH are generally not idempotent, though PATCH can be idempotent depending on implementation.

### Intermediate Level

**Q: How would you implement idempotency for a payment API?**

> Use an idempotency key pattern: (1) Client sends a unique key with each request. (2) Server checks if the key was already processed. (3) If yes, return the cached response. (4) If no, process the request and cache the response with the key. Use Redis for fast lookups and a database unique constraint as a safety net.

**Q: What's the difference between idempotency at the API level vs the database level?**

> API-level idempotency uses a cache (Redis) to check if a request was already processed and returns the cached response. Database-level idempotency uses unique constraints to prevent duplicate records. Both should be used together — API-level for performance, database-level for safety.

**Q: How do you handle concurrent requests with the same idempotency key?**

> Use atomic operations like Redis SET NX (Set if Not eXists) to acquire a lock. The first request gets the lock and processes. Concurrent requests see the lock and receive a 409 Conflict response, telling them to retry later.

### Advanced / Architect Level

**Q: Design an idempotency system for a payment gateway processing 100K transactions/second.**

> Key considerations: (1) Use a distributed cache like Redis Cluster for sub-millisecond lookups. (2) Shard idempotency keys across Redis nodes by key hash. (3) Use database unique constraints as a fallback. (4) Set TTL (24h) to prevent unbounded growth. (5) Handle Redis failures by falling back to the database constraint (fail open). (6) Monitor cache hit rate — high hit rate means many retries, investigate root cause.

**Q: What happens if your Redis goes down? How do you maintain idempotency?**

> Defense in depth: (1) Primary: Redis check. (2) Fallback: Database unique constraint on idempotency key. (3) Design decision: fail open (let requests through) or fail closed (reject all requests). For payments, fail open + database constraint is safer than rejecting all payments. (4) Monitor Redis availability and set up alerts.

**Q: How does idempotency interact with the saga pattern?**

> Each saga step should be idempotent because: (1) The saga orchestrator may retry failed steps. (2) Messages may be redelivered by the message broker. (3) Compensation actions must also be idempotent — refunding a refund shouldn't create a negative refund. In our implementation, the payment service uses `saga-{sagaId}` as the idempotency key for saga-initiated payments.
