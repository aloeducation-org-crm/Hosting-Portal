#!/usr/bin/env bash
set -Eeuo pipefail
source "$(dirname "$0")/../lib/common.sh"
require_root
MODE="${1:-}"; FILE="${2:-}"
[[ -n "$MODE" && -n "$FILE" ]] || { cat <<EOF
Usage:
  sudo $0 configs <configs-tarball>
  sudo $0 db <db-tarball>
EOF
exit 1; }
[[ -f "$FILE" ]] || die "file not found: $FILE"
case "$MODE" in
  configs)
    log "restoring configs from $FILE"
    tar -xzf "$FILE" -C /
    systemctl reload nginx || true
    systemctl reload postgresql || true
    systemctl reload mysql || true
    systemctl restart fail2ban
    log "configs restored"
    ;;
  db)
    log "restoring DB from $FILE"
    case "$FILE" in
      *pg-all-*) sudo -u postgres psql -tAc "SELECT 1" >/dev/null 2>&1 && gunzip -c "$FILE" | sudo -u postgres psql || die "postgres not accessible" ;;
      *mysql-all-*) gunzip -c "$FILE" | mysql ;;
      *) die "unrecognised DB backup name: $FILE" ;;
    esac
    log "DB restored"
    ;;
  *) die "unknown mode: $MODE (use 'configs' or 'db')" ;;
esac
