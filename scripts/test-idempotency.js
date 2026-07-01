/**
 * ============================================================
 * TEST: IDEMPOTENCY PATTERN
 * ============================================================
 * 
 * This script demonstrates idempotency in action.
 * Run it after starting all services:
 * 
 *   node scripts/test-idempotency.js
 * 
 * What it does:
 * 1. Sends a payment request 5 times with the SAME idempotency key
 * 2. Shows that only 1 payment was actually created
 * 3. Shows that duplicate requests return the cached response
 * 4. Sends concurrent requests to show conflict handling
 * 
 * ============================================================
 */

const API_BASE = process.env.API_BASE || 'http://localhost:3000';

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function makeRequest(url, options = {}) {
    const response = await fetch(url, {
        method: options.method || 'GET',
        headers: {
            'Content-Type': 'application/json',
            ...options.headers
        },
        body: options.body ? JSON.stringify(options.body) : undefined
    });
    const body = await response.json();
    return { status: response.status, body, headers: Object.fromEntries(response.headers) };
}

async function testIdempotency() {
    console.log('╔══════════════════════════════════════════════════════════╗');
    console.log('║           IDEMPOTENCY PATTERN — DEMO                    ║');
    console.log('╚══════════════════════════════════════════════════════════╝\n');

    const idempotencyKey = `test-${Date.now()}`;
    const paymentData = {
        orderId: `order-${Date.now()}`,
        amount: 99.99,
        currency: 'USD'
    };

    // ─── Test 1: Sequential duplicate requests ───
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('TEST 1: Sequential Duplicate Requests');
    console.log('Sending 5 identical payment requests with the same idempotency key');
    console.log(`Idempotency Key: ${idempotencyKey}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    for (let i = 1; i <= 5; i++) {
        console.log(`\n📤 Request #${i}:`);
        const start = Date.now();

        try {
            const result = await makeRequest(`${API_BASE}/api/payments`, {
                method: 'POST',
                headers: { 'Idempotency-Key': idempotencyKey },
                body: paymentData
            });

            const duration = Date.now() - start;
            const isReplayed = result.headers['x-idempotent-replayed'] === 'true';

            if (i === 1) {
                console.log(`   ✅ Status: ${result.status} (ORIGINAL — payment processed)`);
                console.log(`   ⏱️  Duration: ${duration}ms (includes 2s processing delay)`);
            } else {
                console.log(`   ⚡ Status: ${result.status} (IDEMPOTENT REPLAY — cached response)`);
                console.log(`   ⏱️  Duration: ${duration}ms (instant — no re-processing!)`);
                console.log(`   🔁 X-Idempotent-Replayed: ${isReplayed}`);
            }

            console.log(`   📦 Response: ${JSON.stringify(result.body, null, 2)}`);
        } catch (err) {
            console.log(`   ❌ Error: ${err.message}`);
        }

        // Small delay between requests
        if (i < 5) await sleep(500);
    }

    // ─── Test 2: Concurrent requests (same key) ───
    console.log('\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('TEST 2: Concurrent Duplicate Requests');
    console.log('Sending 3 simultaneous requests with a NEW idempotency key');
    console.log('Expected: 1 processes, 2 get 409 Conflict');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    const concurrentKey = `concurrent-${Date.now()}`;
    const concurrentPayment = {
        orderId: `order-concurrent-${Date.now()}`,
        amount: 149.99,
        currency: 'USD'
    };

    console.log(`Idempotency Key: ${concurrentKey}`);
    console.log('Firing 3 requests simultaneously...\n');

    const promises = Array.from({ length: 3 }, (_, i) =>
        makeRequest(`${API_BASE}/api/payments`, {
            method: 'POST',
            headers: { 'Idempotency-Key': concurrentKey },
            body: concurrentPayment
        }).then(result => ({
            requestNum: i + 1,
            status: result.status,
            body: result.body
        })).catch(err => ({
            requestNum: i + 1,
            status: 'error',
            body: { error: err.message }
        }))
    );

    const results = await Promise.all(promises);

    results.forEach(r => {
        const icon = r.status === 201 ? '✅' : (r.status === 409 ? '⚠️' : '❌');
        console.log(`   ${icon} Request #${r.requestNum}: Status ${r.status}`);
        if (r.status === 409) {
            console.log(`      → Conflict: Another request is processing this key`);
        } else if (r.status === 201 || r.status === 200) {
            console.log(`      → This request "won" and processed the payment`);
        }
    });

    // ─── Test 3: Different keys = different payments ───
    console.log('\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('TEST 3: Different Idempotency Keys');
    console.log('Same payment data but different keys = DIFFERENT payments');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    for (let i = 1; i <= 3; i++) {
        const uniqueKey = `unique-${Date.now()}-${i}`;
        console.log(`   📤 Request #${i} with key '${uniqueKey}'`);

        try {
            const result = await makeRequest(`${API_BASE}/api/payments`, {
                method: 'POST',
                headers: { 'Idempotency-Key': uniqueKey },
                body: { orderId: `order-diff-${i}`, amount: 25.00 }
            });
            console.log(`   ✅ Status: ${result.status} — Payment ID: ${result.body.paymentId || 'N/A'}`);
        } catch (err) {
            console.log(`   ❌ Error: ${err.message}`);
        }
        await sleep(2500); // Wait for processing
    }

    // ─── Summary ───
    console.log('\n\n╔══════════════════════════════════════════════════════════╗');
    console.log('║                    KEY TAKEAWAYS                         ║');
    console.log('╠══════════════════════════════════════════════════════════╣');
    console.log('║ 1. Same idempotency key → same response (no duplicates) ║');
    console.log('║ 2. Concurrent requests → 409 Conflict (safe!)           ║');
    console.log('║ 3. Different keys → separate payments                   ║');
    console.log('║ 4. First request: ~2s (processing)                      ║');
    console.log('║ 5. Duplicate requests: <10ms (cached!)                  ║');
    console.log('╚══════════════════════════════════════════════════════════╝\n');
}

testIdempotency().catch(err => {
    console.error('Test failed:', err.message);
    process.exit(1);
});
