/**
 * ============================================================
 * TEST: SAGA PATTERN
 * ============================================================
 * 
 * This script demonstrates the saga pattern in action.
 * Run it after starting all services and seeding data:
 * 
 *   node scripts/seed-data.js
 *   node scripts/test-saga.js
 * 
 * What it does:
 * 1. Happy path: Places an order that succeeds through all steps
 * 2. Failure path: Places an order with insufficient inventory
 *    → Shows compensating transactions (refund payment, cancel order)
 * 
 * Watch the docker-compose logs to see the full saga flow:
 *   docker-compose logs -f saga-orchestrator order-service payment-service inventory-service
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

async function pollOrderStatus(orderId, maxAttempts = 15) {
    for (let i = 0; i < maxAttempts; i++) {
        await sleep(2000);
        try {
            const result = await makeRequest(`${API_BASE}/api/orders/${orderId}`);
            const status = result.body.status;
            console.log(`   📋 Order status: ${status} (poll ${i + 1})`);

            if (['CONFIRMED', 'CANCELLED', 'NOTIFICATION_SENT', 'FAILED'].includes(status)) {
                return result.body;
            }
        } catch (err) {
            console.log(`   ⏳ Waiting... (${err.message})`);
        }
    }
    return null;
}

async function testSaga() {
    console.log('╔══════════════════════════════════════════════════════════╗');
    console.log('║              SAGA PATTERN — DEMO                        ║');
    console.log('╚══════════════════════════════════════════════════════════╝\n');

    // First, disable chaos on notification service so saga completes
    console.log('⚙️  Disabling chaos on notification service...');
    try {
        await makeRequest(`${API_BASE}/api/chaos/disable`, { method: 'POST' });
        console.log('   ✅ Chaos disabled\n');
    } catch (err) {
        console.log('   ⚠️  Could not disable chaos (might not be running)\n');
    }

    // ─── Test 1: Happy Path ───
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('TEST 1: HAPPY PATH — Full Saga Success');
    console.log('Order → Payment ✅ → Inventory ✅ → Notification ✅');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    const happyOrder = {
        customerId: 'customer-001',
        items: [
            { productId: 'LAPTOP-001', quantity: 1, price: 2499.99 },
            { productId: 'HEADPHONES-001', quantity: 2, price: 249.99 }
        ]
    };

    console.log('📤 Creating order:', JSON.stringify(happyOrder, null, 2));

    const happyResult = await makeRequest(`${API_BASE}/api/orders`, {
        method: 'POST',
        body: happyOrder
    });

    console.log(`\n   📦 Order created: ${happyResult.body.orderId}`);
    console.log(`   🔗 Saga ID: ${happyResult.body.sagaId}`);
    console.log(`   💰 Total: $${happyResult.body.totalAmount}`);
    console.log(`   📋 Status: ${happyResult.body.status}\n`);
    console.log('   ⏳ Polling order status (saga in progress)...\n');

    const finalOrder = await pollOrderStatus(happyResult.body.orderId);

    if (finalOrder) {
        const icon = finalOrder.status === 'CANCELLED' ? '❌' : '✅';
        console.log(`\n   ${icon} Final order status: ${finalOrder.status}`);
        if (finalOrder.failureReason) {
            console.log(`   📝 Reason: ${finalOrder.failureReason}`);
        }
    }

    // Check inventory
    console.log('\n   📦 Checking inventory after order:');
    try {
        const laptop = await makeRequest(`${API_BASE}/api/inventory/LAPTOP-001`);
        const headphones = await makeRequest(`${API_BASE}/api/inventory/HEADPHONES-001`);
        console.log(`   LAPTOP-001: Available=${laptop.body.available}, Reserved=${laptop.body.reserved}`);
        console.log(`   HEADPHONES-001: Available=${headphones.body.available}, Reserved=${headphones.body.reserved}`);
    } catch (err) {
        console.log(`   ⚠️  Could not check inventory: ${err.message}`);
    }

    // ─── Test 2: Failure Path — Insufficient Inventory ───
    console.log('\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('TEST 2: FAILURE PATH — Inventory Insufficient');
    console.log('Order → Payment ✅ → Inventory ❌ → Compensate: Refund Payment ↩️');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    const failOrder = {
        customerId: 'customer-002',
        items: [
            { productId: 'WATCH-001', quantity: 9999, price: 799.99 }  // Way more than available (30)
        ]
    };

    console.log('📤 Creating order with excessive quantity:', JSON.stringify(failOrder, null, 2));

    const failResult = await makeRequest(`${API_BASE}/api/orders`, {
        method: 'POST',
        body: failOrder
    });

    console.log(`\n   📦 Order created: ${failResult.body.orderId}`);
    console.log(`   🔗 Saga ID: ${failResult.body.sagaId}`);
    console.log(`   📋 Status: ${failResult.body.status}\n`);
    console.log('   ⏳ Polling order status (expecting saga compensation)...\n');

    const failedOrder = await pollOrderStatus(failResult.body.orderId);

    if (failedOrder) {
        console.log(`\n   ❌ Final order status: ${failedOrder.status}`);
        console.log(`   📝 Failure reason: ${failedOrder.failureReason || 'N/A'}`);
        console.log('\n   What happened behind the scenes:');
        console.log('   1. Order was created ✅');
        console.log('   2. Payment was processed ✅');
        console.log('   3. Inventory reservation FAILED (insufficient stock) ❌');
        console.log('   4. Saga orchestrator detected failure');
        console.log('   5. Compensation: Payment was REFUNDED ↩️');
        console.log('   6. Compensation: Order was CANCELLED ↩️');
    }

    // ─── Summary ───
    console.log('\n\n╔══════════════════════════════════════════════════════════╗');
    console.log('║                    KEY TAKEAWAYS                         ║');
    console.log('╠══════════════════════════════════════════════════════════╣');
    console.log('║ 1. Saga coordinates multi-service transactions          ║');
    console.log('║ 2. Each step has a compensating transaction             ║');
    console.log('║ 3. On failure, compensations run in REVERSE order       ║');
    console.log('║ 4. The system stays consistent even after failures      ║');
    console.log('║ 5. No distributed locks or 2-phase commit needed        ║');
    console.log('╚══════════════════════════════════════════════════════════╝\n');
    console.log('💡 TIP: Watch the saga flow in real-time:');
    console.log('   docker-compose logs -f saga-orchestrator\n');
}

testSaga().catch(err => {
    console.error('Test failed:', err.message);
    process.exit(1);
});
