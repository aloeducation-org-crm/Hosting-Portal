#!/usr/bin/env bash
# lib/common.sh — shared helpers used by every stage script.
set -Eeuo pipefail

KIT_ROOT="${KIT_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
CONFIG_FILE="${CONFIG_FILE:-$KIT_ROOT/config.env}"
STATE_DIR="${STATE_DIR:-$KIT_ROOT/run-state}"
LOG_DIR="${LOG_DIR:-$KIT_ROOT/logs}"
mkdir -p "$STATE_DIR" "$LOG_DIR"

load_config() {
  if [[ ! -f "$CONFIG_FILE" ]]; then
    echo "[common] FATAL: $CONFIG_FILE not found. Copy config.env.example -> config.env first." >&2
    exit 2
  fi
  set -a; source "$CONFIG_FILE"; set +a
  : "${KIT_HOSTNAME:=alo-server-lap}"
  : "${KIT_PRIMARY_USER:=alamin}"
  : "${KIT_TIMEZONE:=Asia/Dhaka}"
  : "${KIT_LAN_CIDR:=192.168.0.0/24}"
  : "${KIT_TAILSCALE_IF:=tailscale0}"
  : "${KIT_SSH_PORT:=2244}"
  : "${KIT_DOMAIN:=alo.example.com}"
  : "${KIT_ADMIN_EMAIL:=alamin@example.com}"
  : "${KIT_NGINX_WEBROOT:=/var/www/html}"
  : "${KIT_NODE_LTS:=lts/iron}"
  : "${KIT_PM2_INSTANCES:=2}"
  : "${KIT_APP_DIR:=/srv/alo-app}"
  : "${KIT_PG_VERSION:=14}"
  : "${KIT_PG_APP_USER:=alo_app}"
  : "${KIT_PG_APP_DB:=alo_db}"
  : "${KIT_MYSQL_APP_USER:=alo_app}"
  : "${KIT_MYSQL_APP_DB:=alo_db}"
  : "${KIT_OLLAMA_PORT:=11434}"
  : "${KIT_OLLAMA_MODELS:=qwen2.5:7b llama3.1:8b codellama:7b}"
  : "${KIT_OLLAMA_MEM_MAX:=8G}"
  : "${KIT_LITELLM_PORT:=4000}"
  : "${KIT_LITELLM_MASTER_KEY:=sk-alolitellm-CHANGE-ME-32-chars-minimum}"
  : "${KIT_LITELLM_SALT_KEY:=sk-alolitellm-salt-CHANGE-ME-too}"
  : "${KIT_GEMINI_API_KEY:=}"
  : "${KIT_GROQ_API_KEY:=}"
  : "${KIT_GLM_API_KEY:=}"
  : "${KIT_GLM_BASE_URL:=https://api.z.ai/api/paas/v4}"
  : "${KIT_CLOUDFLARE_AI_ACCOUNT_ID:=}"
  : "${KIT_CLOUDFLARE_AI_API_TOKEN:=}"
  : "${KIT_OPENWEBUI_PORT:=3001}"
  : "${KIT_TELEGRAM_BOT_TOKEN:=}"
  : "${KIT_TELEGRAM_CHAT_ID:=}"
  : "${KIT_NETDATA_PORT:=19999}"
  : "${KIT_SAMBA_USER:=alamin}"
  : "${KIT_SYNCTHING_PORT:=8384}"
}

_log() { printf '%s [%-5s] %s\n' "$(date +'%F %T')" "$1" "$2"; }
log()  { _log "INFO"  "$*"; }
warn() { _log "WARN"  "$*" >&2; }
err()  { _log "ERROR" "$*" >&2; }
die()  { err "$*"; exit 1; }

require_root() { [[ $EUID -eq 0 ]] || die "Run as root (or via sudo)."; }
require_user() { [[ $EUID -ne 0 ]] || die "Do NOT run this as root."; }
as_user()      { local u="${1:-$KIT_PRIMARY_USER}"; sudo -u "$u" "${@:2}"; }

pkg_installed() { dpkg -s "$1" &>/dev/null; }
ensure_pkg() {
  local p
  for p in "$@"; do
    if ! pkg_installed "$p"; then
      log "installing package: $p"
      DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends "$p" >/dev/null
    fi
  done
}

write_file() {
  local path="$1" owner="$2" mode="$3"; shift 3
  install -d -m 0755 "$(dirname "$path")"
  cat >"$path"
  chown "$owner" "$path"
  chmod "$mode" "$path"
}

backup_file() {
  local f="$1"
  [[ -f "$f" ]] || return 0
  if [[ ! -f "${f}.alo-orig" ]]; then
    cp -a "$f" "${f}.alo-orig"
    log "backed up original: $f -> ${f}.alo-orig"
  fi
}

state_done()  { [[ -f "$STATE_DIR/$1.done" ]]; }
mark_done()   { touch "$STATE_DIR/$1.done"; }
reset_state() { rm -f "$STATE_DIR/"*.done; log "state reset"; }

send_telegram() {
  local msg="$1"
  [[ -n "${KIT_TELEGRAM_BOT_TOKEN:-}" && -n "${KIT_TELEGRAM_CHAT_ID:-}" ]] || return 0
  curl -sS -X POST "https://api.telegram.org/bot${KIT_TELEGRAM_BOT_TOKEN}/sendMessage" \
    -d chat_id="$KIT_TELEGRAM_CHAT_ID" -d text="$msg" -d parse_mode=Markdown >/dev/null 2>&1 || true
}

lan_ip_cidr()    { echo "${KIT_LAN_CIDR}"; }
tailscale_if()   { echo "${KIT_TAILSCALE_IF}"; }
is_interface_up(){ ip link show "${1:-}" 2>/dev/null | grep -q 'state UP'; }

load_config
