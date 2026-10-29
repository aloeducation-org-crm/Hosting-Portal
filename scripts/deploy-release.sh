#!/usr/bin/env bash
# Deploy one identified commit to this host, safely.
#
# Single entry point for the deployment workflow. It:
#   1. runs the read-only preflight and lets the unit-tested decision function
#      choose between the canonical immutable-release shape and the historical
#      in-place shape (or blocks);
#   2. canonical → delegates to scripts/deploy-production.sh, which promotes the
#      CI-built artifact, swaps a symlink atomically and restores the previous
#      release automatically when verification fails;
#   3. inline   → captures the current state first, refuses to touch a database
#      it cannot identify, applies ADDITIVE migrations only, rebuilds, records a
#      release identity, restarts, and then *proves* the running application is
#      the intended commit — restoring the previous commit when it is not.
#
# A table-rebuild migration is never applied by a deployment. It needs a human
# with a verified backup: see scripts/apply-deploy-schema.mjs --allow-rebuild and
# docs/DATABASE-RECOVERY-RUNBOOK.md.
#
# Nothing here prints a secret or a database URL value.
#
# Usage (self-hosted runner):
#   DEPLOY_COMMIT_SHA=<40-hex> DEPLOY_PAYLOAD_DIR="$GITHUB_WORKSPACE/.deploy-artifact" \
#     bash scripts/deploy-release.sh
set -Eeuo pipefail
umask 027

log()  { printf 'deploy: %s\n' "$*"; }
fail() { printf 'deploy: ERROR: %s\n' "$*" >&2; exit 1; }

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SHA="${DEPLOY_COMMIT_SHA:-}"
PAYLOAD="${DEPLOY_PAYLOAD_DIR:-${ROOT}/.deploy-artifact}"
if [[ -n "${ALO_INLINE_APP_DIR:-}" ]]; then
  APP_DIR="$ALO_INLINE_APP_DIR"
elif [[ -d "${HOME}/projects/Hosting-Portal/.git" ]]; then
  APP_DIR="${HOME}/projects/Hosting-Portal"
elif [[ -d "${HOME}/Hosting-Portal/.git" ]]; then
  APP_DIR="${HOME}/Hosting-Portal"
else
  APP_DIR="${HOME}/projects/Hosting-Portal"
fi
PORT="${PORT:-3051}"
HEALTH_URL="http://127.0.0.1:${PORT}/api/health"
LOGIN_URL="http://127.0.0.1:${PORT}/login"
LOG_DIR="${ALO_DEPLOY_LOG_DIR:-${HOME}/.alo-hosting/deploy-logs}"
IDENTITY_FILE="release-identity.json"

[[ "$SHA" =~ ^[0-9a-f]{40}$ ]] || fail "DEPLOY_COMMIT_SHA must be a full 40-character Git SHA (got '${SHA:-<empty>}')"

mkdir -p "$LOG_DIR" 2>/dev/null || true
RUN_LOG="${LOG_DIR}/${SHA}-$(date -u +%Y%m%dT%H%M%SZ).log"
exec > >(tee -a "$RUN_LOG") 2>&1
log "commit ${SHA}; log ${RUN_LOG}"

# ── 1. Read-only preflight decides the shape ─────────────────────────────────
export DEPLOY_COMMIT_SHA="$SHA" DEPLOY_PAYLOAD_DIR="$PAYLOAD" ALO_INLINE_APP_DIR="$APP_DIR"

# The workflow runs the preflight as its own read-only job (from the workspace
# checkout, where dev dependencies are installed) and hands the decision here,
# because at this point "$APP_DIR" is still on the previous commit and its
# node_modules may not be installed yet. Run standalone, this script does the
# preflight itself.
MODE="${DEPLOY_MODE:-}"
if [[ -z "$MODE" ]]; then
  PREFLIGHT="$(bash "$ROOT/scripts/deploy-preflight.sh" --json)" \
    || fail "preflight blocked this deployment; nothing was changed. Run: bash scripts/deploy-preflight.sh"
  MODE="$(node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{process.stdout.write(JSON.parse(s).decision.mode)})' <<<"$PREFLIGHT")"
  log "preflight selected mode: ${MODE}"
