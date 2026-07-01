# Hands-On Exercises

## Prerequisites

Before starting, make sure all services are running:

```powershell
docker-compose up --build -d
docker-compose ps  # Verify all containers are healthy
node scripts/seed-data.js  # Seed inventory data
```

Watch logs in a separate terminal:
```powershell
docker-compose logs -f
```

---

## Exercise 1: Idempotency — Duplicate Payment Prevention

### Objective
Prove that sending the same payment request multiple times only processes it once.

### Steps

**Step 1:** Open a terminal and make a payment request with an idempotency key:

```powershell
# First request — will process the payment (takes ~2 seconds)
curl -X POST http://localhost:3000/api/payments `
  -H "Content-Type: application/json" `
  -H "Idempotency-Key: my-test-key-001" `
  -d '{"orderId": "order-exercise-1", "amount": 99.99}'
```

📝 **Note the response** — it will include a `paymentId`.

**Step 2:** Send the EXACT same request again:

```powershell
# Second request — should return cached response instantly
curl -X POST http://localhost:3000/api/payments `
  -H "Content-Type: application/json" `
  -H "Idempotency-Key: my-test-key-001" `
  -d '{"orderId": "order-exercise-1", "amount": 99.99}'
```

### What to Observe
- ✅ First request: Takes ~2 seconds, returns status 201
- ⚡ Second request: Returns instantly, same response, has `X-Idempotent-Replayed: true` header
- ✅ Only ONE payment was created in the database

### Verification
Check the payment service logs:
```powershell
docker-compose logs payment-service --tail=20
```

You should see:
```
🔑 New idempotency key — processing request     (first request)
⚡ IDEMPOTENT HIT — Returning cached response    (second request)
```

### Challenge
Try sending 10 requests simultaneously with the same key. How many succeed? How many get 409 Conflict?

---

## Exercise 2: Saga — Happy Path Order

### Objective
Place an order and watch the full saga flow complete successfully.

### Steps

**Step 1:** Disable chaos mode (so notifications succeed):

```powershell
curl -X POST http://localhost:3000/api/chaos/disable
```

**Step 2:** Check available inventory:

```powershell
curl http://localhost:3000/api/inventory/LAPTOP-001
```

Note the `available` quantity.

**Step 3:** Place an order:

```powershell
curl -X POST http://localhost:3000/api/orders `
  -H "Content-Type: application/json" `
  -d '{"customerId":"cust-001","items":[{"productId":"LAPTOP-001","quantity":1,"price":2499.99}]}'
```

Note the `orderId` and `sagaId` from the response.

**Step 4:** Poll the order status:

```powershell
# Replace ORDER_ID with the actual ID from step 3
curl http://localhost:3000/api/orders/ORDER_ID
```

Keep polling every 2-3 seconds. Watch the status change:
`CREATED` → `PAYMENT_PENDING` → `INVENTORY_PENDING` → `CONFIRMED`

**Step 5:** Check inventory again:

```powershell
curl http://localhost:3000/api/inventory/LAPTOP-001
```

The `available` should be 1 less, and `reserved` should be 1 more.

### What to Observe in Logs

Watch the saga orchestrator logs:
```powershell
docker-compose logs -f saga-orchestrator
```

You should see the saga flow:
```
🎬 SAGA STARTED
▶️ Executing step 1/3: payment
✅ Step 'payment' completed successfully
▶️ Executing step 2/3: inventory
✅ Step 'inventory' completed successfully
▶️ Executing step 3/3: notification
✅ Step 'notification' completed successfully
🎉 SAGA COMPLETED SUCCESSFULLY
```

---

## Exercise 3: Saga — Failure & Compensation

### Objective
Make a saga fail and watch compensating transactions execute.

### Steps

**Step 1:** Place an order with excessive quantity (more than available stock):

```powershell
curl -X POST http://localhost:3000/api/orders `
  -H "Content-Type: application/json" `
  -d '{"customerId":"cust-002","items":[{"productId":"WATCH-001","quantity":9999,"price":799.99}]}'
```

**Step 2:** Watch the saga orchestrator logs:

```powershell
docker-compose logs -f saga-orchestrator
```

### What to Observe

The saga flow should be:
```
🎬 SAGA STARTED
▶️ Executing step 1/3: payment
✅ Step 'payment' completed successfully
▶️ Executing step 2/3: inventory
❌ Step 'inventory' FAILED — starting compensation
🔄 Compensating 1 steps in reverse: [payment]
  ↩️ Compensating step 'payment': command.payment.refund
🔴 SAGA FAILED — all compensations dispatched
```

Check the order status — it should be `CANCELLED`.

Check the payment service logs:
```powershell
docker-compose logs payment-service --tail=10
```

You should see the refund:
```
💸 Payment refunded
```

