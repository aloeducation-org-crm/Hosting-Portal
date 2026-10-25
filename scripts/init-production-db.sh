#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════════
# ALO Labs Hosting Panel — one-time production database bootstrap
# ═══════════════════════════════════════════════════════════════════════════════
# Creates the live SQLite database OUTSIDE the repository and replaces the
# seeded super-admin password (which is public in prisma/seed.ts) with a random
# one.
#
#   sudo bash scripts/init-production-db.sh
#   sudo bash scripts/init-production-db.sh --from /home/alamin/alo-hosting/current
#   sudo ADMIN_EMAIL=ops@alolabs.net ADMIN_PASSWORD='...' bash scripts/init-production-db.sh
#
# --from <dir>          where db/custom.db and prisma/schema.prisma come from
# --modules-from <dir>  where node_modules comes from. Point this at a full
#                       `npm ci` checkout, NOT at a deployed release:
#                       .next/standalone traces only the modules the app
#                       requires at runtime, so @libsql/client arrives there as
#                       a bare package.json whose lib-cjs/ main is missing.
#
# Why the database must not live in the repo:
#   * `db/custom.db` is tracked by git, so every checkout / `git reset --hard` /
#     fresh clone silently replaces production data with the committed snapshot.
#   * `file:./db/custom.db` resolves against the process working directory, so
#     the same app points at a different file depending on who started it.
#
# Idempotent: an existing live database is never overwritten (use --force).
# ═══════════════════════════════════════════════════════════════════════════════
set -euo pipefail
umask 077
[[ "$EUID" -eq 0 ]] || { echo "Run as root (sudo bash scripts/init-production-db.sh)" >&2; exit 77; }

DB_DIR="${ALO_DB_DIR:-/var/lib/alo-hosting}"
ADMIN_CREDENTIAL_FILE="${ADMIN_CREDENTIAL_FILE:-/root/alo-hosting-admin-credentials}"
DB_FILE="${DB_DIR}/alo.db"
APP_USER="${ALO_APP_USER:-alamin}"
# Keep the current production workflow's account as the backward-compatible default.
# New alo-panel units should pass ALO_APP_USER=alo-panel explicitly.
APP_GROUP="${ALO_APP_GROUP:-$(id -gn "${ALO_APP_USER:-alamin}" 2>/dev/null || echo "${ALO_APP_USER:-alamin}")}"
SEED_RELATIVE="db/custom.db"

APP_DIR=""
MODULES_DIR=""
FORCE=false
ROTATE=false

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BOLD='\033[1m'; NC='\033[0m'
ok()   { echo -e "  ${GREEN}✓${NC} $*"; }
warn() { echo -e "  ${YELLOW}⚠${NC} $*"; }
die()  { echo -e "  ${RED}✗ $*${NC}" >&2; exit 1; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --from)  APP_DIR="$2"; shift 2 ;;
    --modules-from) MODULES_DIR="$2"; shift 2 ;;
    --force) FORCE=true; shift ;;
    --rotate-password) ROTATE=true; shift ;;
    -h|--help)
      sed -n '2,26p' "$0"; exit 0 ;;
    *) die "unknown argument: $1" ;;
  esac
done

# ── Locate the release that carries the seed database ─────────────────────────
if [[ -z "$APP_DIR" ]]; then
  here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  APP_DIR="$(dirname "$here")"
fi
[[ -f "${APP_DIR}/${SEED_RELATIVE}" ]] \
  || die "seed database not found at ${APP_DIR}/${SEED_RELATIVE} (pass --from <release-dir>)"
# Where the node modules come from. A deployed release (.next/standalone) is a
# RUNTIME bundle: Next's file tracing copies only what the app itself requires,
# so @libsql/client lands there as a bare package.json whose "main"
# (lib-cjs/node.js) was never traced — requiring it throws MODULE_NOT_FOUND.
# This script is tooling, not the app, so by default it takes its modules from
# the same tree, but callers should point it at a full `npm ci` checkout:
#   alo-init-db --from <release> --modules-from <workspace>
MODULES_DIR="${MODULES_DIR:-${ALO_MODULES_DIR:-$APP_DIR}}"
[[ -d "${MODULES_DIR}/node_modules/bcryptjs" ]] \
  || die "bcryptjs not found under ${MODULES_DIR}/node_modules — pass --modules-from <checkout with npm ci>"

echo -e "${BOLD}ALO Labs — production database bootstrap${NC}"
echo "  release:  ${APP_DIR}"
echo "  database: ${DB_FILE}"
echo ""

