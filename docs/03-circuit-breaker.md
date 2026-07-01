# Deep Dive: Circuit Breaker Pattern

## 📖 What is a Circuit Breaker?

**A circuit breaker prevents an application from repeatedly trying to execute an operation that's likely to fail, allowing it to continue without waiting for the fault to be fixed.**

### The Electrical Analogy

In your house:
- Too much current flows → **circuit breaker trips** (opens) → power cut to prevent damage
- You fix the problem → **manually reset** the breaker → power restored

In software:
- Too many failures to a service → **circuit breaker opens** → requests rejected instantly
- After a timeout → **circuit automatically tests** → if service recovered, circuit closes

### Without Circuit Breaker

```
Client → API → Slow/Dead Service
  └─── Wait 30 seconds...
  └─── Timeout!
  └─── Try again...
  └─── Wait 30 seconds...
  └─── Timeout again!

Meanwhile: Thread pool exhausted, other requests affected → CASCADING FAILURE
```

### With Circuit Breaker

```
Client → API → Circuit Breaker → Service (failing)
                    │
            First 3 failures: pass through
            4th failure: CIRCUIT OPENS
                    │
Client → API → Circuit Breaker  ✋ "Service is down, here's a fallback"
                    │               (instant response, <1ms)
            After 15 seconds: HALF-OPEN
                    │
Client → API → Circuit Breaker → Service (let one through to test)
                    │
            If success: CIRCUIT CLOSES (recovered!)
            If failure: CIRCUIT OPENS again (not yet)
```

---

## 🔄 The Three States

```
  ┌──────────────────────────────────────────────────────────┐
  │                                                          │
  │   ┌──────────┐   failures exceed    ┌──────────┐        │
  │   │          │   threshold          │          │        │
  │   │  CLOSED  │─────────────────────▶│   OPEN   │        │
  │   │ (normal) │                      │(failing) │        │
  │   │          │                      │          │        │
  │   └──────────┘                      └──────────┘        │
  │        ▲                                 │              │
  │        │                          timeout expires       │
  │   test succeeds                          │              │
  │        │                           ┌──────────┐         │
  │        │                           │          │         │
  │        └───────────────────────────│HALF-OPEN │         │
  │                                    │(testing) │         │
  │                                    │          │         │
  │                                    └──────────┘         │
  │                                         │               │
  │                                    test fails           │
  │                                         │               │
  │                                    ┌──────────┐         │
  │                                    │   OPEN   │         │
  │                                    │  (again) │         │
  │                                    └──────────┘         │
  │                                                          │
  └──────────────────────────────────────────────────────────┘
```

### CLOSED (Normal Operation)
- All requests pass through to the downstream service
- Successes and failures are tracked in a rolling window
- When failure rate exceeds threshold (e.g., 50%) → **switch to OPEN**

### OPEN (Service Down — Protecting You)
- **ALL requests are immediately rejected** — no call to downstream service
- Returns fallback response instantly (< 1ms)
- Gives the failing service time to recover (no bombardment)
- After reset timeout (e.g., 15s) → **switch to HALF-OPEN**

### HALF-OPEN (Testing Recovery)
- Allows **ONE** request through to test if service recovered
- If the test request succeeds → **switch to CLOSED** (service recovered!)
- If the test request fails → **switch back to OPEN** (not recovered yet)

---

## 🔧 How Our Implementation Works

### Configuration Parameters

```javascript
const config = {
    timeout: 5000,                   // Request timeout (5 seconds)
    errorThresholdPercentage: 50,    // Open when 50% of requests fail
    resetTimeout: 15000,             // Try again after 15 seconds
    rollingCountTimeout: 10000,      // Count failures in 10-second windows
    volumeThreshold: 3               // Need at least 3 requests before calculating %
};
```

| Parameter | Value | Meaning |
|-----------|-------|---------|
| `timeout` | 5000ms | If a request takes > 5s, count it as a failure |
| `errorThresholdPercentage` | 50% | Open circuit when half of requests fail |
| `resetTimeout` | 15000ms | Wait 15s before testing recovery |
| `rollingCountTimeout` | 10000ms | Count failures in 10-second rolling windows |
| `volumeThreshold` | 3 | Need at least 3 requests before evaluating failure rate |

### Code Architecture

