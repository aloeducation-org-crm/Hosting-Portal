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

# ── 0. Is this release allowed to activate at all? ───────────────────────────
# Decided before ANYTHING is touched and before the deployment shape is chosen,
# so it protects the canonical path too — a stale or backwards release must not
# be able to reach production through either shape.
#
# Two failure modes this closes, both observed in runs #54–#64:
#   - Obsolete queued runs. Merge-to-main runs are serialized by the workflow's
#     `hosting-production-deploy` group and never cancelled, so an old run waits
#     its turn and then deploys. Commit 123d558 (run #62) is a direct ancestor
#     of 7fc3d15 (run #64); only an unrelated preflight failure stopped it from
#     resetting production backwards and reporting success.
#   - A guard that passes vacuously. Actions checks out with `fetch-depth: 1`,
#     and `git fetch origin main` in a shallow clone leaves `origin/main` at the
#     run's own commit, so comparing against `git rev-parse origin/main` is true
#     for exactly the stale run it should reject. The head of main is therefore
#     resolved independently of the clone by scripts/latest-main-sha.mjs, and
#     resolved-or-refuse: unknown means do not deploy.
LATEST_MAIN_SHA="$(node "$ROOT/scripts/latest-main-sha.mjs" --ref main 2>/dev/null || true)"
if [[ ! "$LATEST_MAIN_SHA" =~ ^[0-9a-f]{40}$ ]]; then
  log "WARNING: the head of main could not be resolved; the staleness guard fails closed"
  LATEST_MAIN_SHA=""
fi

# The release that is serving right now, from the identity record the previous
# deployment wrote; falling back to what the checkout points at. A host that has
# never deployed through these scripts has neither, which is a first deployment,
# not a rollback — the guard distinguishes those instead of guessing.
RUNNING_SHA=""
CANONICAL_ROOT="${ALO_HOSTING_ROOT:-${HOME}/alo-hosting}"
if [[ -r "${CANONICAL_ROOT}/current/release-identity.json" ]]; then
  RUNNING_SHA="$(node -e '
    const fs = require("node:fs");
    try {
      const p = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
      if (/^[0-9a-f]{40}$/.test(p.commitSha || "")) process.stdout.write(p.commitSha);
    } catch { /* unknown stays unknown */ }
  ' "${CANONICAL_ROOT}/current/release-identity.json" 2>/dev/null || true)"
fi
if [[ ! "$RUNNING_SHA" =~ ^[0-9a-f]{40}$ && -d "$APP_DIR/.git" ]]; then
  if [[ -r "$APP_DIR/$IDENTITY_FILE" ]]; then
    RUNNING_SHA="$(node -e '
      const fs = require("node:fs");
      try {
        const p = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
        if (/^[0-9a-f]{40}$/.test(p.commitSha || "")) process.stdout.write(p.commitSha);
      } catch { /* unknown stays unknown */ }
    ' "$APP_DIR/$IDENTITY_FILE" 2>/dev/null || true)"
  fi
  if [[ ! "$RUNNING_SHA" =~ ^[0-9a-f]{40}$ ]]; then
    RUNNING_SHA="$(git -C "$APP_DIR" rev-parse HEAD 2>/dev/null || true)"
  fi
fi
[[ "$RUNNING_SHA" =~ ^[0-9a-f]{40}$ ]] || RUNNING_SHA=""

# Ancestry needs real history. `git fetch origin main` without a refspec writes
# only FETCH_HEAD in a shallow clone, so `origin/main` would stay stale and every
# merge-base answer below would be meaningless (or a hard error).
git -C "$ROOT" fetch --quiet origin 2>/dev/null || true
if [[ -f "$(git -C "$ROOT" rev-parse --git-dir 2>/dev/null)/shallow" ]]; then
  git -C "$ROOT" fetch --quiet --unshallow origin 2>/dev/null \
    || git -C "$ROOT" fetch --quiet --deepen=500 origin 2>/dev/null \
    || log "WARNING: history is still shallow; ancestry facts may be unavailable"
fi
git -C "$ROOT" fetch --quiet origin '+refs/heads/main:refs/remotes/origin/main' 2>/dev/null || true

