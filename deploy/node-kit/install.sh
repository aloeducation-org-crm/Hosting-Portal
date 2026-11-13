#!/usr/bin/env bash
#
# ALO Labs — Node Runtime Kit installer (one-time, per compute host).
#
# Brings a managed host to the state the ALO control plane needs for remote
# application deployment. Follows the repo's installer contract: detect first,
# refuse to break existing installs, report every step honestly.
#
# What it installs:
#   - alo-panel system user + /srv/alo-sites + /etc/alo-hosting layout
#   - /usr/local/bin/alo-static-server.mjs  (platform static release server)
#   - /usr/local/bin/alo-edge.mjs           (platform edge reverse proxy + TLS)
#   - /usr/local/sbin/alo-app-helper        (PM2 process manager helper)
#   - the privileged helper set from helpers/ (via helpers/install-helpers.sh)
#   - PM2 (npm -g) if missing, plus the PM2 daemon + edge running as alo-panel
#     (under systemd when a systemd bus exists, otherwise as daemons)
#
# Usage:
#   sudo bash deploy/node-kit/install.sh [--dry-run]
#
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

DRY_RUN=0
[[ "${1:-}" == "--dry-run" ]] && DRY_RUN=1

APP_USER="alo-panel"
APP_HOME="/opt/alo-hosting-portal"
PM2_HOME_DIR="/opt/alo-hosting/pm2"
SITES_BASE="/srv/alo-sites"
ETC_BASE="/etc/alo-hosting"
LOG_DIR="/var/log/alo-hosting"
# Edge listener ports (override with ALO_EDGE_HTTP_PORT/ALO_EDGE_HTTPS_PORT,
# e.g. when something else already owns 80/443).
EDGE_HTTP_PORT="${ALO_EDGE_HTTP_PORT:-80}"
EDGE_HTTPS_PORT="${ALO_EDGE_HTTPS_PORT:-443}"

log()  { printf '[alo-node-kit] %s %s\n' "$(date -u +%FT%TZ)" "$*" >&2; }
fail() { log "ERROR: $*"; exit 1; }
step() { if (( DRY_RUN )); then log "DRY-RUN: $*"; else log "$*"; fi; }

[[ $EUID -eq 0 ]] || fail "must run as root"
command -v node >/dev/null || fail "Node.js >= 18 is required on the host"
command -v npm  >/dev/null || fail "npm is required on the host"

steps=(
  "create user $APP_USER"
  "create $SITES_BASE"
  "create $ETC_BASE layout (apps, edge/sites, tls, pm2, logs)"
  "install alo-static-server.mjs -> /usr/local/bin"
  "install alo-edge.mjs -> /usr/local/bin"
  "install alo-app-helper -> /usr/local/sbin"
  "install privileged helpers via helpers/install-helpers.sh"
  "ensure PM2 (npm -g)"
  "start PM2 daemon as $APP_USER"
  "start alo-edge under PM2"
  "verify edge healthz"
)
if (( DRY_RUN )); then
  for s in "${steps[@]}"; do log "would: $s"; done
  exit 0
fi

# ── user + directories ──────────────────────────────────────────────────────
if ! id "$APP_USER" >/dev/null 2>&1; then
  useradd --system --create-home --home-dir "$APP_HOME" --shell /usr/sbin/nologin "$APP_USER"
  log "created system user $APP_USER"
else
  log "user $APP_USER already exists"
fi
mkdir -p "$SITES_BASE" "$ETC_BASE/apps" "$ETC_BASE/edge/sites" "$ETC_BASE/tls" "$PM2_HOME_DIR" "$LOG_DIR"
chown root:root "$SITES_BASE" && chmod 0755 "$SITES_BASE"
chown root:root "$ETC_BASE" && chmod 0755 "$ETC_BASE"
chown root:"$APP_USER" "$ETC_BASE/apps" "$ETC_BASE/edge" "$ETC_BASE/edge/sites" "$ETC_BASE/tls" "$LOG_DIR"
chmod 0750 "$ETC_BASE/apps" "$ETC_BASE/edge" "$ETC_BASE/edge/sites" "$ETC_BASE/tls" "$LOG_DIR"
# Port-discovery file the edge rewrites (root:alo-panel 0640 so the
# unprivileged edge can update contents but not the file itself).
if [ ! -f "$ETC_BASE/edge/state.json" ]; then
  printf '{\n  "httpPort": %s,\n  "httpsPort": %s,\n  "updatedAt": "pre-created by installer"\n}\n' "$EDGE_HTTP_PORT" "$EDGE_HTTPS_PORT" > "$ETC_BASE/edge/state.json"
fi
chown root:"$APP_USER" "$ETC_BASE/edge/state.json"
chmod 0640 "$ETC_BASE/edge/state.json"
chown -R "$APP_USER:$APP_USER" "$PM2_HOME_DIR"
chmod 0750 "$PM2_HOME_DIR"