```
Client Request
     │
     ▼
┌──────────────┐
│  API Gateway │
│              │
│  ┌────────┐  │         ┌──────────────────┐
│  │Circuit │──│────────▶│ Notification     │
│  │Breaker │  │         │ Service          │
│  └────┬───┘  │         │ (flaky!)         │
│       │      │         └──────────────────┘
│       │      │
│  If OPEN:    │
│  Return      │
│  fallback    │
│  instantly   │
└──────────────┘
```

### The Fallback Response

When the circuit is OPEN, we return a pre-configured fallback instead of failing:

```javascript
notificationBreaker.fallback(() => ({
    error: 'Notification service is temporarily unavailable',
    fallback: true,
    message: 'Notification will be retried later'
}));
```

### Key Files to Study

1. **`services/api-gateway/src/circuit-breaker.js`** — Circuit breaker wrapper (READ FIRST)
2. **`services/api-gateway/src/routes.js`** — How circuit breakers protect each route
3. **`services/notification-service/src/index.js`** — The deliberately flaky service
4. **`scripts/test-circuit-breaker.js`** — Test showing full lifecycle

---

## 📊 Monitoring Circuit Breakers

Our API gateway exposes circuit breaker status at `GET /api/circuit-status`:

```json
{
    "timestamp": "2024-01-15T10:30:00Z",
    "breakers": {
        "notification-service": {
            "state": "OPEN",
            "stats": {
                "successes": 5,
                "failures": 12,
                "timeouts": 3,
                "rejects": 45,
                "fallbacks": 45,
                "latencyMean": "2340ms"
            },
            "config": {
                "timeout": 5000,
                "errorThresholdPercentage": 50,
                "resetTimeout": 15000
            }
        },
        "order-service": {
            "state": "CLOSED",
            "stats": {
                "successes": 150,
                "failures": 2,
                "timeouts": 0,
                "rejects": 0,
                "fallbacks": 0,
                "latencyMean": "45ms"
            }
        }
    }
}
```

---

## 💡 Design Decisions

### 1. Per-Service vs Per-Endpoint Circuit Breakers

| Approach | Pros | Cons |
|----------|------|------|
| **Per-service** (what we do) | Simple, protects against service-wide outages | One slow endpoint opens circuit for all endpoints |
| **Per-endpoint** | Granular control | More circuit breakers to manage |
| **Per-service + per-endpoint** | Best of both | Complex configuration |

We use per-service for simplicity. In production, consider per-endpoint for critical paths.

### 2. Fallback Strategies

| Strategy | Example | When to Use |
|----------|---------|-------------|
| **Default value** | Return empty list | Read operations |
| **Cached data** | Return last known value | Dashboard data |
| **Queue for retry** | Store request for later | Write operations |
| **Degraded response** | "Feature temporarily unavailable" | Non-critical features |
| **Alternative service** | Use SMS instead of email | When alternatives exist |

### 3. Why `volumeThreshold`?

Without a minimum volume, a single failure would immediately open the circuit:
- 1 request, 1 failure = 100% failure rate → circuit opens!
- With `volumeThreshold: 3`, need at least 3 requests before calculating failure percentage
- Prevents premature circuit opening during low traffic

### 4. Using `opossum` Library

We use the `opossum` library (Netflix Hystrix-inspired) because:
- Battle-tested in production systems
- Configurable rolling window statistics
- Built-in event system for monitoring
- Fallback support
- Half-open state management
- No need to reinvent the wheel

---

## ⚠️ Edge Cases and Gotchas

### 1. Cascading Circuit Opens

**Problem:** Service A depends on B, B depends on C. C goes down → B's circuit to C opens → B returns errors → A's circuit to B opens. All circuits open.

**Solution:**
- Use fallbacks at each level
- Different timeout/threshold configs per service
- Monitor and alert when circuits open
- Consider bulkhead pattern (isolate failures)

### 2. Circuit Breaker vs Retry

**They're complementary, not alternatives!**

```
Request → Retry (with backoff) → Circuit Breaker → Service
```

- **Retry**: Try again for transient failures (network glitch, 502)
- **Circuit Breaker**: Stop trying for persistent failures (service down)
- Combined: Retry 3 times. If all fail, circuit breaker counts the failure.

### 3. Health Check Interference

**Problem:** Health check requests keep the circuit "warm" — even when no real traffic exists.

**Solution:** Don't route health checks through the circuit breaker. Health checks should bypass it.

### 4. Testing Circuit Breakers

**Problem:** Hard to test in development — services rarely fail.

**Solution:** That's why we built a deliberately flaky notification service with chaos mode! Toggle failure rate at runtime.

---

## 🏢 How Big Companies Do It

