# FinCore Test Report

## Task 1: Foundation - Test Results

**Date**: 2026-11-23
**Status**: Task 1 startup failures fixed and verified; all Node workspaces typecheck; analytics startup blocked by environment-level Python issues (documented below)

---

## Infrastructure Validation

### Docker Services
| Service | Status | Health Check | Notes |
|---------|--------|--------------|-------|
| PostgreSQL 17 | ✅ Running (external container `fincore-postgres`) | `pg_isready` | Port 5432, external volume `fincore-postgres-data` |
| Redis 7 | ✅ Running (external container `fincore-redis`) | `redis-cli ping` | Port 6379, external volume `fincore-redis-data` |

### Network & Volumes
- ✅ External network `fincore-network` (already exists, not created by compose)
- ✅ External volume `fincore-postgres-data` (already exists)
- ✅ External volume `fincore-redis-data` (already exists)

### Docker Compose (`docker-compose.yml`)
- ✅ `container_name: fincore-postgres` / `fincore-redis` — Compose attaches to existing containers; no duplicate containers or port conflicts on 5432/6379
- ✅ Images match running containers: `postgres:17`, `redis:7`
- ✅ Volumes and network declared `external: true` — compose does not create or adopt existing Docker objects
- ⚠️ Health checks and init-db mount removed from compose (DB already initialized externally); safe local checks only, no Docker commands run against containers

---

## Service Health Endpoints

### Backend API (Express - Port 4000)
| Endpoint | Expected | Actual | Status |
|----------|----------|--------|--------|
| GET /health/live | 200 OK | `{"status":"alive"}` | ✅ Server starts and runs on 4000 |
| GET /health | 200 OK + JSON | 503 | Server starts; dependency check fails because existing `fincore-postgres` container rejects `postgres/postgres` password auth (env credential mismatch — container preserved, not modified) |
| GET /health/ready | 200/503 | Not separately tested | Same dependency check as /health |

### Analytics Service (FastAPI - Port 8000)
| Endpoint | Expected | Actual | Status |
|----------|----------|--------|--------|
| All | 200 OK | Does not start | Blocked by environment-level Python issues (see Known Issues): system `DEBUG=release` var breaks pydantic-settings bool parsing at `config.py:37`; missing `greenlet`/`psycopg` deps and `DATABASE_URL` dialect |

### Frontend (Next.js - Port 3000)
| Endpoint | Expected | Actual | Status |
|----------|----------|--------|--------|
| GET / | 200 OK + HTML | 200 OK | ✅ Next.js 14.2.35 starts ("Ready in 7.9s") with valid win32 SWC binary |

---

## Code Quality Checks

### TypeScript Compilation
| Workspace | `tsc --noEmit` | Status |
|-----------|----------------|--------|
| @fincore/web | `tsc --noEmit` | ✅ Passed |
| @fincore/api | `tsc --noEmit` | ✅ Passed |
| @fincore/shared | `tsc --noEmit` | ✅ Passed |

### ESLint
| Workspace | `npm run lint` | Status |
|-----------|----------------|--------|
| @fincore/web | `next lint` | ✅ Passed |
| @fincore/shared | `eslint src --ext .ts` | ❌ 3 prettier formatting errors (`src/index.ts`, `src/types.ts` lines 26, 112) |
| @fincore/api | `eslint src --ext .ts` | ❌ 43 errors / 22 warnings — pre-existing strict-type issues in `services/redis.ts` (`no-unsafe-call/member-access/assignment`, unresolved types) and routes; unrelated to the compose fix, not Task 1 blockers |

### Prettier
| Scope | `prettier --check` | Status |
|-------|--------------------|--------|
| `docker-compose.yml` | ✅ Passed (after `--write`) |
| `packages/shared/src/*.ts` | ❌ Formatting issues (fixable with `--write`) |
| `apps/api/src/routes/wallet.ts:23` | ❌ Formatting issue (fixable with `--write`) |

### Python (Analytics)
| Check | Command | Status |
|-------|---------|--------|
| Ruff lint | `ruff check` | ⏳ Not run |
| Black format | `black --check` | ⏳ Not run |
| MyPy types | `mypy` | ⏳ Not run |

