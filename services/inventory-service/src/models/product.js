/**
 * Product Model (Mongoose + MongoDB)
 * 
 * Stores product inventory with reservation tracking.
 * MongoDB is used here because:
 * 1. Flexible schema for product attributes
 * 2. Atomic operations for quantity updates
 * 3. Good for read-heavy inventory queries
 */

const mongoose = require('mongoose');

const productSchema = new mongoose.Schema({
    productId: {
        type: String,
        required: true,
        unique: true,
        index: true
    },
    name: {
        type: String,
        required: true
    },
    description: {
        type: String,
        default: ''
    },
    price: {
        type: Number,
        required: true,
        min: 0
    },
    quantity: {
        // Available stock (not including reserved)
        type: Number,
        required: true,
        min: 0,
        default: 0
    },
    reserved: {
        // Stock reserved by pending orders (saga in progress)
        type: Number,
        default: 0,
        min: 0
    },
    // Track which orders have reserved stock
    reservations: [{
        orderId: String,
        sagaId: String,
        quantity: Number,
        reservedAt: { type: Date, default: Date.now }
    }]
}, {
    timestamps: true
});

// Virtual: total stock (available + reserved)
productSchema.virtual('totalStock').get(function() {
    return this.quantity + this.reserved;
});

const Product = mongoose.model('Product', productSchema);

module.exports = { Product };
