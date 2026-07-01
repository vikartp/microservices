const express = require('express');
const { Sequelize } = require('sequelize');
const amqplib = require('amqplib');
const app = express();

let channel;
const queue = 'tasks';
const userQueue = 'user_tasks';

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
    // Connect to PostgreSQL with retry
    await connectWithRetry(async () => {
        const sequelize = new Sequelize(process.env.PG_URI);
        await sequelize.authenticate();
    }, 'PostgreSQL');

    // Connect to RabbitMQ with retry
    await connectWithRetry(async () => {
        const conn = await amqplib.connect(process.env.RABBITMQ_URI);
        channel = await conn.createChannel();
        await channel.assertQueue(queue);
        await channel.assertQueue(userQueue);
    }, 'RabbitMQ');
};

const sendMessage = (message) => {
    if (!channel) {
        console.error('Channel not initialized');
        return false;
    }

    try {
        const sent = channel.sendToQueue(queue, Buffer.from(message));
        if (sent) {
            console.log('Message sent:', message);
            return true;
        } else {
            console.warn('Message buffered but write buffer is full');
            return false;
        }
    } catch (error) {
        console.error('Error sending message:', error);
        return false;
    }
};

// Start the application
startUp().catch(err => {
    console.error('Failed to start producer service:', err);
    process.exit(1);
});

app.get('/', (req, res) => {
    const sent = sendMessage('something to do');
    if (sent) {
        res.json({ message: 'Message sent to queue!' });
    } else {
        res.status(500).json({ error: 'Failed to send message' });
    }
});

// Send custom message from query parameter
app.get('/send', (req, res) => {
    const msg = req.query.msg || 'default message';
    console.log('Received in query:', msg);
    const sent = sendMessage(msg);
    if (sent) {
        res.json({ message: 'Message sent to queue!' });
    } else {
        res.status(500).json({ error: 'Failed to send message' });
    }
});

// Post user data to user_tasks queue
app.use(express.json());

app.post('/user', (req, res) => {
    const userData = req.body;
    if (!userData) {
        return res.status(400).json({ error: 'User data is required' });
    }

    try {
        const sent = channel.sendToQueue(userQueue, Buffer.from(JSON.stringify(userData)));
        if (sent) {
            console.log('User data sent:', userData);
            res.json({ message: 'User data sent to queue!' });
        } else {
            console.warn('User data buffered but write buffer is full');
            res.status(500).json({ error: 'Failed to send user data' });
        }
    } catch (error) {
        console.error('Error sending user data:', error);
        res.status(500).json({ error: 'Failed to send user data' });
    }
});

app.listen(process.env.EXPRESS_PORT, () => {
    console.log(`Producer Service listening at http://localhost:${process.env.EXPRESS_PORT}`);
});