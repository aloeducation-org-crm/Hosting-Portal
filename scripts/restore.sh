#!/usr/bin/env bash
# ALO Labs database restore — rehearse first, then promote.
#
#   ./scripts/restore.sh <backup_file> --target /tmp/drill.db    # rehearse (safe)
#   ./scripts/restore.sh <backup_file> --verify-only             # prove it is usable
#   ./scripts/restore.sh <backup_file> --yes                     # overwrite production
#
# The work is done by scripts/db-restore.mjs. It verifies the snapshot (SQLite
# header, PRAGMA integrity_check, core tables) before anything is replaced, restores
# an isolated target without further authorization, and only overwrites the live
# database with --yes — taking and verifying a fresh snapshot of the current
# database first, so a restore can never be the step that destroys the last good
# copy.
#
# Stop the panel before restoring into production:
#   pm2 stop alo-hosting-portal && ./scripts/restore.sh <file> --yes \
#     && pm2 restart alo-hosting-portal
#
# Exit codes: 0 restored, 1 restore failed, 2 refused / usage error.
set -Eeuo pipefail
umask 077

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if (($# < 1)); then
  echo "Usage: $0 <backup_file> [--target <path>] [--verify-only] [--yes] [--db <url>] [--env-file <path>] [--json]" >&2
  exit 2
fi

BACKUP_FILE="$1"
shift

exec node "${HERE}/db-restore.mjs" --from "${BACKUP_FILE}" "$@"
