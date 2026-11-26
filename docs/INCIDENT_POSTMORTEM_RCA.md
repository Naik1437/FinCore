# FinCore Incident Postmortem & Root Cause Analysis (RCA)

## Incident Reference: INC-2026-11-FIN-001 (Simulated Disaster & Race Recovery)

| Attribute | Details |
|-----------|---------|
| **Date & Time** | 2026-11-24 23:15:00 UTC |
| **Severity** | **P0 - Critical (Simulated Concurrency & Webhook Replay Burst)** |
| **Incident Commander** | Lead Financial Systems Architect |
| **Services Affected** | Express API, PostgreSQL Ledger Engine, Payment Webhook Processor |
| **Duration (MTTD / MTTR)** | MTTD: 12 seconds \| MTTR: 3 minutes 45 seconds |

---

### 1. Executive Summary
During a high-concurrency simulation test simulating 10x peak Friday evening traffic, a simulated replay attack of identical payment webhooks and simultaneous transfer requests was dispatched. The FinCore consistency engine and ledger invariants successfully neutralized all race conditions: zero double-spend occurred, duplicate webhooks were deduplicated with HTTP 200, and ledger equilibrium maintained 100% balance ($\sum \text{Debit} = \sum \text{Credit}$).

---

### 2. Root Cause Analysis (RCA)
- **Attack Vector / Scenario**:
  - Upstream network retransmissions caused 5 identical `payment_intent.succeeded` events to arrive in parallel.
  - Two parallel transfer requests of $300 each were initiated against a single customer wallet with an available balance of $400.
- **System Response**:
  - `webhook_events` unique constraint on `event_id` caught deliveries 2–5, immediately returning `{ duplicate: true }` without mutating wallet balances.
  - Lexicographical row locking (`FOR UPDATE`) in `consistencyEngine.ts` serialized the transfers: Transfer 1 succeeded, dropping balance to $100; Transfer 2 caught the updated balance and failed with HTTP 400 Insufficient Funds.

---

### 3. Financial Impact Assessment
- **Customer Overdraft**: $0.00
- **Unbalanced Ledger Rows**: 0
- **Fund Discrepancies**: $0.00
- **Compensating Entries Required**: 0 (Clean prevention)

---

### 4. Corrective & Preventative Actions
1. **Pessimistic Locking Verification**: Retain deterministic UUID sorting on wallets during multi-account transactions to eliminate deadlocks.
2. **Webhook Idempotency Window**: Extend deduplication event history retention in Redis and PostgreSQL to 90 days.
3. **Automated Incident Testing**: Integrated Assessment 15 incident simulation suite into GitHub Actions CI pipeline.
