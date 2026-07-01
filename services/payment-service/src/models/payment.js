/**
 * Payment Model (Sequelize + PostgreSQL)
 * 
 * Stores payment records with idempotency key as a unique constraint.
 * The database constraint is a SAFETY NET — even if Redis fails,
 * we won't create duplicate payments.
 */

const { DataTypes } = require('sequelize');

const definePaymentModel = (sequelize) => {
    const Payment = sequelize.define('Payment', {
        id: {
            type: DataTypes.UUID,
            defaultValue: DataTypes.UUIDV4,
            primaryKey: true
        },
        orderId: {
            type: DataTypes.UUID,
            allowNull: false,
            field: 'order_id'
        },
        amount: {
            type: DataTypes.DECIMAL(10, 2),
            allowNull: false,
            validate: {
                min: 0.01
            }
        },
        currency: {
            type: DataTypes.STRING(3),
            defaultValue: 'USD'
        },
        status: {
            // Payment lifecycle:
            // PENDING → COMPLETED (success) or FAILED (error)
            // COMPLETED → REFUNDED (compensation in saga)
            type: DataTypes.ENUM('PENDING', 'COMPLETED', 'FAILED', 'REFUNDED'),
            defaultValue: 'PENDING'
        },
        idempotencyKey: {
            type: DataTypes.STRING,
            allowNull: true,
            unique: true,  // DATABASE-LEVEL SAFETY NET for idempotency
            field: 'idempotency_key'
        },
        refundedAt: {
            type: DataTypes.DATE,
            allowNull: true,
            field: 'refunded_at'
        },
        metadata: {
            type: DataTypes.JSONB,
            defaultValue: {}
        }
    }, {
        tableName: 'payments',
        underscored: true,
        timestamps: true  // adds created_at and updated_at
    });

    return Payment;
};

module.exports = { definePaymentModel };
