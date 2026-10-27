#!/usr/bin/env bash
# Activate an already-built standalone Next.js payload on the production host.
# Intended for the repository's self-hosted GitHub Actions runner only.
set -Eeuo pipefail
umask 027

fail() { printf 'deploy: ERROR: %s\n' "$*" >&2; exit 1; }
log() { printf 'deploy: %s\n' "$*"; }

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PAYLOAD="${DEPLOY_PAYLOAD_DIR:-${ROOT}/.deploy-artifact}"
SHA="${DEPLOY_COMMIT_SHA:-$(git -C "$ROOT" rev-parse HEAD)}"
APP_ROOT="${ALO_HOSTING_ROOT:-${HOME}/alo-hosting}"
ENV_FILE="${PANEL_ENV_FILE:-/etc/alo-hosting/panel.env}"
DB_FILE="${PRODUCTION_DB_FILE:-/var/lib/alo-hosting/alo.db}"
PORT="${PORT:-3051}"
RELEASES="${APP_ROOT}/releases"
CURRENT="${APP_ROOT}/current"
RELEASE="${RELEASES}/${SHA}"
STAGING="${RELEASES}/.${SHA}.staging.$$"
HEALTH_URL="http://127.0.0.1:${PORT}/api/health"
activated=0
succeeded=0
previous=""

[[ "$SHA" =~ ^[0-9a-f]{40}$ ]] || fail "commit SHA is not a full 40-character Git SHA"
[[ -d "$PAYLOAD/.next/standalone" && -s "$PAYLOAD/.next/standalone/server.js" ]] \
  || fail "standalone server bundle missing in $PAYLOAD"
[[ -d "$PAYLOAD/.next/static" && -d "$PAYLOAD/public" && -f "$PAYLOAD/prisma/schema.prisma" ]] \
  || fail "release payload is incomplete (static, public, or Prisma schema missing)"
[[ -f "$ROOT/scripts/init-production-db.sh" ]] || fail "database bootstrap helper missing from checkout"
[[ -r "$ENV_FILE" ]] || fail "$ENV_FILE is missing or unreadable; run scripts/bootstrap-server.sh on the host first"
[[ -f "$DB_FILE" ]] || fail "production database is missing at $DB_FILE; initialize it explicitly before deploying"

# Validate only the presence/shape of required settings without sourcing the
# root-owned file (which could execute shell expressions) or printing secrets.
python3 - "$ENV_FILE" "$DB_FILE" "$ROOT" <<'PY'
import os, sys
filename, db_file, repo = sys.argv[1:]
values = {}
with open(filename, encoding="utf-8") as f:
    for line in f:
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        values[key.strip()] = value
for key in ("NEXTAUTH_SECRET", "JWT_SECRET"):
    if len(values.get(key, "")) < 32:
        raise SystemExit(f"deploy: ERROR: {key} missing or shorter than 32 characters in production env")
url = values.get("DATABASE_URL", "")
if not url.startswith("file:/"):
    raise SystemExit("deploy: ERROR: DATABASE_URL must be an absolute SQLite file URL")
if os.path.realpath(url[5:]) != os.path.realpath(db_file):
    raise SystemExit("deploy: ERROR: configured database path does not match the expected external production database")
if os.path.commonpath((os.path.realpath(db_file), os.path.realpath(repo))) == os.path.realpath(repo):
    raise SystemExit("deploy: ERROR: production database must not be inside the Git checkout")
PY

mkdir -p "$RELEASES" "${APP_ROOT}/logs"
[[ -w "$RELEASES" ]] || fail "runner cannot write release directory $RELEASES"
if [[ -e "$CURRENT" && ! -L "$CURRENT" ]]; then
  fail "$CURRENT exists but is not a symlink; refusing to replace it"
fi
if [[ -L "$CURRENT" ]]; then
  previous="$(readlink -f "$CURRENT" || true)"
  [[ -d "$previous" ]] || fail "current symlink is dangling; repair it before deploying"
fi

