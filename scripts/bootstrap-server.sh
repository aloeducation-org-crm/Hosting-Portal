#!/usr/bin/env bash
#
# bootstrap-server.sh — one-time server setup for the ALO Hosting production
# deploy. It installs exactly the four things `.github/workflows/ci-cd.yml`
# requires before it will swap a release, and it is safe to re-run.
#
#   1. /etc/alo-hosting/panel.env        (DATABASE_URL + freshly generated secrets)
#   2. /var/lib/alo-hosting/alo.db       (schema verified, seed password rotated)
#   3. systemd unit alo-hosting-panel    (127.0.0.1:3051, survives reboot)
#   4. /etc/sudoers.d/alo-hosting-deploy (the workflow's four passwordless commands)
#      + /usr/local/sbin/alo-init-db     (stable path the sudoers rule allows)
#
# Run this ON THE SERVER, from a checkout that has had `npm ci`:
#
#   cd ~/projects/Hosting-Portal
#   sudo bash scripts/bootstrap-server.sh --domain hosting.alolabs.net
#
# Then merge to main (or re-run a failed production deploy run) and it will deploy.
#
# Idempotency contract:
#   * an existing panel.env is never overwritten — only missing keys are added,
#     and a key whose value is a published dev default is replaced (with a
#     timestamped backup of the old file);
#   * an existing unit / sudoers file / config.yml is only replaced with --force;
#   * re-running the DB bootstrap never rotates the admin password again.
#
# Optional extras (off by default because they touch live traffic):
#   --nginx          install deploy/nginx/* (requires the Let's Encrypt cert)
#   --tunnel <uuid>  rewrite ~/.cloudflared/config.yml to ingress on 443
#
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_DIR="/etc/alo-hosting"
ENV_FILE="${ENV_DIR}/panel.env"
DB_DIR="/var/lib/alo-hosting"
DB_FILE="${DB_DIR}/alo.db"
UNIT_NAME="alo-hosting-panel"
UNIT_DST="/etc/systemd/system/${UNIT_NAME}.service"
SUDOERS_SRC="${REPO_ROOT}/deploy/sudoers/alo-hosting-deploy"
SUDOERS_DST="/etc/sudoers.d/alo-hosting-deploy"
INIT_DB_SRC="${REPO_ROOT}/scripts/init-production-db.sh"
INIT_DB_DST="/usr/local/sbin/alo-init-db"

DOMAIN="hosting.alolabs.net"
PORT="3051"
DRY_RUN=0
FORCE=0
SKIP_DB=0
DO_NGINX=0
TUNNEL_UUID=""

say()  { printf '\n\033[1;34m▶ %s\033[0m\n' "$*"; }
ok()   { printf '  \033[1;32m✔\033[0m %s\n' "$*"; }
warn() { printf '  \033[1;33m⚠\033[0m %s\n' "$*"; }
die()  { printf '  \033[1;31m✘ %s\033[0m\n' "$*" >&2; exit 1; }

run() {
  if [[ "$DRY_RUN" -eq 1 ]]; then
    printf '  \033[2m[dry-run]\033[0m %s\n' "$*"
  else
    eval "$@"
  fi
}

# write_file <dest> <mode> <owner>:<group> — content comes from stdin.
write_file() {
  local dest="$1" mode="$2" own="$3" tmp
  tmp="$(mktemp)"
  cat > "$tmp"
  if [[ "$DRY_RUN" -eq 1 ]]; then
    printf '  \033[2m[dry-run]\033[0m would write %s bytes to %s (%s %s)\n' \
      "$(wc -c < "$tmp" | tr -d ' ')" "$dest" "$mode" "$own"
  else
    install -m "$mode" -o "${own%%:*}" -g "${own##*:}" "$tmp" "$dest"
  fi
  rm -f "$tmp"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --domain)   DOMAIN="${2:-}"; shift 2 ;;
    --port)     PORT="${2:-}"; shift 2 ;;
    --app-root) APP_ROOT_OVERRIDE="${2:-}"; shift 2 ;;
    --app-user) APP_USER_OVERRIDE="${2:-}"; shift 2 ;;
    --dry-run)  DRY_RUN=1; shift ;;
    --force)    FORCE=1; shift ;;
    --skip-db)  SKIP_DB=1; shift ;;
    --nginx)    DO_NGINX=1; shift ;;
    --tunnel)   TUNNEL_UUID="${2:-}"; shift 2 ;;
    -h|--help)  sed -n '2,29p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *)          die "unknown argument: $1 (try --help)" ;;
  esac
