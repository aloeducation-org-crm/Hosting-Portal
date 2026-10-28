#!/usr/bin/env bash
# install-agent.sh — one-time ALO server-agent bootstrap for a managed Linux
# host (Server A / Server B, or any Linux host that should join the fleet).
#
# Contract (§6 of the control-plane spec):
#   * DETECT first: OS, architecture, Node.js, resources, disk, existing
#     Docker/proxy services, occupied ports, an existing agent install.
#   * DRY RUN by default posture: `--dry-run` prints the full plan as JSON and
#     writes NOTHING — no files, no directories, no service changes.
#   * A real run refuses to do anything without an explicit enrollment token,
#     preserves an existing agent install unless --force is given (with a
#     timestamped backup), installs only what is missing, and reports every
#     step's outcome honestly (ok / skipped / failed — never "success" for a
#     step that did not run).
#   * Never touches SSH, Tailscale, firewalls, existing databases, existing
#     services or any populated directory.
#
# Usage:
#   bash scripts/install-agent.sh --dry-run --panel-url https://hosting.alolabs.net --name office-b
#   ALO_ENROLL_TOKEN=alo_enroll_... bash scripts/install-agent.sh \
#       --panel-url https://hosting.alolabs.net --name office-b [--force] [--systemd]
#
# Exit codes: 0 ok · 2 usage error (nothing written) · 3 missing prerequisite
#             (nothing written) · 4 existing install refused (use --force)
#             · 5 an actual step failed (see the JSON report on stdout).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

DRY_RUN=0
FORCE=0
INSTALL_SYSTEMD=0
PANEL_URL=""
AGENT_NAME=""
ENROLL_TOKEN="${ALO_ENROLL_TOKEN:-}"

usage_err() { echo "ERROR: $1" >&2; echo "usage: $0 --dry-run|--panel-url URL --name NAME [--force] [--systemd] (token via ALO_ENROLL_TOKEN)" >&2; exit 2; }
prereq_err() { echo "ERROR: $1" >&2; exit 3; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) DRY_RUN=1; shift ;;
    --force) FORCE=1; shift ;;
    --systemd) INSTALL_SYSTEMD=1; shift ;;
    --panel-url) PANEL_URL="${2:-}"; shift 2 ;;
    --name) AGENT_NAME="${2:-}"; shift 2 ;;
    *) usage_err "unknown argument: $1" ;;
  esac
done

STATE_DIR="${ALO_AGENT_STATE_DIR:-$HOME/.alo-agent}"
STATE_FILE="$STATE_DIR/agent.json"
AGENT_DEST="$STATE_DIR/alo-agent.mjs"

