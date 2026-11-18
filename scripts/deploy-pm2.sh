#!/usr/bin/env bash
# Build and (re)start the panel under PM2 on alo-server-lap.
#
#   su - alamin -c "cd /home/alamin/Hosting-Portal && bash scripts/deploy-pm2.sh"
#
# Run as the PM2 user (alamin), never as root. Full procedure and the reasons
# behind each step: docs/PM2-PRODUCTION-RUNBOOK.md.
#
# Order of work — the database is backed up before anything can change it, and
# the running processes are only touched after the new build is complete:
#   1. preflight (user, env file, secrets present, database location)
#   2. move stray .env files out of the checkout
#   3. git pull --ff-only            (skip with --no-pull)
#   4. npm ci
#   5. verified database backup
#   6. prisma db push                (skip with --skip-schema)
#   7. next build + worker bundles
#   8. copy .next/static and public into the standalone output
#   9. pm2 startOrReload + pm2 save
#  10. health check on 127.0.0.1
#
# Known limit: the build runs in place, so `.next` is rewritten while the old
# process is still serving from it. Expect a short window (the build time) in
# which some static assets can 404. It does not affect the database.
#
# Options:
#   --no-pull       build the checkout as it is
#   --skip-schema   do not run prisma db push
#   --check         run the preflight only and change nothing
#
# Environment overrides: PANEL_ENV_FILE, PANEL_PORT, PANEL_BACKUP_DIR,
# PANEL_BRANCH.
set -Eeuo pipefail
set +H
umask 027

log()  { printf 'deploy-pm2: %s\n' "$*"; }
fail() { printf 'deploy-pm2: ERROR: %s\n' "$*" >&2; exit 1; }

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${PANEL_ENV_FILE:-/etc/alo-hosting/panel.env}"
PORT="${PANEL_PORT:-3000}"
BRANCH="${PANEL_BRANCH:-main}"
BACKUP_DIR="${PANEL_BACKUP_DIR:-${HOME}/storage/backups/hosting-predeploy}"
ECOSYSTEM="${ROOT}/deploy/pm2/ecosystem.config.cjs"
ENV_READER="${ROOT}/deploy/pm2/panel-env.cjs"
HEALTH_URL="http://127.0.0.1:${PORT}/api/health"

do_pull=1
do_schema=1
check_only=0
for arg in "$@"; do
  case "$arg" in
    --no-pull) do_pull=0 ;;
    --skip-schema) do_schema=0 ;;
    --check) check_only=1 ;;
    -h|--help) sed -n '2,33p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) fail "unknown option: $arg" ;;
  esac
done

cd "$ROOT"

# ── 1. Preflight ─────────────────────────────────────────────────────────────
[[ "$(id -u)" -ne 0 ]] || fail "do not run as root; use: su - alamin -c \"cd $ROOT && bash scripts/deploy-pm2.sh\""
for tool in node npm git curl; do
  command -v "$tool" >/dev/null 2>&1 || fail "$tool is not installed or not on PATH"
done
if [[ "$check_only" -eq 0 ]]; then
  command -v pm2 >/dev/null 2>&1 || fail "pm2 is not installed or not on PATH for $(id -un)"
fi
[[ -r "$ENV_FILE" ]] || fail "$ENV_FILE is missing or not readable by $(id -un)"
[[ -f "$ECOSYSTEM" && -f "$ENV_READER" ]] || fail "deploy/pm2 files are missing from this checkout"
[[ ! -e "$ROOT/src/middleware.ts" ]] || fail "src/middleware.ts exists; Next.js 16 uses src/proxy.ts only. Remove middleware.ts."

env_value() { node "$ENV_READER" "$ENV_FILE" "$1" 2>/dev/null || true; }

for key in NEXTAUTH_SECRET JWT_SECRET APP_ENCRYPTION_KEY INTERNAL_SECRET; do
  value="$(env_value "$key")"
  [[ "${#value}" -ge 32 ]] || fail "$key is missing or shorter than 32 characters in $ENV_FILE"
done
unset value

