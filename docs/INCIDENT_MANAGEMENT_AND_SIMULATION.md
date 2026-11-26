# FinCore Financial Incident Management, Escalation & Simulation Runbook

## 1. Incident Severity Classification Matrix

FinCore classifies financial and platform incidents across 4 distinct severity tiers:

| Severity | Category / Criteria | Target MTTD | Target MTTR | Escalation & Response |
|----------|---------------------|-------------|-------------|-----------------------|
| **P0 - Critical** | **Ledger Imbalance / Double-Spending / Fund Loss Risk**<br>• Any unbalanced ledger transaction ($\sum \text{Debit} \neq \sum \text{Credit}$)<br>• Concurrent transfer double-spend bypass<br>• Core database corruption or widespread outage | $< 1$ Min | $< 15$ Min | **Immediate Page**: CTO, Lead Financial Engineer, Security Officer, On-call SRE.<br>**Action**: Freeze affected wallet(s), route traffic to read-only, execute compensating entries. |
| **P1 - High** | **Payment Gateway Outage / Webhook Replay Surge / Auth Compromise**<br>• Payment provider timeout $> 10\%$<br>• Large-scale webhook replay or burst duplicate attacks<br>• Cross-account authorization breach attempt | $< 5$ Min | $< 30$ Min | **Page**: Lead Payment Engineer, Security Lead.<br>**Action**: Fallback to secondary payment adapter, rotate compromised credentials, enforce strict rate limiting. |
| **P2 - Medium** | **Degraded Performance / Analytics Failure / DLQ Overflow**<br>• Fast-API risk scoring timeout (degraded to conservative hold)<br>• Redis cache unavailability (fallback to DB pessimistic lock)<br>• Asynchronous DLQ accumulation | $< 15$ Min | $< 2$ Hours | **Notify**: On-call engineer, Operations Analyst.<br>**Action**: Drain and inspect DLQ, restart cache service, replay failed jobs. |
| **P3 - Low** | **Non-Critical UI / Report Discrepancy**<br>• Statement PDF export delay<br>• Non-blocking cosmetic frontend error | $< 1$ Hour | $< 1$ Day | **Ticket**: JIRA sprint backlog. |

---

## 2. Simulated Incident Response Procedures

### Incident 1: Duplicate Payment & Webhook Replay Burst
- **Simulation**: Ingest identical signed webhook payloads (`payment_intent.succeeded`) concurrently within milliseconds.
- **Expected Defense**: Database `webhook_events` uniqueness constraint deduplicates delivery. Response: `{ duplicate: true }`. Zero double-credit to wallet balance. Zero duplicate ledger journal entries.

### Incident 2: Concurrent Transfer & Double-Spending Race
- **Simulation**: Fire parallel transfer requests exceeding the available wallet balance ($300 + $300 > $400).
- **Expected Defense**: Deterministic row-level locking (`SELECT ... FOR UPDATE`) serialized by wallet UUID. Exactly 1 transaction succeeds (HTTP 201), 1 rejected (HTTP 400). Zero negative balance.

### Incident 3: Ledger Discrepancy Detection & Auditable Reconciliation
- **Simulation**: Detect any historical or injected unbalanced transaction.
- **Expected Defense**: Automated reconciliation scanner queries:
  $$\sum \text{Debit} \neq \sum \text{Credit}$$
- **Resolution**: Append an immutable **compensating journal entry** restoring equilibrium without modifying historical records.

### Incident 4: Payment Provider Failure & Fallback Handling
- **Simulation**: Ingest simulated upstream gateway failure event (`payment_intent.payment_failed`) with error code `card_declined_insufficient_funds`.
- **Expected Defense**: Transaction status marked `failed`, failure reason logged in metadata, hold released, customer funds preserved.

### Incident 5: Database / Redis Degradation Simulation
- **Simulation**: Redis connection timeout during transfer concurrency lock.
- **Expected Defense**: Fallback to database row-level locking ensures atomicity even without distributed Redis locks.

### Incident 6: Unauthorized Cross-Account Breach
- **Simulation**: Authenticated customer attempts transfer from another user's wallet.
- **Expected Defense**: Immediate rejection with `HTTP 403 Forbidden`. Security audit event persisted in `security_audit_logs`.

---

## 3. Post-Recovery Financial Integrity Verification Protocol

Following any incident resolution or recovery procedure, the financial reconciliation engine executes:
1. **Double-Entry Balance Equilibrium**:
   ```sql
   SELECT transaction_id, 
          SUM(CASE WHEN entry_type = 'debit' THEN amount ELSE 0 END) as debit,
          SUM(CASE WHEN entry_type = 'credit' THEN amount ELSE 0 END) as credit
   FROM ledger_entries
   GROUP BY transaction_id
   HAVING SUM(CASE WHEN entry_type = 'debit' THEN amount ELSE 0 END) != SUM(CASE WHEN entry_type = 'credit' THEN amount ELSE 0 END);
   ```
   **Pass Condition**: 0 rows returned.
2. **Wallet Balance Consistency**:
   $$\text{Wallet Balance} \ge 0 \quad \text{and} \quad \text{Available Balance} = \text{Balance} - \text{Held Balance}$$
