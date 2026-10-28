/**
 * Seed Script — Populate inventory with test products
 * 
 * Run this after starting the services:
 *   node scripts/seed-data.js
 * 
 * Or from inside a container:
 *   docker-compose exec inventory-service node /app/../scripts/seed-data.js
 */

const BASE_URL = process.env.INVENTORY_SERVICE_URL || 'http://localhost:3003';

const products = [
    {
        productId: 'LAPTOP-001',
        name: 'MacBook Pro 16"',
        description: 'Apple M3 Pro, 18GB RAM, 512GB SSD',
        price: 2499.99,
        quantity: 50,
        reserved: 0,
        reservations: []
    },
    {
        productId: 'PHONE-001',
        name: 'iPhone 15 Pro',
        description: '256GB, Natural Titanium',
        price: 1199.99,
        quantity: 100,
        reserved: 0,
        reservations: []
    },
    {
        productId: 'HEADPHONES-001',
        name: 'AirPods Pro 2',
        description: 'Active Noise Cancellation, USB-C',
        price: 249.99,
        quantity: 200,
        reserved: 0,
        reservations: []
    },
    {
        productId: 'WATCH-001',
        name: 'Apple Watch Ultra 2',
        description: '49mm Titanium Case',
        price: 799.99,
        quantity: 30,
        reserved: 0,
        reservations: []
    },
    {
        productId: 'TABLET-001',
        name: 'iPad Air M2',
        description: '11-inch, 256GB, Wi-Fi',
        price: 599.99,
        quantity: 75,
        reserved: 0,
        reservations: []
    }
];

async function seedData() {
    console.log('🌱 Seeding inventory data...\n');

    // We'll use MongoDB directly since the inventory service uses mongoose
    // For simplicity, we'll make HTTP calls or use mongoose directly
    
    try {
        // Try connecting directly to MongoDB
        const mongoose = require('mongoose');
        const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/inventory_db';
        
        await mongoose.connect(MONGO_URI);
        console.log('✅ Connected to MongoDB\n');

        // Define the schema inline (same as inventory service)
        const productSchema = new mongoose.Schema({
            productId: { type: String, required: true, unique: true },
            name: { type: String, required: true },
            description: { type: String, default: '' },
            price: { type: Number, required: true },
            quantity: { type: Number, required: true, default: 0 },
            reserved: { type: Number, default: 0 },
            reservations: [{ orderId: String, sagaId: String, quantity: Number, reservedAt: Date }]
        }, { timestamps: true });

        const Product = mongoose.model('Product', productSchema);

        // Clear existing data
        await Product.deleteMany({});
        console.log('🗑️  Cleared existing inventory\n');

        // Insert products
        for (const product of products) {
            await Product.create(product);
            console.log(`  ✅ ${product.name} (${product.productId}) — Stock: ${product.quantity}, Price: $${product.price}`);
        }

        console.log(`\n🎉 Seeded ${products.length} products successfully!\n`);
        console.log('You can now place orders with these product IDs:');
        products.forEach(p => {
            console.log(`  - ${p.productId}: ${p.name} ($${p.price})`);
        });

        await mongoose.disconnect();
        process.exit(0);

    } catch (err) {
        console.error('❌ Seed failed:', err.message);
        console.error('\nMake sure MongoDB is running:');
        console.error('  docker-compose up -d mongodb');
        process.exit(1);
    }
}

seedData();