json_escape() {
  if command -v python3 >/dev/null 2>&1; then
    python3 -c 'import json,sys; print(json.dumps(sys.argv[1]))' "$1"
    return 0
  fi
  local s=$1
  s=${s//\\/\\\\}
  s=${s//\"/\\\"}
  s=${s//$'\n'/\\n}
  printf '"%s"' "$s"
}

# ── Detection (read-only) ─────────────────────────────────────────────────────

OS_ID="unknown"; OS_VERSION="unknown"; OS_PRETTY="unknown"
if [[ -r /etc/os-release ]]; then
  # shellcheck disable=SC1091
  . /etc/os-release
  OS_ID="${ID:-unknown}"; OS_VERSION="${VERSION_ID:-unknown}"; OS_PRETTY="${PRETTY_NAME:-unknown}"
fi
ARCH="$(uname -m 2>/dev/null || echo unknown)"
KERNEL="$(uname -sr 2>/dev/null || echo unknown)"
NODE_PATH="$(command -v node || true)"
NODE_VERSION="missing"
if [[ -n "$NODE_PATH" ]]; then NODE_VERSION="$(node --version 2>/dev/null || echo unknown)"; fi

RAM_TOTAL_MB="unknown"
if [[ -r /proc/meminfo ]]; then
  RAM_TOTAL_MB="$(awk '/MemTotal/ {printf "%d", $2/1024}' /proc/meminfo)"
fi
DISK_AVAIL_MB="unknown"; DISK_USED_PCT="unknown"
if command -v df >/dev/null 2>&1; then
  DISK_AVAIL_MB="$(df -Pm "${HOME}" 2>/dev/null | awk 'NR==2 {print $4}')"
  DISK_USED_PCT="$(df -P "${HOME}" 2>/dev/null | awk 'NR==2 {gsub(/%/,"",$5); print $5}')"
  [[ -z "$DISK_AVAIL_MB" ]] && DISK_AVAIL_MB="unknown"
  [[ -z "$DISK_USED_PCT" ]] && DISK_USED_PCT="unknown"
fi

HAS_DOCKER=0; command -v docker >/dev/null 2>&1 && HAS_DOCKER=1
PROXY_SERVICES=()
for svc in nginx caddy traefik tailscaled ssh; do
  if command -v systemctl >/dev/null 2>&1 && systemctl is-active --quiet "$svc" 2>/dev/null; then
    PROXY_SERVICES+=("$svc")
  fi
done
LISTEN_PORTS="unknown"
if command -v ss >/dev/null 2>&1; then
  LISTEN_PORTS="$(ss -Hltn 2>/dev/null | wc -l | tr -d ' ')"
fi
EXISTING_AGENT=0
[[ -f "$STATE_FILE" ]] && EXISTING_AGENT=1

# ── Decisions ─────────────────────────────────────────────────────────────────

STEPS_JSON=""
plan_fail=0

add_step() { # name status detail
  local s
  s=$(printf '{"name":"%s","status":"%s","detail":%s}' "$1" "$2" "$(json_escape "$3")")
  if [[ -n "$STEPS_JSON" ]]; then STEPS_JSON="$STEPS_JSON,$s"; else STEPS_JSON="$s"; fi
  [[ "$2" == "failed" ]] && plan_fail=1
  return 0
}

# Node.js is the agent's only runtime. Never installed implicitly.
NODE_OK=1
if [[ "$NODE_VERSION" == "missing" || "$NODE_VERSION" == "unknown" ]]; then NODE_OK=0; fi
if [[ -z "$NODE_PATH" ]]; then
  add_step "node-runtime" "failed" "Node.js >= 18 not found on PATH. Install it (e.g. apt-get install -y nodejs or nvm) and re-run; this installer will not install packages implicitly."
else
  major="${NODE_VERSION#v}"; major="${major%%.*}"
  if [[ "$major" =~ ^[0-9]+$ && "$major" -ge 18 ]]; then
    add_step "node-runtime" "ok" "Node.js $NODE_VERSION at $NODE_PATH"
  else
    NODE_OK=0
    add_step "node-runtime" "failed" "Node.js $NODE_VERSION found but >= 18 is required"
  fi
fi

if [[ -n "$DISK_AVAIL_MB" && "$DISK_AVAIL_MB" != "unknown" && "$DISK_AVAIL_MB" -lt 200 ]]; then
  add_step "disk-space" "failed" "Only ${DISK_AVAIL_MB}MB free on the home volume (need >= 200MB)"
else
  add_step "disk-space" "ok" "${DISK_AVAIL_MB}MB free on the home volume"
fi

add_step "os-architecture" "ok" "$OS_PRETTY / $ARCH / $KERNEL"
if [[ "$HAS_DOCKER" == "1" ]]; then
  add_step "container-runtime" "ok" "docker present on PATH"
else
  add_step "container-runtime" "skipped" "docker not installed (not required for agent operation)"
fi
if [[ ${#PROXY_SERVICES[@]} -gt 0 ]]; then
  add_step "existing-services" "ok" "active services noted: ${PROXY_SERVICES[*]} (will not be modified)"
else
  add_step "existing-services" "ok" "no known proxy/system services detected as active (nothing will be modified)"
fi
add_step "listening-ports" "ok" "$LISTEN_PORTS listening TCP sockets observed (agent needs no inbound port)"

if [[ "$EXISTING_AGENT" == "1" && "$FORCE" == "0" ]]; then
  add_step "agent-install" "ok" "existing agent install detected at $STATE_FILE — credentials preserved (use --force to rotate, a backup is taken first)"
elif [[ "$EXISTING_AGENT" == "1" ]]; then
  add_step "agent-install" "ok" "existing agent install at $STATE_FILE — --force given: current state will be backed up before replacement"
else
  add_step "agent-install" "ok" "no existing agent install; $STATE_DIR will be created with mode 0700"
fi

# ── Usage / prerequisite gates (before ANY write) ────────────────────────────

if [[ "$DRY_RUN" == "0" ]]; then
  if [[ -z "$PANEL_URL" || -z "$AGENT_NAME" ]]; then usage_err "--panel-url and --name are required for a real run"; fi
  if [[ -z "$ENROLL_TOKEN" ]]; then usage_err "ALO_ENROLL_TOKEN is required for a real run (nothing was written)"; fi
  if [[ "$NODE_OK" == "0" ]]; then prereq_err "prerequisites not met (see report) — nothing was written"; fi
  if [[ "$plan_fail" == "1" ]]; then prereq_err "prerequisite check failed (see report) — nothing was written"; fi
  if [[ "$EXISTING_AGENT" == "1" && "$FORCE" == "0" ]]; then
    echo "ERROR: an agent install already exists at $STATE_FILE. Re-run with --force to rotate it (the current state file is backed up first)." >&2
    exit 4
  fi
fi

# ── Report ────────────────────────────────────────────────────────────────────

ACTION="dry-run"
if [[ "$DRY_RUN" == "0" ]]; then ACTION="install"; fi

cat <<EOF
{
  "action": "$ACTION",
  "panelUrl": $(json_escape "$PANEL_URL"),
  "agentName": $(json_escape "$AGENT_NAME"),
  "host": {
    "osId": $(json_escape "$OS_ID"),
    "osVersion": $(json_escape "$OS_VERSION"),
    "osPretty": $(json_escape "$OS_PRETTY"),
    "arch": $(json_escape "$ARCH"),
    "kernel": $(json_escape "$KERNEL"),
    "nodeVersion": $(json_escape "$NODE_VERSION"),
    "ramTotalMb": $(json_escape "$RAM_TOTAL_MB"),
    "diskAvailMb": $(json_escape "$DISK_AVAIL_MB"),
    "diskUsedPct": $(json_escape "$DISK_USED_PCT"),
    "dockerPresent": $([[ "$HAS_DOCKER" == "1" ]] && echo true || echo false),
    "activeServices": [$(if [[ ${#PROXY_SERVICES[@]} -gt 0 ]]; then printf '"%s",' "${PROXY_SERVICES[@]}" | sed 's/,$//'; fi)],
    "listeningPorts": $(json_escape "$LISTEN_PORTS"),
    "existingAgent": $([[ "$EXISTING_AGENT" == "1" ]] && echo true || echo false)
  },
  "steps": [$STEPS_JSON],
  "writesPerformed": $([[ "$DRY_RUN" == "1" ]] && echo false || echo true),
  "nextSteps": [
    "Review this report.",
    "Real run: ALO_ENROLL_TOKEN=... $0 --panel-url <url> --name <name>",
    "Optional: append --systemd to install the heartbeat service (requires root)."
  ]
}
EOF

if [[ "$DRY_RUN" == "1" ]]; then exit 0; fi

# ── Real installation (only after every gate above) ──────────────────────────

BACKUP_PATH=""
if [[ "$EXISTING_AGENT" == "1" ]]; then
  BACKUP_PATH="$STATE_FILE.bak.$(date +%Y%m%d%H%M%S)"
  cp -p "$STATE_FILE" "$BACKUP_PATH"
fi
mkdir -p "$STATE_DIR"
chmod 0700 "$STATE_DIR"
cp "$REPO_ROOT/agent/alo-agent.mjs" "$AGENT_DEST"
chmod 0755 "$AGENT_DEST"

echo "Enrolling with panel $PANEL_URL ..."
set +e
ALO_PANEL_URL="$PANEL_URL" ALO_ENROLL_TOKEN="$ENROLL_TOKEN" \
  "$NODE_PATH" "$AGENT_DEST" --name "$AGENT_NAME" --enroll
ENROLL_RC=$?
set -e
if [[ "$ENROLL_RC" != "0" ]]; then
  echo "ENROLLMENT_FAILED rc=$ENROLL_RC backup=${BACKUP_PATH:-none}" >&2
  exit 5
fi
chmod 0600 "$STATE_FILE" 2>/dev/null || true

if [[ "$INSTALL_SYSTEMD" == "1" && "$EUID" == "0" ]]; then
  UNIT=/etc/systemd/system/alo-agent.service
  cat > "$UNIT" <<UNIT_EOF
[Unit]
Description=ALO Hosting server agent
After=network-online.target
Wants=network-online.target

[Service]
ExecStart=$NODE_PATH $AGENT_DEST
Restart=always
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
UNIT_EOF
  systemctl daemon-reload
  systemctl enable --now alo-agent.service
  echo "SYSTEMD_INSTALLED $UNIT"
elif [[ "$INSTALL_SYSTEMD" == "1" ]]; then
  echo "SYSTEMD_SKIPPED requires root to install /etc/systemd/system/alo-agent.service" >&2
fi

echo "INSTALL_OK state=$STATE_FILE backup=${BACKUP_PATH:-none}"
