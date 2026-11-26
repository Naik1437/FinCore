# FinCore Architecture

## Service and data flow

```mermaid
flowchart LR
  Browser[Next.js customer and operations UI] -->|HTTPS JSON| API[Express API]
  API --> PG[(PostgreSQL system of record)]
  API --> Redis[(Redis locks and receipts)]
  API --> Analytics[FastAPI analytics]
  Worker[Transfer worker] --> PG
  Worker --> Redis
  Analytics --> PG
```

Express owns users, accounts, wallets, beneficiaries, transactions, ledger entries,
holds, settlements, disputes, notifications, and webhook records. FastAPI reads
financial data for calculations and risk decision support. Redis stores ephemeral
locks and idempotency receipts. The worker owns transfer-job execution and writes
the resulting transaction and ledger records through the same consistency engine.

## Core entity relationships

```mermaid
erDiagram
  USERS ||--o{ WALLETS : owns
  USERS ||--o{ BENEFICIARIES : creates
  USERS ||--o{ REFRESH_TOKENS : receives
  WALLETS ||--o{ TRANSACTIONS : records
  TRANSACTIONS ||--o{ LEDGER_ENTRIES : posts
  TRANSACTIONS ||--o{ DISPUTES : may_have
  TRANSACTIONS ||--o{ SETTLEMENTS : reconciles
  TRANSACTIONS ||--o{ HOLDS : reserves
  TRANSFER_JOBS }o--|| BENEFICIARIES : targets
  TRANSFER_JOBS }o--|| WALLETS : debits
  WEBHOOK_EVENTS ||--o{ NOTIFICATIONS : triggers
```

All monetary amounts use PostgreSQL `NUMERIC(18,4)`. Ledger entries are append-only,
and new completed transactions are required to have balanced debit and credit rows.