else
  log "mode supplied by the caller: ${MODE} (the workflow's read-only preflight job decided this)"
fi

if [[ "$MODE" == "canonical" ]]; then
  # ── 2. Canonical: promote the CI-built artifact into an immutable release ──
  log "promoting the CI artifact (no build on the production host)"
  bash "$ROOT/scripts/deploy-production.sh"
  log "canonical activation verified by scripts/deploy-production.sh"
  exit 0
fi

[[ "$MODE" == "inline" ]] || fail "preflight returned an unusable mode '${MODE}'"

# ── 3. Inline (hardened) ─────────────────────────────────────────────────────
cd "$APP_DIR"
[[ -d .git ]] || fail "$APP_DIR is not a git work tree"

PREV_SHA="$(git rev-parse HEAD)"
log "current commit ${PREV_SHA}"

# The preflight already proved the tree is clean; re-check because a build may
# have written into it since, and pulling over local changes is how work is lost.
[[ -z "$(git status --porcelain --untracked-files=normal)" ]] \
  || fail "the checkout gained local changes after preflight; refusing to pull over them"

# ── 3a. The database must be identified explicitly ───────────────────────────
# The applier refuses to run without an absolute DATABASE_URL, so the deploy has
# to be told which database it is allowed to change. It is never inferred from a
# relative path, and it may never live inside the Git checkout.
DB_URL="${DATABASE_URL:-}"
if [[ -z "$DB_URL" ]]; then
  for candidate in /etc/alo-hosting/panel.env "${APP_DIR}/.env.production" "${APP_DIR}/.env.local" "${APP_DIR}/.env"; do
    if [[ -r "$candidate" ]]; then
      # Read the value without sourcing the file (which could execute shell) and
      # without ever printing it.
      DB_URL="$(python3 - "$candidate" <<'PY'
import sys
for line in open(sys.argv[1], encoding="utf-8"):
    line = line.strip()
    if line.startswith("DATABASE_URL="):
        v = line.split("=", 1)[1].strip()
        if len(v) >= 2 and v[0] == v[-1] and v[0] in "\"'":
            v = v[1:-1]
        print(v)
        break
PY
)"
      [[ -n "$DB_URL" ]] && { log "database target resolved from ${candidate}"; break; }
    fi
  done