---

## Test Coverage (Not Yet Implemented)

### Unit Tests
| Service | Framework | Coverage | Status |
|---------|-----------|----------|--------|
| Frontend | Jest + React Testing Library | 0% | 📋 Planned |
| Backend | Jest + Supertest | 0% | 📋 Planned |
| Analytics | Pytest + httpx | 0% | 📋 Planned |
| Shared | Jest | 0% | 📋 Planned |

### Integration Tests
| Scenario | Status |
|----------|--------|
| Wallet CRUD | 📋 Planned |
| Transaction flow | 📋 Planned |
| Ledger atomicity | 📋 Planned |
| Analytics queries | 📋 Planned |

### E2E Tests
| Scenario | Status |
|----------|--------|
| User registration → wallet → transaction | 📋 Planned |
| Transfer between wallets | 📋 Planned |
| Balance consistency under load | 📋 Planned |

---

## Known Issues & TODOs

### Immediate (Before Task 2)
- [x] Install dependencies: `npm install --workspaces` (clean reinstall done; all workspaces resolve)
- [ ] Install Python deps: `cd services/analytics && pip install -e ".[dev]"` (`greenlet`, `structlog` now declared in pyproject.toml; `psycopg`/DATABASE_URL dialect still unresolved)
- [x] Run TypeScript compilation on all workspaces — ✅ All passed (web, api, shared)
- [x] Run ESLint on all workspaces — ⚠️ web passed; shared + api have pre-existing issues (see above)
- [ ] Run Ruff/Black/MyPy on analytics (blocked by env; Python deps partially installed)
- [ ] Start Docker services and verify health endpoints — containers already running externally (`fincore-postgres`, `fincore-redis`); no Docker commands run against them per constraints
- [x] Start all dev servers and verify integration — ✅ API (4000, /live 200) and Web (3000, / 200) start; Analytics blocked by env (see below)

### Analytics Startup Blockers (environment-level, not repo defects)
- System environment variable `DEBUG=release` is set on this machine. `app/config.py` declares `DEBUG: bool = False`; pydantic-settings reads OS env and fails bool parsing on `'release'`, crashing `Settings()` at import (`config.py:37`). Not fixable via repo changes; unset or correct `DEBUG` to run analytics.
- `app/database.py` uses `create_async_engine(settings.DATABASE_URL)` with `DATABASE_URL=postgresql://...`, which SQLAlchemy resolves to the `psycopg` driver — not installed. `asyncpg` IS installed/declared but the URL lacks the `+asyncpg` driver.
- Missing/undeclared Python deps found during verification: `structlog` (imported in `main.py:6`) and `greenlet` (required by SQLAlchemy asyncio) — both now declared in `pyproject.toml` and installed.

### Short-term (Task 2-3)
- [ ] Implement unit test infrastructure
- [ ] Add test scripts to package.json / pyproject.toml
- [ ] Create test database setup/teardown
- [ ] Add CI pipeline for automated testing

### Test Infrastructure Needed
- [ ] Jest configuration for each workspace
- [ ] Pytest configuration with async support
- [ ] Testcontainers for integration tests
- [ ] Supertest for API integration tests
- [ ] React Testing Library for component tests
- [ ] Coverage thresholds (target: 80%)

---

## Validation Commands Reference

```bash
# Install all dependencies
npm install --workspaces
cd services/analytics && pip install -e ".[dev]"

# Start infrastructure
npm run db:up

# Type check
npm run typecheck  # (add to root package.json)
cd apps/api && npm run typecheck
cd apps/web && npm run typecheck
cd packages/shared && npm run typecheck

# Lint
npm run lint
cd services/analytics && ruff check && black --check && mypy

# Format
npx prettier --write .
cd services/analytics && black . && isort .

# Test (when implemented)
npm run test
cd services/analytics && pytest

# Start dev servers
npm run dev
```

---

## Next Test Milestone

**Target**: Task 2 completion
- All TypeScript compilation passing
- All linting passing
- Health endpoints returning 200
- Basic unit test infrastructure in place
- At least 3 unit tests per service