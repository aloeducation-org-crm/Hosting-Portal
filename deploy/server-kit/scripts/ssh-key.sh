#!/usr/bin/env bash
set -Eeuo pipefail
source "$(dirname "$0")/../lib/common.sh"
require_root
USER_HOME=$(getent passwd "$KIT_PRIMARY_USER" | cut -d: -f6)
AUTH="$USER_HOME/.ssh/authorized_keys"
install -d -m 0700 -o "$KIT_PRIMARY_USER" -g "$KIT_PRIMARY_USER" "$USER_HOME/.ssh"
touch "$AUTH"; chown "$KIT_PRIMARY_USER:$KIT_PRIMARY_USER" "$AUTH"; chmod 0600 "$AUTH"
cmd="${1:-list}"
case "$cmd" in
  add)
    key=$(cat)
    if [[ -z "$key" ]]; then die "no key on stdin"; fi
    grep -qF "$key" "$AUTH" || echo "$key" >> "$AUTH"
    log "key added"
    ;;
  list) awk '{ printf "%s %s\n", $1, substr($3,1,30) "..." $4 }' "$AUTH" | nl ;;
  remove)
    fp="${2:-}"
    [[ -n "$fp" ]] || die "usage: $0 remove <fingerprint-substring>"
    grep -vF "$fp" "$AUTH" > "${AUTH}.tmp" && mv "${AUTH}.tmp" "$AUTH"
    log "removed lines matching '$fp'"
    ;;
  *) die "usage: $0 {add|list|remove}" ;;
esac