# ── 1. Directory ─────────────────────────────────────────────────────────────
mkdir -p "$DB_DIR"
chown "${APP_USER}:${APP_GROUP}" "$DB_DIR"
chmod 0750 "$DB_DIR"
ok "directory ${DB_DIR} (${APP_USER}:${APP_GROUP}, 0750)"

# ── 2. Seed copy ─────────────────────────────────────────────────────────────
SEEDED=false
if [[ -f "$DB_FILE" && "$FORCE" != true ]]; then
  ok "database already exists — leaving production data untouched (use --force to reseed)"
else
  SEEDED=true
  [[ -f "$DB_FILE" ]] && cp -a "$DB_FILE" "${DB_FILE}.bak.$(date +%Y%m%d%H%M%S)"
  install -m 0640 -o "${APP_USER}" -g "${APP_GROUP}" "${APP_DIR}/${SEED_RELATIVE}" "$DB_FILE"
  ok "seeded from ${SEED_RELATIVE} ($(du -h "$DB_FILE" | cut -f1))"
fi

# ── 2b. Resolve a node binary ───────────────────────────────────────────────
# `sudo` resets PATH to secure_path (/usr/local/sbin:/usr/local/bin:/usr/sbin:
# /usr/bin:/sbin:/bin), which does NOT contain an nvm-managed node. That is why
# `node`/`npm`/`pm2` work in an interactive SSH shell and vanish under sudo or
# inside a GitHub Actions runner. Find the real binary instead of trusting PATH.
NODE_BIN="$(command -v node || true)"
if [[ -z "$NODE_BIN" ]]; then
  NODE_BIN="$(ls -1d /home/"${APP_USER}"/.nvm/versions/node/*/bin/node 2>/dev/null | sort -V | tail -1 || true)"
fi
[[ -n "$NODE_BIN" && -x "$NODE_BIN" ]] \
  || die "no node binary found (looked in PATH and /home/${APP_USER}/.nvm/versions/node/*/bin)"
ok "node: ${NODE_BIN} ($("$NODE_BIN" -v))"

# Fail here with a useful message rather than as a MODULE_NOT_FOUND stack trace
# halfway through credential rotation (which would leave the DB seeded but the
# published admin123 password still in place).
"$NODE_BIN" -e '
  const p = require("path");
  for (const mod of ["bcryptjs", "@libsql/client"]) {
    require(p.join(process.argv[1], "node_modules", ...mod.split("/")));
  }
' "$MODULES_DIR" >/dev/null 2>&1 \
  || die "cannot load bcryptjs / @libsql/client from ${MODULES_DIR}/node_modules —
     a .next/standalone release is deliberately incomplete, so pass
     --modules-from <dir with a full 'npm ci' node_modules>"
ok "modules: ${MODULES_DIR}/node_modules"

# ── 3. Sanity check the schema really is there ───────────────────────────────
# Counting tables is not enough: the seed database has previously shipped 74
# tables while being 10 COLUMNS behind prisma/schema.prisma, which turns every
# login into a 500 (`prisma:error SQLITE_ERROR: no such column: operationJobId`)
# with nothing wrong-looking in `prisma migrate status`. Apply Prisma's safe
# default (no --accept-data-loss), then independently compare every column.
[[ -f "${APP_DIR}/prisma/schema.prisma" ]] || die "Prisma schema missing at ${APP_DIR}/prisma/schema.prisma"
[[ -f "${MODULES_DIR}/node_modules/prisma/build/index.js" ]] || die "Prisma CLI missing under ${MODULES_DIR}/node_modules"
echo "  applying Prisma schema to ${DB_FILE} (no --accept-data-loss)"
if ! sudo -u "${APP_USER}" env \
  PATH="$(dirname "$NODE_BIN"):/usr/local/bin:/usr/bin:/bin" \
  DATABASE_URL="file:${DB_FILE}" \
  "$NODE_BIN" "${MODULES_DIR}/node_modules/prisma/build/index.js" db push \
  --schema "${APP_DIR}/prisma/schema.prisma" --skip-generate; then
  die "Prisma schema update failed; refusing to continue with a drifted production database"
fi
ok "Prisma schema applied safely"

