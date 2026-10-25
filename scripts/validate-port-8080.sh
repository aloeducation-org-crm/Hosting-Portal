#!/usr/bin/env bash
# Read-only health/RSS validator. Run as root from systemd timer/service for
# optional recovery. It never changes process memory allocation or system limits.
set -Eeuo pipefail
umask 077
PORT="${PORT:-8080}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:${PORT}/api/health}"
SERVICE="${SERVICE:-alo-hosting-panel}"
MAX_RSS_MB="${MAX_RSS_MB:-1536}"
MAX_LOAD_PER_CPU="${MAX_LOAD_PER_CPU:-2.0}"
COOLDOWN_SECONDS="${RESTART_COOLDOWN_SECONDS:-300}"
CHECK_ONLY="${CHECK_ONLY:-0}"
STATE_DIR="${STATE_DIR:-$([[ $EUID -eq 0 ]] && echo /run/alo-hosting-monitor || echo "${TMPDIR:-/tmp}/alo-hosting-monitor-${EUID}")}"
LOCK_FILE="$STATE_DIR/validator.lock"
[[ $EUID -eq 0 || "$CHECK_ONLY" == 1 ]] || { echo "run as root, or set CHECK_ONLY=1 for non-privileged validation" >&2; exit 77; }
[[ "$PORT" =~ ^[0-9]{1,5}$ ]] && (( PORT > 0 && PORT <= 65535 )) || { echo "invalid PORT" >&2; exit 64; }
[[ "$MAX_RSS_MB" =~ ^[0-9]+$ ]] && (( MAX_RSS_MB > 0 )) || { echo "invalid MAX_RSS_MB" >&2; exit 64; }
[[ "$MAX_LOAD_PER_CPU" =~ ^[0-9]+([.][0-9]+)?$ ]] || { echo "invalid MAX_LOAD_PER_CPU" >&2; exit 64; }
command -v curl >/dev/null && command -v systemctl >/dev/null && command -v ss >/dev/null || { echo "curl, systemctl, and ss are required" >&2; exit 69; }
install -d -m 0700 "$STATE_DIR"
exec 9>"$LOCK_FILE"
flock -n 9 || exit 0
log() { printf '[alo-port-validator] %s %s\n' "$(date -u +%FT%TZ)" "$*"; }

failure=""
if ! ss -H -ltn sport = ":$PORT" | grep -qE "[:.]${PORT}[[:space:]]"; then
  failure="no listener on tcp/$PORT"
elif ! curl --fail --silent --show-error --max-time 5 "$HEALTH_URL" >/dev/null 2>&1; then
  failure="health endpoint failed: $HEALTH_URL"
fi

main_pid=$(systemctl show "$SERVICE" --property=MainPID --value 2>/dev/null || echo 0)
if [[ "$CHECK_ONLY" == 1 && ! "$main_pid" =~ ^[1-9][0-9]*$ ]]; then
  # In sandbox/read-only audits, systemd may be unavailable. Inspect the
  # process bound to the configured port without requiring service privileges.
  main_pid=$(ss -H -ltnp "sport = :$PORT" 2>/dev/null | sed -n 's/.*pid=\([0-9][0-9]*\).*/\1/p' | head -n 1)
  main_pid="${main_pid:-0}"
fi
if [[ "$main_pid" =~ ^[1-9][0-9]*$ && -r "/proc/$main_pid/status" ]]; then
  rss_kb=$(awk '/^VmRSS:/ {print $2}' "/proc/$main_pid/status")
  rss_mb=$(( ${rss_kb:-0} / 1024 ))
  if (( rss_mb > MAX_RSS_MB )); then
    failure="RSS threshold exceeded: ${rss_mb}MiB > ${MAX_RSS_MB}MiB"
  fi
else
  if [[ "$CHECK_ONLY" != 1 ]]; then
    [[ -n "$failure" ]] || failure="systemd service $SERVICE has no live MainPID"
  fi
fi

load_avg=$(awk '{print $1}' /proc/loadavg 2>/dev/null || echo 0)
cpu_count=$(getconf _NPROCESSORS_ONLN 2>/dev/null || echo 1)
if awk -v load="$load_avg" -v cpus="$cpu_count" -v limit="$MAX_LOAD_PER_CPU" 'BEGIN {exit !(load > cpus * limit)}'; then
  log "CAPACITY_ALERT load_1m=$load_avg cpu_count=$cpu_count threshold_per_cpu=$MAX_LOAD_PER_CPU; investigate workload or scale infrastructure"
  capacity_alert=1
else
  capacity_alert=0
fi

if [[ -z "$failure" ]]; then
  log "PASS port=$PORT service=$SERVICE pid=$main_pid rss=${rss_mb:-unknown}MiB"
  (( capacity_alert == 0 )) || exit 1
  exit 0
fi
log "DEGRADED $failure"
if [[ "$CHECK_ONLY" == 1 ]]; then
  log "CHECK_ONLY: no restart attempted; root/systemd recovery is required"
  exit 1
fi
now=$(date +%s)
last=0
[[ -r "$STATE_DIR/last-restart" ]] && read -r last <"$STATE_DIR/last-restart" || true
if (( now - last < COOLDOWN_SECONDS )); then
  log "restart suppressed by ${COOLDOWN_SECONDS}s cooldown; systemd restart policy remains active"
  exit 1
fi
printf '%s\n' "$now" >"$STATE_DIR/last-restart"
if systemctl restart "$SERVICE"; then
  log "RECOVERY requested systemd restart service=$SERVICE; the failed process exits and its RSS is released before a fresh process starts under its configured memory limit"
else
  log "ERROR systemd restart failed service=$SERVICE"
  exit 1
fi
