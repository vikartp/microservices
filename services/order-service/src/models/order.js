/**
 * Order Model (Sequelize + PostgreSQL)
 * 
 * Stores order records with saga tracking.
 * The order status reflects the current saga state.
 */

const { DataTypes } = require('sequelize');

const defineOrderModel = (sequelize) => {
    const Order = sequelize.define('Order', {
        id: {
            type: DataTypes.UUID,
            defaultValue: DataTypes.UUIDV4,
            primaryKey: true
        },
        customerId: {
            type: DataTypes.STRING,
            allowNull: false,
            field: 'customer_id'
        },
        items: {
            // Array of { productId, quantity, price }
            type: DataTypes.JSONB,
            allowNull: false,
            defaultValue: []
        },
        totalAmount: {
            type: DataTypes.DECIMAL(10, 2),
            allowNull: false,
            field: 'total_amount'
        },
        currency: {
            type: DataTypes.STRING(3),
            defaultValue: 'USD'
        },
        status: {
            // Order lifecycle (follows saga states):
            // CREATED → PAYMENT_PENDING → PAYMENT_COMPLETED →
            // INVENTORY_PENDING → CONFIRMED → NOTIFICATION_SENT
            //
            // Failure paths:
            // PAYMENT_FAILED → CANCELLED
            // INVENTORY_FAILED → REFUNDING → CANCELLED
            type: DataTypes.ENUM(
                'CREATED',
                'PAYMENT_PENDING',
                'PAYMENT_COMPLETED',
                'INVENTORY_PENDING',
                'CONFIRMED',
                'NOTIFICATION_SENT',
                'PAYMENT_FAILED',
                'INVENTORY_FAILED',
                'REFUNDING',
                'CANCELLED'
            ),
            defaultValue: 'CREATED'
        },
        sagaId: {
            type: DataTypes.UUID,
            allowNull: true,
            field: 'saga_id'
        },
        paymentId: {
            type: DataTypes.UUID,
            allowNull: true,
            field: 'payment_id'
        },
        failureReason: {
            type: DataTypes.STRING,
            allowNull: true,
            field: 'failure_reason'
        }
    }, {
        tableName: 'orders',
        underscored: true,
        timestamps: true
    });

    return Order;
};

module.exports = { defineOrderModel };
