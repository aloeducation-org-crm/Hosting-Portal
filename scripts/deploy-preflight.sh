#!/usr/bin/env bash
# Read-only deployment preflight.
#
# Collects the facts about THIS host that decide which deployment shape is safe,
# asks the unit-tested decision function in src/lib/deploy/preflight.ts (through
# scripts/decide-release-target.mjs) to choose, and prints the result.
#
# It changes nothing: no checkout, no install, no build, no migration, no service
# restart, no firewall/DNS/SSH change. It prints no secret and no database URL.
#
# Usage:
#   DEPLOY_COMMIT_SHA=<40-hex> DEPLOY_PAYLOAD_DIR=.deploy-artifact bash scripts/deploy-preflight.sh
#   bash scripts/deploy-preflight.sh --json      # facts + decision as JSON
#
# Exit codes: 0 = canonical or inline is safe, 1 = blocked, 2 = usage error.
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
JSON_ONLY=0
[[ "${1:-}" == "--json" ]] && JSON_ONLY=1

SHA="${DEPLOY_COMMIT_SHA:-$(git -C "$ROOT" rev-parse HEAD 2>/dev/null || echo "")}"
PAYLOAD="${DEPLOY_PAYLOAD_DIR:-${ROOT}/.deploy-artifact}"
APP_ROOT="${ALO_HOSTING_ROOT:-${HOME}/alo-hosting}"
ENV_FILE="${PANEL_ENV_FILE:-/etc/alo-hosting/panel.env}"
DB_FILE="${PRODUCTION_DB_FILE:-/var/lib/alo-hosting/alo.db}"
if [[ -n "${ALO_INLINE_APP_DIR:-}" ]]; then
  INLINE_ROOT="$ALO_INLINE_APP_DIR"
elif [[ -d "${HOME}/projects/Hosting-Portal/.git" ]]; then
  INLINE_ROOT="${HOME}/projects/Hosting-Portal"
elif [[ -d "${HOME}/Hosting-Portal/.git" ]]; then
  INLINE_ROOT="${HOME}/Hosting-Portal"
else
  INLINE_ROOT="${HOME}/projects/Hosting-Portal"
fi
RELEASES="${APP_ROOT}/releases"

bool() { if [[ "$1" == "0" ]]; then printf 'true'; else printf 'false'; fi; }

# ── Facts (read-only probes) ─────────────────────────────────────────────────
artifact_usable=1
if [[ -d "$PAYLOAD/.next/standalone" && -s "$PAYLOAD/.next/standalone/server.js" && -d "$PAYLOAD/.next/static" && -d "$PAYLOAD/public" ]]; then
  artifact_usable=0
fi

env_readable=1; [[ -r "$ENV_FILE" ]] && env_readable=0
db_present=1;   [[ -f "$DB_FILE" ]] && db_present=0

releases_writable=1
if [[ -d "$RELEASES" && -w "$RELEASES" ]]; then
  releases_writable=0
elif [[ ! -e "$RELEASES" && -d "$APP_ROOT" && -w "$APP_ROOT" ]]; then
  releases_writable=0
fi

systemd_unit=1
if command -v systemctl >/dev/null 2>&1 \
   && systemctl list-unit-files alo-hosting-panel.service 2>/dev/null | grep -q "alo-hosting-panel\.service"; then
  systemd_unit=0
fi

canonical_root=1; [[ -d "$APP_ROOT" ]] && canonical_root=0
inline_is_git=1;  [[ -d "$INLINE_ROOT/.git" ]] && inline_is_git=0
inline_clean=1
if (( inline_is_git == 0 )); then
  # Classified rather than "any output from git status": the deployment writes
  # release-identity.json into this checkout so the running app can report its
  # commit through /api/health, and counting that file as a local change made
  # every deploy after the first one fail preflight (runs #54–#64). The
  # classifier tolerates only untracked files it can validate as deployment
  # output, so genuine uncommitted work still blocks the deployment.
  if bash "$ROOT/scripts/host-checkout-status.sh" "$INLINE_ROOT" >/dev/null 2>&1; then
    inline_clean=0
  else
    # Surface the offending paths in the job log; still read-only.
    bash "$ROOT/scripts/host-checkout-status.sh" "$INLINE_ROOT" >&2 || true
  fi
fi
pm2_present=1; command -v pm2 >/dev/null 2>&1 && pm2_present=0

FACTS="$(printf '{"commitSha":"%s","artifactUsable":%s,"envFileReadable":%s,"dbFilePresent":%s,"releasesDirWritable":%s,"systemdUnitPresent":%s,"canonicalRootPresent":%s,"inlineRootIsGit":%s,"inlineRootClean":%s,"pm2Present":%s}' \
  "$SHA" "$(bool "$artifact_usable")" "$(bool "$env_readable")" "$(bool "$db_present")" \
  "$(bool "$releases_writable")" "$(bool "$systemd_unit")" "$(bool "$canonical_root")" \
  "$(bool "$inline_is_git")" "$(bool "$inline_clean")" "$(bool "$pm2_present")")"

DECISION="$(printf '%s' "$FACTS" | node "$ROOT/scripts/decide-release-target.mjs")" \
  || { printf 'preflight: ERROR: the deployment decision could not be evaluated\n%s\n' "$FACTS" >&2; exit 2; }

field() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const d=JSON.parse(s);const v=d[process.argv[1]];process.stdout.write(typeof v==="string"?v:JSON.stringify(v))})' "$1" <<<"$DECISION"; }

MODE="$(field mode)"
OK="$(field ok)"

if (( JSON_ONLY == 1 )); then
  printf '{"facts":%s,"decision":%s}\n' "$FACTS" "$DECISION"
else
  printf 'preflight: commit          = %s\n' "$SHA"
  printf 'preflight: deployment mode = %s\n' "$MODE"
  printf 'preflight: canonical shape = %s\n' "$(node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const d=JSON.parse(s);process.stdout.write(d.canonicalBlockedBy.length?"blocked: "+d.canonicalBlockedBy.join("; "):"available")})' <<<"$DECISION")"
  printf 'preflight: decision        = %s\n' "$(field reason)"
  if [[ "$OK" != "true" ]]; then
    printf 'preflight: missing         = %s\n' "$(field missing)" >&2
  fi
fi

[[ "$OK" == "true" ]] || exit 1
exit 0
