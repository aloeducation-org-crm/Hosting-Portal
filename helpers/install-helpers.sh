#!/usr/bin/env bash
# ALO Labs Hosting Portal — Install Shell Helpers
# Copies all 19 helper scripts to /usr/local/sbin/ and sets permissions.
# Must be run as root.
#
set -euo pipefail

HELPER_SRC_DIR="$(cd "$(dirname "$0")" && pwd)"
HELPER_DST_DIR="/usr/local/sbin"

HELPERS=(
  alo-hosting-helper
  alo-site-lifecycle
  alo-site-backup
  alo-site-restore
  alo-database-helper
  alo-domain-helper
  alo-node-app-helper
  alo-file-manager-helper
  alo-log-helper
  alo-health-helper
  alo-firewall-helper
  alo-ssl-helper
  alo-email-helper
  alo-cron-helper
  alo-ssh-helper
  alo-encryption-helper
  alo-deploy-helper
  alo-dns-helper
  alo-docker-helper
)

if [[ "$(id -u)" -ne 0 ]]; then
  echo "ERROR: This script must be run as root" >&2
  exit 1
fi

echo "Installing ALO Labs shell helpers to ${HELPER_DST_DIR}..."

# Ensure alo-panel user exists
if ! id alo-panel &>/dev/null; then
  echo "Creating system user: alo-panel"
  useradd -r -s /bin/bash -d /opt/alo-hosting-portal -m alo-panel
fi

installed=0
skipped=0

for helper in "${HELPERS[@]}"; do
  src="${HELPER_SRC_DIR}/${helper}"
  dst="${HELPER_DST_DIR}/${helper}"

  if [[ ! -f "$src" ]]; then
    echo "  SKIP: ${helper} (source not found)"
    skipped=$((skipped + 1))
    continue
  fi

  cp "$src" "$dst"
  chmod 755 "$dst"
  echo "  OK: ${helper}"
  installed=$((installed + 1))
done

echo ""
echo "Installed: ${installed} helpers"
echo "Skipped:  ${skipped} helpers"

# Install sudoers
if [[ -f "${HELPER_SRC_DIR}/../server-config/alo-hosting-portal.sudoers" ]]; then
  cp "${HELPER_SRC_DIR}/../server-config/alo-hosting-portal.sudoers" /etc/sudoers.d/alo-helpers
  chmod 440 /etc/sudoers.d/alo-helpers
  echo "Sudoers policy installed to /etc/sudoers.d/alo-helpers"
fi

echo "Done."
