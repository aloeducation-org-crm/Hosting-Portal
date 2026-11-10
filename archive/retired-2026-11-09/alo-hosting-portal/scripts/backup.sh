#!/bin/bash
# ALO Labs Database Backup Script
# Usage: ./scripts/backup.sh [output_dir]

set -euo pipefail

OUTPUT_DIR="${1:-./backups}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
FILENAME="alolabs_backup_${TIMESTAMP}.sql"
OUTPUT_PATH="${OUTPUT_DIR}/${FILENAME}"

mkdir -p "${OUTPUT_DIR}"

if [ -z "${DATABASE_URL:-}" ]; then
    echo "ERROR: DATABASE_URL environment variable is not set"
    exit 1
fi

echo "Starting database backup..."
pg_dump "${DATABASE_URL}" > "${OUTPUT_PATH}"

if [ $? -eq 0 ]; then
    SIZE=$(du -h "${OUTPUT_PATH}" | cut -f1)
    echo "Backup completed: ${OUTPUT_PATH} (${SIZE})"
else
    echo "ERROR: Backup failed"
    rm -f "${OUTPUT_PATH}"
    exit 1
fi
