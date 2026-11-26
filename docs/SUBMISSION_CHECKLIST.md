# FinCore Capstone Project Submission & Setup Guide

## Project Summary
- **Project Name**: FinCore — Digital Wallet, Double-Entry Ledger & Payment Processing Platform
- **Architecture**: Modular multi-service fintech system (Next.js 14 frontend, Express REST API, FastAPI analytics, PostgreSQL 17, Redis 7).
- **Quality & Verification**: 225 / 225 automated test pass rate (100%), clean production builds, zero ledger discrepancies.

---

## 1. Quickstart & Reproducible Setup Instructions

### Prerequisites
- Node.js v20+ & npm 10+
- Python 3.11+
- Docker & Docker Compose v2+
- Git

### One-Command Docker Setup
```bash
# Clone the repository
git clone https://github.com/organization/fincore.git
cd fincore

# Copy environment variables template
cp .env.example .env

# Start core datastores (PostgreSQL 17 & Redis 7)
docker compose up -d postgres redis

# Verify datastores health
docker compose ps
```

### Local Application Execution
```bash
# Install all monorepo dependencies
npm install

# Start Express Backend API (Port 4000)
npm run dev:api

# In a separate terminal: Start Python FastAPI Analytics Service (Port 8000)
cd services/analytics
pip install -e ".[dev]"
uvicorn app.main:app --host 0.0.0.0 --port 8000

# In a separate terminal: Start Next.js Frontend (Port 3000)
npm run dev:web
```

---

## 2. Comprehensive Test Suite Execution

All 225 tests can be executed sequentially using free local tooling:

| Suite | Target / Command | Tests | Coverage |
|:------|:-----------------|:-----:|:---------|
| **Shared Package** | `npm --prefix packages/shared test` | 14 | Currency, Wallets, Transactions, Ledger, RBAC & Health schemas |
| **API Regression** | `npm --prefix apps/api test` (Node.js Test Runner) | 155 | Assessments 02–15, Auth, Ledger, Transfers, Outages |
| **Python Analytics** | `python -m pytest services/analytics/tests` | 41 | Decimal precision, interest, tiered fees, risk engine |
| **Frontend Jest** | `npm --prefix apps/web test` | 10 | Customer UI, Wallets, Transfer form, Disputes, Ops console |
| **Playwright E2E** | `npx playwright test` | 5 | End-to-end browser journeys, role switching, transfer execution |
| **Total Verified** | — | **225** | **100% Pass Rate (0 Failures)** |

---

## 3. Architecture & Entity Relationships

Detailed architectural documentation with interactive Mermaid flowcharts is available in [ARCHITECTURE.md](file:///c:/Users/neele/Desktop/FinCore/docs/ARCHITECTURE.md).

Key system principles:
- **Append-Only Ledger**: No `UPDATE` or `DELETE` operations on `ledger_entries`.
- **Double-Entry Equilibrium**: Every completed financial transaction produces equal debit and credit rows ($\sum \text{Debit} - \sum \text{Credit} = 0$).
- **Monetary Precision**: Exact fixed-point calculation using PostgreSQL `NUMERIC(18, 4)` and `BigInt` scaling. No floating-point roundoff errors.
- **Idempotency**: Strict principal-scoped, request-bound duplicate protection using Redis distributed locks and persistent transaction receipts.

---

## 4. API Contracts & Documentation
- **Interactive Swagger UI**: `http://localhost:4000/docs`
- **OpenAPI 3.0 Specification**: [docs/openapi.json](file:///c:/Users/neele/Desktop/FinCore/docs/openapi.json)
- **Importable Postman Collection**: [docs/postman_collection.json](file:///c:/Users/neele/Desktop/FinCore/docs/postman_collection.json)
- **Postman Environment Template**: [docs/postman_environment.json](file:///c:/Users/neele/Desktop/FinCore/docs/postman_environment.json)

---

## 5. Security & Governance Compliance
- **RBAC**: Multi-role authorization (`customer`, `operations_analyst`, `finance_administrator`, `platform_administrator`).
- **MFA**: Simulated TOTP secret generation, QR URL, and backup recovery codes.
- **Production Hardening**: Demo persona auto-login and webhook simulator endpoints are strictly disabled in production environments (`NODE_ENV=production`).
- **Zero Secrets**: Scanned and verified clean with 0 committed private keys or unmasked secrets.
