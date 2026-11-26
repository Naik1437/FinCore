# FinCore Financial Change Audit & Compliance Runbook

## 1. Core Principles of Financial Change Governance

1. **Double-Entry Immutability**:
   - The double-entry ledger is an append-only system of record.
   - Database records in `ledger_entries` and `financial_transactions` must never be altered with `UPDATE` or purged with `DELETE`.
   - Any financial discrepancy must be resolved through an auditable compensating entry (credit reversal or debit adjustment) accompanied by an audit reason.

2. **Concurrency & Race-Condition Defense**:
   - Every financial state transition altering account balances or holds must obtain deterministic row-level locks (`SELECT ... FOR UPDATE`) ordered lexicographically by wallet UUID to prevent deadlocks.
   - Distributed in-flight locks (Redis `SET NX EX`) must guard against rapid double-clicks and burst submissions.

3. **Object-Level Authorization & RBAC**:
   - Customer-owned resources (wallets, statements, transfers) must explicitly check `wallet.user_id === req.user.id`.
   - Administrative overrides (hold release, dispute settlement, audit logs) require specific roles (`Operations Analyst`, `Finance Administrator`, `Platform Administrator`).

4. **Synthetic Data Mandate**:
   - Real bank accounts, card numbers, or production customer PII must never be stored in test fixtures, seeds, or repository files.

---

## 2. Remote GitHub Actions & Repository Configuration Guide

*Note: In accordance with execution rules, no remote repository or branch was modified during local assessment execution. The following configuration must be verified upon pushing to remote GitHub.*

### A. Branch Protection Rules on `main` / `master`
1. Go to **Settings** > **Branches** > **Add branch protection rule**.
2. Branch name pattern: `main` (or `master`).
3. Enable:
   - [x] **Require a pull request before merging**.
   - [x] **Require approvals**: Minimum 2 approvals (Financial Engineer & Security Lead).
   - [x] **Dismiss stale pull request approvals when new commits are pushed**.
   - [x] **Require status checks to pass before merging**:
     - `test-api`
     - `test-analytics`
     - `test-web`
     - `validate-governance`
   - [x] **Require branches to be up to date before merging**.
   - [x] **Require signed commits**.
   - [x] **Include administrators** (enforce policy on all contributors).

### B. Secret Scanning & Dependabot
1. Under **Settings** > **Code security and analysis**:
   - Enable **Secret scanning** and **Push protection**.
   - Enable **Dependabot alerts** and **Dependabot security updates**.

### C. CODEOWNERS Enforcement
- Enable **Require review from Code Owners** under branch protection rules to automatically request reviews based on `.github/CODEOWNERS`.
