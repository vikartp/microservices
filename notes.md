# Microservices Learning Notes

## Table of Contents
1. [Docker Basics](#docker-basics)
2. [Docker Compose](#docker-compose)
3. [Docker Commands Reference](#docker-commands-reference)
4. [RabbitMQ Concepts](#rabbitmq-concepts)
5. [Microservices Patterns](#microservices-patterns)
6. [Database Selection](#database-selection)
7. [Development Best Practices](#development-best-practices)

---

## Docker Basics

### What is Docker?
Docker is a containerization platform that packages applications and their dependencies into isolated containers, ensuring consistency across different environments.

### Key Concepts

#### Images
- **Blueprint** for containers
- Immutable snapshots containing OS, application code, and dependencies
- Built from Dockerfiles
- Stored in registries (Docker Hub, etc.)

**Best Practices:**
- Use specific version tags instead of `latest` for production
  - ✅ `postgres:15` or `postgres:15.3`
  - ❌ `postgres:latest`
- `latest` is fine for local development but unpredictable in production

#### Containers
- **Running instances** of images
- Isolated processes with their own filesystem, networking, and resources
- Ephemeral by default (data lost when container is removed)

#### Volumes
- Persistent storage for containers
- Data survives container restarts and deletions

**Types:**
1. **Named Volumes** (Docker-managed)
   ```yaml
   volumes:
     - rabbitmq_data:/var/lib/rabbitmq
   
   volumes:
     rabbitmq_data:
       driver: local
   ```

2. **Bind Mounts** (Host directory)
   ```yaml
   volumes:
     - ./data/rabbitmq:/var/lib/rabbitmq
     - d:/workspace/Micro/rabbitmq_data:/var/lib/rabbitmq
   ```

3. **Anonymous Volumes** (Prevent overwriting)
   ```yaml
   volumes:
     - /app/node_modules
   ```

**Volume Purposes:**
- Persist database data
- Share code with containers for hot-reload
- Prevent host node_modules from overwriting container's

#### Networks
- Docker creates isolated networks for container communication
- Services in the same Docker Compose network can communicate using service names as hostnames
- Example: `mongodb://myMongo:27017` (myMongo is the service name)

---

## Docker Compose

### What is Docker Compose?
A tool for defining and running multi-container Docker applications using a YAML configuration file.

### Key Configuration Properties

#### service
Defines a container/application in your stack
```yaml
services:
  myService:
    # configuration here
```

#### image
Specifies the Docker image to use
```yaml
image: rabbitmq:3.13-management
```

#### build
Builds image from Dockerfile in specified directory
```yaml
build: ./producer
```

#### container_name
Custom name for the container (optional but helpful)
```yaml
container_name: my_rabbitmq
```

**Note:** If omitted, Docker generates names like `<project>_<service>_<number>`

#### ports
Maps container ports to host ports
```yaml
ports:
  - "8080:8080"  # host:container
  - "5672:5672"
```

#### environment
Sets environment variables
```yaml
environment:
  MONGO_URI: mongodb://myMongo:27017/mydatabase
  EXPRESS_PORT: 8080
```

#### volumes
Mounts volumes or directories
```yaml
volumes:
  - ./data/rabbitmq:/var/lib/rabbitmq
  - ./producer:/app
  - /app/node_modules
```

#### depends_on
Controls startup order (doesn't wait for readiness!)
```yaml
depends_on:
  - myRabbit
  - myMongo
```

**Important:** `depends_on` only ensures services START in order, not that they're READY. Use retry logic in your application.

#### restart
Restart policy for containers
```yaml
restart: on-failure  # Restart if container exits with error
restart: always      # Always restart
restart: unless-stopped
```

### Docker Compose vs Dockerfile

**Dockerfile:**
- Defines how to BUILD an image
- Instructions: `FROM`, `WORKDIR`, `COPY`, `RUN`, `CMD`
- Build-time configuration

**Docker Compose:**
- Defines how to RUN containers
- Runtime configuration: ports, volumes, networks, environment
- Orchestrates multiple services

---

## Docker Commands Reference

### Docker Compose Commands

#### Start Services
```powershell
# Build and start all services
docker-compose up --build

# Start in detached mode (background)
docker-compose up --build -d

# Start specific service
docker-compose up producer

# Rebuild specific service
docker-compose build producer
docker-compose up producer
```

#### Stop Services
```powershell
# Stop all services (keeps containers)
docker-compose stop

# Stop and remove containers, networks
docker-compose down

# Stop and remove volumes (clean slate)
docker-compose down -v
```

#### View Logs
```powershell
# All services (follow mode)
docker-compose logs -f

# Specific service
docker-compose logs -f consumer
docker-compose logs -f producer

# Last 100 lines
docker-compose logs --tail=100 producer
```

#### Restart Services
```powershell
# Restart specific service
docker-compose restart producer

# Restart all services
docker-compose restart
```

#### Other Useful Commands
```powershell
# List running services
docker-compose ps

# Execute command in running container
docker-compose exec producer sh

# View service configuration
docker-compose config
```

### Docker Commands (without Compose)

#### Container Management
```powershell
# List running containers
docker ps

# List all containers (including stopped)
docker ps -a

# Start/stop container
docker start <container_name>
docker stop <container_name>

# Remove container
docker rm <container_name>

# Remove all stopped containers
docker container prune
```

#### Image Management
```powershell
# List images
docker images

# Pull image
docker pull postgres:15

# Remove image
docker rmi <image_name>

# Remove unused images
docker image prune
```

#### Logs and Inspection
```powershell
# View container logs
docker logs <container_name>
docker logs -f <container_name>  # Follow mode

# Inspect container
docker inspect <container_name>

# Execute command in container
docker exec -it <container_name> sh
docker exec -it <container_name> bash
```

#### Volume Management
```powershell
# List volumes
docker volume ls

# Inspect volume
docker volume inspect <volume_name>

# Remove volume
docker volume rm <volume_name>

# Remove unused volumes
docker volume prune
```

#### Network Management
```powershell
# List networks
docker network ls

# Inspect network
docker network inspect <network_name>
```

---

## RabbitMQ Concepts

### What is RabbitMQ?
A message broker that implements AMQP (Advanced Message Queuing Protocol). It acts as a middleman for message passing between services.

### Key Components

#### Producer
- Service that SENDS messages to queues
- Example: Producer service publishing user creation tasks

#### Consumer
- Service that RECEIVES and PROCESSES messages from queues
- Example: Consumer service reading tasks and saving to MongoDB

#### Queue
- Buffer that stores messages
- FIFO (First In, First Out) by default
- Messages persist until consumed and acknowledged

#### Channel
- Virtual connection within a single TCP connection
- Where you perform most AMQP operations (publish, consume, etc.)

```javascript
const channel = await conn.createChannel();
await channel.assertQueue(queue);
```

#### Exchange (not used in our simple example)
- Routes messages to queues based on rules
- Types: direct, topic, fanout, headers

### Message Flow

1. **Producer sends message:**
   ```javascript
   channel.sendToQueue(queue, Buffer.from('message'));
   ```

2. **Message stored in queue** by RabbitMQ

3. **Consumer receives message:**
   ```javascript
   channel.consume(queue, (msg) => {
     console.log(msg.content.toString());
     channel.ack(msg);  // Acknowledge
   });
   ```

4. **Consumer acknowledges** - RabbitMQ deletes message from queue

### Message Acknowledgment

#### What is `ack()`?
Tells RabbitMQ that a message was successfully processed and can be deleted.

```javascript
channel.consume(queue, async (msg) => {
  try {
    const data = JSON.parse(msg.content.toString());
    await processData(data);
    channel.ack(msg);  // Only ack after successful processing
  } catch (error) {
    // Don't ack - message will be redelivered
    console.error('Processing failed:', error);
  }
});
```

**Key Points:**
- Message stays in queue until acknowledged
- If consumer crashes before acking, message is redelivered
- Ensures "at-least-once delivery"
- Don't use `{ noAck: true }` in production - you'll lose messages on failures

### Virtual Hosts (vhosts)
- Isolated environments within single RabbitMQ instance
- Like separate "tenants" with own queues, exchanges, permissions
- Our setup: `my_vhost`

```yaml
environment:
  RABBITMQ_DEFAULT_VHOST: my_vhost
```

Connection string includes vhost:
```
amqp://user:password@myRabbit:5672/my_vhost
```

### RabbitMQ Management UI
- Web interface for monitoring and management
- Access: `http://localhost:15672`
- Default credentials: `user/password`
- View queues, messages, connections, channels

---

## Microservices Patterns

### Service Communication

#### Synchronous Communication
- HTTP/REST APIs
- Request-response pattern
- Services directly depend on each other
- **Issue:** If one service is down, requests fail

#### Asynchronous Communication (Event-Driven)
- Message brokers (RabbitMQ, Kafka)
- Services don't need to know about each other
- Loose coupling
- Better resilience - messages queued even if consumer is down

**Our Implementation:**
- Producer publishes to queue (fire and forget)
- Consumer processes when ready
- Services can scale independently

### Connection Resilience

#### Problem with `depends_on`
```yaml
depends_on:
  - myRabbit
```
Only ensures RabbitMQ container STARTS, not that it's READY to accept connections.

#### Solution: Retry Logic with Backoff
```javascript
const connectWithRetry = async (connectFn, serviceName, maxRetries = 10, delay = 3000) => {
  for (let i = 0; i < maxRetries; i++) {
    try {
      await connectFn();
      console.log(`${serviceName} connected successfully`);
      return true;
    } catch (err) {
      console.error(`Connection failed (attempt ${i + 1}/${maxRetries})`);
      if (i < maxRetries - 1) {
        await sleep(delay);
      }
    }
  }
  throw new Error(`Failed to connect after ${maxRetries} attempts`);
};
```

**Benefits:**
- Automatically retries failed connections
- No arbitrary timeouts (`setTimeout(startUp, 30000)`)
- Connects as soon as service is ready
- Predictable failure after max retries

#### Restart Policy
```yaml
restart: on-failure
```
Docker automatically restarts container if it exits with error.

**Combined approach:**
- Retry logic handles temporary issues
- Restart policy handles application crashes
- Together: robust startup behavior

### Polyglot Persistence

Using different databases for different services based on their needs:

- **MongoDB** (Consumer) - Document database for flexible user data
- **PostgreSQL** (Producer) - Relational database for structured data
- **Redis** - In-memory cache for fast access
- **InfluxDB** (planned) - Time-series data for metrics

**Benefits:**
- Each service uses the best tool for its job
- Services remain independent
- Can optimize per use case

---

## Database Selection

### MongoDB (Document Database)
**Use when:**
- Schema flexibility needed
- Rapid development with changing requirements
- Hierarchical/nested data
- JSON-like documents

**Our usage:** Consumer service storing user data

### PostgreSQL (Relational Database)
**Use when:**
- ACID transactions required
- Complex queries and joins
- Structured data with relationships
- Data integrity critical

**Our usage:** Producer service

### Redis (In-Memory Cache)
**Use when:**
- High-speed read/write needed
- Session management
- Caching frequently accessed data
- Real-time analytics
- Rate limiting

### InfluxDB (Time-Series Database)
**Use when:**
- Time-stamped data (metrics, logs, events)
- IoT sensor data
- Application performance monitoring
- Data retention policies needed

---

## Development Best Practices

### Dockerfile Best Practices

#### RUN vs CMD
```dockerfile
# ❌ Wrong - runs during BUILD (no env vars, no services)
RUN npm run start

# ✅ Correct - runs at RUNTIME (env vars available)
CMD ["npm", "run", "start"]
```

**RUN:** Execute commands during image BUILD
- Install dependencies
- Copy files
- Set up environment

**CMD:** Command to run when container STARTS
- Start application
- Has access to environment variables
- Services are running

#### Efficient Dockerfile
```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package.json ./
RUN npm install
COPY . .
CMD ["npm", "run", "start"]
```

### Hot Reload in Docker

#### The Problem
Normally, when you change code in your application, you need to:
1. Stop the container
2. Rebuild the Docker image
3. Start the container again

This is slow and disrupts your development workflow.

#### The Solution: Volume Mounting + Nodemon

**Step 1: Mount Local Code into Container**
```yaml
# docker-compose.yaml
services:
  producer:
    volumes:
      - ./producer:/app          # Mount local folder to container
      - /app/node_modules         # Preserve container's node_modules
```

**What this does:**
- `./producer:/app` - Your local `producer` folder is "linked" to `/app` inside the container
- Any changes you make locally are **immediately visible** inside the container
- `/app/node_modules` - Anonymous volume prevents your host's node_modules from overwriting the container's dependencies

**Step 2: Use Nodemon to Auto-Restart**
```json
// package.json
{
  "scripts": {
    "start": "nodemon -L index.js"
  }
}
```

**Step 3: Update Dockerfile**
```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package.json ./
RUN npm install
COPY . .
CMD ["npm", "run", "start"]  # Uses nodemon at runtime
```

#### How It Works Together

1. **Volume binding** makes your code changes visible in the container
2. **Nodemon** watches for file changes inside the container
3. When you edit `index.js` locally:
   - File change appears in container (via volume mount)
   - Nodemon detects the change (via `-L` polling)
   - Nodemon automatically restarts Node.js process
   - Your changes are live **without rebuilding**!

#### The `-L` Flag (Critical for Docker)

```json
"start": "nodemon -L index.js"
```

**`-L` flag:** Uses legacy watch mode (polling)
- **Required** for Docker volumes on Windows/Mac
- Detects file changes through network file systems
- Polls the filesystem at regular intervals instead of relying on OS events
- Without it: nodemon won't detect changes from mounted volumes

**Why it's needed:**
- Docker volumes use a virtualized filesystem
- Native file system events (inotify on Linux, FSEvents on Mac) don't propagate through Docker's volume layer
- Polling mode (`-L`) actively checks for changes, bypassing the event system

#### Complete Workflow

```yaml
# docker-compose.yaml
services:
  consumer:
    build: ./consumer
    volumes:
      - ./consumer:/app        # Bind mount for hot reload
      - /app/node_modules       # Preserve dependencies
    environment:
      MONGO_URI: mongodb://myMongo:27017/mydatabase
```

```json
// consumer/package.json
{
  "scripts": {
    "start": "nodemon -L index.js"
  }
}
```

```dockerfile
# consumer/Dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package.json ./
RUN npm install
COPY . .
CMD ["npm", "run", "start"]
```

**Development Flow:**
1. `docker-compose up --build` (first time only)
2. Edit `consumer/index.js` in your editor
3. Save the file
4. Nodemon detects change → restarts automatically
5. See changes immediately in logs
6. No rebuild needed! 🎉

**When you DO need to rebuild:**
- Changed `package.json` (new dependencies)
- Changed `Dockerfile`
- Changed files not in volume mount

### Environment Variables

#### Best Practices
```yaml
environment:
  MONGO_URI: mongodb://myMongo:27017/mydatabase
  RABBITMQ_URI: amqp://user:password@myRabbit:5672/my_vhost
```

**Don't:**
- Hardcode credentials in application code
- Commit `.env` files with secrets to git

**Do:**
- Use environment variables
- Use Docker secrets for production
- Different configs per environment (dev/staging/prod)

### Error Handling

#### Async/Await with Try-Catch
```javascript
// ❌ Old way with promises
mongoose.connect(uri)
  .then(() => console.log('Connected'))
  .catch(err => console.error(err));

// ✅ Better with async/await
try {
  await mongoose.connect(uri);
  console.log('Connected');
} catch (err) {
  console.error('Connection failed:', err);
}
```

#### Application Startup
```javascript
startUp().catch(err => {
  console.error('Failed to start:', err);
  process.exit(1);  // Exit with error code
});
```
Docker will restart container if `restart: on-failure` is set.

### Message Processing

#### Safe Message Handling
```javascript
channel.consume(queue, async (msg) => {
  try {
    const data = JSON.parse(msg.content.toString());
    await processData(data);
    channel.ack(msg);  // Only ack on success
  } catch (error) {
    console.error('Processing failed:', error);
    // Don't ack - message will be redelivered
    // Or use channel.nack(msg) for explicit negative acknowledgment
  }
});
```

**Important:**
- Only acknowledge after successful processing
- Failed messages are redelivered for retry
- Implement dead letter queues for permanently failed messages

---

## Common Issues and Solutions

### Issue: Container exits immediately
**Cause:** `RUN npm run start` in Dockerfile
**Solution:** Use `CMD ["npm", "run", "start"]`

### Issue: Environment variables undefined
**Cause:** Accessed during build time
**Solution:** Ensure variables used at runtime in CMD, not in RUN

### Issue: Services can't connect at startup
**Cause:** `depends_on` doesn't wait for service readiness
**Solution:** Implement retry logic with backoff

### Issue: Nodemon not detecting changes in Docker
**Cause:** File system events not propagated through volumes
**Solution:** Use `nodemon -L` (legacy watch/polling mode)

### Issue: Host node_modules conflicting with container
**Cause:** Volume mount overwrites container's node_modules
**Solution:** Add anonymous volume: `- /app/node_modules`

### Issue: Data lost when container restarts
**Cause:** No volume mounted for database data
**Solution:** Add volume mapping to persist data

---

## Quick Reference

### Connection Strings
```javascript
// MongoDB
mongodb://myMongo:27017/mydatabase

// PostgreSQL
postgres://admin:adminpassword@myPostgress:5432/mydatabase

// RabbitMQ
amqp://user:password@myRabbit:5672/my_vhost

// Redis
redis://myRedis:6379
```

### Common Docker Compose Workflow
```powershell
# Initial setup
docker-compose up --build

# View logs
docker-compose logs -f

# Make code changes (auto-reloads with nodemon)

# Rebuild specific service
docker-compose build producer
docker-compose up producer

# Clean restart
docker-compose down
docker-compose up --build

# Complete cleanup
docker-compose down -v
docker system prune -a
```

---

## Next Steps

- [ ] Implement Kafka for event streaming
- [ ] Add InfluxDB for time-series metrics
- [ ] Implement API Gateway pattern
- [ ] Add service discovery (Consul/Eureka)
- [ ] Implement circuit breaker pattern
- [ ] Add distributed tracing (Jaeger/Zipkin)
- [ ] Set up monitoring (Prometheus/Grafana)
- [ ] Implement CQRS pattern
- [ ] Add authentication/authorization
- [ ] Create health check endpoints