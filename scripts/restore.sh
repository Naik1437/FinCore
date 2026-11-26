#!/usr/bin/env bash
# ==============================================================================
# FinCore Disaster Recovery & Restoration Verification Script
# Restores a backup file strictly into an ISOLATED verification database.
# NEVER overwrites the live production/testing fincore database.
# ==============================================================================
set -euo pipefail

BACKUP_FILE="${1:-}"
DB_CONTAINER="${DB_CONTAINER:-fincore-postgres}"
DB_USER="${DB_USER:-fincore}"
ISOLATED_TEST_DB="fincore_dr_isolated_$(date +"%s")"

if [[ -z "${BACKUP_FILE}" || ! -f "${BACKUP_FILE}" ]]; then
  echo "Error: Backup file must be provided and exist."
  echo "Usage: ./restore.sh <path_to_backup.sql.gz>"
  exit 1
fi

echo "Verifying SHA256 checksum if available..."
if [[ -f "${BACKUP_FILE}.sha256" ]]; then
  sha256sum -c "${BACKUP_FILE}.sha256"
  echo "SHA256 checksum integrity: VERIFIED"
fi

if [[ -z "${BACKUP_ENCRYPTION_KEY:-}" ]]; then
  echo "Error: BACKUP_ENCRYPTION_KEY is required for encrypted backups." >&2
  exit 1
fi

echo "Creating isolated test database for restoration verification: ${ISOLATED_TEST_DB}..."
docker exec -e PGPASSWORD="${POSTGRES_PASSWORD:-postgres}" "${DB_CONTAINER}" \
  psql -U "${DB_USER}" -c "CREATE DATABASE ${ISOLATED_TEST_DB};"

cleanup() {
  echo "Tearing down isolated test database: ${ISOLATED_TEST_DB}..."
  docker exec -e PGPASSWORD="${POSTGRES_PASSWORD:-postgres}" "${DB_CONTAINER}" \
    psql -U "${DB_USER}" -c "DROP DATABASE IF EXISTS ${ISOLATED_TEST_DB};"
}
trap cleanup EXIT

echo "Restoring data into isolated test database: ${ISOLATED_TEST_DB}..."
openssl enc -d -aes-256-cbc -pbkdf2 -in "${BACKUP_FILE}" -pass env:BACKUP_ENCRYPTION_KEY | gunzip | docker exec -i -e PGPASSWORD="${POSTGRES_PASSWORD:-postgres}" "${DB_CONTAINER}" \
  psql -U "${DB_USER}" -d "${ISOLATED_TEST_DB}" -v ON_ERROR_STOP=1 -q

echo "Validating financial double-entry integrity on restored isolated database..."
UNBALANCED_COUNT=$(docker exec -e PGPASSWORD="${POSTGRES_PASSWORD:-postgres}" "${DB_CONTAINER}" \
  psql -U "${DB_USER}" -d "${ISOLATED_TEST_DB}" -v ON_ERROR_STOP=1 -t -A -c "
    SELECT COUNT(*) FROM (
      SELECT transaction_id, currency 
      FROM ledger_entries 
      GROUP BY transaction_id, currency 
      HAVING SUM(CASE WHEN entry_type = 'debit' THEN amount ELSE 0 END) != SUM(CASE WHEN entry_type = 'credit' THEN amount ELSE 0 END)
    ) unbal;
  ")

echo "Restored Ledger Audit: Unbalanced Transactions = ${UNBALANCED_COUNT}"
if [[ "${UNBALANCED_COUNT}" -eq 0 ]]; then
  echo "Disaster recovery restoration verification: SUCCESSFUL (Zero ledger discrepancies)"
else
  echo "CRITICAL FAILURE: Restored ledger contains unbalanced entries!"
  exit 1
fi
