#!/usr/bin/env bash
# =============================================================================
# ALO Hosting Portal — repair a Next.js site that is stuck in a PM2 crash-loop
#
# Built for the 2026-10-27 incident, where two sites showed as `errored` with
# 15 restarts and HTTP 000:
#
#   alo-learning: Cannot find module '.../.next/standalone/server.js'
#   marketingos:  sh: 1: bun: not found
#
# Both are symptoms of the same root cause: `package.json` `scripts.start` was
# written for a human shell, and PM2 was asked to supervise a shell pipeline.
# This script replaces that with a resolved argv command + a generated PM2
# ecosystem file, stages the assets `next build` does not copy, restarts the
# app, and proves it with a real HTTP health check.
#
# Idempotent: safe to run repeatedly. Never edits application source.
#
# Usage:
#   ./scripts/repair-nextjs-site.sh --app alo-learning \
#       --dir ~/projects/ALO-LEARNING-JOURNEY --port 3060 \
#       [--domain learn.aloeducation.com] [--health /] [--build] [--install-bun] [--dry-run]
#
#   ./scripts/repair-nextjs-site.sh --app marketingos \
#       --dir ~/projects/MarketingOS --port 3061 --domain marketing.alolabs.net
# =============================================================================
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
RESOLVER="${SCRIPT_DIR}/resolve-start-entry.mjs"

APP=""
PROJECT_DIR=""
PORT=""
DOMAIN=""
HEALTH_PATH="/"
DO_BUILD=0
INSTALL_BUN=0
DRY_RUN=0

PUBLIC_IP="${ALO_PUBLIC_IP:-103.231.239.79}"

die() { printf '\033[31m✗ %s\033[0m\n' "$*" >&2; exit 1; }
ok() { printf '\033[32m✓ %s\033[0m\n' "$*"; }
info() { printf '  %s\n' "$*"; }
warn() { printf '\033[33m! %s\033[0m\n' "$*"; }
step() { printf '\n\033[1m%s\033[0m\n' "$*"; }

usage() {
  sed -n '2,30p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
  exit "${1:-0}"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --app) APP="${2:-}"; shift 2 ;;
    --dir) PROJECT_DIR="${2:-}"; shift 2 ;;
    --port) PORT="${2:-}"; shift 2 ;;
    --domain) DOMAIN="${2:-}"; shift 2 ;;
    --health) HEALTH_PATH="${2:-}"; shift 2 ;;
    --build) DO_BUILD=1; shift ;;
    --install-bun) INSTALL_BUN=1; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    -h|--help) usage 0 ;;
    *) die "unknown argument: $1 (try --help)" ;;
  esac
done

[[ -n "$APP" ]] || die "--app is required"
[[ -n "$PROJECT_DIR" ]] || die "--dir is required"
[[ -n "$PORT" && "$PORT" =~ ^[0-9]{4,5}$ ]] || die "--port must be a 4-5 digit port number"
[[ -f "$RESOLVER" ]] || die "missing $RESOLVER — re-clone the scripts/ directory"
command -v node >/dev/null 2>&1 || die "node is not installed or not on PATH"
command -v pm2 >/dev/null 2>&1 || die "pm2 is not installed or not on PATH"

PROJECT_DIR="$(cd -- "$PROJECT_DIR" 2>/dev/null && pwd)" || die "project directory does not exist"
[[ -f "${PROJECT_DIR}/package.json" ]] || die "${PROJECT_DIR} has no package.json"

run() {
  if (( DRY_RUN )); then
    printf '  [dry-run] %s\n' "$*"
    return 0
  fi
  "$@"
}

# ── 1. Current state ────────────────────────────────────────────────────────
step "1/6 Current PM2 state for ${APP}"
if pm2 describe "$APP" >/dev/null 2>&1; then
  pm2 jlist 2>/dev/null | ALO_APP="$APP" node -e '
    let raw = "";
    process.stdin.on("data", (chunk) => (raw += chunk)).on("end", () => {
      let list = [];
      try { list = JSON.parse(raw); } catch { /* pm2 not ready */ }
      const app = Array.isArray(list) ? list.find((entry) => entry.name === process.env.ALO_APP) : null;
      if (!app) return console.log("  (not in pm2 list)");
      const env = app.pm2_env ?? {};
      console.log(`  status=${env.status ?? "-"} restarts=${env.restart_time ?? 0} script=${env.pm_exec_path ?? env.pm2_env?.script ?? "-"}`);
      console.log(`  interpreter=${env.exec_interpreter ?? "-"} port=${env.PORT ?? "-"}`);
    });
  ' || true
else
  info "not registered with pm2 yet"
fi

