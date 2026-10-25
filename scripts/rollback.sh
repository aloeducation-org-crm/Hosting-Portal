#!/usr/bin/env bash
set -Eeuo pipefail

APP_DIR="/opt/application"
RELEASES_DIR="${APP_DIR}/releases"
HEALTH_URL="http://127.0.0.1:3101/api/health"

RED='\033[0;31m'; GRN='\033[0;32m'; NC='\033[0m'
info() { printf "${GRN}[rollback]${NC} %s\n" "$*"; }
die()  { printf "${RED}[rollback]${NC} FATAL: %s\n" "$*"; }

[[ $EUID -eq 0 ]] || die "Must run as root"

CURRENT=$(readlink -f "${APP_DIR}/current")
PREV=$(ls -dt "${RELEASES_DIR}"/*/ 2>/dev/null | grep -v "^${CURRENT}" | head -1)

[[ -n "$PREV" && -d "$PREV" ]] || die "No previous release to roll back to"

info "Current: $CURRENT"
info "Rolling back to: $PREV"

ln -sfn "$PREV" "${APP_DIR}/current"
systemctl restart alo-hosting-portal
sleep 3

HTTP_CODE=$(curl -s -o /dev/null -w '%{http_code}' "$HEALTH_URL" 2>/dev/null || echo "000")
if [[ "$HTTP_CODE" == "200" ]]; then
  info "Rollback successful"
  printf '{"success":true,"step":"rollback","release":"%s"}\n' "$(basename $PREV)"
else
  die "Rollback health check failed"
fi