drift=$(sudo -u "${APP_USER}" python3 - "$DB_FILE" "${APP_DIR}/prisma/schema.prisma" <<'PY' 2>/dev/null || echo "ERROR"
import re, sqlite3, sys
db_file, schema_file = sys.argv[1], sys.argv[2]
SCALARS = {"String","Boolean","Int","BigInt","Float","Decimal","DateTime","Bytes","Json"}
schema = open(schema_file, encoding="utf-8").read()
enums = set(re.findall(r'^enum\s+(\w+)\s*\{', schema, re.M))
con = sqlite3.connect(db_file)
actual = {}
for (t,) in con.execute("select name from sqlite_master where type='table'"):
    actual[t] = {r[1] for r in con.execute('PRAGMA table_info("%s")' % t)}
models = re.findall(r'^model\s+(\w+)\s*\{(.*?)^\}', schema, re.S | re.M)
missing = []
for name, body in models:
    m = re.search(r'@@map\("([^"]+)"\)', body)
    table = m.group(1) if m else name
    if table not in actual:
        missing.append("table " + table); continue
    for line in body.splitlines():
        line = line.strip()
        if not line or line.startswith('//') or line.startswith('@@'): continue
        parts = line.split()
        if len(parts) < 2: continue
        field, ftype = parts[0], parts[1]
        base = ftype.rstrip('?')
        if base.endswith('[]'): continue
        if base not in SCALARS and base not in enums: continue
        cm = re.search(r'@map\("([^"]+)"\)', line)
        col = cm.group(1) if cm else field
        if col not in actual[table]:
            missing.append("%s.%s" % (table, col))
print("%d|%d|%s" % (len(models), len(actual), ",".join(missing)))
PY
)
[[ "$drift" == "ERROR" || -z "$drift" ]] \
  && die "could not verify ${DB_FILE} against prisma/schema.prisma (python3/sqlite3 available?)"

models_n="${drift%%|*}"; rest="${drift#*|}"; tables_n="${rest%%|*}"; missing="${rest#*|}"
[[ "${tables_n:-0}" -ge 70 ]] \
  || die "expected 70+ tables in ${DB_FILE}, found ${tables_n:-0} — wrong seed or wrong schema"
ok "schema verified (${models_n} models / ${tables_n} tables)"

if [[ -n "$missing" ]]; then
  echo -e "  ${RED}the database is behind prisma/schema.prisma — missing:${NC}"
  echo "$missing" | tr ',' '\n' | sed 's/^/      /'
  echo ""
  echo "  Reconcile it, then re-run this script:"
  echo "    cd ${APP_DIR}"
  echo "    DATABASE_URL=\"file:${DB_FILE}\" npx prisma db push"
  die "refusing to hand a drifted database to production — the affected routes would 500"
fi

# ── 4. Rotate the seeded credentials ────────────────────────────────────────
# prisma/seed.ts publishes admin123 / reseller123 / client123 in a public repo.
# Any of them left in a production database is an instant SUPER_ADMIN takeover.
#
# But rotating on EVERY run is its own footgun: this script is called by the
# deploy workflow, so an unconditional rotation would invalidate the operator's
# admin password on every deploy. Hardening therefore happens only when
#   (a) this run created/reseeded the database, or
#   (b) the stored password still equals the published seed default, or
#   (c) --rotate-password was passed explicitly.
ADMIN_EMAIL="${ADMIN_EMAIL:-admin@alolabs.net}"
HARDEN_LOG="$(mktemp)"      # 0600, so the user list never lands in a world-readable file
trap 'rm -f "$HARDEN_LOG"' EXIT
GENERATED=""
if [[ -z "${ADMIN_PASSWORD:-}" ]]; then
  # 16 random bytes rendered as hex: exactly 32 cryptographically random characters.
  ADMIN_PASSWORD="$(openssl rand -hex 16)"
  GENERATED="yes"
fi

MODULES_DIR="$MODULES_DIR" DB_FILE="$DB_FILE" ADMIN_EMAIL="$ADMIN_EMAIL" ADMIN_PASSWORD="$ADMIN_PASSWORD" \
  HARDEN="$( [[ "$SEEDED" == true || "$ROTATE" == true ]] && echo yes || echo auto )" \
  sudo -u "${APP_USER}" -E "$NODE_BIN" - <<'NODE' | tee "$HARDEN_LOG"
const path = require("node:path");
const app = process.env.MODULES_DIR;
const bcrypt = require(path.join(app, "node_modules", "bcryptjs"));
const { createClient } = require(path.join(app, "node_modules", "@libsql", "client"));