# ── 2. Diagnose the start command ───────────────────────────────────────────
step "2/6 Diagnosing the declared start command"
START_SCRIPT="$(node -e 'const p=require(process.argv[1]);process.stdout.write((p.scripts&&p.scripts.start)||"")' "${PROJECT_DIR}/package.json")"
info "scripts.start = ${START_SCRIPT:-<none>}"

if [[ "$START_SCRIPT" == *"|"* || "$START_SCRIPT" == *"tee"* || "$START_SCRIPT" == *"&"* ]]; then
  warn "start script is a shell pipeline (| tee ...). PM2 supervises tee, never the server:"
  warn "its exit status hides crashes and restarts loop forever. Replacing with argv."
fi

# Runtime the declared start script asks for (bun/node/...).
DECLARED_RUNTIME="$(printf '%s' "$START_SCRIPT" | awk '{
  for (i = 1; i <= NF; i++) {
    if ($i ~ /^[A-Za-z_][A-Za-z0-9_]*=/) continue;
    n = split($i, parts, "/"); print parts[n]; exit;
  }
}')"
if [[ -n "$DECLARED_RUNTIME" ]] && ! command -v "$DECLARED_RUNTIME" >/dev/null 2>&1; then
  warn "'${DECLARED_RUNTIME}' is declared by scripts.start but is NOT installed on this host"
  info "looked for: $(command -v "$DECLARED_RUNTIME" 2>/dev/null || echo "nothing on PATH")"
  if (( ! INSTALL_BUN )) && [[ "$DECLARED_RUNTIME" == "bun" ]]; then
    warn "the site is still repaired: the standalone server is a Node script and runs under node."
    warn "for the build/install path, install bun with:  curl -fsSL https://bun.sh/install | bash"
    warn "or re-run this script with --install-bun"
  fi
fi

# Lockfile-driven provisioning gap (bun/pnpm lock committed, tool missing).
LOCK_KIND=""
if [[ -f "${PROJECT_DIR}/bun.lock" || -f "${PROJECT_DIR}/bun.lockb" ]]; then LOCK_KIND="bun"; fi
if [[ -f "${PROJECT_DIR}/pnpm-lock.yaml" ]]; then LOCK_KIND="pnpm"; fi
if [[ -n "$LOCK_KIND" ]] && ! command -v "$LOCK_KIND" >/dev/null 2>&1; then
  warn "${LOCK_KIND} lockfile is committed but '${LOCK_KIND}' is not installed (build/install path is unserved)"
  if (( INSTALL_BUN )) && [[ "$LOCK_KIND" == "bun" && "$DECLARED_RUNTIME" != "bun"* ]]; then
    info "installing bun (official installer)"
    run bash -c 'curl -fsSL https://bun.sh/install | bash'
    export PATH="${HOME}/.bun/bin:${PATH}"
  fi
fi

# ── 3. Locate the build output ──────────────────────────────────────────────
step "3/6 Build output"
BUNDLE_HINT="none"
for candidate in ".next/standalone/server.js"; do
  [[ -f "${PROJECT_DIR}/${candidate}" ]] && BUNDLE_HINT="$candidate"
done
NESTED="$(find "${PROJECT_DIR}/.next/standalone" -maxdepth 3 -name server.js -type f 2>/dev/null | head -n 1 || true)"
if [[ -n "$NESTED" ]]; then
  BUNDLE_HINT="${NESTED#"${PROJECT_DIR}/"}"
fi
if [[ "$BUNDLE_HINT" == "none" ]]; then
  warn "no .next/standalone/server.js anywhere under ${PROJECT_DIR}/.next"
  if (( DO_BUILD )); then
    step "3b/6 Building (next build)"
    if [[ "$LOCK_KIND" == "bun" ]] && command -v bun >/dev/null 2>&1; then
      run bun run build
    else
      run npm run build
    fi
  else
    die "nothing to start. Re-run with --build (or run 'npm run build' in ${PROJECT_DIR}) and try again.
       If the build reports nested output, pin outputFileTracingRoot to the app directory in next.config."
  fi
else
  ok "standalone server found: ${BUNDLE_HINT}"
fi
[[ -d "${PROJECT_DIR}/.next/static" ]] && info ".next/static present" || warn ".next/static missing (assets will 404)"
[[ -d "${PROJECT_DIR}/public" ]] && info "public/ present" || info "public/ absent (optional)"

# ── 4. Resolve argv + write ecosystem ───────────────────────────────────────
step "4/6 Resolving an argv start command"
# PM2 only parses a file as an ecosystem config when it matches *.config.js or
# *.config.cjs. Named `ecosystem.alo.cjs` it silently treats the config file as
# the application script and registers an app named after the file.
ECOSYSTEM="${PROJECT_DIR}/ecosystem.alo.config.cjs"
if ! RESOLVE_OUT="$(node "$RESOLVER" --dir "$PROJECT_DIR" --port "$PORT" --name "$APP" \
                      --stage-assets --write-ecosystem "$ECOSYSTEM" 2>&1)"; then
  printf '%s\n' "$RESOLVE_OUT" | sed 's/^/  /' >&2
  die "could not resolve a runnable entry point; leaving PM2 untouched"