### Netflix (Hystrix → Resilience4j)
- Pioneered the circuit breaker pattern in microservices
- Hystrix was THE library (now in maintenance mode)
- Resilience4j is the modern replacement
- Every service-to-service call is wrapped in a circuit breaker

### Amazon
- Circuit breakers on all external service calls
- Automated scaling when circuits open (the failing service needs help)
- Correlation between circuit breaker opens and deployment rollbacks

### Uber
- Custom circuit breaker with adaptive thresholds
- Machine learning to predict optimal threshold values
- Per-datacenter circuit breaker state

---

## 🎯 Interview Questions — Circuit Breaker

### Basic Level

**Q: What is the circuit breaker pattern? Explain the three states.**

> The circuit breaker pattern prevents an application from repeatedly calling a failing service. It has three states: CLOSED (normal — requests pass through), OPEN (failing — requests rejected immediately with fallback), and HALF-OPEN (testing — one request passes through to test if service recovered). If the test succeeds, circuit closes. If it fails, circuit opens again.

**Q: Why is the circuit breaker pattern important in microservices?**

> Without it, a failing downstream service can cause cascading failures. Every request to the failing service hangs for the timeout duration, consuming threads and resources. This can make YOUR service slow, which makes services calling you slow — a domino effect. The circuit breaker fails fast, protecting your resources and giving the failing service time to recover.

**Q: What is a fallback in the context of a circuit breaker?**

> A fallback is an alternative response returned when the circuit is open. It could be a default value, cached data, a degraded response, or a redirect to an alternative service. The key is providing a useful response instead of an error.

### Intermediate Level

**Q: How do you configure circuit breaker thresholds? What factors do you consider?**

> Key parameters: (1) Error threshold percentage — how many failures before opening (typically 50-70%). (2) Timeout — how long to wait before counting as failure (based on SLA). (3) Reset timeout — how long the circuit stays open (15-60 seconds). (4) Rolling window — time period for counting failures (10-60 seconds). (5) Volume threshold — minimum requests before evaluating (prevents premature opening). Factors: service criticality, expected latency, traffic volume, and acceptable degradation.

**Q: How does the circuit breaker pattern relate to the bulkhead pattern?**

> They're complementary. Circuit breaker prevents a single failing dependency from consuming resources. Bulkhead isolates different call paths so that a failure in one doesn't affect others. Example: Separate thread pools for payment calls and notification calls — if notifications are slow, payment calls are unaffected.

**Q: Explain the difference between circuit breaker, retry, and timeout patterns.**

> Timeout: Sets a maximum wait time for a single request. Retry: Repeats a failed request N times with backoff. Circuit Breaker: Stops all requests to a failing service. They work together: a single request has a timeout. If it fails, it's retried. If retries fail, the circuit breaker counts the failure. When failures exceed the threshold, the circuit opens and stops ALL further attempts.

### Advanced / Architect Level

**Q: Design a circuit breaker system for a high-traffic e-commerce platform with 50 microservices.**

> (1) Use a library like Resilience4j or opossum in each service. (2) Configure per-service with different thresholds based on criticality. (3) Store circuit state in a shared store (Redis) for consistency across service instances. (4) Implement a monitoring dashboard showing all circuit states. (5) Set up alerts when circuits open. (6) Use adaptive thresholds that adjust based on traffic patterns. (7) Implement bulkheads to isolate failure domains. (8) Use fallbacks appropriate to each service's function.

**Q: How would you handle circuit breakers in a service mesh (Istio, Linkerd)?**

> Service meshes provide circuit breaking at the infrastructure level — no code changes needed. Configure circuit breaking in the mesh's traffic policy (DestinationRule in Istio). Advantages: consistent across all services regardless of language, centralized management. Disadvantages: less fine-grained control, fallback logic still needs application code. Best approach: use mesh-level circuit breaking for basic protection, add application-level for critical paths that need custom fallbacks.

**Q: A circuit breaker is open for a critical service. How do you handle this in production?**

> Immediate: (1) Return fallback responses to users. (2) Alert on-call engineers. Short-term: (3) Check the failing service — is it deployed, healthy, scaled properly? (4) Check for recent deployments or config changes. (5) Check infrastructure — network, DNS, load balancer. Recovery: (6) Fix the root cause. (7) Circuit will auto-recover through HALF-OPEN state. (8) Monitor for full recovery. Post-incident: (9) Conduct post-mortem. (10) Improve fallback responses. (11) Add automated recovery actions.
