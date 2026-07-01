/**
 * ============================================================
 * TEST: CIRCUIT BREAKER PATTERN
 * ============================================================
 * 
 * This script demonstrates the circuit breaker in action.
 * Run it after starting all services:
 * 
 *   node scripts/test-circuit-breaker.js
 * 
 * What it does:
 * 1. Enables chaos on notification service (50% failure)
 * 2. Sends requests and watches the circuit OPEN
 * 3. Shows fallback responses when circuit is OPEN
 * 4. Waits for reset timeout
 * 5. Shows HALF-OPEN state (testing with one request)
 * 6. Disables chaos → shows circuit CLOSE (recovery)
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
    return { status: response.status, body: await response.json() };
}

async function getCircuitStatus() {
    try {
        const result = await makeRequest(`${API_BASE}/api/circuit-status`);
        return result.body.breakers['notification-service'] || {};
    } catch {
        return { state: 'UNKNOWN' };
    }
}

async function testCircuitBreaker() {
    console.log('╔══════════════════════════════════════════════════════════╗');
    console.log('║          CIRCUIT BREAKER PATTERN — DEMO                 ║');
    console.log('╚══════════════════════════════════════════════════════════╝\n');

    // ─── Phase 1: Enable chaos ───
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('PHASE 1: Enable Chaos Mode (70% failure rate)');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    try {
        await makeRequest(`${API_BASE}/api/chaos/config`, {
            method: 'POST',
            body: { failureRate: 0.7, latencyMaxMs: 1000, enabled: true }
        });
        console.log('   🔥 Chaos enabled: 70% failure rate, max 1s latency\n');
    } catch (err) {
        console.log('   ⚠️  Could not configure chaos:', err.message);
    }

    // Check initial circuit state
    let status = await getCircuitStatus();
    console.log(`   Circuit State: ${status.state || 'CLOSED'}\n`);

    // ─── Phase 2: Trigger failures → watch circuit OPEN ───
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('PHASE 2: Sending Requests (watch the circuit open)');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    let circuitOpened = false;

    for (let i = 1; i <= 15; i++) {
        try {
            const start = Date.now();
            const result = await makeRequest(`${API_BASE}/api/notify`, {
                method: 'POST',
                body: { orderId: `test-order-${i}`, customerId: `cust-${i}`, type: 'email' }
            });
            const duration = Date.now() - start;

            const circuitState = result.body.circuitState || 'unknown';
            const isFallback = result.body.fallback;
            const statusCode = result.status;

            if (isFallback) {
                console.log(`   🚫 Request #${i}: REJECTED (circuit OPEN) — ${duration}ms — Fallback response returned`);
                if (!circuitOpened) {
                    circuitOpened = true;
                    console.log('   ┌─────────────────────────────────────────────┐');
                    console.log('   │ 🔴 CIRCUIT OPENED! All requests now rejected │');
                    console.log('   │    No requests sent to failing service      │');
                    console.log('   │    Fallback responses returned instantly    │');
                    console.log('   └─────────────────────────────────────────────┘');
                }
            } else if (statusCode >= 500) {
                console.log(`   ❌ Request #${i}: FAILED (HTTP ${statusCode}) — ${duration}ms — Circuit: ${circuitState}`);
            } else {
                console.log(`   ✅ Request #${i}: SUCCESS — ${duration}ms — Circuit: ${circuitState}`);
            }
        } catch (err) {
            console.log(`   ❌ Request #${i}: ERROR — ${err.message}`);
        }
        await sleep(500);
    }

    // Show circuit status
    status = await getCircuitStatus();
    console.log(`\n   📊 Circuit Status: ${JSON.stringify(status, null, 2)}\n`);

    // ─── Phase 3: Wait for reset timeout → HALF-OPEN ───
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('PHASE 3: Waiting for Reset Timeout (15s)');
    console.log('Circuit will transition: OPEN → HALF-OPEN');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    // Disable chaos before the half-open test so the test request succeeds
    console.log('   ⚙️  Disabling chaos (simulating service recovery)...');
    try {
        await makeRequest(`${API_BASE}/api/chaos/disable`, { method: 'POST' });
        console.log('   ✅ Chaos disabled — service is "recovered"\n');
    } catch (err) {
        console.log('   ⚠️  Could not disable chaos\n');
    }

    for (let i = 15; i > 0; i--) {
        process.stdout.write(`\r   ⏳ Waiting... ${i}s remaining  `);
        await sleep(1000);
    }
    console.log('\n');

    // ─── Phase 4: Send test request → circuit should CLOSE ───
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('PHASE 4: Testing Recovery (HALF-OPEN → CLOSED)');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    for (let i = 1; i <= 5; i++) {
        try {
            const start = Date.now();
            const result = await makeRequest(`${API_BASE}/api/notify`, {
                method: 'POST',
                body: { orderId: `recovery-${i}`, customerId: `cust-${i}`, type: 'email' }
            });
            const duration = Date.now() - start;

            const circuitState = result.body.circuitState || 'unknown';
            const isFallback = result.body.fallback;

            if (isFallback) {
                console.log(`   🟡 Request #${i}: Circuit still OPEN/HALF-OPEN — ${duration}ms`);
            } else {
                console.log(`   🟢 Request #${i}: SUCCESS — Circuit: ${circuitState} — ${duration}ms`);
                if (circuitState === 'CLOSED') {
                    console.log('   ┌─────────────────────────────────────────────┐');
                    console.log('   │ 🟢 CIRCUIT CLOSED! Service has recovered!   │');
                    console.log('   │    Normal operation resumed                 │');
                    console.log('   └─────────────────────────────────────────────┘');
                }
            }
        } catch (err) {
            console.log(`   ❌ Request #${i}: ERROR — ${err.message}`);
        }
        await sleep(1000);
    }

    // Final status
    status = await getCircuitStatus();
    console.log(`\n   📊 Final Circuit Status: ${JSON.stringify(status, null, 2)}\n`);

    // ─── Summary ───
    console.log('╔══════════════════════════════════════════════════════════╗');
    console.log('║                    KEY TAKEAWAYS                         ║');
    console.log('╠══════════════════════════════════════════════════════════╣');
    console.log('║ 1. CLOSED: Normal operation, requests pass through      ║');
    console.log('║ 2. OPEN: Too many failures → instant fallback           ║');
    console.log('║ 3. HALF-OPEN: After timeout → test with one request     ║');
    console.log('║ 4. Recovery: Test succeeds → CLOSED (normal again)      ║');
    console.log('║ 5. Fallback: Instant response, no waiting for timeout   ║');
    console.log('║ 6. Prevents cascading failures in your system           ║');
    console.log('╚══════════════════════════════════════════════════════════╝\n');
}

testCircuitBreaker().catch(err => {
    console.error('Test failed:', err.message);
    process.exit(1);
});
