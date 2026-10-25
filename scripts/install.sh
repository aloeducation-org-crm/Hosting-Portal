#!/usr/bin/env bash
set -Eeuo pipefail

APP_DIR="/opt/application"
RELEASES_DIR="${APP_DIR}/releases"
SHARED_DIR="${APP_DIR}/shared"
SITE_BASE="/srv/alo-sites"
BACKUP_BASE="/var/backups/alo-sites"
CADDY_SITES="/etc/caddy/sites-enabled"
CADDY_LOGS="/var/log/caddy/alo-sites"
HELPER_SRC="./helpers"
SUDO_POLICY_SRC="./server-config/sudo-policy"
SYSTEMD_SRC="./server-config/application.service"

RED='\033[0;31m'; GRN='\033[0;32m'; YLW='\033[1;33m'; NC='\033[0m'
info()  { printf "${GRN}[install]${NC} %s\n" "$*"; }
warn()  { printf "${YLW}[install]${NC} WARN: %s\n" "$*"; }
die()   { printf "${RED}[install]${NC} FATAL: %s\n" "$*"; exit 1; }

[[ $EUID -eq 0 ]] || die "Must run as root"

info "Creating directories..."
mkdir -p "${RELEASES_DIR}" "${SHARED_DIR}" "${SITE_BASE}" "${BACKUP_BASE}" "${CADDY_SITES}" "${CADDY_LOGS}"

info "Installing helper scripts to /usr/local/sbin/..."
for h in "${HELPER_SRC}"/*; do
  [[ -f "$h" ]] || continue
  bn=$(basename "$h")
  cp "$h" "/usr/local/sbin/${bn}"
  chmod 0755 "/usr/local/sbin/${bn}"
  chown root:root "/usr/local/sbin/${bn}"
  info "  Installed ${bn}"
done

info "Installing sudo policy..."
cp "$SUDO_POLICY_SRC" /etc/sudoers.d/alo-hosting-portal
chmod 0440 /etc/sudoers.d/alo-hosting-portal
visudo -cf /etc/sudoers.d/alo-hosting-portal || die "sudo policy validation failed"
info "  Sudo policy validated"

info "Installing systemd unit..."
cp "$SYSTEMD_SRC" /etc/systemd/system/alo-hosting-portal.service
systemctl daemon-reload
systemctl enable alo-hosting-portal
info "  Service enabled"

if [[ ! -f "${SHARED_DIR}/.env" ]] && [[ -f ".env.example" ]]; then
  cp .env.example "${SHARED_DIR}/.env"
  chown aloedu:aloedu "${SHARED_DIR}/.env"
  chmod 0600 "${SHARED_DIR}/.env"
  warn "Copied .env.example to ${SHARED_DIR}/.env — EDIT WITH REAL SECRETS"
fi

info "Running database migrations..."
cd "${APP_DIR}/current" 2>/dev/null || cd /opt/application/current
npx prisma generate 2>&1 | tail -1
npx prisma migrate deploy 2>&1 | tail -1

info "Installation complete."
info "Next: sudo systemctl start alo-hosting-portal"
printf '{"success":true,"step":"install","message":"Installation complete"}\n'