ancestor_or_unknown() {
  # Echoes true / false / unknown. "unknown" is reported when either commit is
  # absent from the local history, so the caller can fail closed instead of
  # reading a git error as "not an ancestor".
  local from="$1" to="$2"
  [[ -n "$from" && -n "$to" ]] || { printf 'unknown'; return 0; }
  git -C "$ROOT" cat-file -e "${from}^{commit}" 2>/dev/null || { printf 'unknown'; return 0; }
  git -C "$ROOT" cat-file -e "${to}^{commit}"   2>/dev/null || { printf 'unknown'; return 0; }
  if git -C "$ROOT" merge-base --is-ancestor "$from" "$to" 2>/dev/null; then
    printf 'true'
  else
    printf 'false'
  fi
}

TARGET_ON_MAIN="$(ancestor_or_unknown "$SHA" "${LATEST_MAIN_SHA:-origin/main}")"
RUNNING_ANCESTOR_OF_TARGET="$(ancestor_or_unknown "$RUNNING_SHA" "$SHA")"
TARGET_ANCESTOR_OF_RUNNING="$(ancestor_or_unknown "$SHA" "$RUNNING_SHA")"

json_string() {
  # Quote a value as JSON without letting its content break the document, and
  # without invoking a shell on it. Empty becomes null.
  local value="$1"
  if [[ -z "$value" ]]; then printf 'null'; return 0; fi
  node -e 'process.stdout.write(JSON.stringify(process.argv[1]))' "$value"
}

GUARD_FACTS="$(printf '{"targetSha":%s,"latestMainSha":%s,"runningSha":%s,"targetOnMain":%s,"runningIsAncestorOfTarget":%s,"targetIsAncestorOfRunning":%s}' \
  "$(json_string "$SHA")" "$(json_string "$LATEST_MAIN_SHA")" "$(json_string "$RUNNING_SHA")" \
  "$( [[ "$TARGET_ON_MAIN" == "true" ]] && echo true || echo false )" \
  "$( [[ "$RUNNING_ANCESTOR_OF_TARGET" == "true" ]] && echo true || echo false )" \
  "$( [[ "$TARGET_ANCESTOR_OF_RUNNING" == "true" ]] && echo true || echo false )")"

GUARD_AUTH="$(printf '{"allowRollback":%s,"operator":%s,"reason":%s}' \
  "$( [[ "${ALLOW_RELEASE_ROLLBACK:-0}" == "1" ]] && echo true || echo false )" \
  "$(json_string "${RELEASE_ROLLBACK_OPERATOR:-}")" \
  "$(json_string "${RELEASE_ROLLBACK_REASON:-}")")"

GUARD_DECISION="$(printf '{"facts":%s,"authorization":%s}' "$GUARD_FACTS" "$GUARD_AUTH" \
  | node "$ROOT/scripts/decide-release-activation.mjs")" \
  || fail "release ${SHA} is not authorized to activate: $(node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.stdout.write(JSON.parse(s).reason)}catch{process.stdout.write(s.trim())}})' <<<"$GUARD_DECISION")"

GUARD_ROLLBACK="$(node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{process.stdout.write(String(JSON.parse(s).rollback===true))})' <<<"$GUARD_DECISION")"
log "release guard: $(node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const d=JSON.parse(s);process.stdout.write(d.code+" — "+d.reason)})' <<<"$GUARD_DECISION")"

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
# Section 0 already authorized this release against an authoritative main head.
# Re-assert it here against the same resolved value rather than re-deriving it
# from `git rev-parse origin/main`, which a shallow clone silently pins to this
# run's own commit — the hole that made the original staleness check vacuous.
[[ -n "$LATEST_MAIN_SHA" && "$SHA" == "$LATEST_MAIN_SHA" ]] \
  || fail "commit ${SHA} is stale; main is now ${LATEST_MAIN_SHA:-<unresolved>}. Refusing to deploy an obsolete queued run."
