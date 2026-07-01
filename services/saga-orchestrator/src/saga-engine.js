/**
 * ============================================================
 * SAGA ENGINE — Generic Saga State Machine
 * ============================================================
 * 
 * This is the CORE LEARNING PIECE for the Saga Pattern.
 * 
 * WHAT IS A SAGA?
 * A saga is a sequence of local transactions where each step
 * has a corresponding COMPENSATING TRANSACTION. If any step
 * fails, the saga executes compensations in REVERSE ORDER.
 * 
 * ORCHESTRATION vs CHOREOGRAPHY:
 * 
 * ORCHESTRATION (what we implement here):
 *   - Central coordinator (this engine) tells each service what to do
 *   - Like a conductor directing an orchestra
 *   - Pros: Easy to understand, centralized logic, easy to debug
 *   - Cons: Single point of coordination, orchestrator complexity
 * 
 * CHOREOGRAPHY (alternative approach):
 *   - Each service listens to events and decides what to do next
 *   - Like dancers following the music independently
 *   - Pros: No central point, looser coupling
 *   - Cons: Hard to track, circular dependencies, debugging nightmare
 * 
 * HOW THIS ENGINE WORKS:
 * 
 * 1. Define saga steps:
 *    [
 *      { name: 'payment',   command: 'command.payment.process',   successEvent: 'payment.success',   failureEvent: 'payment.failed',   compensation: 'command.payment.refund' },
 *      { name: 'inventory', command: 'command.inventory.reserve',  successEvent: 'inventory.reserved', failureEvent: 'inventory.failed', compensation: 'command.inventory.release' },
 *      { name: 'notify',    command: 'command.notification.send',  successEvent: 'notification.sent',  failureEvent: 'notification.failed' }
 *    ]
 * 
 * 2. Saga starts → execute step 1 command
 * 3. Listen for success/failure event
 *    - Success → move to next step
 *    - Failure → start compensation (reverse order)
 * 4. Compensation: execute each completed step's compensation in reverse
 * 
 * STATE MACHINE:
 *   STARTED → STEP_1_PENDING → STEP_1_COMPLETED →
 *   STEP_2_PENDING → STEP_2_COMPLETED → ... → COMPLETED
 *   
 *   On failure:
 *   STEP_N_FAILED → COMPENSATING → COMPENSATION_COMPLETED → FAILED
 * 
 * ============================================================
 */

const { createLogger } = require('../../../shared/logger');
const logger = createLogger('SagaEngine');

class SagaEngine {
    /**
     * @param {Object} redis - ioredis client
     * @param {Object} channel - RabbitMQ channel
     * @param {Function} publishEvent - Function to publish events
     */
    constructor(redis, channel, publishEvent) {
        this.redis = redis;
        this.channel = channel;
        this.publishEvent = publishEvent;
        this.sagaDefinitions = new Map(); // sagaType → step definitions
    }

    /**
     * Register a saga definition.
     * 
     * @param {string} sagaType - Name of the saga (e.g., 'order')
     * @param {Array} steps - Array of step definitions
     */
    registerSaga(sagaType, steps) {
        this.sagaDefinitions.set(sagaType, steps);
        logger.info(`📋 Registered saga: '${sagaType}' with ${steps.length} steps`, {
            steps: steps.map(s => s.name)
        });
    }

    /**
     * Start a new saga instance.
     * 
     * @param {string} sagaType - Which saga to run
     * @param {string} sagaId - Unique ID for this saga instance
     * @param {Object} initialData - Data passed to the first step
     */
    async startSaga(sagaType, sagaId, initialData) {
        const steps = this.sagaDefinitions.get(sagaType);
        if (!steps) {
            throw new Error(`Unknown saga type: ${sagaType}`);
        }

        const correlationLogger = logger.withCorrelation(sagaId);

        // Initialize saga state in Redis
        const sagaState = {
            sagaId,
            sagaType,
            status: 'STARTED',
            currentStep: 0,
            data: initialData,
            completedSteps: [],
            history: [{
                action: 'SAGA_STARTED',
                timestamp: new Date().toISOString(),
                data: initialData
            }],
            startedAt: new Date().toISOString()
        };

        await this.saveSagaState(sagaId, sagaState);

        correlationLogger.info('🎬 SAGA STARTED', {
            sagaType,
            steps: steps.map(s => s.name),
            totalSteps: steps.length
        });

        // Execute the first step
        await this.executeStep(sagaId, sagaState, steps);
    }

