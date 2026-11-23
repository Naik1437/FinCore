# FinCore Architecture Decision Records (ADRs)

## ADR-001: Monorepo with npm Workspaces
**Date**: 2026-11-23
**Status**: Accepted

### Context
Need to manage frontend, backend, analytics service, and shared code in a single repository.

### Decision
Use npm workspaces with the following structure:
- `apps/web` - Next.js frontend
- `apps/api` - Express backend
- `services/analytics` - FastAPI analytics (Python, separate package manager)
- `packages/shared` - Shared TypeScript types

### Consequences
- ✅ Shared code via `@fincore/shared` package
- ✅ Single `npm install` for all Node.js workspaces
- ✅ Atomic commits across services
- ⚠️ Python service uses separate `pyproject.toml` and `pip`
- ⚠️ Need to coordinate TypeScript/Python type sharing

---

## ADR-002: Next.js 14 App Router for Frontend
**Date**: 2026-11-23
**Status**: Accepted

### Context
Need a modern React framework for the dashboard and user-facing portal.

### Decision
Use Next.js 14 with App Router, TypeScript, and React Server Components.

### Consequences
- ✅ Server-side rendering by default
- ✅ Built-in routing, layouts, loading states
- ✅ Excellent TypeScript support
- ✅ API route proxying to backend
- ⚠️ Learning curve for App Router patterns
- ⚠️ Client/server component boundary complexity

---

## ADR-003: Express.js for Backend API
**Date**: 2026-11-23
**Status**: Accepted

### Context
Need a robust, well-understood Node.js framework for the REST API.

### Decision
Use Express.js with TypeScript, Zod validation, and modular route structure.

### Consequences
- ✅ Mature ecosystem, extensive middleware
- ✅ Full control over request/response cycle
- ✅ Easy to add WebSocket support later
- ⚠️ Manual route organization needed
- ⚠️ No built-in OpenAPI generation (add swagger later)

---

## ADR-004: FastAPI for Analytics Service
**Date**: 2026-11-23
**Status**: Accepted

### Context
Need a high-performance Python service for analytics, ML, and data processing.

### Decision
Use FastAPI with Pydantic v2, SQLAlchemy 2.0 async, and structlog.

### Consequences
- ✅ Automatic OpenAPI/Swagger documentation
- ✅ Excellent async support for I/O-bound analytics
- ✅ Pydantic validation matches Zod patterns
- ✅ Great for pandas/numpy data processing
- ⚠️ Separate deployment and dependency management
- ⚠️ Python/TypeScript type sharing requires manual sync

---

## ADR-005: PostgreSQL for Primary Database
**Date**: 2026-11-23
**Status**: Accepted

### Context
Need ACID-compliant database for financial data with strong consistency.

### Decision
Use PostgreSQL 16 with:
- UUID primary keys
- Row-level locking for balance updates
- Advisory locks for distributed coordination
- JSONB for flexible metadata
- Partitioning strategy for ledger entries (future)

### Consequences
- ✅ Strong consistency for financial transactions
- ✅ Mature ecosystem, excellent tooling
- ✅ Supports complex queries for analytics
- ⚠️ Horizontal scaling requires planning
- ⚠️ Connection pooling essential

---

## ADR-006: Redis for Caching & Session Store
**Date**: 2026-11-23
**Status**: Accepted

### Context
Need high-performance cache for balances, sessions, and idempotency keys.

### Decision
Use Redis 7 with:
- LRU eviction policy
- Persistence enabled (AOF)
- TTL-based expiration for all keys
- Separate databases for cache vs sessions

### Consequences
- ✅ Sub-millisecond latency for balance reads
- ✅ Atomic operations for idempotency
- ✅ Pub/Sub for real-time updates (future)
- ⚠️ Memory-limited, plan capacity
- ⚠️ Not a source of truth

---

## ADR-007: Zod for Shared Runtime Validation
**Date**: 2026-11-23
**Status**: Accepted

### Context
Need shared validation schemas between TypeScript services.

### Decision
Create `@fincore/shared` package with Zod schemas that export both types and validators.

### Consequences
- ✅ Single source of truth for API contracts
- ✅ Runtime validation matches compile-time types
- ✅ Works in both Node.js and Edge runtimes
- ✅ Easy to generate OpenAPI from schemas
- ⚠️ Python service needs equivalent Pydantic models
- ⚠️ Version coordination required

---

## ADR-008: Docker Compose for Local Development
**Date**: 2026-11-23
**Status**: Accepted

### Context
Need consistent local development environment matching production.

### Decision
Use Docker Compose v3.8 for PostgreSQL and Redis with:
- Named volumes for persistence
- Health checks for dependency ordering
- Custom bridge network
- Init scripts for schema initialization

### Consequences
- ✅ Zero-config database setup for developers
- ✅ Matches production container images
- ✅ Easy to add pgAdmin, Redis Commander
- ⚠️ Not for production deployment
- ⚠️ Volume data persists between restarts

---

## ADR-009: Health Endpoint Standard
**Date**: 2026-11-23
**Status**: Accepted

### Context
Need standardized health checking for container orchestration.

### Decision
All services implement three endpoints:
- `GET /health` - Full health with dependency checks (200/503)
- `GET /health/ready` - Readiness for traffic (200/503)
- `GET /health/live` - Liveness for restart (200)

### Consequences
- ✅ Kubernetes-compatible probes
- ✅ Consistent monitoring across services
- ✅ Dependency visibility (DB, Redis)
- ⚠️ Must keep lightweight for liveness

---

## ADR-010: Double-Entry Ledger with Atomic Functions
**Date**: 2026-11-23
**Status**: Accepted

### Context
Financial ledger must be immutable and consistent.

### Decision
Use PostgreSQL functions with row-level locking:
- `create_ledger_entry()` handles balance update + ledger insert atomically
- Optimistic locking via `version` column on wallets
- All entries immutable after creation
- Idempotency keys on transactions

### Consequences
- ✅ ACID compliance for financial data
- ✅ Audit trail by design
- ✅ Prevents negative balances at DB level
- ⚠️ Business logic in database (trade-off for correctness)
- ⚠️ Requires careful testing of concurrent scenarios

---

## ADR-011: Environment-Based Configuration
**Date**: 2026-11-23
**Status**: Accepted

### Context
Need secure, flexible configuration across environments.

### Decision
- Root `.env.example` documents all variables
- Each service has its own `.env.example`
- Use `dotenv` (Node) and `pydantic-settings` (Python)
- Never commit actual `.env` files
- Secrets injected at runtime in production

### Consequences
- ✅ Clear documentation of required config
- ✅ Easy local development setup
- ✅ 12-factor app compliant
- ⚠️ Must validate required vars at startup

---

## ADR-012: Code Quality Standards
**Date**: 2026-11-23
**Status**: Accepted

### Context
Need consistent code quality across all services.

### Decision
- ESLint with TypeScript strict mode for all TS code
- Prettier for formatting (single quotes, 2 spaces, trailing commas)
- Ruff + Black + MyPy for Python
- Pre-commit hooks (future)
- CI pipeline enforcement (future)

### Consequences
- ✅ Consistent style across codebase
- ✅ Catch bugs early with strict TS
- ✅ Automated formatting reduces review friction
- ⚠️ Initial setup overhead
- ⚠️ May need rule adjustments per service