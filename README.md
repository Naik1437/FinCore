# FinCore - Digital Wallet, Ledger & Payment Processing Platform

A production-ready, modular fintech platform built with modern technologies for digital wallet management, ledger accounting, and payment processing.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        FinCore Platform                          │
├─────────────────┬─────────────────┬─────────────────────────────┤
│   Frontend      │   Backend API   │   Analytics Service         │
│   (Next.js 14)  │   (Express)     │   (FastAPI)                 │
│   Port: 3000    │   Port: 4000    │   Port: 8000                │
└────────┬────────┴────────┬────────┴────────────┬───────────────┘
         │                 │                     │
         └─────────────────┼─────────────────────┘
                           │
        ┌──────────────────┼──────────────────┐
        ▼                  ▼                  ▼
   ┌─────────┐       ┌──────────┐       ┌──────────┐
   │PostgreSQL│      │  Redis   │       │  Shared  │
   │  Port    │       │  Port    │       │  Types   │
   │  5432    │       │  6379    │       │  (Zod)   │
   └─────────┘       └──────────┘       └──────────┘
```

## Tech Stack

| Layer | Technology | Version |
|-------|------------|---------|
| Frontend | Next.js (App Router) | 14.x |
| Backend | Node.js + Express | 20.x / 4.x |
| Analytics | Python FastAPI | 3.11 / 0.109 |
| Database | PostgreSQL | 17 |
| Cache | Redis | 7 |
| Language | TypeScript / Python | 5.4 / 3.11 |
| Validation | Zod / Pydantic | 3.22 / 2.5 |
| Containerization | Docker Compose | 3.8 |

## Project Structure

```
FinCore/
├── apps/
│   ├── web/                 # Next.js frontend
│   │   ├── src/
│   │   │   ├── app/         # App Router pages
│   │   │   ├── components/  # React components
│   │   │   └── lib/         # Utilities
│   │   └── package.json
│   └── api/                 # Express backend
│       ├── src/
│       │   ├── routes/      # API routes
│       │   ├── middleware/  # Express middleware
│       │   ├── controllers/ # Route controllers
│       │   ├── services/    # Business logic
│       │   └── utils/       # Utilities
│       └── package.json
├── services/
│   └── analytics/           # FastAPI analytics service
│       ├── app/
│       │   ├── routes/      # API routes
│       │   ├── models/      # Pydantic models
│       │   ├── services/    # Business logic
│       │   └── main.py      # FastAPI app entry
│       └── pyproject.toml
├── packages/
│   └── shared/              # Shared TypeScript types (Zod schemas)
│       └── src/
├── scripts/
│   └── init-db/             # Database initialization scripts
├── docker-compose.yml       # Infrastructure services
├── .env.example             # Environment template
├── .eslintrc.js             # ESLint config
├── .prettierrc              # Prettier config
└── package.json             # Root workspace config
```

## Quick Start

### Prerequisites

- Node.js 20+
- Python 3.11+
- Docker & Docker Compose
- npm 10+

### 1. Clone and Install

```bash
# Install root dependencies
npm install

# Install workspace dependencies
npm install --workspaces
```

### 2. Configure Environment

```bash
# Copy environment templates
cp .env.example .env
cp apps/web/.env.example apps/web/.env.local
cp apps/api/.env.example apps/api/.env
cp services/analytics/.env.example services/analytics/.env
```

### 3. Start Infrastructure

```bash
# Start PostgreSQL and Redis
npm run db:up

# Verify services are healthy
docker compose ps
```

### 4. Run Development Servers

```bash
# Run all services concurrently
npm run dev

# Or run individually:
npm run dev:web     # Frontend at http://localhost:3000
npm run dev:api     # Backend at http://localhost:4000
npm run dev:analytics  # Analytics at http://localhost:8000
```

### 5. Verify Health Endpoints

```bash
# Frontend
curl http://localhost:3000

# Backend API
curl http://localhost:4000/health
curl http://localhost:4000/health/ready
curl http://localhost:4000/health/live

