const express = require('express');
const mongoose = require('mongoose');
const amqplib = require('amqplib');
const app = express();

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const connectWithRetry = async (connectFn, serviceName, maxRetries = 10, delay = 3000) => {
    for (let i = 0; i < maxRetries; i++) {
        try {
            await connectFn();
            console.log(`${serviceName} connected successfully`);
            return true;
        } catch (err) {
            console.error(`${serviceName} connection failed (attempt ${i + 1}/${maxRetries}):`, err.message);
            if (i < maxRetries - 1) {
                console.log(`Retrying in ${delay}ms...`);
                await sleep(delay);
            }
        }
    }
    throw new Error(`Failed to connect to ${serviceName} after ${maxRetries} attempts`);
};

const startUp = async () => {
    // Connect to MongoDB with retry
    await connectWithRetry(async () => {
        await mongoose.connect(process.env.MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true });
    }, 'MongoDB');

    // Create User schema and model
    const userSchema = new mongoose.Schema({
        name: String,
        email: String,
        password: String
    });
    const User = mongoose.model('User', userSchema);

    // Connect to RabbitMQ with retry
    await connectWithRetry(async () => {
        const queue = 'tasks';
        const userQueue = 'user_tasks';
        const conn = await amqplib.connect(process.env.RABBITMQ_URI);
        const ch1 = await conn.createChannel();
        await ch1.assertQueue(queue);
        await ch1.assertQueue(userQueue);
        
        // Set prefetch to control message concurrency
        // prefetch(1) = process one message at a time (sequential)
        // prefetch(5) = process up to 5 messages concurrently
        ch1.prefetch(1);  // Process one user creation at a time
        
        // Listener
        ch1.consume(queue, (msg) => {
            if (msg !== null) {
                console.log('Received:', msg.content.toString());
                ch1.ack(msg);
            } else {
                console.log('Consumer cancelled by server');
            }
        });
        // Create User in mongoDB upon receiving message
        ch1.consume(userQueue, async (msg) => {
            if (msg !== null) {
                const userData = JSON.parse(msg.content.toString());
                const user = new User(userData);
                await user.save();
                console.log('User created:', user);
                ch1.ack(msg);
            } else {
                console.log('Consumer cancelled by server');
            }
        });
    }, 'RabbitMQ');
};

// Start the application
startUp().catch(err => {
    console.error('Failed to start consumer service:', err);
    process.exit(1);
});

app.get('/', (req, res) => {
    res.json({ message: 'Hello World from Consumer Service!' });
});

app.listen(process.env.EXPRESS_PORT, () => {
    console.log(`Consumer Service listening at http://localhost:${process.env.EXPRESS_PORT}`);
});