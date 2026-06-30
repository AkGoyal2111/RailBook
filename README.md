# RailBook

A distributed railway reservation system built on microservices. Six backend services coordinate through Kafka events and synchronous REST to handle the full lifecycle — from user registration and train management to seat locking, payment processing, and booking confirmation.

The system solves hard concurrency problems: two users racing for the same seat on overlapping journey segments are handled correctly through Redis distributed locks, Postgres row-level locking (`FOR UPDATE NOWAIT`), and a Saga-based transaction orchestrator that knows how to roll itself back.

---

## What Makes This Non-Trivial

Most booking systems treat a seat as binary — booked or not. This one implements **segment-aware seat locking**: a seat on the Delhi→Mumbai route can be simultaneously booked by one passenger for Delhi→Jaipur and another for Jaipur→Mumbai, because their segments don't overlap. The inventory service maintains per-segment lock rows and recomputes seat availability from the ground truth on every state transition.

**Other things worth noting:**
- **Saga orchestrator** with full compensation — if payment fails after seats are locked, the system automatically releases locks, refunds payments, and logs every step to a `SagaLog` table for crash recovery
- **Two layers of locking** — Redis Lua scripts provide all-or-nothing distributed locks (fast rejection), while Postgres `FOR UPDATE NOWAIT` provides the transactional consistency guarantee
- **Dead-letter queues** on every Kafka consumer — poison messages get retried 3× then shunted to `dlq.<service>` topics instead of blocking the consumer
- **Circuit breakers** in the API Gateway — downstream service failures trip breakers (CLOSED → OPEN → HALF_OPEN → CLOSED) with configurable thresholds, preventing cascade failures
- **Booking expiry daemon** — a background job sweeps expired seat locks every 30s, releasing them and compensating the full saga

---

## Architecture

```
                       ┌──────────────────┐
                       │  Frontend        │
                       │  React + Vite    │
                       │  Port 3000       │
                       └────────┬─────────┘
                                │
                       ┌────────▼─────────┐
                       │  API Gateway     │
                       │  Port 4000       │
                       │  JWT · rate-limit│
                       │  circuit breaker │
                       └──┬──┬──┬──┬──┬───┘
          ┌───────────────┘  │  │  │  └──────────────┐
          │          ┌───────┘  │  └───────┐          │
  ┌───────▼──────┐ ┌─▼──────┐ ┌▼───────┐ ┌▼────────┐ ┌▼──────────┐
  │ User Service │ │ Admin  │ │Booking │ │Payment  │ │ Inventory │
  │ 4001         │ │ 4003   │ │ 4005   │ │ 4006    │ │ 4007      │
  │ auth, OTP,   │ │stations│ │ saga,  │ │Razorpay │ │ seats,    │
  │ JWT, OAuth   │ │trains, │ │ expiry │ │orders,  │ │ segments, │
  │              │ │routes, │ │        │ │refunds, │ │ locks     │
  │              │ │search  │ │        │ │webhooks │ │           │
  └──────┬───────┘ └───┬────┘ └───┬────┘ └────┬────┘ └─────┬─────┘
         │             │          │            │            │
         └─────────────┴──────┬───┴────────────┴────────────┘
                              │
              ┌───────────────┼───────────────┐
              │               │               │
      ┌───────▼──────┐ ┌─────▼──────┐ ┌──────▼──────┐
      │  PostgreSQL  │ │   Redis    │ │    Kafka    │
      │  5432        │ │   6379     │ │  9092/9093  │
      │  5 databases │ │  locks,    │ │  events,    │
      │  (per svc)   │ │  sessions, │ │  DLQs       │
      │              │ │  OTP cache │ │             │
      └──────────────┘ └────────────┘ └─────────────┘
```

**Key design decision:** Search is handled directly by the admin-service via PostgreSQL queries — no Elasticsearch dependency. Notifications (OTP emails, booking confirmations) are sent inline by the user-service using Nodemailer + Gmail SMTP. This keeps the service count at 6 without sacrificing functionality.

---

## Services

| # | Service | Port | Database | Role |
|---|---------|------|----------|------|
| 1 | **API Gateway** | 4000 | — | Single entrypoint. JWT enforcement, per-route rate limiting, request proxying, circuit breakers |
| 2 | **User Service** | 4001 | `user_service_database` | Registration, OTP email, JWT (access+refresh), Google OAuth, profile CRUD |
| 3 | **Admin Service** | 4003 | `admin_service_database` | Stations, trains, routes, schedules CRUD. Publishes domain events. Also serves train search queries |
| 4 | **Booking Service** | 4005 | `booking_service_database` | Saga orchestrator: lock seats → create payment → confirm/compensate. Background expiry job |
| 5 | **Payment Service** | 4006 | `payment_service_database` | Razorpay order creation, signature verification, webhook processing, refunds |
| 6 | **Inventory Service** | 4007 | `inventory_service_database` | Per-schedule seat management, segment-aware locking, availability aggregation |

---

## Kafka Event Flow

All topic names are centralized in [`shared/constants/kafka-topics.js`](shared/constants/kafka-topics.js).