// Passwords published in prisma/seed.ts. If any of them still verifies, the
// database is a seed snapshot and must be hardened regardless of HARDEN mode.
const PUBLISHED = {
  "admin@alolabs.net": "admin123",
  "reseller@alolabs.net": "reseller123",
  "client@alolabs.net": "client123",
};

(async () => {
  const client = createClient({ url: "file:" + process.env.DB_FILE });
  const harden = process.env.HARDEN;

  const rows = await client.execute(
    "SELECT u.id, u.email, u.passwordHash, u.isActive, r.name AS role " +
    "FROM users u LEFT JOIN roles r ON r.id = u.roleId ORDER BY u.email",
  );
  if (rows.rows.length === 0) {
    console.error("no users in the database — nothing to harden");
    process.exit(1);
  }

  const stillDefault = [];
  for (const u of rows.rows) {
    const published = PUBLISHED[String(u.email)];
    if (published && u.passwordHash && (await bcrypt.compare(published, String(u.passwordHash)))) {
      stillDefault.push(String(u.email));
    }
  }

  const mustRotate = harden === "yes" || stillDefault.includes(process.env.ADMIN_EMAIL);

  if (mustRotate) {
    const hash = await bcrypt.hash(process.env.ADMIN_PASSWORD, 12);
    const res = await client.execute(
      "UPDATE users SET passwordHash = ?, failedLoginAttempts = 0, isLocked = 0, lockedUntil = NULL WHERE email = ?",
      [hash, process.env.ADMIN_EMAIL],
    );
    if (res.rowsAffected === 0) {
      console.error(`no user with email ${process.env.ADMIN_EMAIL} — set ADMIN_EMAIL and re-run`);
      process.exit(1);
    }
    for (const email of stillDefault) {
      if (email !== process.env.ADMIN_EMAIL) {
        await client.execute("UPDATE users SET isActive = 0 WHERE email = ?", [email]);
      }
    }
    process.env.ROTATED = "yes";
  }

  const after = await client.execute(
    "SELECT u.email, r.name AS role, u.isActive FROM users u LEFT JOIN roles r ON r.id = u.roleId ORDER BY u.email",
  );
  console.log(mustRotate ? "  ROTATED=yes" : "  ROTATED=no");
  console.log("  users now:");
  for (const r of after.rows) {
    console.log(`    ${String(r.email).padEnd(26)} ${String(r.role).padEnd(12)} active=${r.isActive}`);
  }
  client.close();
})().catch((e) => { console.error(e.message); process.exit(1); });
NODE

ROTATED="$(grep -oE 'ROTATED=(yes|no)' "$HARDEN_LOG" 2>/dev/null | head -1 | cut -d= -f2 || echo no)"
rm -f "$HARDEN_LOG"
ok "credential hardening pass complete (rotated=${ROTATED:-no})"

# ── 5. Report ───────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}Database ready.${NC} Add this to /etc/alo-hosting/panel.env:"
echo ""
echo "    DATABASE_URL=\"file:${DB_FILE}\""
echo ""
if [[ "$ROTATED" != "yes" ]]; then
  echo -e "  ${BOLD}No credential change was needed${NC} — the admin password is not the published"
  echo "  seed default, and this run did not reseed the database. Pass --rotate-password"
  echo "  (with ADMIN_PASSWORD=… if you want to choose it) to force a rotation."
  echo ""
  exit 0
fi

if [[ -n "$GENERATED" ]]; then
  install -d -m 0700 "$(dirname "$ADMIN_CREDENTIAL_FILE")"
  printf 'ADMIN_EMAIL=%s\nADMIN_PASSWORD=%s\n' "$ADMIN_EMAIL" "$ADMIN_PASSWORD" >"$ADMIN_CREDENTIAL_FILE"
  chmod 0600 "$ADMIN_CREDENTIAL_FILE"
  chown root:root "$ADMIN_CREDENTIAL_FILE"
  echo -e "${RED}${BOLD}  SUPER-ADMIN CREDENTIALS generated and stored securely.${NC}"
  echo "  credential file: ${ADMIN_CREDENTIAL_FILE} (root:root, mode 0600)"
  echo "  Read it locally as root and transfer the password to an approved password manager."
  echo "  The password is deliberately not printed to this terminal or CI logs."
else
  echo "  Admin password set from \$ADMIN_PASSWORD (not echoed)."
fi
echo ""
echo "  Then:  sudo systemctl restart alo-hosting-panel"
echo "         curl -s http://127.0.0.1:3051/api/health"
echo ""
