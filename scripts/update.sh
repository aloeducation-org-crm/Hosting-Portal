#!/usr/bin/env bash
set -Eeuo pipefail

APP_DIR="/opt/application"
RELEASES_DIR="${APP_DIR}/releases"
SHARED_DIR="${APP_DIR}/shared"
HEALTH_URL="http://127.0.0.1:3101/api/health"

RED='\033[0;31m'; GRN='\033[0;32m'; NC='\033[0m'
info() { printf "${GRN}[update]${NC} %s\n" "$*"; }
die()  { printf "${RED}[update]${NC} FATAL: %s\n" "$*"; }

[[ $EUID -eq 0 ]] || die "Must run as root"
[[ $# -ge 1 ]] || die "Usage: update.sh <tarball-path-or-version>"

TARBALL="$1"
[[ -f "$TARBALL" ]] || TARBALL="${SHARED_DIR}/releases/${TARBALL}.tar.gz"
[[ -f "$TARBALL" ]] || die "Tarball not found: $TARBALL"

RELEASE_NAME=$(date +%Y%m%d%H%M%S)
RELEASE_DIR="${RELEASES_DIR}/${RELEASE_NAME}"
mkdir -p "$RELEASE_DIR"

info "Extracting release to ${RELEASE_DIR}..."
tar xzf "$TARBALL" -C "$RELEASE_DIR"
ln -sf "${SHARED_DIR}/.env" "${RELEASE_DIR}/.env"

info "Building..."
cd "$RELEASE_DIR"
npm ci --omit=dev 2>&1 | tail -3
npx prisma generate 2>&1 | tail -1
npx prisma migrate deploy 2>&1 | tail -1
npm run build 2>&1 | tail -3

PREV=$(readlink -f "${APP_DIR}/current" 2>/dev/null || echo "")

info "Activating release..."
ln -sfn "${RELEASE_DIR}" "${APP_DIR}/current"
systemctl restart alo-hosting-portal

info "Waiting for health check..."
sleep 3
HTTP_CODE=$(curl -s -o /dev/null -w '%{http_code}' "$HEALTH_URL" 2>/dev/null || echo "000")

if [[ "$HTTP_CODE" == "200" ]]; then
  info "Update successful"
  # Keep last 3 releases
  cd "$RELEASES_DIR" && ls -dt */ | tail -n +4 | xargs -r rm -rf
  printf '{"success":true,"step":"update","release":"%s"}\n' "$RELEASE_NAME"
else
  warn "Health check failed (HTTP $HTTP_CODE), rolling back..."
  if [[ -n "$PREV" && -d "$PREV" ]]; then
    ln -sfn "$PREV" "${APP_DIR}/current"
    systemctl restart alo-hosting-portal
  fi
  printf '{"success":false,"step":"update","error":"Health check failed, rolled back"}\n'
  exit 1
fi
