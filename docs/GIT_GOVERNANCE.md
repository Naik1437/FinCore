# FinCore Git Branching, Release & Change Governance Strategy

## 1. Branch Topology & Trunk-Based Governance

FinCore adheres to a disciplined financial engineering branching model with strict branch protection:

```
[production / main]  <--- Tagged Releases (e.g. v1.0.0, v1.0.1)
        ^
        | (Release PR with dual-auditor approval)
  [staging / uat]    <--- Pre-production integration & reconciliation tests
        ^
        | (Squash & Merge PR with passing CI)
   [feat/*, fix/*]   <--- Ephemeral short-lived branches
```

### Branch Naming Conventions
All branch names must strictly match domain-scoped prefixes:
- `feat/assessment-[01-10]-[short-name]` — Assessment milestones (e.g. `feat/assessment-10-git-governance`)
- `feat/[domain]-[description]` — Domain features (e.g. `feat/ledger-reconciliation`, `feat/transfer-engine`)
- `fix/[domain]-[bug-description]` — Bugfixes (e.g. `fix/auth-token-rotation`, `fix/rounding-precision`)
- `sec/[cve-or-audit-ref]` — Security patches (e.g. `sec/timing-attack-protection`)
- `release/v[major].[minor].[patch]` — Release stabilization candidate branches

---

## 2. Conventional Commit Specification

FinCore enforces [Conventional Commits v1.0.0](https://www.conventionalcommits.org/) standards. Commit messages must follow this structure:

```
<type>(<scope>): <short imperative description>

[optional body explaining financial reasoning, regulatory compliance, or audit trail]

[optional footer(s): Assessment ref, Breaking Changes, Closes #issue]
```

### Allowed Types
| Type | Financial Purpose | Example |
|------|-------------------|---------|
| `feat` | New capability or financial API endpoint | `feat(ledger): add multi-currency hold reservation` |
| `fix` | Correcting a calculation, concurrency, or API bug | `fix(transfer): prevent race condition with FOR UPDATE` |
| `sec` | Security, identity, RBAC or vulnerability remediation | `sec(auth): implement argon2/bcrypt password hashing` |
| `audit` | Financial reconciliation, audit logging, or compliance checks | `audit(reconciliation): record compensating journal entry` |
| `perf` | Concurrency, indexing, or throughput optimization | `perf(database): add composite index on wallet_id and created_at` |
| `docs` | Progress tracking, architectural decision records (ADR) | `docs(governance): add branch protection and release guide` |
| `test` | Automated test suites or edge case assertions | `test(consistency): add concurrent idempotency tests` |
| `ci` | Docker, GitHub Actions, container orchestration | `ci(docker): add multi-stage container build checks` |
| `refactor` | Code restructuring without financial logic mutation | `refactor(analytics): modularize risk rule evaluation` |

### Scopes
`ledger`, `transfer`, `wallet`, `auth`, `payment`, `webhook`, `analytics`, `docker`, `api`, `web`, `shared`.

---

## 3. Financial Change Governance & Dual-Approval Rules

Any modification to financial code must comply with financial engineering safeguards:

### Dual-Signoff Requirement
1. **Financial Systems Lead**: Signs off on ledger balance immutability, double-entry equality ($\sum \text{Debits} = \sum \text{Credits}$), and concurrency lock safety.
2. **Security & Compliance Officer**: Signs off on role-based authorization, rate-limiting, secret management, and webhook replay protection.

### Mandatory CI Checks Before Merge
- **Lint & Typecheck**: Zero TypeScript / Python type errors.
- **Automated Test Matrix**: 100% pass across all unit, integration, and concurrency suites.
- **Secret Scanning**: Zero unmasked secrets, private keys, or `.env` files.
- **Zero Ledger Discrepancies**: Reconciliation script passes cleanly.

---

## 4. Release Management & SemVer

FinCore uses Semantic Versioning (`MAJOR.MINOR.PATCH`):
- `MAJOR` (vX.0.0): Breaking API contract changes or core banking schema transitions.
- `MINOR` (v1.X.0): New backward-compatible financial capabilities (e.g., adding a payment provider adapter).
- `PATCH` (v1.0.X): Non-breaking bugfixes, security patches, or reconciliation adjustments.

### Tagging Procedure
```bash
git tag -a v1.0.0 -m "Release v1.0.0: FinCore Production Ready Financial Stack (Assessments 01-10)"
```
