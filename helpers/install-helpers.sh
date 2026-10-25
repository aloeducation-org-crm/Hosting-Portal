#!/usr/bin/env bash
# Install the privileged, allowlisted host helpers. Must run as root.
set -Eeuo pipefail
umask 077

HELPER_SRC_DIR="$(cd "$(dirname "$0")" && pwd)"
HELPER_DST_DIR="/usr/local/sbin"
SUDOERS_SRC="${HELPER_SRC_DIR}/../server-config/alo-hosting-portal.sudoers"
SUDOERS_DST="/etc/sudoers.d/alo-helpers"

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
  provision-site.sh
  ssl-lifecycle.sh
)

if [[ "$(id -u)" -ne 0 ]]; then
  echo "ERROR: This script must be run as root" >&2
  exit 1
fi

missing=()
for helper in "${HELPERS[@]}"; do
  [[ -f "${HELPER_SRC_DIR}/${helper}" ]] || missing+=("${helper}")
done
if ((${#missing[@]} > 0)); then
  printf 'ERROR: Required helper source files are missing: %s\n' "${missing[*]}" >&2
  exit 1
fi

[[ -f "$SUDOERS_SRC" ]] || { echo "ERROR: sudoers source not found: $SUDOERS_SRC" >&2; exit 1; }
command -v visudo >/dev/null || { echo "ERROR: visudo is required to validate the privileged policy" >&2; exit 69; }
visudo -c -f "$SUDOERS_SRC"

if ! id alo-panel >/dev/null 2>&1; then
  echo "Creating system user: alo-panel"
  useradd --system --create-home --home-dir /opt/alo-hosting-portal --shell /usr/sbin/nologin alo-panel
fi
APP_HOME="$(getent passwd alo-panel | cut -d: -f6)"
[[ -n "$APP_HOME" && "$APP_HOME" == /* && ! -L "$APP_HOME" ]] || { echo "ERROR: alo-panel has an invalid or symlinked home directory" >&2; exit 1; }
[[ -d "$APP_HOME" ]] || { echo "ERROR: alo-panel home directory does not exist: $APP_HOME" >&2; exit 1; }
chown root:alo-panel "$APP_HOME"
chmod 0750 "$APP_HOME"
install -d -o root -g root -m 0700 "$APP_HOME/.ssh"

install -d -o root -g root -m 0755 "$HELPER_DST_DIR"
for helper in "${HELPERS[@]}"; do
  install -o root -g root -m 0755 "${HELPER_SRC_DIR}/${helper}" "${HELPER_DST_DIR}/${helper}"
done

# Install sudoers atomically and only after validating the exact installed file.
sudoers_tmp=$(mktemp /etc/sudoers.d/.alo-helpers.XXXXXX)
cleanup() { rm -f -- "$sudoers_tmp"; }
trap cleanup EXIT
install -o root -g root -m 0440 "$SUDOERS_SRC" "$sudoers_tmp"
visudo -c -f "$sudoers_tmp"
mv -f -- "$sudoers_tmp" "$SUDOERS_DST"
trap - EXIT

printf 'Installed and validated %d host helpers in %s.\n' "${#HELPERS[@]}" "$HELPER_DST_DIR"
printf 'Validated and installed sudo policy at %s.\n' "$SUDOERS_DST"