fi
[[ -n "$DB_URL" ]] || fail "no DATABASE_URL could be resolved for this host. Refusing to deploy: the schema step would not know which database it is allowed to change. Set DATABASE_URL (absolute file: path) in /etc/alo-hosting/panel.env."
[[ "$DB_URL" == file:/* ]] || fail "the resolved DATABASE_URL is not an absolute file: path; refusing to change a database this deploy cannot identify (scheme reported, value not printed)"
DB_FILE="${DB_URL#file:}"
[[ -f "$DB_FILE" ]] || fail "the resolved database file does not exist at the expected absolute path"
# A database inside the Git checkout is how a `git reset --hard` destroys
# production data, and it is also why the preflight refuses to pull over a dirty
# tree (the running app writes into it). It is refused unless an operator has
# explicitly accepted it for this host.
if [[ "$(realpath "$DB_FILE")" == "$(realpath "$APP_DIR")"/* ]]; then
  if [[ "${ALLOW_DB_IN_CHECKOUT:-0}" != "1" ]]; then
    fail "the production database is inside the Git checkout (${DB_FILE}). Refusing to deploy over it: a checkout reset would destroy live data, and the running app keeps making the tree dirty so no pull can ever be clean.
  Fix: stop the panel, move the database outside the checkout (e.g. /var/lib/alo-hosting/alo.db), set DATABASE_URL to the new absolute path in /etc/alo-hosting/panel.env, start the panel, then redeploy.
  Only if you have deliberately accepted this risk for this host, re-run with ALLOW_DB_IN_CHECKOUT=1. See docs/DATABASE-RECOVERY-RUNBOOK.md."
  fi
  log "WARNING: the database lives inside the Git checkout and ALLOW_DB_IN_CHECKOUT=1 was set. Restore copies are taken before every change."
fi
log "database target verified: absolute path, exists, engine is SQLite (value not printed)"

# ── 3b. Capture the state needed to restore ──────────────────────────────────
BACKUP_DIR="${ALO_DEPLOY_BACKUP_DIR:-${HOME}/.alo-hosting/deploy-backup/${SHA:0:12}}"
mkdir -p "$BACKUP_DIR"
[[ -f "$IDENTITY_FILE" ]] && cp -a "$IDENTITY_FILE" "$BACKUP_DIR/$IDENTITY_FILE" || true
if [[ -d .next ]]; then
  # Copy, do not move: a failed capture must not leave the app without a build.
  cp -a .next "$BACKUP_DIR/.next" 2>/dev/null || log "warning: could not capture .next for restore"
fi
PREV_DB_BACKUP="${BACKUP_DIR}/database-$(date -u +%Y%m%dT%H%M%SZ).db"
if cp -a "$DB_FILE" "$PREV_DB_BACKUP" 2>/dev/null; then
  log "captured a pre-deployment copy of the database ($(du -h "$PREV_DB_BACKUP" | cut -f1))"
else
  log "warning: could not copy the database file for restore; continuing because migrations are additive-only"
fi

restore() {
  log "restoring commit ${PREV_SHA}"
  git reset --hard "$PREV_SHA" >/dev/null 2>&1 || { log "RESTORE FAILED at git reset; manual intervention required"; return 1; }
  npm ci --include=dev >/dev/null 2>&1 || log "warning: npm ci failed during restore"
  npx prisma generate >/dev/null 2>&1 || log "warning: prisma generate failed during restore"
  npm run build >/dev/null 2>&1 || { log "RESTORE FAILED at build; manual intervention required"; return 1; }
  if [[ -f "$BACKUP_DIR/$IDENTITY_FILE" ]]; then cp -a "$BACKUP_DIR/$IDENTITY_FILE" "$IDENTITY_FILE"; else rm -f "$IDENTITY_FILE"; fi
  restart_panel
  if verify_health "$PREV_SHA"; then
    log "restored and verified commit ${PREV_SHA}"
    return 0
  fi
  log "RESTORE INCOMPLETE: commit ${PREV_SHA} is checked out but did not verify. Database copy: ${PREV_DB_BACKUP}"
  return 1
}

restart_panel() {
  pm2 restart alo-hosting-portal --update-env >/dev/null 2>&1 \
    || pm2 restart alo-hosting --update-env >/dev/null 2>&1 \
    || pm2 restart alo-dashboard --update-env >/dev/null 2>&1 \
    || PORT="$PORT" pm2 start npm --name "alo-hosting-portal" -- start >/dev/null 2>&1 \
    || { log "could not restart the panel through pm2"; return 1; }
  pm2 save >/dev/null 2>&1 || true
  sleep 4
}

# The health probe must identify the *release*, not merely answer. A response
# whose commit SHA differs from the one being deployed means the old process is
# still serving, which is exactly the failure this check exists to catch.
verify_health() {
  local expect="$1" attempt body
  for attempt in $(seq 1 30); do
    body="$(curl --silent --show-error --max-time 4 "$HEALTH_URL" 2>/dev/null || true)"
    if [[ -n "$body" ]] && printf '%s' "$body" | EXPECT="$expect" node -e '
      let input = "";
      process.stdin.on("data", (d) => (input += d)).on("end", () => {
        try {
          const r = JSON.parse(input);
          const d = r.data || {};
          const ok = r.success === true
            && d.databaseStatus === "connected"
            && d.schemaStatus === "current"
            && d.release
            && d.release.commitSha === process.env.EXPECT;
          process.exit(ok ? 0 : 1);
        } catch { process.exit(1); }
      });
    '; then
      return 0
    fi
    sleep 2
  done
  return 1
}

changed=0
trap 'code=$?; trap - EXIT; if (( code != 0 && changed == 1 )); then log "deployment failed after the checkout moved; attempting restore"; restore || log "MANUAL RECOVERY REQUIRED — see docs/DATABASE-RECOVERY-RUNBOOK.md"; fi; exit $code' EXIT

# ── 3c. Move to the target commit ────────────────────────────────────────────
git fetch origin main
LATEST_MAIN_SHA="$(git rev-parse origin/main)"
[[ "$SHA" == "$LATEST_MAIN_SHA" ]] || fail "commit ${SHA} is stale; origin/main is now ${LATEST_MAIN_SHA}. Refusing to deploy an obsolete queued run."
git merge-base --is-ancestor "$SHA" origin/main || fail "commit ${SHA} is not on origin/main; refusing to deploy something that was not merged"
if ! git merge-base --is-ancestor "$PREV_SHA" "$SHA"; then
  [[ "${ALLOW_RELEASE_ROLLBACK:-0}" == "1" ]] || fail "refusing backwards deployment from ${PREV_SHA} to ${SHA}. For an explicitly approved rollback, set ALLOW_RELEASE_ROLLBACK=1 and follow the recovery runbook."
  log "WARNING: explicitly authorized backwards deployment from ${PREV_SHA} to ${SHA}"
fi
git checkout main >/dev/null
git reset --hard "$SHA" >/dev/null
changed=1
log "checked out ${SHA}"

npm ci --include=dev
npx prisma generate

# ── 3d. Schema: ADDITIVE only, explicit target, verified ─────────────────────
# No --allow-rebuild: a deployment may never rewrite an existing table. The
# applier locks, verifies postconditions including audit_logs, and fails closed.
log "applying additive migrations (rebuild migrations require a separate authorized run)"
DATABASE_URL="$DB_URL" node "$APP_DIR/scripts/apply-deploy-schema.mjs" \
  || fail "additive migration or schema verification failed; the database was not rewritten (additive only)"
DATABASE_URL="$DB_URL" node "$APP_DIR/scripts/apply-deploy-schema.mjs" --verify \
  || fail "post-migration verification failed"

npm run build

# ── 3e. Record what is now running ──────────────────────────────────────────
ARTIFACT_SHA="null"
if [[ -d "$PAYLOAD" ]]; then
  ARTIFACT_SHA="\"$(find "$PAYLOAD" -type f -print0 2>/dev/null | sort -z | xargs -0 sha256sum 2>/dev/null | sha256sum | cut -d" " -f1)\""
fi
DEPLOYMENT_ID="$(node -e 'process.stdout.write(require("node:crypto").randomUUID())')"
cat > "$IDENTITY_FILE" <<JSON
{
  "commitSha": "${SHA}",
  "mode": "inline",
  "artifactSha256": ${ARTIFACT_SHA},
  "activatedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "deploymentId": "${DEPLOYMENT_ID}"
}
JSON
log "recorded release identity ${DEPLOYMENT_ID}"

restart_panel

# ── 3f. Prove it ────────────────────────────────────────────────────────────
verify_health "$SHA" || fail "health probe did not confirm release ${SHA} (commit SHA, database and schema). Restoring ${PREV_SHA}."
login_code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 5 "$LOGIN_URL" || true)"
[[ "$login_code" == 200 ]] || fail "/login returned HTTP ${login_code:-000}, expected 200. Restoring ${PREV_SHA}."

changed=0
trap - EXIT
log "verified release ${SHA}: health reports the commit, database and schema; /login HTTP 200"
log "pre-deployment state kept at ${BACKUP_DIR} (previous commit ${PREV_SHA})"