# Analytics
curl http://localhost:8000/health
curl http://localhost:8000/health/ready
curl http://localhost:8000/health/live
```

## API Endpoints

### Backend API (Port 4000)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | Full health check |
| GET | `/health/ready` | Readiness probe |
| GET | `/health/live` | Liveness probe |
| GET | `/api` | API info |
| POST | `/api/wallets` | Create wallet |
| GET | `/api/wallets/:id` | Get wallet |
| GET | `/api/wallets` | List wallets |
| POST | `/api/transactions` | Create transaction |
| GET | `/api/transactions/:id` | Get transaction |
| GET | `/api/transactions` | List transactions |
| POST | `/api/ledger` | Create ledger entry |
| GET | `/api/ledger/:id` | Get ledger entry |
| GET | `/api/ledger` | List ledger entries |
| GET | `/api/ledger/wallet/:walletId/balance` | Get wallet balance |

### Analytics Service (Port 8000)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | Full health check |
| GET | `/health/ready` | Readiness probe |
| GET | `/health/live` | Liveness probe |
| GET | `/` | Service info |
| GET | `/api/v1/analytics/wallets/:id` | Wallet analytics |
| GET | `/api/v1/analytics/transactions` | Transaction analytics |
| GET | `/api/v1/analytics/summary` | Platform summary |
| GET | `/api/v1/metrics/transaction-volume` | Volume time series |
| GET | `/api/v1/metrics/transaction-count` | Count time series |
| GET | `/api/v1/metrics/wallet-balance` | Balance time series |
| GET | `/api/v1/metrics/active-users` | Active users time series |
| GET | `/api/v1/metrics/error-rate` | Error rate time series |

## Database Schema

The platform uses PostgreSQL with the following core tables:

- **users** - Wallet owners
- **wallets** - Digital wallets with currency and balance
- **transactions** - Financial transactions (deposit, withdrawal, transfer, payment)
- **ledger_entries** - Immutable double-entry accounting records

Key features:
- UUID primary keys
- Optimistic locking via version column
- Row-level locking for balance updates
- Idempotency keys for transactions
- Comprehensive indexes for query performance
- Automated `updated_at` triggers

## Development Commands

```bash
# Build all workspaces
npm run build

# Lint all workspaces
npm run lint

# Type check all workspaces
npm run typecheck  # (add to root package.json if needed)

# Run tests
npm run test

# Database operations
npm run db:up      # Start PostgreSQL & Redis
npm run db:down    # Stop PostgreSQL & Redis
npm run db:logs    # View database logs
```

## Environment Variables

### Root (.env)
| Variable | Description | Default |
|----------|-------------|---------|
| NODE_ENV | Environment | development |
| PORT | API port | 4000 |
| DB_HOST | PostgreSQL host | localhost |
| DB_PORT | PostgreSQL port | 5432 |
| DB_NAME | Database name | fincore |
| DB_USER | Database user | postgres |
| DB_PASSWORD | Database password | postgres |
| REDIS_HOST | Redis host | localhost |
| REDIS_PORT | Redis port | 6379 |
| CORS_ORIGIN | CORS origin | http://localhost:3000 |
| JWT_SECRET | JWT signing secret | (required) |
| ENCRYPTION_KEY | Encryption key (32 chars) | (required) |

### Frontend (apps/web/.env.local)
| Variable | Description | Default |
|----------|-------------|---------|
| NEXT_PUBLIC_API_URL | Backend API URL | http://localhost:4000 |
| NEXT_PUBLIC_ANALYTICS_URL | Analytics URL | http://localhost:8000 |

### Analytics (services/analytics/.env)
| Variable | Description | Default |
|----------|-------------|---------|
| DATABASE_URL | PostgreSQL connection URL | postgresql://postgres:postgres@localhost:5432/fincore |
| REDIS_URL | Redis connection URL | redis://localhost:6379/0 |
| DEBUG | Debug mode | true |
| PORT | Service port | 8000 |

## Testing

```bash
# Run all tests
npm run test

# Run specific workspace tests
npm run test:web
npm run test:api
npm run test:analytics
```

## Deployment

### Docker Production Build

```bash
# Build all images
docker compose -f docker-compose.yml -f docker-compose.prod.yml build

# Start production stack
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```

### Kubernetes

Helm charts and Kustomize manifests are planned for future releases.

## Security Considerations

- All secrets managed via environment variables
- JWT-based authentication (to be implemented)
- Rate limiting on API endpoints
- Helmet.js for HTTP security headers
- CORS configured per environment
- Input validation via Zod/Pydantic
- SQL injection prevention via parameterized queries
- Idempotency keys for transaction safety

## Monitoring & Observability

- Health endpoints for all services (`/health`, `/health/ready`, `/health/live`)
- Structured JSON logging
- Request/response logging middleware
- Prometheus metrics exposition (planned)
- Distributed tracing with OpenTelemetry (planned)

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make changes with tests
4. Run linting and type checking
5. Submit a pull request

## License

Proprietary - FinCore Platform

## Assessment Requirements Checklist

This foundation maps to the following FinCore assessment requirements:

- [x] **REQ-01**: Monorepo structure with frontend, backend, analytics services
- [x] **REQ-02**: TypeScript throughout (frontend, backend, shared types)
- [x] **REQ-03**: Next.js 14 App Router frontend
- [x] **REQ-04**: Express.js backend with TypeScript
- [x] **REQ-05**: Python FastAPI analytics service
- [x] **REQ-06**: PostgreSQL database with Docker Compose
- [x] **REQ-07**: Redis cache with Docker Compose
- [x] **REQ-08**: Shared type definitions (Zod schemas)
- [x] **REQ-09**: Health endpoints for all services
- [x] **REQ-10**: Environment variable configuration
- [x] **REQ-11**: ESLint + Prettier code quality
- [x] **REQ-12**: Database schema with wallets, transactions, ledger
- [x] **REQ-13**: API routes for wallets, transactions, ledger
- [x] **REQ-14**: Docker Compose for local development
- [x] **REQ-15**: Documentation and startup instructions