### Challenge
What happens if you order a product that doesn't exist in inventory? Try:
```powershell
curl -X POST http://localhost:3000/api/orders `
  -H "Content-Type: application/json" `
  -d '{"customerId":"cust-003","items":[{"productId":"NONEXISTENT","quantity":1,"price":1.00}]}'
```

---

## Exercise 4: Circuit Breaker — Watch It Open and Close

### Objective
Make the notification service flaky, watch the circuit breaker open, then recover.

### Steps

**Step 1:** Check initial circuit state:

```powershell
curl http://localhost:3000/api/circuit-status
```

All circuits should be `CLOSED`.

**Step 2:** Enable high chaos on notification service:

```powershell
curl -X POST http://localhost:3000/api/chaos/config `
  -H "Content-Type: application/json" `
  -d '{"failureRate": 0.8, "latencyMaxMs": 1000, "enabled": true}'
```

**Step 3:** Send notification requests rapidly:

```powershell
# Send 10 requests quickly
for ($i = 1; $i -le 10; $i++) {
  $response = curl -s -X POST http://localhost:3000/api/notify `
    -H "Content-Type: application/json" `
    -d "{`"orderId`":`"test-$i`",`"customerId`":`"cust-$i`"}"
  Write-Host "Request $i : $response"
  Start-Sleep -Milliseconds 500
}
```

**Step 4:** Check circuit state again:

```powershell
curl http://localhost:3000/api/circuit-status | ConvertFrom-Json | ConvertTo-Json -Depth 5
```

The notification-service circuit should be `OPEN`.

**Step 5:** Send another request — it should get fallback response instantly:

```powershell
curl -X POST http://localhost:3000/api/notify `
  -H "Content-Type: application/json" `
  -d '{"orderId":"fallback-test","customerId":"cust-fallback"}'
```

Note: Response should contain `"fallback": true` and be instant (< 5ms).

**Step 6:** Disable chaos and wait for recovery:

```powershell
curl -X POST http://localhost:3000/api/chaos/disable
```

Wait 15 seconds (the reset timeout), then:

```powershell
curl -X POST http://localhost:3000/api/notify `
  -H "Content-Type: application/json" `
  -d '{"orderId":"recovery-test","customerId":"cust-recovery"}'
```

**Step 7:** Verify circuit is closed:

```powershell
curl http://localhost:3000/api/circuit-status
```

The notification-service circuit should be `CLOSED` again.

### What to Observe
1. **CLOSED → OPEN**: After enough failures, requests are rejected instantly
2. **OPEN**: Fallback responses returned in < 5ms
3. **OPEN → HALF-OPEN**: After 15s timeout, one request passes through
4. **HALF-OPEN → CLOSED**: Test request succeeds, normal operation resumes

---

## Exercise 5: Combined — Full E-Commerce Flow with Failures

### Objective
Run the complete system with all patterns interacting.

### Steps

**Step 1:** Reset everything:

```powershell
docker-compose down -v
docker-compose up --build -d
# Wait for health checks
node scripts/seed-data.js
```

**Step 2:** Enable moderate chaos (30% failure):

```powershell
curl -X POST http://localhost:3000/api/chaos/config `
  -H "Content-Type: application/json" `
  -d '{"failureRate": 0.3, "enabled": true}'
```

**Step 3:** Place 5 orders rapidly:

```powershell
for ($i = 1; $i -le 5; $i++) {
  curl -s -X POST http://localhost:3000/api/orders `
    -H "Content-Type: application/json" `
    -d "{`"customerId`":`"cust-$i`",`"items`":[{`"productId`":`"HEADPHONES-001`",`"quantity`":1,`"price`":249.99}]}"
  Write-Host ""
}
```

**Step 4:** Check all orders:

```powershell
curl http://localhost:3000/api/orders
```

**Step 5:** Observe:
- Some orders should be `CONFIRMED`
- Some might be `CANCELLED` (if payment failed randomly)
- Check inventory — only confirmed orders should have reserved stock
- Check circuit status — notification circuit might be open if enough failures

### Discussion Questions
1. How many orders were confirmed vs cancelled?
2. Did any orders fail at the inventory step? Why or why not?
3. Is the notification circuit breaker open? Why?
4. What would happen if you increased the chaos to 90%?

---

## 🎯 Self-Assessment Checklist

After completing all exercises, you should be able to answer:

- [ ] How does the idempotency key prevent duplicate payments?
- [ ] What's the role of Redis vs PostgreSQL in idempotency?
- [ ] What happens when you send concurrent requests with the same key?
- [ ] How does the saga orchestrator track saga progress?
- [ ] What are compensating transactions and when do they run?
- [ ] Why is notification failure treated differently from payment failure?
- [ ] How does the circuit breaker decide when to open?
- [ ] What is a fallback response and when is it returned?
- [ ] How does the HALF-OPEN state work?
- [ ] How do all three patterns work together in the order flow?