```
admin-service ──────────────────────────────────────────────────────────────
  │ SCHEDULE_CREATED ──► inventory-service (creates seat inventory)
  │ SCHEDULE_CANCELLED ──► inventory-service (cancels all seats)
  │                    ──► booking-service (cancels affected bookings)

payment-service ────────────────────────────────────────────────────────────
  │ PAYMENT_SUCCESS ──► booking-service (confirms seats via saga)
  │ PAYMENT_FAILED  ──► booking-service (compensates — releases locks)

inventory-service ──────────────────────────────────────────────────────────
  │ SEAT_AVAILABILITY_UPDATED ──► (available for downstream consumers)

booking-service ────────────────────────────────────────────────────────────
  │ BOOKING_CONFIRMED / FAILED / CANCELLED ──► (available for consumers)

Every consumer wraps handlers with shared/utils/dlqHandler.js:
  3 retries → publish to dlq.<service-name> topic
```

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js 20+, JavaScript (ES Modules) |
| Framework | Express.js 5 |
| ORM | Prisma 7 (5 services) |
| Auth | JWT (access + refresh tokens), OTP via Gmail SMTP, Google OAuth |
| Payments | Razorpay SDK + webhook signature verification |
| Messaging | KafkaJS (Confluent 7.5 broker) |
| Caching & Locking | Redis Stack (ioredis) — sessions, OTP, distributed seat locks via Lua scripts |
| Database | PostgreSQL 15 — one database per service |
| Logging | Winston |
| Security | Helmet, CORS, bcrypt |
| Frontend | React 18, Vite 6, Tailwind CSS 3, Zustand, React Hook Form |
| CI | GitHub Actions — parallel test suites on every push/PR |
| Deployment | Docker Compose (dev + production), nginx reverse proxy |

---

## Running Locally

### Prerequisites

- Node.js ≥ 20 and npm
- Docker and Docker Compose
- Git

### Quick Start (everything in Docker)

```bash
git clone https://github.com/AkGoyal2111/RailBook.git && cd RailBook
cp .env.prod.example .env    # fill in Gmail, Google OAuth, Razorpay keys
docker compose -f docker-compose.prod.yml up -d --build
# Frontend → http://localhost    Gateway → http://localhost:4000
```

### Development Mode (infra in Docker, services with npm)

```bash
# 1. Start infrastructure
docker compose up -d          # Postgres, Redis, Kafka, Kafka UI, pgAdmin

# 2. Start services (in separate terminals, this order respects Kafka dependencies)
cd admin-service     && npm install && npx prisma migrate deploy && npm run dev
cd inventory-service && npm install && npx prisma migrate deploy && npm run dev
cd user-service      && npm install && npx prisma migrate deploy && npm run dev
cd payment-service   && npm install && npx prisma migrate deploy && npm run dev
cd booking-service   && npm install && npx prisma migrate deploy && npm run dev
cd api-gateway       && npm install && npm run dev
cd frontend          && npm install && npm run dev   # http://localhost:3000
```

### Smoke Test

1. Register with email → OTP is sent via Gmail → verify → login
2. Create station → train → route → schedule (this fires `SCHEDULE_CREATED`, inventory service creates seats)
3. Search trains for a date → select seats → pay with Razorpay test mode → booking confirms

---

## Tests

Unit tests use Node's built-in test runner (`node --test`) — zero external test dependencies.

| Service | What's Covered |
|---------|---------------|
| `api-gateway` | Circuit breaker state machine (CLOSED → OPEN → HALF_OPEN → CLOSED), threshold behavior, fast-fail |
| `payment-service` | Razorpay webhook signature verification (security-critical path) |
| `user-service` | JWT access/refresh token generation & verification, token hashing |

```bash
cd api-gateway && npm test
cd payment-service && npm test
cd user-service && npm test
```

CI runs all three in parallel via GitHub Actions on every push/PR to `main`. See [`.github/workflows/ci.yml`](.github/workflows/ci.yml).

---

## API Routes

All routes go through the gateway at `http://localhost:4000/api/...`. Direct service access is also possible during development.

### Authentication (User Service)

| Method | Gateway Path | Auth | Rate Limit |
|--------|-------------|------|------------|
| POST | `/api/users/auth/send-otp` | — | 5/hour |
| POST | `/api/users/auth/verify-otp` | — | 10/hour |
| POST | `/api/users/auth/login` | — | 100/15min |
| POST | `/api/users/auth/google-auth` | — | 10/15min |
| POST | `/api/users/auth/refresh` | — | 20/15min |
| GET | `/api/users/user/profile` | JWT | default |

### Admin (Station/Train/Route/Schedule CRUD)

| Method | Gateway Path | Auth |
|--------|-------------|------|
| POST | `/api/admins/stations/station` | JWT |
| GET | `/api/admins/stations/station` | JWT |
| POST | `/api/admins/trains/train` | JWT |
| GET | `/api/admins/trains/train/:trainId` | JWT |
| POST | `/api/admins/trains/route` | JWT |
| POST | `/api/admins/schedules/schedule` | JWT |
| PUT | `/api/admins/schedules/schedule/:scheduleId` | JWT |