git fetch origin '+refs/heads/main:refs/remotes/origin/main'
git merge-base --is-ancestor "$SHA" origin/main || fail "commit ${SHA} is not on origin/main; refusing to deploy something that was not merged"
# Backwards movement was already decided in section 0 by the tested guard, which
# reads the release that is actually serving rather than trusting HEAD. Kept as a
# second, independent assertion because this is the last point before the tree
# moves and the cost of being wrong is a production rollback nobody asked for.
git fetch origin main
LATEST_MAIN_SHA="$(git rev-parse origin/main)"
[[ "$SHA" == "$LATEST_MAIN_SHA" ]] || fail "commit ${SHA} is stale; origin/main is now ${LATEST_MAIN_SHA}. Refusing to deploy an obsolete queued run."
git merge-base --is-ancestor "$SHA" origin/main || fail "commit ${SHA} is not on origin/main; refusing to deploy something that was not merged"
if ! git merge-base --is-ancestor "$PREV_SHA" "$SHA"; then
  [[ "${ALLOW_RELEASE_ROLLBACK:-0}" == "1" ]] || fail "refusing backwards deployment from ${PREV_SHA} to ${SHA}. For an explicitly approved rollback, set ALLOW_RELEASE_ROLLBACK=1 and follow the recovery runbook."
  log "WARNING: explicitly authorized backwards deployment from ${PREV_SHA} to ${SHA}"
fi
git checkout main >/dev/null
# Last revalidation before the only irreversible step. The workflow's
# single-flight group makes deploys run one at a time, but a run can sit in that
# queue for hours — run #62 waited two — so "was latest when the run started" is
# not evidence of "is latest now". Anything that fails here fails before
# `changed=1`, so nothing has been touched and no restore is needed.
REVALIDATED_MAIN_SHA="$(node "$ROOT/scripts/latest-main-sha.mjs" --ref main 2>/dev/null || true)"
if [[ "$REVALIDATED_MAIN_SHA" =~ ^[0-9a-f]{40}$ && "$REVALIDATED_MAIN_SHA" != "$SHA" ]]; then
  fail "main advanced to ${REVALIDATED_MAIN_SHA} while this run waited to deploy ${SHA}. Refusing to activate a superseded release; re-run the workflow for the new head."
fi
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

# ── 3e-bis. Attribute the rollback, if this was one ──────────────────────────
# A rollback is the only deployment that knowingly moves production backwards,
# so it is the one that must still answer "who, from what, to what, why" months
# later. The record is appended to the deploy-log directory OUTSIDE the Git
# checkout: writing it into the tree would make the next deployment's dirty-tree
# check fail, which is precisely the deadlock that blocked runs #54–#64.
if [[ "$GUARD_ROLLBACK" == "true" ]]; then
  ROLLBACK_AUDIT_FILE="${ALO_ROLLBACK_AUDIT_FILE:-${LOG_DIR}/rollback-audit.jsonl}"
  node -e '
    const fs = require("node:fs");
    const record = JSON.parse(process.argv[1]);
    record.deploymentId = process.argv[2];
    fs.appendFileSync(process.argv[3], JSON.stringify(record) + "\n", { mode: 0o640 });
  ' "$(printf '{"event":"release-rollback","recordedAt":"%s","operator":%s,"reason":%s,"sourceRelease":%s,"targetRelease":%s,"mainHeadAtDecision":%s,"result":"authorized"}' \
        "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
        "$(json_string "${RELEASE_ROLLBACK_OPERATOR:-}")" \
        "$(json_string "${RELEASE_ROLLBACK_REASON:-}")" \
        "$(json_string "$RUNNING_SHA")" \
        "$(json_string "$SHA")" \
        "$(json_string "$LATEST_MAIN_SHA")")" \
     "$DEPLOYMENT_ID" "$ROLLBACK_AUDIT_FILE" \
    && log "rollback audit record appended to ${ROLLBACK_AUDIT_FILE}" \
    || log "WARNING: the rollback audit record could not be written to ${ROLLBACK_AUDIT_FILE}"
fi

restart_panel

# ── 3f. Prove it ────────────────────────────────────────────────────────────
verify_health "$SHA" || fail "health probe did not confirm release ${SHA} (commit SHA, database and schema). Restoring ${PREV_SHA}."
login_code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 5 "$LOGIN_URL" || true)"
[[ "$login_code" == 200 ]] || fail "/login returned HTTP ${login_code:-000}, expected 200. Restoring ${PREV_SHA}."

changed=0
trap - EXIT
log "verified release ${SHA}: health reports the commit, database and schema; /login HTTP 200"
log "pre-deployment state kept at ${BACKUP_DIR} (previous commit ${PREV_SHA})"
