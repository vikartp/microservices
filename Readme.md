# 🎯 Backend Mastery — The Architectural Playground

Welcome to the **Backend Mastery** repository! This is a comprehensive, practical workspace dedicated to exploring, implementing, and mastering various backend architectural patterns, distributed systems concepts, and advanced software engineering techniques.

> **Goal:** A living repository to prepare for senior backend developer and architecture interviews by building working, scalable examples of complex systems.

## 📁 Repository Structure

The repository is organized by architectural concepts and specific techniques, making it infinitely scalable for future learning.

```text
backend-mastery/
├── 📁 architectures/               # Complete, running system architectures
│   ├── 📁 microservices-ecommerce/ # An e-commerce saga pattern and circuit breaker setup
│   └── 📁 event-driven/            # Kafka/RabbitMQ producer & consumer topologies
│
├── 📁 patterns-and-techniques/     # Isolated, smaller backend concepts
│   └── (Future additions like GraphQL, WebSockets, Distributed Caching)
│
├── 📁 shared-libraries/            # Common code shared across architectures (e.g. loggers)
├── 📁 docs/                        # Architectural notes, diagrams, and deep dives
└── 📁 scripts/                     # Helpful automation scripts
```

## 🚀 Explore the Architectures

### 1. Microservices (E-Commerce)
A full 6-microservice architecture demonstrating how to handle distributed transactions, failure recovery, and resilient networking.
* **Location:** [`architectures/microservices-ecommerce/`](architectures/microservices-ecommerce/)
* **Key Concepts Covered:**
  * **Saga Pattern:** Distributed transactions with RabbitMQ and Redis.
  * **Idempotency:** Preventing duplicate payments.
  * **Circuit Breaker:** Handling cascading failures with Opossum.

### 2. Event-Driven Architecture (EDA)
Explorations into asynchronous messaging and stream processing using industry-standard message brokers.
* **Location:** [`architectures/event-driven/`](architectures/event-driven/)
* **Key Concepts Covered:**
  * **Kafka & RabbitMQ:** Producers, Consumers, Pub/Sub.
  * **Telemetry Pipelines:** Piping events to Time-Series Databases (InfluxDB/TimescaleDB).

## 📚 Learning Path & Deep Dives

Check out the detailed markdown guides located in [`docs/`](docs/) for theory, analogies, diagrams, and interview Q&A.

| # | Guide | Time | Difficulty |
|---|-------|------|------------|
| 0 | [Architecture Overview](docs/00-overview.md) | 10 min | ⭐ |
| 1 | [Idempotency Deep Dive](docs/01-idempotency.md) | 30 min | ⭐⭐ |
| 2 | [Saga Pattern Deep Dive](docs/02-saga-pattern.md) | 45 min | ⭐⭐⭐ |
| 3 | [Circuit Breaker Deep Dive](docs/03-circuit-breaker.md) | 30 min | ⭐⭐ |
| 4 | [Hands-On Exercises](docs/04-exercises.md) | 60 min | ⭐⭐⭐ |
| 5 | [Interview Questions (50+)](docs/05-interview-questions.md) | 90 min | ⭐⭐⭐⭐ |

## 🔧 Getting Started

To spin up a specific architecture, navigate to its folder and run docker-compose.

**Example for Microservices:**
```powershell
cd architectures/microservices-ecommerce
docker-compose up --build -d
```
*(Check the README or `docs/` inside each specific architecture for detailed instructions).*

## 📄 License
MIT — Built for learning. Break things. Experiment. Master it.