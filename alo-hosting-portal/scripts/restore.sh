#!/bin/bash
# ALO Labs Database Restore Script
# Usage: ./scripts/restore.sh <backup_file.sql>

set -euo pipefail

if [ $# -lt 1 ]; then
    echo "Usage: $0 <backup_file.sql>"
    exit 1
fi

BACKUP_FILE="$1"

if [ ! -f "${BACKUP_FILE}" ]; then
    echo "ERROR: Backup file not found: ${BACKUP_FILE}"
    exit 1
fi

if [ -z "${DATABASE_URL:-}" ]; then
    echo "ERROR: DATABASE_URL environment variable is not set"
    exit 1
fi

read -p "WARNING: This will overwrite the current database. Continue? (yes/no) " CONFIRM
if [ "${CONFIRM}" != "yes" ]; then
    echo "Restore cancelled."
    exit 0
fi

echo "Starting database restore..."
psql "${DATABASE_URL}" < "${BACKUP_FILE}"

if [ $? -eq 0 ]; then
    echo "Restore completed successfully from: ${BACKUP_FILE}"
else
    echo "ERROR: Restore failed"
    exit 1
fi
