#!/usr/bin/env bash
# ALO Labs database backup.
#
#   ./scripts/backup.sh [output_dir] [extra args for db-backup.mjs]
#
# The work is done by scripts/db-backup.mjs, which takes a *consistent* snapshot of
# the engine in use and verifies it before reporting success:
#
#   SQLite (the shipped deployment)  VACUUM INTO → PRAGMA integrity_check
#                                    → core-table presence → sha256 metadata
#   PostgreSQL                       pg_dump → non-empty file → sha256 metadata
#
# This replaces a `pg_dump "$DATABASE_URL"` one-liner that could only fail against
# the configured `file:/…/hosting.db` database, and a deployment path that copied a
# live SQLite file without checking that the copy was recoverable.
#
# Exit codes: 0 verified backup, 1 backup/verification failed, 2 configuration error.
set -Eeuo pipefail
umask 077

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# First positional argument is the output directory (the historical interface),
# unless it is a flag, so `backup.sh --verify <file>` keeps working too.
OUT_DIR="${ALO_BACKUP_DIR:-./backups}"
if (($# > 0)) && [[ "${1}" != --* ]]; then
  OUT_DIR="$1"
  shift
fi

exec node "${HERE}/db-backup.mjs" --out "${OUT_DIR}" "$@"