    /**
     * Execute the current step in the saga.
     */
    async executeStep(sagaId, sagaState, steps) {
        const stepIndex = sagaState.currentStep;
        const step = steps[stepIndex];
        const correlationLogger = logger.withCorrelation(sagaId);

        if (!step) {
            // All steps completed!
            sagaState.status = 'COMPLETED';
            sagaState.completedAt = new Date().toISOString();
            sagaState.history.push({
                action: 'SAGA_COMPLETED',
                timestamp: new Date().toISOString()
            });
            await this.saveSagaState(sagaId, sagaState);

            correlationLogger.success('🎉 SAGA COMPLETED SUCCESSFULLY', {
                sagaType: sagaState.sagaType,
                duration: `${Date.now() - new Date(sagaState.startedAt).getTime()}ms`
            });

            // Update order status to final
            this.publishEvent(this.channel, 'order.status.update', {
                sagaId,
                orderId: sagaState.data.orderId,
                status: 'CONFIRMED'
            }, sagaId);

            return;
        }

        correlationLogger.info(`▶️ Executing step ${stepIndex + 1}/${steps.length}: ${step.name}`, {
            command: step.command
        });

        // Update state
        sagaState.status = `${step.name.toUpperCase()}_PENDING`;
        sagaState.history.push({
            action: `STEP_EXECUTE`,
            step: step.name,
            stepIndex,
            command: step.command,
            timestamp: new Date().toISOString()
        });
        await this.saveSagaState(sagaId, sagaState);

        // Update order status
        const statusMap = {
            'payment': 'PAYMENT_PENDING',
            'inventory': 'INVENTORY_PENDING',
            'notification': 'NOTIFICATION_SENT'
        };
        if (statusMap[step.name]) {
            this.publishEvent(this.channel, 'order.status.update', {
                sagaId,
                orderId: sagaState.data.orderId,
                status: statusMap[step.name]
            }, sagaId);
        }

        // Publish the command for this step
        this.publishEvent(this.channel, step.command, {
            sagaId,
            ...sagaState.data
        }, sagaId);
    }

    /**
     * Handle a step success event.
     * Move to the next step.
     */
    async handleStepSuccess(sagaId, stepName, eventData) {
        const sagaState = await this.loadSagaState(sagaId);
        if (!sagaState) {
            logger.warn(`Saga not found: ${sagaId}`);
            return;
        }

        const steps = this.sagaDefinitions.get(sagaState.sagaType);
        const correlationLogger = logger.withCorrelation(sagaId);

        correlationLogger.success(`✅ Step '${stepName}' completed successfully`);

        // Record completion
        sagaState.completedSteps.push(stepName);
        sagaState.data = { ...sagaState.data, ...eventData };
        sagaState.history.push({
            action: 'STEP_SUCCESS',
            step: stepName,
            timestamp: new Date().toISOString(),
            data: eventData
        });

        // Move to next step
        sagaState.currentStep++;
        await this.saveSagaState(sagaId, sagaState);

        // Execute next step
        await this.executeStep(sagaId, sagaState, steps);
    }

    /**
     * Handle a step failure event.
     * Start compensating transactions in reverse order.
     */
    async handleStepFailure(sagaId, stepName, reason) {
        const sagaState = await this.loadSagaState(sagaId);
        if (!sagaState) {
            logger.warn(`Saga not found: ${sagaId}`);
            return;
        }

        const steps = this.sagaDefinitions.get(sagaState.sagaType);
        const correlationLogger = logger.withCorrelation(sagaId);

        correlationLogger.error(`❌ Step '${stepName}' FAILED — starting compensation`, {
            reason,
            completedSteps: sagaState.completedSteps
        });

        sagaState.status = 'COMPENSATING';
        sagaState.failureReason = reason;
        sagaState.history.push({
            action: 'STEP_FAILED',
            step: stepName,
            reason,
            timestamp: new Date().toISOString()
        });
        await this.saveSagaState(sagaId, sagaState);

        // ─── COMPENSATING TRANSACTIONS ───
        // Execute compensations in REVERSE ORDER for all completed steps
        const completedSteps = [...sagaState.completedSteps].reverse();

        correlationLogger.warn(`🔄 Compensating ${completedSteps.length} steps in reverse: [${completedSteps.join(' → ')}]`);

        for (const completedStepName of completedSteps) {
            const stepDef = steps.find(s => s.name === completedStepName);

            if (stepDef && stepDef.compensation) {
                correlationLogger.info(`  ↩️ Compensating step '${completedStepName}': ${stepDef.compensation}`);

                sagaState.history.push({
                    action: 'COMPENSATION_EXECUTE',
                    step: completedStepName,
                    command: stepDef.compensation,
                    timestamp: new Date().toISOString()
                });

                // Publish compensation command
                this.publishEvent(this.channel, stepDef.compensation, {
                    sagaId,
                    orderId: sagaState.data.orderId,
                    reason: `Compensation for failed step: ${stepName}`
                }, sagaId);
            }
        }

        // Cancel the order
        this.publishEvent(this.channel, 'command.order.cancel', {
            sagaId,
            orderId: sagaState.data.orderId,
            reason: `Saga failed at step '${stepName}': ${reason}`
        }, sagaId);

        // Mark saga as failed
        sagaState.status = 'FAILED';
        sagaState.completedAt = new Date().toISOString();
        sagaState.history.push({
            action: 'SAGA_FAILED',
            timestamp: new Date().toISOString(),
            reason
        });
        await this.saveSagaState(sagaId, sagaState);

        correlationLogger.error('🔴 SAGA FAILED — all compensations dispatched', {
            sagaType: sagaState.sagaType,
            failedStep: stepName,
            compensated: completedSteps
        });
    }

    /**
     * Save saga state to Redis.
     */
    async saveSagaState(sagaId, state) {
        await this.redis.set(
            `saga:${sagaId}`,
            JSON.stringify(state),
            'EX', 86400  // 24 hour TTL
        );
    }

    /**
     * Load saga state from Redis.
     */
    async loadSagaState(sagaId) {
        const data = await this.redis.get(`saga:${sagaId}`);
        return data ? JSON.parse(data) : null;
    }
}

module.exports = { SagaEngine };