### Search (served by Admin Service)

| Method | Gateway Path | Auth | Rate Limit |
|--------|-------------|------|------------|
| GET | `/api/search/trains?from=&to=&date=` | — | 60/min |
| GET | `/api/search/autocomplete?q=` | — | 120/min |

### Bookings

| Method | Gateway Path | Auth | Rate Limit |
|--------|-------------|------|------------|
| POST | `/api/bookings/bookings` | JWT | 5/min |
| GET | `/api/bookings/bookings` | JWT | default |
| GET | `/api/bookings/bookings/:bookingId` | JWT | default |
| POST | `/api/bookings/bookings/:bookingId/verify-payment` | JWT | default |
| POST | `/api/bookings/bookings/:bookingId/cancel` | JWT | default |

### Inventory (public read, internal write)

| Method | Gateway Path | Auth |
|--------|-------------|------|
| GET | `/api/inventory/schedules/:scheduleId/availability` | — |
| GET | `/api/inventory/schedules/:scheduleId/seats` | JWT |

Lock/unlock/confirm/cancel-booking endpoints are internal-only (called by booking-service directly, not exposed through the gateway).

### Payments (webhook only through gateway)

| Method | Gateway Path | Auth |
|--------|-------------|------|
| POST | `/api/payments/webhooks/razorpay` | Razorpay signature |

### Gateway Health

| Method | Path | Notes |
|--------|------|-------|
| GET | `/health` | Liveness probe |
| GET | `/api/gateway/health` | Gateway health |
| GET | `/api/gateway/circuit-breakers` | Current breaker states |

---

## Environment Variables

Each service has a `.env.example` — copy to `.env` and fill in real values. **Never commit `.env` files.**

**Secrets that must match across services:**
- `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET` — shared between API Gateway and User Service
- `INTERNAL_SERVICE_KEY` — shared across all services for internal REST calls

**External integrations you must configure:**
- Gmail app password (for OTP emails)
- Google OAuth client ID
- Razorpay key ID, key secret, and webhook secret

Generate strong secrets:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

See individual `.env.example` files in each service directory for the full list.

---

## Project Structure

```
RailBook/
├── api-gateway/           # Single entrypoint — JWT, rate limiting, circuit breakers
├── user-service/          # Auth, OTP, JWT, Google OAuth, profile (Postgres + Redis)
├── admin-service/         # Stations, trains, routes, schedules, search (Postgres)
├── booking-service/       # Booking saga orchestrator, expiry daemon (Postgres + Redis)
├── payment-service/       # Razorpay integration, webhooks, refunds (Postgres)
├── inventory-service/     # Seat inventory, segment locking, availability (Postgres)
├── frontend/              # React 18 + Vite 6 + Tailwind CSS
├── shared/                # Cross-service code
│   ├── constants/
│   │   └── kafka-topics.js    # Single source of truth for all Kafka topic names
│   └── utils/
│       └── dlqHandler.js      # Kafka consumer wrapper — retry + DLQ publishing
├── db/init/               # Postgres init scripts (auto-creates 5 databases)
├── docker-compose.yml     # Dev infrastructure (Postgres, Redis, Kafka, Kafka UI, pgAdmin)
├── docker-compose.prod.yml  # Full production stack (infra + all services + frontend)
└── DEPLOYMENT.md          # Deployment guide (local Docker + Oracle Cloud free tier)
```

Each backend service follows:
```
<service>/
├── src/
│   ├── index.js           # Server bootstrap + Kafka consumer init
│   ├── config/            # Environment config, DB client, Redis client, Kafka client
│   ├── routes/            # Express route definitions
│   ├── controllers/       # Request handlers
│   ├── services/          # Core business logic
│   ├── middlewares/       # Auth, validation, error handling
│   ├── kafka/             # Producers and consumers
│   └── utils/             # Logger, error classes, helpers
├── prisma/                # Schema + migrations (5 services)
├── __tests__/             # Unit tests (gateway, payment, user)
├── Dockerfile
└── .env.example
```

---

## Infrastructure Ports

| Component | Port(s) | Access |
|-----------|---------|--------|
| PostgreSQL 15 | 5432 | `admin` / `irctcpass` (dev defaults) |
| pgAdmin | 8081 | `admin@admin.com` / `admin` |
| Redis Stack | 6379 (Redis), 8001 (RedisInsight) | password `irctcpass` |
| Kafka | 9092 (internal), 9093 (host) | |
| Kafka UI | 8080 | topic inspection |
| Zookeeper | 2181 | |

---

## Deployment

See [`DEPLOYMENT.md`](DEPLOYMENT.md) for detailed instructions covering:
- **Full Docker deployment** — single `docker compose` command for everything
- **Oracle Cloud Always Free tier** — self-hosted on a free ARM VM (4 cores, 24 GB RAM)
- **Optional**: frontend on Vercel, free domain + auto-TLS with Caddy

---

## License

MIT
