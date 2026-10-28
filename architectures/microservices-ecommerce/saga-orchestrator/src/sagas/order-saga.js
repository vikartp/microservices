/**
 * ============================================================
 * ORDER SAGA DEFINITION
 * ============================================================
 * 
 * Defines the steps for the order processing saga:
 * 
 * ┌─────────┐    ┌─────────┐    ┌───────────┐    ┌──────────────┐
 * │  Order  │───▶│ Payment │───▶│ Inventory │───▶│ Notification │
 * │ Created │    │ Process │    │  Reserve  │    │     Send     │
 * └─────────┘    └─────────┘    └───────────┘    └──────────────┘
 *                    │               │
 *                    ▼               ▼
 *               ┌─────────┐    ┌───────────┐
 *               │ Payment │    │ Inventory │
 *               │  Refund │    │  Release  │
 *               └─────────┘    └───────────┘
 *               (compensation)  (compensation)
 * 
 * HAPPY PATH:
 *   order.created → payment.success → inventory.reserved → notification.sent → DONE
 * 
 * FAILURE SCENARIOS:
 * 
 *   Scenario 1: Payment fails
 *   order.created → payment.failed → cancel order → FAILED
 *   (no compensation needed — nothing to undo)
 * 
 *   Scenario 2: Inventory fails (after payment succeeded)
 *   order.created → payment.success → inventory.failed
 *     → COMPENSATE: refund payment → cancel order → FAILED
 * 
 *   Scenario 3: Notification fails (after payment + inventory succeeded)
 *   order.created → payment.success → inventory.reserved → notification.failed
 *     → ORDER STILL CONFIRMED (notification is best-effort)
 *     → We don't roll back the whole order just because email failed!
 * 
 * ============================================================
 */

const orderSagaSteps = [
    {
        name: 'payment',
        command: 'command.payment.process',
        successEvent: 'payment.success',
        failureEvent: 'payment.failed',
        compensation: 'command.payment.refund'
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
        compensation: null  // No compensation — notification is best-effort
        // DESIGN DECISION: We don't roll back payment and inventory
        // just because an email failed to send. The order is still valid.
    }
];

module.exports = { orderSagaSteps };
