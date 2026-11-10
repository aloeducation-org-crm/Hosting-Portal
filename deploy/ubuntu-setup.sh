#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════════════════
# ALO Hosting Portal — ONE canonical Ubuntu provisioning entrypoint.
#
# This is the only supported way to prepare a fresh Ubuntu 22.04/24.04 host.
# It chains the three previously independent installers in the correct order:
#
#   1. deploy/server-kit/setup.sh   host OS: users, SSH, UFW, nginx, DB engines,
#                                   PM2, AI infra, backup cron, file sync
#   2. scripts/bootstrap-server.sh  panel env (generated secrets), SQLite DB,
#                                   systemd unit, deploy sudoers policy
#   3. helpers/install-helpers.sh   root-owned allowlisted privileged helpers
#   4. scripts/server-doctor.sh     read-only verification of the result
#
# Dry-run is the default: nothing is changed until you pass --apply.
#
#   sudo bash deploy/ubuntu-setup.sh --domain hosting.alolabs.net
#   sudo bash deploy/ubuntu-setup.sh --domain hosting.alolabs.net --apply
#   sudo bash deploy/ubuntu-setup.sh --skip-host-stages --apply   # panel only
#
# Preconditions (checked, never guessed):
#   * run from a full checkout with `npm ci` already executed
#   * deploy/server-kit/config.env copied from config.env.example and edited
#   * an SSH session on the NEW port verified before closing port 22
#   * a verified backup taken on any host that already serves traffic
# ══════════════════════════════════════════════════════════════════════════════
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
KIT="${ROOT}/deploy/server-kit"
DOMAIN="hosting.alolabs.net"
APPLY=0
SKIP_HOST_STAGES=0
EXTRA_ARGS=()

usage() {
  cat <<EOF
Usage: sudo bash deploy/ubuntu-setup.sh [options]

  --domain <fqdn>      public hostname (default: ${DOMAIN})
  --apply              actually change the host (default: print the plan)
  --skip-host-stages   skip deploy/server-kit/setup.sh (panel-only bootstrap)
  --nginx              also install the nginx vhost (needs a real certificate)
  --force              allow bootstrap-server.sh to replace existing unit/sudoers
  -h, --help           show this help
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --domain) DOMAIN="${2:-}"; [[ -n "$DOMAIN" ]] || { echo "--domain needs a value" >&2; exit 2; }; shift 2 ;;
    --apply) APPLY=1; shift ;;
    --skip-host-stages) SKIP_HOST_STAGES=1; shift ;;
    --nginx|--force) EXTRA_ARGS+=("$1"); shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage; exit 2 ;;
  esac
done

say() { printf '\n\033[1;34m▶ %s\033[0m\n' "$*"; }
ok()  { printf '  \033[1;32m✔\033[0m %s\n' "$*"; }
die() { printf '  \033[1;31m✘ %s\033[0m\n' "$*" >&2; exit 1; }

# ── Preflight (read-only, always runs) ───────────────────────────────────────
say "Preflight"
[[ -f "${ROOT}/package.json" ]] || die "not a full checkout: ${ROOT}/package.json is missing"
[[ -d "${ROOT}/node_modules" ]] || die "run 'npm ci' in ${ROOT} first"
[[ -f "${ROOT}/scripts/bootstrap-server.sh" ]] || die "panel bootstrap script is missing"
[[ -f "${ROOT}/helpers/install-helpers.sh" ]] || die "helper installer is missing"
[[ -f "${KIT}/setup.sh" ]] || die "server kit is missing at ${KIT}"
[[ -f "${ROOT}/prisma/schema.prisma" ]] || die "Prisma schema is missing"
if [[ "$SKIP_HOST_STAGES" -eq 0 && ! -f "${KIT}/config.env" ]]; then
  die "copy ${KIT}/config.env.example to config.env, chmod 0600, and replace every CHANGE_ME value first"
fi
if [[ "$APPLY" -eq 1 && "$EUID" -ne 0 ]]; then
  die "--apply must run as root (sudo)"
fi
if [[ "$APPLY" -eq 1 ]] && ! grep -qE '^ID=(ubuntu|debian)' /etc/os-release 2>/dev/null; then
  die "this installer targets Ubuntu 22.04/24.04; refusing to mutate an unknown OS"
fi
ok "checkout, dependencies and OS family validated"
printf '  mode: %s | domain: %s | host stages: %s\n' \
  "$([[ "$APPLY" -eq 1 ]] && echo APPLY || echo DRY-RUN)" "$DOMAIN" \
  "$([[ "$SKIP_HOST_STAGES" -eq 1 ]] && echo skipped || echo enabled)"

DRY=()
[[ "$APPLY" -eq 1 ]] || DRY=(--dry-run)

# ── 1. Host OS stages ───────────────────────────────────────────────────────
if [[ "$SKIP_HOST_STAGES" -eq 1 ]]; then
  say "Host OS stages skipped (--skip-host-stages)"
else
  say "Host OS provisioning (deploy/server-kit/setup.sh)"
  if [[ "$APPLY" -eq 0 ]]; then
    printf '  [dry-run] would run: sudo bash %s/setup.sh\n' "$KIT"
  else
    bash "${KIT}/setup.sh"
  fi
fi

# ── 2. Panel env / DB / systemd / deploy sudoers ────────────────────────────
say "Panel bootstrap (scripts/bootstrap-server.sh)"
BOOTSTRAP_ARGS=(--domain "$DOMAIN" "${DRY[@]}" "${EXTRA_ARGS[@]}")
if [[ "$APPLY" -eq 0 ]]; then
  printf '  [dry-run] would run: sudo bash %s/scripts/bootstrap-server.sh %s\n' "$ROOT" "${BOOTSTRAP_ARGS[*]}"
else
  bash "${ROOT}/scripts/bootstrap-server.sh" "${BOOTSTRAP_ARGS[@]}"
fi

# ── 3. Privileged helpers ───────────────────────────────────────────────────
say "Privileged helpers (helpers/install-helpers.sh)"
if [[ "$APPLY" -eq 0 ]]; then
  printf '  [dry-run] would run: sudo bash %s/helpers/install-helpers.sh\n' "$ROOT"
else
  bash "${ROOT}/helpers/install-helpers.sh"
fi

# ── 4. Verification ─────────────────────────────────────────────────────────
say "Verification"
if [[ "$APPLY" -eq 0 ]]; then
  ok "dry-run complete — no host change was made; re-run with --apply"
  exit 0
fi
bash "${ROOT}/scripts/server-doctor.sh" || true
printf '\n%s\n' "Next: verify https://${DOMAIN}/api/health, then approve a production release in .github/workflows/ci-cd.yml."