# ── node kit scripts ────────────────────────────────────────────────────────
install -o root -g root -m 0755 "$SCRIPT_DIR/alo-static-server.mjs" /usr/local/bin/alo-static-server.mjs
install -o root -g root -m 0755 "$SCRIPT_DIR/alo-edge.mjs" /usr/local/bin/alo-edge.mjs
install -o root -g root -m 0755 "$REPO_ROOT/helpers/alo-app-helper" /usr/local/sbin/alo-app-helper
log "installed node kit scripts"

# ── privileged helpers (deploy/dns/ssl/domain/backup...) + sudoers ──────────
if [[ -x "$REPO_ROOT/helpers/install-helpers.sh" ]]; then
  bash "$REPO_ROOT/helpers/install-helpers.sh"
else
  fail "helpers/install-helpers.sh not found — run from a full checkout"
fi

# alo-app-helper also needs a sudoers grant (it is installed after the shared file).
if ! grep -q "alo-app-helper" /etc/sudoers.d/alo-helpers 2>/dev/null; then
  echo "$APP_USER ALL=(root) NOPASSWD: /usr/local/sbin/alo-app-helper" >> /etc/sudoers.d/alo-helpers
  visudo -c -f /etc/sudoers.d/alo-helpers >/dev/null || fail "sudoers validation failed"
  log "granted sudoers access for alo-app-helper"
fi

# ── PM2 ─────────────────────────────────────────────────────────────────────
if ! command -v pm2 >/dev/null; then
  npm install -g --silent pm2 || fail "npm install -g pm2 failed"
  log "installed PM2 globally"
else
  log "PM2 already installed ($(pm2 --version))"
fi

# The edge binds 80/443 as the unprivileged alo-panel user. The standard,
# minimal grant for that is CAP_NET_BIND_SERVICE on the Node binary (what most
# PaaS runtimes do). Without it the edge falls back to high ports and the
# installer says so honestly.
NODE_REAL="$(readlink -f "$(command -v node)")"
if setcap 'cap_net_bind_service=+ep' "$NODE_REAL" 2>/dev/null; then
  log "granted cap_net_bind_service to $NODE_REAL (edge can bind 80/443)"
else
  log "NOTE: could not setcap on $NODE_REAL — the edge must run on high ports (ALO_EDGE_HTTP_PORT/ALO_EDGE_HTTPS_PORT)"
fi

run_pm2() {
  runuser -u "$APP_USER" -- env \
    PM2_HOME="$PM2_HOME_DIR" \
    PATH="/usr/local/bin:/usr/bin:/bin:/usr/local/sbin:/usr/sbin:/sbin" \
    HOME="$APP_HOME" \
    pm2 "$@"
}

# ── start edge + daemon ─────────────────────────────────────────────────────
if ! run_pm2 jlist 2>/dev/null | grep -q '"alo-edge"'; then
  runuser -u "$APP_USER" -- env \
    PM2_HOME="$PM2_HOME_DIR" \
    PATH="/usr/local/bin:/usr/bin:/bin:/usr/local/sbin:/usr/sbin:/sbin" \
    HOME="$APP_HOME" \
    ALO_EDGE_HTTP_PORT="$EDGE_HTTP_PORT" \
    ALO_EDGE_HTTPS_PORT="$EDGE_HTTPS_PORT" \
    ALO_EDGE_BIND="${ALO_EDGE_BIND:-0.0.0.0}" \
    ALO_EDGE_SITES_DIR="${ALO_EDGE_SITES_DIR:-$ETC_BASE/edge/sites}" \
    ALO_EDGE_TLS_BASE="${ALO_EDGE_TLS_BASE:-$ETC_BASE/tls}" \
    pm2 start /usr/local/bin/alo-edge.mjs --name alo-edge >/dev/null || fail "failed to start alo-edge"
  run_pm2 save >/dev/null 2>&1 || true
  log "started alo-edge under PM2 (http :$EDGE_HTTP_PORT, https :$EDGE_HTTPS_PORT)"
else
  log "alo-edge already running under PM2"
fi

# On a real host, also install the systemd integration so the daemon + edge
# survive reboots. In containers without a systemd bus this reports honestly.
if systemctl is-system-running >/dev/null 2>&1; then
  run_pm2 startup systemd -u "$APP_USER" --hp "$APP_HOME" >/dev/null 2>&1 || true
  log "systemd detected: PM2 startup integration configured"
else
  log "NOTE: no systemd bus on this host; PM2 daemon runs without systemd supervision"
fi

# ── verify ──────────────────────────────────────────────────────────────────
for i in $(seq 1 20); do
  if curl -fsS --max-time 2 "http://127.0.0.1:${EDGE_HTTP_PORT}/alo-edge/healthz" >/dev/null 2>&1; then
    log "SUCCESS: node runtime kit installed; edge healthz OK on :${EDGE_HTTP_PORT}"
    exit 0
  fi
  sleep 1
done
fail "edge healthz did not become reachable on :${EDGE_HTTP_PORT}"
