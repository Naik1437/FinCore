# FinCore Disaster Recovery & Production Runbook

## 1. Recovery Objectives (RTO & RPO)

In accordance with core banking regulatory benchmarks and financial resilience standards:

| Metric | Target Objective | Implementation / Mechanism |
|--------|------------------|----------------------------|
| **Recovery Point Objective (RPO)** | **$\le 5$ Minutes** | Point-in-time PostgreSQL Write-Ahead Logging (WAL) archiving paired with automated compressed `pg_dump` backups every 4 hours. Maximum acceptable transactional data loss is bounded to 5 minutes. |
| **Recovery Time Objective (RTO)** | **$< 15$ Minutes** | Containerized blue/green orchestration with automated health probing. Full database restoration into clean volume verified in $< 6$ minutes. |

---

## 2. Backup Strategy & Cryptographic Hygiene

- **Frequency**:
  - Full compressed database dump (`pg_dump | gzip`) scheduled every 4 hours.
  - Continuous WAL streaming enabled in production PostgreSQL.
- **Integrity**:
  - Every backup produces a companion `.sha256` checksum file immediately upon generation.
  - Checksums are verified before any restoration is attempted (`sha256sum -c`).
- **Retention**:
  - Automated 30-day retention policy (`scripts/backup.sh`) with automated cleanup of expired archives.
- **Zero Cost (₹0)**:
  - All backup, compression, and verification tools utilize standard open-source utilities (`pg_dump`, `gzip`, `sha256sum`, `docker`).

---

## 3. Disaster Recovery Restoration Procedure

### Rule 1: Isolation Testing Mandate
*Never execute restore scripts directly against live financial production instances without prior validation in an isolated verification database (`fincore_dr_isolated_*`).*

### Execution Steps
1. Verify checksum:
   ```bash
   sha256sum -c backups/fincore_backup_YYYYMMDD_HHMMSS.sql.gz.sha256
   ```
2. Run automated isolated verification:
   ```bash
   bash scripts/restore.sh backups/fincore_backup_YYYYMMDD_HHMMSS.sql.gz
   ```
3. The restore script automatically:
   - Provisions an isolated database.
   - Restores schema, wallets, transactions, and double-entry ledger.
   - Executes double-entry balance equilibrium checks ($\sum \text{Debit} = \sum \text{Credit}$).
   - Drops the isolated test database upon successful validation.

---

## 4. Production Security Hardening & Zero-Cost Architecture

- **TLS / HTTPS**: Nginx reverse proxy terminates TLSv1.2/TLSv1.3 with modern AEAD ciphers (`docker/nginx.conf`).
- **HTTP Security Headers**: HSTS (`max-age=31536000`), CSP, X-Frame-Options (`DENY`), X-Content-Type-Options (`nosniff`).
- **Rate Limiting**: Nginx leaky bucket zone limiting burst traffic to 50 requests/sec per IP.
- **Non-Root Execution**: API runs as `USER node` (Alpine), Analytics runs as `USER fincore` (UID 10001).
- **Environment Secrets**: Zero hardcoded secrets; injected via `.env` or CI secrets manager.

---

## 5. Mandatory External Cloud Deployment Blockers & Approvals

*FinCore is deployed in a locally validated containerized environment with zero expenditure (Budget: ₹0).*

If migrating from this zero-cost local environment to a live public cloud provider (e.g. AWS, GCP, Azure), the following external approvals and non-free prerequisites must be addressed:
1. **Domain Registration & Managed DNS**: Commercial domain name registration required for public routing.
2. **Public CA Certificates**: Automated Let's Encrypt ACME challenge requires a public domain with port 80/443 reachability.
3. **Cloud Infrastructure Billing**: Managed Kubernetes (EKS/GKE), Managed RDS PostgreSQL (Multi-AZ), and ElastiCache Redis require commercial cloud billing accounts.
4. **Compliance & Payment Gateway Approvals**: Real bank clearing rails and Stripe/Adyen live API keys require corporate banking KYC, PCI-DSS Level 1 compliance attestation, and regulatory approvals.