fi
printf '%s\n' "$RESOLVE_OUT" | sed 's/^/  /'
ENTRY="$(printf '%s' "$RESOLVE_OUT" | awk -F= '/^entry=/{print $2}')"
info "ecosystem file: ${ECOSYSTEM}"

# ── 5. Re-create the process ────────────────────────────────────────────────
step "5/6 Restarting ${APP} from ${ECOSYSTEM}"
if (( DRY_RUN )); then
  info "[dry-run] pm2 delete ${APP} && pm2 start ${ECOSYSTEM}"
else
  # `pm2 restart` keeps the ORIGINAL script (here: `npm`). The broken process
  # must be deleted so the argv entry from the ecosystem file takes effect.
  pm2 delete "$APP" >/dev/null 2>&1 || true
  pm2 start "$ECOSYSTEM"
  # If PM2 did not parse the file as a config it registers an app named after
  # the file instead of $APP - catch that here rather than 30s later at HTTP 000.
  if ! pm2 describe "$APP" >/dev/null 2>&1; then
    pm2 delete "$(basename "$ECOSYSTEM" .cjs)" >/dev/null 2>&1 || true
    die "PM2 did not register '${APP}'. The ecosystem file was not parsed as a config (${ECOSYSTEM})."
  fi
  pm2 save >/dev/null
fi

# ── 6. Prove it ─────────────────────────────────────────────────────────────
step "6/6 Health check"
http_code() {
  # `curl -w` already prints 000 on failure; appending another "000" produced
  # the unreadable "HTTP 000000" this script used to report.
  local code
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 "http://127.0.0.1:${PORT}${HEALTH_PATH}" 2>/dev/null)" || true
  printf '%s' "${code:-000}"
}

CODE="000"
if (( DRY_RUN )); then
  info "[dry-run] would poll http://127.0.0.1:${PORT}${HEALTH_PATH} for up to 30s"
else
  CODE="$(http_code)"
  for _ in $(seq 1 30); do
    [[ "$CODE" =~ ^[23] ]] && break
    sleep 1
    CODE="$(http_code)"
  done
fi

if (( DRY_RUN )); then
  ok "dry run complete — no changes were made"
  exit 0
fi

if [[ ! "$CODE" =~ ^[23] ]]; then
  printf '\n\033[31m✗ %s is still unhealthy on 127.0.0.1:%s (HTTP %s)\033[0m\n' "$APP" "$PORT" "$CODE" >&2
  echo "--- last 40 log lines ---" >&2
  pm2 logs "$APP" --lines 40 --nostream 2>&1 | tail -n 40 >&2 || true
  echo "-------------------------" >&2
  cat >&2 <<EOF

The process starts but does not answer. Common causes, in order:

  1. The app reads a required env var that is missing. Check the app's
     .env / .env.local and re-run:
        pm2 delete $APP && PORT=$PORT NODE_ENV=production pm2 start $ECOSYSTEM --update-env
  2. It listens on a different port/host. $ENTRY honours \$PORT and \$HOSTNAME;
     verify with:  ss -tlnp | grep $PORT
  3. It needs a database migration or a generated client at boot
     (prisma migrate deploy / prisma generate), which is a release step,
     not a web-server one.
EOF
  exit 1
fi

ok "${APP} is healthy: HTTP ${CODE} on http://127.0.0.1:${PORT}${HEALTH_PATH}"

if [[ -n "$DOMAIN" ]]; then
  NGINX_CONF="/etc/nginx/sites-enabled/${DOMAIN}"
  if [[ -f "$NGINX_CONF" ]]; then
    if grep -q "proxy_pass http://127.0.0.1:${PORT}" "$NGINX_CONF"; then
      ok "nginx ${DOMAIN} -> 127.0.0.1:${PORT}"
    else
      warn "nginx ${DOMAIN} does not proxy to 127.0.0.1:${PORT}; check: grep proxy_pass $NGINX_CONF"
    fi
  else
    warn "no nginx vhost at ${NGINX_CONF}"
  fi
  if curl -fsS -o /dev/null --max-time 10 -H "Host: ${DOMAIN}" "http://127.0.0.1${HEALTH_PATH}" 2>/dev/null; then
    ok "vhost responds locally (Host: ${DOMAIN})"
  else
    warn "vhost did not answer via nginx (Host: ${DOMAIN}); check the proxy and firewall"
  fi
  echo
  info "edge check (after DNS/Cloudflare): curl -I https://${DOMAIN}"
  info "public IP: ${PUBLIC_IP}"
fi

echo
ok "repaired in place. 'pm2 save' recorded the new process list for reboot."