cleanup() {
  local code=$?
  trap - EXIT
  rm -rf "$STAGING"
  if (( activated == 1 && succeeded == 0 )); then
    log "deployment verification failed; restoring previous release"
    if [[ -n "$previous" && -d "$previous" ]]; then
      local rollback_link="${APP_ROOT}/.current-rollback.$$"
      ln -s "$previous" "$rollback_link"
      mv -Tf "$rollback_link" "$CURRENT"
    else
      rm -f "$CURRENT"
    fi
    sudo -n /usr/bin/systemctl restart alo-hosting-panel || true
    log "rollback attempt finished"
  fi
  exit "$code"
}
trap cleanup EXIT

if [[ ! -d "$RELEASE" ]]; then
  mkdir -p "$STAGING/.next" "$STAGING/scripts"
  cp -a "$PAYLOAD/.next/standalone/." "$STAGING/"
  cp -a "$PAYLOAD/.next/static" "$STAGING/.next/static"
  cp -a "$PAYLOAD/public" "$STAGING/public"
  cp -a "$PAYLOAD/prisma" "$STAGING/prisma"
  install -m 0755 "$ROOT/scripts/init-production-db.sh" "$STAGING/scripts/init-production-db.sh"
  test -s "$STAGING/server.js" || fail "copied release has no server.js entrypoint"

  # Record what this release is, so /api/health can prove which commit is
  # serving and the probe below can verify it after activation. Written before
  # the directory becomes immutable; it carries no secrets.
  payload_digest="null"
  if command -v sha256sum >/dev/null 2>&1; then
    payload_digest="\"$(cd "$PAYLOAD" && find . -type f -print0 | sort -z | xargs -0 sha256sum | sha256sum | cut -d' ' -f1)\""
  fi
  cat > "$STAGING/release-identity.json" <<JSON
{
  "commitSha": "${SHA}",
  "mode": "canonical",
  "artifactSha256": ${payload_digest},
  "activatedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "deploymentId": "$(node -e 'process.stdout.write(require("node:crypto").randomUUID())')"
}
JSON
  log "recorded release identity for ${SHA}"

  mv "$STAGING" "$RELEASE"
  log "assembled immutable release $SHA"
else
  log "release $SHA already exists; reusing immutable release"
fi

# The sudoers rule intentionally permits only this fixed helper path and a
# source under /home/alamin/alo-hosting/releases/<sha>/scripts/.
sudo -n /usr/bin/install -m 0755 "$RELEASE/scripts/init-production-db.sh" /usr/local/sbin/alo-init-db

link_tmp="${APP_ROOT}/.current-${SHA}"
ln -s "$RELEASE" "$link_tmp"
mv -Tf "$link_tmp" "$CURRENT"
activated=1
log "activated release $SHA; restarting systemd service"
sudo -n /usr/bin/systemctl restart alo-hosting-panel

healthy=0
for attempt in $(seq 1 30); do
  body="$(curl --silent --show-error --max-time 4 "$HEALTH_URL" 2>/dev/null || true)"
  if [[ -n "$body" ]] && printf '%s' "$body" | EXPECT_SHA="$SHA" node -e '
    let input=""; process.stdin.on("data", d => input += d).on("end", () => {
      try {
        const result = JSON.parse(input);
        const data = result.data || {};
        const identified = Boolean(data.release) && data.release.commitSha === process.env.EXPECT_SHA;
        process.exit(result.success === true && data.databaseStatus === "connected" && data.schemaStatus === "current" && identified ? 0 : 1);
      } catch { process.exit(1); }
    });
  '; then
    healthy=1
    break
  fi
  sleep 2
done
(( healthy == 1 )) || fail "health probe did not confirm release ${SHA} (database, schema and the running commit SHA) at $HEALTH_URL"

login_code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 5 "http://127.0.0.1:${PORT}/login" || true)"
[[ "$login_code" == 200 ]] || fail "/login returned HTTP ${login_code:-000}, expected 200"
succeeded=1
log "verified release $SHA: health reports this exact commit, database/schema PASS, /login HTTP 200"
log "active release: $(readlink -f "$CURRENT")"