DB_URL="$(env_value DATABASE_URL)"
[[ "$DB_URL" == file:/* ]] || fail "DATABASE_URL in $ENV_FILE must be an absolute SQLite URL (file:/...)"
DB_FILE="${DB_URL#file:}"
[[ -f "$DB_FILE" ]] || fail "database file $DB_FILE does not exist"
[[ -w "$DB_FILE" && -w "$(dirname "$DB_FILE")" ]] || fail "$(id -un) cannot write $DB_FILE or its directory (SQLite needs both)"
case "$(readlink -f "$DB_FILE")" in
  "$ROOT"/*) fail "the production database must not live inside the Git checkout" ;;
esac

log "preflight ok: user=$(id -un) port=$PORT database=$DB_FILE"
if [[ "$check_only" -eq 1 ]]; then
  log "--check given; nothing was changed"
  exit 0
fi

# One deploy at a time.
exec 9>"${ROOT}/.deploy-pm2.lock"
flock -n 9 || fail "another deploy-pm2 run holds ${ROOT}/.deploy-pm2.lock"

# ── 2. Stray .env files ──────────────────────────────────────────────────────
# Next.js loads .env and .env.production from the checkout and copies them into
# the standalone output. Template values there are what made the production
# secret check in src/lib/env.ts refuse to start. panel.env is the only source.
for name in .env .env.production .env.local .env.production.local; do
  if [[ -e "$ROOT/$name" ]]; then
    mv -f "$ROOT/$name" "$ROOT/$name.placeholder"
    log "moved $name aside to $name.placeholder"
  fi
done

# ── 3. Source ────────────────────────────────────────────────────────────────
if [[ "$do_pull" -eq 1 ]]; then
  [[ -z "$(git status --porcelain --untracked-files=no)" ]] \
    || fail "tracked files have local changes; commit, stash or re-run with --no-pull"
  git fetch --quiet origin "$BRANCH"
  git merge --ff-only --quiet "origin/$BRANCH" || fail "cannot fast-forward to origin/$BRANCH"
fi
SHA="$(git rev-parse HEAD)"
log "building commit ${SHA:0:12}"

# ── 4. Dependencies ──────────────────────────────────────────────────────────
npm ci --include=dev --no-audit --no-fund

# Runs a command with panel.env merged into its environment. The file is parsed
# as data by Node; it is never sourced by this shell.
with_panel_env() {
  node -e '
    const { readPanelEnv } = require(process.argv[1]);
    const { spawnSync } = require("node:child_process");
    const [file, command, ...args] = process.argv.slice(3);
    const result = spawnSync(command, args, {
      stdio: "inherit",
      env: Object.assign({}, process.env, readPanelEnv(file), { NODE_ENV: "production" }),
    });
    process.exit(result.status === null ? 1 : result.status);
  ' "$ENV_READER" -- "$ENV_FILE" "$@"
}

# ── 5. Backup (before anything can touch the schema) ─────────────────────────
mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"
node scripts/db-backup.mjs --db "$DB_URL" --out "$BACKUP_DIR" --label "predeploy-${SHA:0:12}" \
  || fail "database backup failed; nothing has been changed"
log "database backup written to $BACKUP_DIR"

# ── 6. Schema ────────────────────────────────────────────────────────────────
# No --accept-data-loss: if Prisma would have to drop data it stops here, and
# the running application is left exactly as it was.
if [[ "$do_schema" -eq 1 ]]; then
  DATABASE_URL="$DB_URL" npx prisma db push --skip-generate \
    || fail "prisma db push failed; the running application was not restarted. Backup: $BACKUP_DIR"
fi

# ── 7. Build ─────────────────────────────────────────────────────────────────
with_panel_env npm run build
with_panel_env npm run build:worker

STANDALONE="$ROOT/.next/standalone"
[[ -s "$STANDALONE/server.js" ]] || fail "build did not produce .next/standalone/server.js"
node --check "$STANDALONE/deploy-worker.cjs"
node --check "$STANDALONE/automation-worker.cjs"

# ── 8. Static assets ─────────────────────────────────────────────────────────
# The standalone output contains neither .next/static nor public. Without them
# every JS/CSS request and every public file returns 404. The targets are
# removed first so a re-run cannot nest static/static.
rm -rf "$STANDALONE/.next/static" "$STANDALONE/public"
mkdir -p "$STANDALONE/.next"
cp -R "$ROOT/.next/static" "$STANDALONE/.next/static"
[[ ! -d "$ROOT/public" ]] || cp -R "$ROOT/public" "$STANDALONE/public"
rm -f "$STANDALONE"/.env "$STANDALONE"/.env.production "$STANDALONE"/.env.local "$STANDALONE"/.env.production.local

# ── 9. PM2 ───────────────────────────────────────────────────────────────────
PANEL_ENV_FILE="$ENV_FILE" PANEL_PORT="$PORT" PANEL_APP_DIR="$ROOT" \
  pm2 startOrReload "$ECOSYSTEM" --update-env
pm2 save

# ── 10. Health ───────────────────────────────────────────────────────────────
code=000
for _ in $(seq 1 30); do
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$HEALTH_URL" || true)"
  [[ "$code" == "200" ]] && break
  sleep 2
done
if [[ "$code" != "200" ]]; then
  pm2 logs alo-hosting-panel --lines 40 --nostream || true
  fail "$HEALTH_URL returned HTTP $code after 60s. Database backup: $BACKUP_DIR"
fi

asset="$(find "$STANDALONE/.next/static/chunks" -maxdepth 1 -name '*.js' -print -quit 2>/dev/null || true)"
if [[ -n "$asset" ]]; then
  asset_code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "http://127.0.0.1:${PORT}/_next/static/chunks/$(basename "$asset")" || true)"
  [[ "$asset_code" == "200" ]] || fail "static chunk returned HTTP $asset_code; static assets are not being served"
fi

log "ok: commit ${SHA:0:12} is healthy on 127.0.0.1:${PORT}"
