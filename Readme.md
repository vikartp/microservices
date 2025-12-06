# Microservices Learning Repository

A hands-on learning project for understanding microservices architecture, event-driven systems, and containerization using Docker.

## 🎯 Project Overview

This repository contains practical examples of microservices built with Node.js, demonstrating various architectural patterns and technologies commonly used in modern distributed systems.

## 🏗️ Architecture

### Event-Driven Communication
- **RabbitMQ** (✅ Implemented) - Message broker for asynchronous communication between services
- **Kafka** (🔜 Planned) - Distributed event streaming platform for high-throughput scenarios

### Services

#### Producer Service
- Publishes messages to RabbitMQ queues
- Connected to PostgreSQL database
- REST API endpoint to trigger message sending
- Port: `8081`

#### Consumer Service
- Consumes messages from RabbitMQ queues
- Connected to MongoDB database
- Processes user creation tasks asynchronously
- Port: `8080`

## 🗄️ Databases

The project uses multiple database types to demonstrate polyglot persistence:

- **MongoDB** (Document Database) - Used by Consumer service for user data
- **PostgreSQL** (Relational Database) - Used by Producer service
- **Redis** (In-Memory Cache) - For caching and session management
- **InfluxDB** (🔜 Planned) - Time-series database for metrics and monitoring

## 🐳 Docker Setup

All services run in Docker containers orchestrated by Docker Compose:

### Services Stack
- **RabbitMQ** (with Management UI)
  - AMQP Port: `5672`
  - Management UI: `15672`
  - Credentials: `user/password`
  - Virtual Host: `my_vhost`

- **MongoDB** - Port: `27017`
- **PostgreSQL** - Port: `5432`
- **Redis** - Port: `6379`
- **Producer** - Port: `8081`
- **Consumer** - Port: `8080`

### Volume Mounting
Both producer and consumer services use volume mounting for hot-reload during development:
```yaml
volumes:
  - ./producer:/app
  - /app/node_modules
```

This enables immediate reflection of code changes without rebuilding containers.

## 🚀 Getting Started

### Prerequisites
- Docker Desktop or Rancher Desktop(dockerd) installed
- Docker Compose installed

### Running the Application

1. **Start all services:**
   ```powershell
   docker-compose up --build
   ```

2. **Run in detached mode (background):**
   ```powershell
   docker-compose up --build -d
   ```

3. **Rebuild specific service:**
   ```powershell
   docker-compose build producer
   docker-compose up producer
   ```

4. **View logs:**
   ```powershell
   # All services
   docker-compose logs -f
   
   # Specific service
   docker-compose logs -f consumer
   ```

5. **Stop services:**
   ```powershell
   docker-compose down
   ```

6. **Stop and remove volumes:**
   ```powershell
   docker-compose down -v
   ```

## 📡 API Endpoints

### Producer Service (Port 8081)
- `GET /` - Send a default message to the queue
- `GET /send?msg=your_message` - Send a custom message to the queue
- `POST /user` - Create a user (sends user data to user_tasks queue)
  ```json
  {
    "name": "John Doe",
    "email": "john@example.com",
    "password": "secret123"
  }
  ```

### Consumer Service (Port 8080)
- `GET /` - Health check endpoint

## 🔄 Message Flow

1. Producer service receives HTTP request
2. Producer publishes message to RabbitMQ queue
3. RabbitMQ stores message until consumed
4. Consumer service listens to the queue
5. Consumer processes message and stores data in MongoDB
6. Consumer acknowledges message to RabbitMQ

## 🛠️ Development Features

### Hot Reload with Nodemon
Both services use nodemon with legacy watch mode for Docker compatibility:
```json
"start": "nodemon -L index.js"
```

### Connection Retry Logic
Services implement retry logic with exponential backoff (10 retries, 3-second delay) to handle startup dependencies gracefully.

### Restart Policy
Containers automatically restart on failure:
```yaml
restart: on-failure
```

## 📚 Learning Topics Covered

- Microservices architecture
- Event-driven communication
- Message queuing with RabbitMQ
- Docker containerization
- Docker Compose orchestration
- Polyglot persistence
- Connection resilience and retry patterns
- Hot reload in containerized environments
- Volume mounting for development
- Environment variable management

## 🔜 Future Enhancements

- [ ] Kafka integration for event streaming
- [ ] InfluxDB for time-series data and metrics
- [ ] API Gateway
- [ ] Service discovery
- [ ] Load balancing
- [ ] Distributed tracing
- [ ] Monitoring and observability
- [ ] Authentication and authorization
- [ ] Circuit breaker pattern
- [ ] CQRS pattern implementation

## 📝 Notes

For detailed learning notes, Docker commands, and explanations, see [notes.md](./notes.md).

## 🤝 Contributing

This is a learning repository. Feel free to experiment, break things, and learn!

## 📄 License

MIT License - Feel free to use this for learning purposes.