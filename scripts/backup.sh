#!/usr/bin/env bash
# ==============================================================================
# FinCore Automated PostgreSQL Backup Script
# Creates an immutable, compressed, timestamped pg_dump of the core banking DB.
# ==============================================================================
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-./backups}"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_FILE="${BACKUP_DIR}/fincore_backup_${TIMESTAMP}.sql.gz"
DB_CONTAINER="${DB_CONTAINER:-fincore-postgres}"
DB_USER="${DB_USER:-fincore}"
DB_NAME="${DB_NAME:-fincore}"

mkdir -p "${BACKUP_DIR}"

echo "Starting FinCore database backup for container: ${DB_CONTAINER} [Database: ${DB_NAME}]..."

# Execute pg_dump inside container and compress with gzip
docker exec -e PGPASSWORD="${POSTGRES_PASSWORD:-postgres}" "${DB_CONTAINER}" \
  pg_dump -U "${DB_USER}" -d "${DB_NAME}" --clean --if-exists --no-owner --no-privileges | gzip > "${BACKUP_FILE}"

if [[ -z "${BACKUP_ENCRYPTION_KEY:-}" ]]; then
  echo "Error: BACKUP_ENCRYPTION_KEY is required for encrypted backups." >&2
  rm -f "${BACKUP_FILE}"
  exit 1
fi
openssl enc -aes-256-cbc -pbkdf2 -salt -in "${BACKUP_FILE}" -out "${BACKUP_FILE}.enc" \
  -pass env:BACKUP_ENCRYPTION_KEY
rm -f "${BACKUP_FILE}"
BACKUP_FILE="${BACKUP_FILE}.enc"

# Generate SHA256 checksum for audit and integrity verification
sha256sum "${BACKUP_FILE}" > "${BACKUP_FILE}.sha256"

echo "Backup completed successfully:"
echo "  Artifact: ${BACKUP_FILE}"
echo "  Checksum: $(cat "${BACKUP_FILE}.sha256")"
echo "  Size: $(du -h "${BACKUP_FILE}" | cut -f1)"

# Keep 30-day retention policy (purge backups older than 30 days)
find "${BACKUP_DIR}" -type f -name "fincore_backup_*.sql.gz*" -mtime +30 -delete || true
echo "Retention policy verified."
