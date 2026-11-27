# FinCore Secure Deployment & Automated Rollback Procedures

## 1. Zero-Downtime Deployment Architecture

## Demo Gate Setup

The optional HTTPS Nginx profile requires these local-only files under `docker/certs/`:

- `fincore.crt` and `fincore.key` for TLS.
- `.htpasswd` containing the demo username and bcrypt/crypt password hash.
- `gate_map.conf` mapping the HttpOnly cookie value to `1`.
- `gate_set_cookie.conf` issuing the matching Secure, HttpOnly cookie.

Generate them with `bash scripts/setup_demo_gate.sh`. The script requires `htpasswd`
from `apache2-utils`, uses bcrypt cost 12, generates a random cookie value, applies
restrictive permissions, and does not print either secret. Do not use `openssl passwd`
or a SHA-1 hash for the gate.

On Windows, run the script from Git Bash or WSL. If using Docker tooling instead,
provide `htpasswd` through a local Apache HTTPD image, write the generated `.htpasswd`
and cookie include files only into the ignored `docker/certs/` directory, then run
`docker exec fincore-nginx nginx -t` and `docker exec fincore-nginx nginx -s reload`.

These files are intentionally git-ignored. Create or provision them before starting
the `https` Compose profile; never commit the credentials, cookie value, private key,
or certificate. The `/_gate` endpoint must be challenged with Basic Auth before it
issues the dashboard cookie.

FinCore financial services employ a **Blue/Green (or Canary Rolling)** deployment strategy to ensure continuous availability, ledger safety, and zero data loss during production upgrades.

```
                  [ Ingress Load Balancer ]
                             |
            +----------------+----------------+
            | (Live: 95%)                     | (Canary: 5%)
    [ Blue Stack: v1.0.0 ]            [ Green Stack: v1.0.1 ]
    - Express API (v1.0.0)             - Express API (v1.0.1)
    - Web UI (v1.0.0)                  - Web UI (v1.0.1)
    - FastAPI Analytics (v1.0.0)       - FastAPI Analytics (v1.0.1)
            \                                /
             \                              /
              v                            v
          [ Shared PostgreSQL 17 & Redis 7 Cluster ]
          - Backward-compatible schema migrations
          - Row-level pessimistic locking
```

---

## 2. Mandatory Financial Pre-Deployment Checks

Before traffic cutover to a new release:
1. **Schema Compatibility**: Migrations must follow the expand/contract pattern. Existing active versions must remain functional with newly added tables or columns.
2. **Database Backup**: Point-In-Time-Recovery (PITR) snapshot or WAL archive must be completed.
3. **Double-Entry Equilibrium**: Ledger reconciliation verification confirms zero historical variance.
4. **Secret Injection**: All credentials (`JWT_SECRET`, database passwords) injected via environment secrets, never committed into images.

---

## 3. Automated Canary Rollback Triggers

During the canary phase (first 10 minutes of 5% traffic routing):
Automatic rollback is triggered if ANY of the following occur:
- **HTTP Error Rate**: `5xx` error spike exceeding 0.1% of requests.
- **Latency Spike**: p99 transaction response time exceeds 250ms.
- **Ledger Inconsistency**: Any `unbalanced_ledger_entry` event logged.
- **Database Lock Timeout**: Concurrency deadlocks or lock wait timeouts exceeding 5s.

---

## 4. Emergency Rollback Runbook

If a critical flaw, race condition, or balance variance is detected post-deployment:

### Step 1: Immediate Ingress Traffic Reversion
Instantly switch the ingress load balancer routing 100% of traffic back to the proven Blue stack:
```bash
# Example Kubernetes / Nginx switch
kubectl patch service fincore-api-ingress -p '{"spec":{"selector":{"version":"blue"}}}'
```

### Step 2: Compensating Financial Journal Entries
**Rule**: Never rollback the database by restoring a snapshot if transactions were processed on the new version, as doing so would cause silent loss of customer deposits or transfers!
- If an erroneous transaction was recorded, append an auditable **Compensating Journal Entry**:
```sql
-- Example compensating reversal entry
INSERT INTO ledger_entries (
    id, transaction_id, entry_type, account_type, account_id,
    amount, currency, status, description, created_at
) VALUES (
    gen_random_uuid(), $1, 'credit', 'customer_wallet', $2,
    $3, 'USD', 'posted', 'COMPENSATING ENTRY: Automated rollback reversal for tx ' || $1, NOW()
);
```

### Step 3: Secret & Token Revocation (If Security Rollback)
If rollback was triggered by compromised secrets or authentication vulnerability:
1. Rotate `JWT_SECRET` and `JWT_REFRESH_SECRET`.
2. Clear active sessions in Redis: `redis-cli FLUSHDB`.
3. Force customer re-authentication.

### Step 4: Post-Mortem & Audit Incident Log
Record the incident in `docs/FINANCIAL_CHANGE_AUDIT.md` with:
- Root cause analysis (RCA).
- Affected account IDs and ledger balance impact.
- Corrective actions and test additions.

## Verified Deployment Status

- Local Docker HTTPS and authenticated demo access verified.
- Temporary Cloudflare HTTPS demonstration completed; tunnel stopped.
- Permanent cloud hosting and trusted origin TLS remain pending.
- The demo gate must be provisioned with `scripts/setup_demo_gate.sh`; bcrypt setup is
  required before any public exposure.
- Stripe and Twilio external dispatch require evaluator-controlled sandbox credentials;
  repository fallback providers are simulations only.
- Stripe webhook verification used a locally generated signed event.
- Twilio trial accepted the notification; final delivery remains unverified.
- Previously exposed provider credentials require rotation before reuse.
- Production deployment, approval, rollback execution, monitoring and zero-downtime
  operation are not independently verified.
- Real deployment validation can be executed with `scripts/verify_staging.sh` and
  `scripts/verify_rollback.sh` when protected environment URLs and release versions
  are supplied.