done

# ── 0. Who are we setting this up for? ─────────────────────────────────────
[[ $EUID -eq 0 ]] || die "run me with sudo: sudo bash scripts/bootstrap-server.sh"

APP_USER="${APP_USER_OVERRIDE:-${SUDO_USER:-}}"
[[ -n "$APP_USER" && "$APP_USER" != "root" ]] \
  || die "could not work out the app user — pass --app-user alamin"
id "$APP_USER" >/dev/null 2>&1 || die "user '$APP_USER' does not exist"
APP_GROUP="$(id -gn "$APP_USER")"
APP_HOME="$(getent passwd "$APP_USER" | cut -d: -f6)"
APP_ROOT="${APP_ROOT_OVERRIDE:-${APP_HOME}/alo-hosting}"

say "Target"
ok "app user   : ${APP_USER} (group ${APP_GROUP}, home ${APP_HOME})"
ok "app root   : ${APP_ROOT}"
# PrivateTmp=true in the unit gives the service its own /tmp, so a ReadWritePaths
# entry under /tmp can never be satisfied (systemd aborts with 226/NAMESPACE).
case "$APP_ROOT" in
  /tmp|/tmp/*) warn "APP_ROOT is under /tmp, which conflicts with PrivateTmp=true — use a real path (e.g. ${APP_HOME}/alo-hosting)" ;;
esac
ok "public URL : https://${DOMAIN}"
ok "panel port : 127.0.0.1:${PORT}"
ok "database   : ${DB_FILE}"
[[ $DRY_RUN -eq 1 ]] && warn "dry run — nothing will be written"

# ── 1. Find a Node >= 20.9 that systemd can launch by absolute path ──────────
# systemd does not source your shell profile, so an nvm-only Node is invisible
# to it. Writing the resolved absolute path into the unit avoids needing a
# system-wide Node install at all.
say "Node.js runtime"
NODE_BIN=""
for candidate in /usr/bin/node /usr/local/bin/node /usr/local/nodejs/bin/node \
                 "${APP_HOME}/.nvm/versions/node/"*/bin/node; do
  [[ -x "$candidate" ]] || continue
  ver="$("$candidate" -v 2>/dev/null || true)"
  major="${ver#v}"; major="${major%%.*}"
  minor=0
  if (( ${major:-0} == 20 )); then minor="${ver#v20.}"; minor="${minor%%.*}"; minor=$((10#${minor:-0})); fi
  if (( ${major:-0} > 20 )) || { (( ${major:-0} == 20 )) && (( minor >= 9 )); }; then NODE_BIN="$candidate"; NODE_VER="$ver"; break; fi
done
[[ -n "$NODE_BIN" ]] || die "no Node >= 20.9 found (looked in /usr/bin, /usr/local/bin, ~/.nvm). Install it, then re-run."
ok "using ${NODE_BIN} (${NODE_VER})"

# ── 2. /etc/alo-hosting/panel.env ──────────────────────────────────────────
# This is the file whose absence fails the CI/deploy workflow preflight. Secrets
# are generated here, on the server, and never leave it.
say "Production environment file"

rand_hex() {
  if command -v openssl >/dev/null 2>&1; then openssl rand -hex "${1:-32}"
  else head -c "${1:-32}" /dev/urandom | od -An -tx1 | tr -d ' \n'; fi
}

# Read a KEY from an env file without eval-ing anything.
env_get() {
  local key="$1" file="$2" line
  [[ -f "$file" ]] || return 0
  line="$(grep -E "^[[:space:]]*${key}=" "$file" | tail -n1 || true)"
  line="${line#*=}"
  line="${line%\"}"; line="${line#\"}"
  line="${line%\'}"; line="${line#\'}"
  printf '%s' "$line"
}

DEV_DEFAULTS="development-secret-change-me change-me-in-production dev-secret-change-me-in-production"

run "mkdir -p '$ENV_DIR'"
run "chmod 0750 '$ENV_DIR'"
run "chown 'root:${APP_GROUP}' '$ENV_DIR'"

if [[ ! -f "$ENV_FILE" ]]; then
  write_file "$ENV_FILE" 0640 "root:${APP_GROUP}" <<EOF
# ALO Hosting Panel — production environment
# Generated by scripts/bootstrap-server.sh on $(date -u '+%Y-%m-%dT%H:%M:%SZ').
# Read by systemd (EnvironmentFile=) and validated by .github/workflows/ci-cd.yml.
# Secrets in here were generated on this host. Keep it 0640 root:${APP_GROUP}.
NODE_ENV="production"
HOSTNAME="127.0.0.1"
PORT="${PORT}"
LOG_LEVEL="info"

# Absolute path, and deliberately outside the git checkout: a relative path
# would resolve against each new release directory and wipe data on redeploy.
DATABASE_URL="file:${DB_FILE}"

APP_URL="https://${DOMAIN}"
NEXTAUTH_URL="https://${DOMAIN}"
NEXTAUTH_SECRET="$(rand_hex 32)"
JWT_SECRET="$(rand_hex 32)"
APP_ENCRYPTION_KEY="$(rand_hex 32)"
INTERNAL_SECRET="$(rand_hex 32)"

# Only needed by the optional helper layer; leave commented until it runs here.
# REDIS_URL="redis://127.0.0.1:6379"
# AI_GATEWAY_URL="https://ai.alolabs.net/v1"
# AI_GATEWAY_KEY=""
EOF
  ok "created ${ENV_FILE} (0640 root:${APP_GROUP}) with generated secrets"
else
  ok "${ENV_FILE} already exists — keeping every value, filling gaps only"
  additions=""
  declare -A REQUIRED=(
    [NODE_ENV]="production"
    [HOSTNAME]="127.0.0.1"
    [PORT]="$PORT"
    [DATABASE_URL]="file:${DB_FILE}"
    [APP_URL]="https://${DOMAIN}"
    [NEXTAUTH_URL]="https://${DOMAIN}"
  )
  for key in "${!REQUIRED[@]}"; do
    [[ -n "$(env_get "$key" "$ENV_FILE")" ]] || additions+="${key}=\"${REQUIRED[$key]}\""$'\n'
  done
  for key in NEXTAUTH_SECRET JWT_SECRET APP_ENCRYPTION_KEY INTERNAL_SECRET; do
    [[ -n "$(env_get "$key" "$ENV_FILE")" ]] || additions+="${key}=\"$(rand_hex 32)\""$'\n'
  done

  # A published dev default is not a secret — replace it (with a backup).
  for key in NEXTAUTH_SECRET JWT_SECRET APP_ENCRYPTION_KEY INTERNAL_SECRET; do
    val="$(env_get "$key" "$ENV_FILE")"
    for bad in $DEV_DEFAULTS; do
      if [[ "$val" == "$bad" ]]; then
        [[ $DRY_RUN -eq 1 ]] || cp -p "$ENV_FILE" "${ENV_FILE}.bak.$(date -u +%Y%m%d%H%M%S)"
        run "sed -i \"s|^${key}=.*|${key}=\\\"$(rand_hex 32)\\\"|\" '$ENV_FILE'"
        ok "replaced dev-default ${key} (old file backed up alongside)"
      fi
    done
  done

  if [[ -n "$additions" ]]; then
    [[ $DRY_RUN -eq 1 ]] || printf '\n# Added by bootstrap-server.sh on %s\n%s' \
      "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$additions" >> "$ENV_FILE"
    ok "appended missing keys: $(printf '%s' "$additions" | cut -d= -f1 | tr '\n' ' ')"
  fi
  run "chmod 0640 '$ENV_FILE'"
  run "chown 'root:${APP_GROUP}' '$ENV_FILE'"
fi

# Re-validate the production preconditions so the later deploy can fail early with a useful message.
if [[ $DRY_RUN -eq 0 ]]; then
  dburl="$(env_get DATABASE_URL "$ENV_FILE")"
  case "$dburl" in
    file:/*)   ok "DATABASE_URL is an absolute file: path" ;;
    file:*)    die "DATABASE_URL='${dburl}' is relative — set it to file:${DB_FILE}" ;;
    *)         die "DATABASE_URL must be SQLite (file:/...). Postgres is not supported: the schema's provider is sqlite." ;;
  esac
  for key in NEXTAUTH_SECRET JWT_SECRET; do
    val="$(env_get "$key" "$ENV_FILE")"
    [[ ${#val} -ge 32 ]] || die "${key} is only ${#val} chars — needs >= 32"
    for bad in $DEV_DEFAULTS; do [[ "$val" != "$bad" ]] || die "${key} is a published dev default"; done
  done
  ok "secrets pass the CI/deploy preflight checks"
  # The runner reads this file as the app user — group read is mandatory.
  sudo -u "$APP_USER" test -r "$ENV_FILE" \
    || die "${APP_USER} cannot read ${ENV_FILE} (need root:${APP_GROUP} 0640)"
  ok "${APP_USER} can read it (this is the exact check the runner performs)"
fi

# ── 3. Database ────────────────────────────────────────────────────────────
# /usr/local/sbin/alo-init-db is installed at a STABLE path on purpose: on a
# first deploy ${APP_ROOT}/current does not exist yet, and the sudoers rule can
# only grant a fixed filename. The CI/deploy workflow refreshes this copy from each
# release, so it never goes stale.
say "Database"
[[ -f "$INIT_DB_SRC" ]] || die "missing ${INIT_DB_SRC}"
if [[ $DRY_RUN -eq 1 ]]; then
  printf '  \033[2m[dry-run]\033[0m would install %s -> %s\n' "$INIT_DB_SRC" "$INIT_DB_DST"
else
  install -m 0755 -o root -g root "$INIT_DB_SRC" "$INIT_DB_DST"
  ok "installed ${INIT_DB_DST}"
fi

if [[ "$SKIP_DB" -eq 1 ]]; then
  warn "skipped (--skip-db)"
else
  # Seed source: the live release if one is deployed, otherwise this checkout.
  # Either way it must carry db/custom.db, prisma/schema.prisma and
  # node_modules/{bcryptjs,@libsql/client} — the standalone bundle does.
  if [[ -L "${APP_ROOT}/current" ]]; then SEED_DIR="${APP_ROOT}/current"; else SEED_DIR="$REPO_ROOT"; fi
  [[ -f "${SEED_DIR}/db/custom.db" ]] \
    || die "${SEED_DIR} has no db/custom.db — run 'npm ci && npm run build' first"
  [[ -f "${REPO_ROOT}/node_modules/@libsql/client/lib-cjs/node.js" ]] \
    || die "${REPO_ROOT}/node_modules is incomplete — run 'npm ci' in the checkout first"
  ok "seeding from ${SEED_DIR}"
  if [[ $DRY_RUN -eq 1 ]]; then
    printf '  \033[2m[dry-run]\033[0m would bootstrap %s\n' "$DB_FILE"
  else
    # Runs as root: the script itself creates /var/lib/alo-hosting and drops to
    # the app user for the node/python work. Its output includes the rotated
    # admin password — the one secret this bootstrap prints, because you need it.
    # --modules-from this checkout, never the release: .next/standalone carries
    # only the modules the app requires at runtime, and @libsql/client is traced
    # there as a bare package.json whose lib-cjs/ main is absent — the bootstrap
    # would die with MODULE_NOT_FOUND halfway through credential rotation.
    if env ALO_APP_USER="$APP_USER" ALO_APP_GROUP="$APP_GROUP" ALO_DB_DIR="$DB_DIR" \
           PATH="$(dirname "$NODE_BIN"):$PATH" \
           "$INIT_DB_DST" --from "$SEED_DIR" --modules-from "$REPO_ROOT"; then
      ok "database ready at ${DB_FILE}"
    else
      die "database bootstrap failed — fix that before deployment can proceed"
    fi
  fi
fi

# ── 4. systemd unit ────────────────────────────────────────────────────────
say "systemd unit"
# Create the tree the unit expects. ReadWritePaths on a missing directory used
# to abort the unit with status=226/NAMESPACE before ExecStart ran, so a
# bootstrap run before the first deploy left an enabled-but-unstartable service.
run "install -d -m 0755 -o '$APP_USER' -g '$APP_GROUP' '${APP_ROOT}/releases' '${APP_ROOT}/logs'"
ok "${APP_ROOT}/{releases,logs} ready"
UNIT_SRC="${REPO_ROOT}/deploy/systemd/${UNIT_NAME}.service"
[[ -f "$UNIT_SRC" ]] || die "missing ${UNIT_SRC}"
if [[ -f "$UNIT_DST" && $FORCE -eq 0 ]]; then
  warn "${UNIT_DST} already exists — leaving it alone (use --force to replace)"
else
  tmp="$(mktemp)"
  sed -e "s|^ExecStart=.*|ExecStart=${NODE_BIN} server.js|" \
      -e "s|^User=.*|User=${APP_USER}|" \
      -e "s|^Group=.*|Group=${APP_GROUP}|" \
      -e "s|^WorkingDirectory=.*|WorkingDirectory=${APP_ROOT}/current|" \
      -e "s|^ReadWritePaths=.*|ReadWritePaths=-${DB_DIR} -${APP_ROOT}/logs|" \
      "$UNIT_SRC" > "$tmp"
  # The unit hard-codes the alamin home in its comments/paths elsewhere too.
  sed -i "s|/home/alamin/alo-hosting|${APP_ROOT}|g" "$tmp"
  write_file "$UNIT_DST" 0644 root:root < "$tmp"
  rm -f "$tmp"
  ok "installed ${UNIT_DST} (ExecStart=${NODE_BIN} server.js)"
  run "systemctl daemon-reload"
  run "systemctl enable ${UNIT_NAME}.service"
  ok "enabled — the panel now survives reboots"
fi
if [[ -L "${APP_ROOT}/current" ]]; then
  if [[ $DRY_RUN -eq 1 ]]; then
    printf '  \033[2m[dry-run]\033[0m systemctl restart %s.service\n' "$UNIT_NAME"
  elif systemctl restart "${UNIT_NAME}.service"; then
    ok "restarted (a release is in place)"
  else
    # A bare non-zero exit here tells the operator nothing; show them why.
    echo ""
    systemctl status "${UNIT_NAME}.service" --no-pager -l 2>&1 | sed 's/^/    /' | head -15
    journalctl -u "${UNIT_NAME}.service" --no-pager -n 15 2>&1 | sed 's/^/    /' | tail -15
    die "${UNIT_NAME} failed to start — the log above says why (common causes: WorkingDirectory missing, node path wrong, port ${PORT} already in use)"
  fi
else
  warn "no ${APP_ROOT}/current yet — the unit will start on the first successful deploy"
fi

# ── 5. sudoers + the stable bootstrap path ─────────────────────────────────
say "Passwordless sudo for the deploy workflow"
[[ -f "$SUDOERS_SRC" ]] || die "missing ${SUDOERS_SRC}"

tmp="$(mktemp)"
sed -e "s/\balamin\b/${APP_USER}/g" -e "s|/home/alamin/alo-hosting|${APP_ROOT}|g" \
    "$SUDOERS_SRC" > "$tmp"
if command -v visudo >/dev/null 2>&1; then
  visudo -cf "$tmp" >/dev/null || { rm -f "$tmp"; die "rendered sudoers file is invalid — refusing to install"; }
  ok "sudoers syntax validated with visudo -cf"
else
  warn "visudo not installed — could not syntax-check; install sudo package to be safe"
fi
if [[ -f "$SUDOERS_DST" && $FORCE -eq 0 ]]; then
  if diff -q "$tmp" "$SUDOERS_DST" >/dev/null 2>&1; then
    ok "${SUDOERS_DST} already correct"
  else
    warn "${SUDOERS_DST} exists and differs — leaving it alone (use --force to replace)"
  fi
else
  write_file "$SUDOERS_DST" 0440 root:root < "$tmp"
  ok "installed ${SUDOERS_DST} (0440)"
fi
rm -f "$tmp"
# Prove the workflow's first sudo call cannot hang the runner.
if [[ $DRY_RUN -eq 0 ]]; then
  if sudo -u "$APP_USER" sudo -n true 2>/dev/null; then
    ok "${APP_USER} has passwordless sudo for the four deploy commands"
  else
    warn "sudo -n as ${APP_USER} was not granted yet (may need a re-login or NOPASSWD entry)"
  fi
fi

# ── 6. Optional: nginx ─────────────────────────────────────────────────────
if [[ "$DO_NGINX" -eq 1 ]]; then
  say "nginx (optional)"
  if ! command -v nginx >/dev/null 2>&1; then
    warn "nginx is not installed — skipping"
  else
    install -m 0644 "${REPO_ROOT}/deploy/nginx/conf.d/websocket-upgrade.conf" /etc/nginx/conf.d/websocket-upgrade.conf
    ok "installed conf.d/websocket-upgrade.conf"
    site="/etc/nginx/sites-available/${DOMAIN}"
    if [[ -f "$site" && $FORCE -eq 0 ]]; then
      warn "${site} exists — leaving it alone (--force to replace)"
    else
      sed "s/hosting\.alolabs\.net/${DOMAIN}/g; s/:3051;/:${PORT};/g" \
        "${REPO_ROOT}/deploy/nginx/${DOMAIN}.conf" > "$site" 2>/dev/null \
        || sed "s/hosting\.alolabs\.net/${DOMAIN}/g" "${REPO_ROOT}/deploy/nginx/hosting.alolabs.net.conf" > "$site"
      ln -sfn "$site" "/etc/nginx/sites-enabled/${DOMAIN}"
      ok "installed ${site}"
    fi
    if nginx -t; then systemctl reload nginx; ok "nginx reloaded"; else die "nginx -t failed — fix before continuing"; fi
  fi
fi

# ── 7. Optional: cloudflared tunnel ingress ────────────────────────────────
if [[ -n "$TUNNEL_UUID" ]]; then
  say "cloudflared tunnel (optional)"
  cfg="${APP_HOME}/.cloudflared/config.yml"
  if [[ -f "$cfg" && $DRY_RUN -eq 0 ]]; then
    cp -p "$cfg" "${cfg}.bak.$(date -u +%Y%m%d%H%M%S)"; ok "backed up ${cfg}"
  fi
  write_file "$cfg" 0600 "${APP_USER}:${APP_GROUP}" <<EOF
tunnel: ${TUNNEL_UUID}
credentials-file: ${APP_HOME}/.cloudflared/${TUNNEL_UUID}.json

ingress:
  # nginx terminates TLS on 443. Going to :80 would be redirected back to
  # https by nginx and cloudflared would loop (HTTP 530 at the edge).
  - hostname: ${DOMAIN}
    service: https://127.0.0.1:443
    originRequest:
      noTLSVerify: true
  - service: http_status:404
EOF
  ok "wrote ${cfg} — ingress on 443 with noTLSVerify"
  run "systemctl restart cloudflared"
  warn "set the Cloudflare zone SSL mode for ${DOMAIN} to FULL (not Flexible, not Full-strict)"
fi

# ── 8. What's next ─────────────────────────────────────────────────────────
say "Done — next step"
cat <<EOF
  The CI/deploy workflow's preconditions are now satisfied. Merge an approved
  change to main to trigger deployment, or rerun the failed production job from
  GitHub Actions. Do not create an empty commit solely to force a deploy.

  Then watch it:

    systemctl status ${UNIT_NAME}
    curl -sS -o /dev/null -w '%{http_code}\\n' http://127.0.0.1:${PORT}/api/health
    curl -sS -o /dev/null -w '%{http_code}\\n' https://${DOMAIN}/login
    bash ${REPO_ROOT}/scripts/server-doctor.sh

  Log in at https://${DOMAIN}/login as admin@alolabs.net with the rotated
  password printed above (or: sudo ${INIT_DB_DST} --rotate-password).
EOF
