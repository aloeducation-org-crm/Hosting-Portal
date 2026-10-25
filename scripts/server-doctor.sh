#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════════
# ALO Labs Hosting Panel — server doctor
# ═══════════════════════════════════════════════════════════════════════════════
# Read-only audit of the whole request path:
#
#   browser → Cloudflare edge → cloudflared tunnel → nginx (443)
#           → Next.js standalone (127.0.0.1:3051) → SQLite (libSQL)
#
# Every check prints PASS / WARN / FAIL and, on WARN/FAIL, the command that
# fixes it. Nothing here writes, restarts or deletes anything.
#
#   bash scripts/server-doctor.sh
#   bash scripts/server-doctor.sh --domain hosting.alolabs.net --port 3051
#
# Run it from anywhere; it locates the repository itself.
# ═══════════════════════════════════════════════════════════════════════════════
set -uo pipefail

DOMAIN="hosting.alolabs.net"
PORT="3051"
APP_DIR_OVERRIDE=""
SERVICE="alo-hosting-panel"
DB_PATH="/var/lib/alo-hosting/alo.db"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --domain) DOMAIN="$2"; shift 2 ;;
    --port)   PORT="$2"; shift 2 ;;
    --app)    APP_DIR_OVERRIDE="$2"; shift 2 ;;
    --service) SERVICE="$2"; shift 2 ;;
    -h|--help) sed -n '2,20p' "$0"; exit 0 ;;
    *) echo "unknown argument: $1"; exit 2 ;;
  esac
done

PASS=0; WARN=0; FAIL=0
G='\033[0;32m'; Y='\033[1;33m'; R='\033[0;31m'; C='\033[0;36m'; B='\033[1m'; N='\033[0m'
FIXES=()

pass() { PASS=$((PASS+1)); echo -e "  ${G}✓ PASS${N}  $*"; }
warn() { WARN=$((WARN+1)); echo -e "  ${Y}⚠ WARN${N}  $*"; [[ -n "${1:-}" ]] && FIXES+=("WARN: $*"); }
fail() { FAIL=$((FAIL+1)); echo -e "  ${R}✗ FAIL${N}  $*"; FIXES+=("FAIL: $*"); }
fix()  { echo -e "          ${C}↳ fix:${N} $*"; }
head_(){ echo ""; echo -e "${B}${C}── $* ──${N}"; }
have() { command -v "$1" >/dev/null 2>&1; }

# Compare a live SQLite database against prisma/schema.prisma.
# A column the schema declares but the database lacks turns into a runtime
# `prisma:error SQLITE_ERROR: no such column: …` and a 500 on whichever route
# touches it — the tables all exist, so a table-count check cannot see this.
check_schema_drift() {
  local db_file="$1" schema_file="$2"
  [[ -f "$schema_file" ]] || { warn "cannot compare schema: $schema_file not found"; return 0; }
  have python3 || { warn "python3 unavailable — skipping schema drift check"; return 0; }

  local out res detail
  out=$(python3 - "$db_file" "$schema_file" <<'PY' 2>/dev/null
import re, sqlite3, sys
db_file, schema_file = sys.argv[1], sys.argv[2]
SCALARS = {"String","Boolean","Int","BigInt","Float","Decimal","DateTime","Bytes","Json"}
schema = open(schema_file, encoding="utf-8").read()
enums = set(re.findall(r'^enum\s+(\w+)\s*\{', schema, re.M))

con = sqlite3.connect(db_file)
actual = {}
for (t,) in con.execute("select name from sqlite_master where type='table'"):
    actual[t] = {r[1] for r in con.execute('PRAGMA table_info("%s")' % t)}

missing_tables, missing_cols = [], []
models = re.findall(r'^model\s+(\w+)\s*\{(.*?)^\}', schema, re.S | re.M)
for name, body in models:
    m = re.search(r'@@map\("([^"]+)"\)', body)
    table = m.group(1) if m else name
    if table not in actual:
        missing_tables.append(table); continue
    for line in body.splitlines():
        line = line.strip()
        if not line or line.startswith('//') or line.startswith('@@'): continue
        parts = line.split()
        if len(parts) < 2: continue
        field, ftype = parts[0], parts[1]
        base = ftype.rstrip('?')
        if base.endswith('[]'): continue                 # list relation
        if base not in SCALARS and base not in enums: continue   # model relation
        cm = re.search(r'@map\("([^"]+)"\)', line)
        col = cm.group(1) if cm else field
        if col not in actual[table]:
            missing_cols.append("%s.%s" % (table, col))

if not missing_tables and not missing_cols:
    print("RESULT\tOK\t%d models / %d tables in sync" % (len(models), len(actual)))
else:
    print("RESULT\tDRIFT\t%d table(s) missing, %d column(s) missing" % (len(missing_tables), len(missing_cols)))
    for t in missing_tables: print("ISSUE\tmissing table: %s" % t)
    for c in missing_cols[:20]: print("ISSUE\tmissing column: %s" % c)
    if len(missing_cols) > 20: print("ISSUE\t… and %d more" % (len(missing_cols) - 20))
PY
) || true
  res=$(printf '%s' "$out" | awk -F'\t' '/^RESULT/{print $2; exit}')
  detail=$(printf '%s' "$out" | awk -F'\t' '/^RESULT/{ $1=""; $2=""; print substr($0,3); exit}')
  if [[ "$res" == "OK" ]]; then
    pass "live database matches prisma/schema.prisma (${detail})"
  elif [[ "$res" == "DRIFT" ]]; then
    fail "live database is BEHIND prisma/schema.prisma — ${detail}"
    printf '%s\n' "$out" | awk -F'\t' '/^ISSUE/{print "            " $2}'
    fix "cd $REPO && DATABASE_URL=\"file:$db_file\" npx prisma db push    (adds missing columns non-destructively)"
  else
    warn "schema drift check produced no result (python3/sqlite3 could not read $db_file)"
  fi
}

echo -e "${B}ALO Labs Hosting Panel — server doctor${N}"
echo -e "  host: $(hostname) | user: $(whoami) | $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
echo -e "  domain: ${DOMAIN} | panel port: ${PORT} | service: ${SERVICE}"

# ═══ 1. WHICH DIRECTORY IS THE APP? ═══════════════════════════════════════════
head_ "1. Repository & canonical app"

if [[ -n "$APP_DIR_OVERRIDE" ]]; then
  REPO="$APP_DIR_OVERRIDE"
elif git rev-parse --show-toplevel >/dev/null 2>&1; then
  REPO="$(git rev-parse --show-toplevel)"
else
  REPO="$(pwd)"
fi
echo "  repository: $REPO"

if [[ -f "$REPO/src/app/(auth)/login/page.tsx" ]]; then
  pass "repo root is the canonical app (/login route present)"
else
  fail "no src/app/(auth)/login/page.tsx under $REPO — this is not the deployable app"
  fix "cd to the repository ROOT, not alo-hosting-portal/"
fi

if [[ "$(basename "$REPO")" == "alo-hosting-portal" ]]; then
  fail "you are inside alo-hosting-portal/ — the LEGACY snapshot (55 models, no /login)"
  fix "cd $(dirname "$REPO")   # the repository root is the app"
fi

if [[ -f "$REPO/package.json" ]]; then
  name=$(node -e "try{console.log(require('$REPO/package.json').name)}catch(e){console.log('?')}" 2>/dev/null || echo "?")
  start=$(node -e "try{console.log(require('$REPO/package.json').scripts.start)}catch(e){console.log('?')}" 2>/dev/null || echo "?")
  echo "  package: $name | start: $start"
  [[ "$start" == *"standalone/server.js"* ]] \
    && pass "start script matches output: \"standalone\"" \
    || { warn "start script is '$start' but next.config.ts sets output: \"standalone\"";
         fix "restore it: git checkout -- package.json   (npm start must be 'node .next/standalone/server.js')"; }
fi

if [[ -d "$REPO/.git" ]]; then
  dirty=$(git -C "$REPO" status --porcelain 2>/dev/null | grep -vE '^\?\?' | head -8)
  if [[ -n "$dirty" ]]; then
    warn "working tree has committed-file modifications (a deploy that runs git reset --hard will destroy them):"
    echo "$dirty" | sed 's/^/            /'
    fix "git -C $REPO diff   then commit the change or revert it — do not leave server-local edits in a clone"
  else
    pass "working tree clean (no local edits to lose)"
  fi
  echo "  branch: $(git -C "$REPO" rev-parse --abbrev-ref HEAD 2>/dev/null) @ $(git -C "$REPO" rev-parse --short HEAD 2>/dev/null)"
fi

if [[ -f "$REPO/next.config.ts" ]] && ! grep -q "outputFileTracingRoot" "$REPO/next.config.ts"; then
  warn "next.config.ts does not pin outputFileTracingRoot — with multiple lockfiles the standalone server can land in a subdirectory"
  fix "pull the latest main; next.config.ts must set outputFileTracingRoot"
else
  pass "outputFileTracingRoot is pinned"
fi

lockfiles=$(find "$REPO" -maxdepth 2 \( -name 'package-lock.json' -o -name 'bun.lock' -o -name 'bun.lockb' \) -not -path '*/node_modules/*' 2>/dev/null | wc -l)
[[ "$lockfiles" -le 1 ]] && pass "one lockfile" || echo "  (note: $lockfiles lockfiles in the tree — npm ci uses package-lock.json)"

# ═══ 2. RUNTIME ═══════════════════════════════════════════════════════════════
head_ "2. Runtime & process manager"

if have node; then
  nv=$(node -v); major=${nv#v}; major=${major%%.*}
  if (( major > 20 )) || { (( major == 20 )) && [[ "${nv#v20.}" != "$nv" ]]; }; then
    minor=${nv#v}; minor=${minor#20.}; minor=${minor%%.*}
    if (( major >= 21 )) || (( major == 20 && minor >= 9 )); then pass "node $nv (>= 20.9 required by Next.js 16)"; else fail "node $nv is too old (need >= 20.9)"; fi
  else
    fail "node $nv is too old (need >= 20.9)"
  fi
else
  fail "node not on PATH in this shell"
  fix "export NVM_DIR=\"\$HOME/.nvm\"; . \"\$NVM_DIR/nvm.sh\"   (and see check 2b)"
fi

# sudo/PATH: the classic "works in SSH, missing under sudo/Actions" failure
if have node; then
  sudo_node=$(sudo -n bash -lc 'command -v node' 2>/dev/null || true)
  if [[ -z "$sudo_node" ]]; then
    warn "node is NOT visible to sudo (secure_path excludes nvm) — systemd units and CI steps that call 'node' will fail"
    fix "use an absolute ExecStart, or install node system-wide: curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt install -y nodejs"
  else
    pass "node visible to sudo ($sudo_node)"
  fi
fi

if systemctl list-unit-files "${SERVICE}.service" >/dev/null 2>&1 && [[ -f "/etc/systemd/system/${SERVICE}.service" || -f "/lib/systemd/system/${SERVICE}.service" ]]; then
  state=$(systemctl is-active "${SERVICE}" 2>/dev/null || true)
  enabled=$(systemctl is-enabled "${SERVICE}" 2>/dev/null || true)
  if [[ "$state" == "active" ]]; then
    pass "systemd ${SERVICE}: active (enabled=${enabled})"
    [[ "$enabled" == "enabled" ]] || { warn "${SERVICE} is not enabled — it will not start after a reboot"; fix "sudo systemctl enable ${SERVICE}"; }
  else
    fail "systemd ${SERVICE}: ${state:-missing}"
    fix "sudo journalctl -u ${SERVICE} -n 50 --no-pager"
  fi
else
  warn "systemd unit ${SERVICE}.service is not installed"
  fix "sudo cp deploy/systemd/${SERVICE}.service /etc/systemd/system/ && sudo systemctl daemon-reload && sudo systemctl enable --now ${SERVICE}"
fi

if have pm2; then
  pm2list=$(pm2 jlist 2>/dev/null || echo "[]")
  pm2apps=$(echo "$pm2list" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const a=JSON.parse(s);console.log(a.map(p=>`${p.name}=${p.pm2_env.status}(restarts:${p.pm2_env.restart_time})`).join(", ")||"none")}catch(e){console.log("unparseable")}})' 2>/dev/null || echo "?")
  echo "  pm2: $pm2apps"
  case "$pm2apps" in
    *errored*) fail "a PM2 app is crash-looping (errored)"
               fix "pm2 logs <app> --lines 50 --nostream" ;;
    *none*)    echo "  (pm2 present, managing nothing)" ;;
    *)         pass "pm2 apps: $pm2apps" ;;
  esac
  # restart_time climbing = crash loop
  loops=$(echo "$pm2list" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log(JSON.parse(s).filter(p=>p.pm2_env.restart_time>10).map(p=>p.name+":"+p.pm2_env.restart_time).join(","))}catch(e){console.log("")}})' 2>/dev/null || true)
  [[ -n "$loops" ]] && { fail "crash-looping PM2 app(s): $loops — a process that restarts >10× is not 'online', it is failing"; fix "pm2 logs --lines 60 --nostream; the usual cause is 'node .next/standalone/server.js' with no standalone build"; }
  if systemctl is-active pm2-$(whoami) >/dev/null 2>&1; then
    pass "pm2 startup hook installed (survives reboot)"
  else
    warn "pm2 has no systemd startup hook — its process list is lost on reboot/daemon respawn"
    fix "sudo env PATH=\$PATH:$(dirname "$(command -v node)") $(command -v pm2) startup systemd -u $(whoami) --hp \$HOME && pm2 save"
  fi
else
  echo "  pm2: not installed (systemd is the supported process manager here)"
fi

# ═══ 3. LISTENING SOCKET ══════════════════════════════════════════════════════
head_ "3. Listening sockets"

listen=$(ss -tlnp 2>/dev/null | grep -E ":${PORT}\b" || true)
if [[ -n "$listen" ]]; then
  echo "$listen" | sed 's/^/          /'
  if echo "$listen" | grep -qE "(0\.0\.0\.0|\*|\[::\]):${PORT}"; then
    warn "port ${PORT} is bound to ALL interfaces — the panel is reachable directly, bypassing nginx/TLS"
    fix "set HOSTNAME=127.0.0.1 in /etc/alo-hosting/panel.env (the standalone server reads HOSTNAME, not HOST)"
  else
    pass "port ${PORT} bound to loopback only"
  fi
else
  fail "nothing is listening on port ${PORT} — the panel is down"
  fix "sudo systemctl restart ${SERVICE}   (or: cd $REPO && npm run build && PORT=$PORT HOSTNAME=127.0.0.1 node .next/standalone/server.js)"
fi

for p in 80 443; do
  if ss -tln 2>/dev/null | grep -qE ":${p}\b"; then pass "nginx port $p listening"; else warn "nothing listening on $p"; fi
done

# ═══ 4. DATABASE ══════════════════════════════════════════════════════════════
head_ "4. Database"

ENV_FILE=""
for cand in /etc/alo-hosting/panel.env "$REPO/.env"; do
  [[ -r "$cand" ]] && { ENV_FILE="$cand"; break; }
done

provider=$(grep -A3 '^datasource' "$REPO/prisma/schema.prisma" 2>/dev/null | grep -oE 'provider *= *"[a-z]+"' | head -1 | grep -oE '"[a-z]+"' | tr -d '"' || echo "?")
echo "  prisma provider: ${provider}"

if [[ -z "$ENV_FILE" ]]; then
  fail "no readable env file (/etc/alo-hosting/panel.env or $REPO/.env)"
  fix "sudo install -d -m 0750 /etc/alo-hosting && sudo cp $REPO/.env.example /etc/alo-hosting/panel.env && sudo chown root:$(whoami) /etc/alo-hosting/panel.env && sudo chmod 0640 /etc/alo-hosting/panel.env"
else
  echo "  env file: $ENV_FILE ($(stat -c '%A %U:%G' "$ENV_FILE" 2>/dev/null))"
  dburl=$(grep -E '^DATABASE_URL=' "$ENV_FILE" | head -1 | cut -d= -f2- | tr -d '"' || true)
  if [[ -z "$dburl" ]]; then
    fail "DATABASE_URL is not set in $ENV_FILE"
  else
    scheme="${dburl%%:*}"
    echo "  DATABASE_URL scheme: ${scheme} (value hidden)"
    if [[ "$scheme" == "postgresql" && "$provider" == "sqlite" ]]; then
      fail "DATABASE_URL is postgresql:// but prisma/schema.prisma is provider = \"sqlite\" — the generated client cannot open it (Prisma throws on the scheme mismatch)"
      fix "use a SQLite URL: DATABASE_URL=\"file:${DB_PATH}\" — see docs/RECOVERY-hosting.alolabs.net.md §4"
    elif [[ "$scheme" == "file" ]]; then
      pass "scheme matches the sqlite provider"
      path_part="${dburl#file:}"
      if [[ "$path_part" != /* ]]; then
        fail "DATABASE_URL is RELATIVE ($dburl) — libSQL resolves it against the process CWD, so systemd/PM2/CI each open a different file (or fail)"
        fix "DATABASE_URL=\"file:${DB_PATH}\""
      else
        if [[ -f "$path_part" ]]; then
          pass "database file exists: $path_part ($(du -h "$path_part" | cut -f1))"
          n=$(python3 -c "import sqlite3,sys;print(sqlite3.connect(sys.argv[1]).execute(\"select count(*) from sqlite_master where type='table'\").fetchone()[0])" "$path_part" 2>/dev/null || echo 0)
          [[ "$n" -ge 70 ]] && pass "$n tables (schema present)" || fail "only $n tables — run prisma db push or re-seed"
          check_schema_drift "$path_part" "$REPO/prisma/schema.prisma"
        else
          fail "database file does not exist: $path_part"
          fix "sudo bash $REPO/scripts/init-production-db.sh"
        fi
        case "$path_part" in
          "$REPO"*) warn "the live database is INSIDE the git checkout — every git checkout/reset/clone overwrites production data"
                    fix "move it out: sudo bash $REPO/scripts/init-production-db.sh   then set DATABASE_URL=\"file:${DB_PATH}\"" ;;
          *) pass "database lives outside the repository" ;;
        esac
      fi
    else
      warn "unexpected DATABASE_URL scheme: $scheme"
    fi
  fi

  # secrets
  for key in NEXTAUTH_SECRET JWT_SECRET; do
    val=$(grep -E "^${key}=" "$ENV_FILE" | head -1 | cut -d= -f2- || true)
    if [[ -z "$val" ]]; then
      fail "${key} is missing — src/lib/env.ts calls process.exit(1) in production"
    elif [[ "$val" == "dev-secret-change-in-production" || "$val" == "dev-jwt-secret-change-in-production" ]]; then
      fail "${key} is the dev default — the app refuses to boot in production (and the build dies during 'Collecting page data')"
      fix "printf '%s=%s\n' '${key}' \"\$(openssl rand -hex 64)\" | sudo tee -a $ENV_FILE"
    elif [[ ${#val} -lt 32 ]]; then
      warn "${key} is only ${#val} chars — use 64+"
    else
      pass "${key} set (${#val} chars)"
    fi
  done
  perms=$(stat -c '%a' "$ENV_FILE" 2>/dev/null || echo "?")
  if [[ "$perms" == "600" || "$perms" == "640" || "$perms" == "400" ]]; then
    pass "env file mode $perms"
  else
    warn "env file mode $perms is too open for a file holding production secrets"
    fix "sudo chmod 0640 $ENV_FILE"
  fi
  if [[ -d "$REPO/.git" ]] && git -C "$REPO" ls-files --error-unmatch .env >/dev/null 2>&1; then
    fail ".env is TRACKED BY GIT — secrets are in the repository history"
    fix "git rm --cached .env && git commit -m 'chore: untrack .env' (then rotate every value in it)"
  else
    pass ".env is not tracked by git"
  fi
fi

# ═══ 5. LOCAL HTTP ════════════════════════════════════════════════════════════
head_ "5. Panel responses (direct, bypassing the proxy)"

probe() {
  local path="$1" want="$2"
  local code
  code=$(curl -sS -o /tmp/doctor-body -w '%{http_code}' --max-time 8 "http://127.0.0.1:${PORT}${path}" 2>/dev/null || true)
  if [[ "$code" == "$want" ]]; then
    pass "${path} → ${code}"
  elif [[ "$code" == "000" ]]; then
    fail "${path} → no response (is the process up?)"
  else
    warn "${path} → ${code} (expected ${want})"
  fi
}
probe "/" "200"
probe "/login" "200"
probe "/register" "200"

health=$(curl -fsS --max-time 8 "http://127.0.0.1:${PORT}/api/health" 2>/dev/null || echo "")
if [[ -n "$health" ]]; then
  echo "          ${health:0:220}"
  echo "$health" | grep -q '"databaseStatus":"connected"' \
    && pass "/api/health reports databaseStatus=connected" \
    || fail "/api/health is NOT reporting a connected database"
else
  fail "/api/health did not answer"
fi

# A 404 on /login is the signature of deploying the legacy snapshot
login_code=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 8 "http://127.0.0.1:${PORT}/login" 2>/dev/null || true)
[[ -n "$login_code" ]] || login_code="000"
if [[ "$login_code" == "404" ]]; then
  fail "/login returns 404 — you are running the LEGACY alo-hosting-portal snapshot, which has no (auth) routes"
  fix "deploy the repository root instead; see docs/RECOVERY-hosting.alolabs.net.md §2"
fi

# ═══ 6. NGINX ═════════════════════════════════════════════════════════════════
head_ "6. nginx"

if have nginx; then
  pass "nginx $(nginx -v 2>&1 | grep -oE '[0-9.]+$')"
  if sudo -n nginx -t >/dev/null 2>&1; then
    pass "config test OK"
  elif nginx -t >/dev/null 2>&1; then
    pass "config test OK (unprivileged)"
  elif sudo -n true >/dev/null 2>&1; then
    fail "nginx config test FAILED"; fix "sudo nginx -t   (then sudo systemctl reload nginx)"
  else
    warn "cannot run 'nginx -t' without passwordless sudo — config not validated here"
  fi
  site="/etc/nginx/sites-available/${DOMAIN}"
  if [[ -f "$site" ]]; then
    pass "site file exists: $site"
    if [[ -L "/etc/nginx/sites-enabled/${DOMAIN}" ]]; then pass "site is enabled"; else fail "site is not symlinked into sites-enabled"; fix "sudo ln -sfn $site /etc/nginx/sites-enabled/${DOMAIN} && sudo nginx -t && sudo systemctl reload nginx"; fi
    if grep -qE "proxy_pass .*:${PORT}" "$site"; then pass "proxies to 127.0.0.1:${PORT}"; else fail "no proxy_pass to port ${PORT} in $site"; fix "align the upstream with the panel port (${PORT})"; fi
    grep -q "listen 443 ssl" "$site" && pass "443/TLS server block present" || { fail "no 'listen 443 ssl' block — certbot has not been applied to this vhost"; fix "sudo certbot --nginx -d ${DOMAIN}"; }
    grep -q "X-Forwarded-Proto" "$site" && pass "forwards X-Forwarded-Proto" || warn "X-Forwarded-Proto not forwarded — NextAuth will build http:// callback URLs"
    grep -q "client_max_body_size" "$site" && pass "client_max_body_size set" || warn "no client_max_body_size (nginx default 1M will reject site uploads / server actions)"
  else
    fail "no nginx site for ${DOMAIN}"
    fix "sudo cp deploy/nginx/${DOMAIN}.conf /etc/nginx/sites-available/${DOMAIN} && sudo ln -sfn /etc/nginx/sites-available/${DOMAIN} /etc/nginx/sites-enabled/ && sudo rm -f /etc/nginx/sites-enabled/default"
  fi
  [[ -e /etc/nginx/sites-enabled/default ]] && { warn "the nginx default site is still enabled — it can answer requests for ${DOMAIN} when the vhost fails to load"; fix "sudo rm -f /etc/nginx/sites-enabled/default"; } || pass "default site removed"
  [[ -f /etc/nginx/conf.d/websocket-upgrade.conf ]] && pass "websocket upgrade map installed" || warn "\$connection_upgrade map missing (needed by deploy/nginx/${DOMAIN}.conf)"
else
  fail "nginx is not installed"
fi

# ═══ 7. TLS CERTIFICATE ═══════════════════════════════════════════════════════
head_ "7. TLS certificate"

if [[ -d "/etc/letsencrypt/live/${DOMAIN}" ]]; then
  expiry=$(sudo -n certbot certificates 2>/dev/null | grep -A4 "$DOMAIN" | grep -i "Expiry" || true)
  pass "Let's Encrypt certificate present for ${DOMAIN}"
  [[ -n "$expiry" ]] && echo "          ${expiry}"
  if systemctl is-active certbot.timer >/dev/null 2>&1; then pass "certbot.timer active (auto-renew)"; else warn "certbot.timer is not active — the cert will expire"; fix "sudo systemctl enable --now certbot.timer"; fi
  # renewal needs the HTTP-01 challenge path to survive the redirect
  if grep -rq "acme-challenge" /etc/nginx/sites-available/ 2>/dev/null; then pass "ACME challenge location configured"; else warn "no /.well-known/acme-challenge/ location — renewal may fail once certbot's managed block is edited"; fi
else
  warn "no Let's Encrypt certificate for ${DOMAIN}"
  fix "sudo certbot --nginx -d ${DOMAIN} --agree-tos -m you@example.com"
fi

# ═══ 8. CLOUDFLARE TUNNEL ═════════════════════════════════════════════════════
head_ "8. Cloudflare Tunnel"

if have cloudflared; then
  pass "cloudflared $(cloudflared --version 2>&1 | grep -oE '[0-9]{4}\.[0-9]+\.[0-9]+' | head -1)"
  if systemctl is-active cloudflared >/dev/null 2>&1; then pass "cloudflared.service active"; else fail "cloudflared.service is not active"; fix "sudo systemctl restart cloudflared; journalctl -u cloudflared -n 40"; fi
  systemctl is-enabled cloudflared >/dev/null 2>&1 && pass "cloudflared enabled at boot" || warn "cloudflared not enabled at boot"

  cfg=""
  for c in /etc/cloudflared/config.yml "$HOME/.cloudflared/config.yml"; do [[ -f "$c" ]] && { cfg="$c"; break; }; done
  if [[ -n "$cfg" ]]; then
    echo "  config: $cfg"
    origin=$(grep -E "^\s*service:" "$cfg" | head -1 | awk '{print $2}')
    echo "  ingress origin: ${origin:-<none>}"
    case "$origin" in
      http://localhost:80|http://127.0.0.1:80|http://localhost)
        fail "the tunnel terminates on port 80 while nginx 301-redirects 80→443: that is an INFINITE REDIRECT LOOP. Cloudflare answers 530 / ERR_TOO_MANY_REDIRECTS while the panel looks healthy locally."
        fix "set service: https://127.0.0.1:443 with originRequest.noTLSVerify: true (deploy/cloudflared/config.yml), then sudo systemctl restart cloudflared" ;;
      https://*)
        pass "tunnel terminates on TLS (${origin}) — no redirect loop"
        grep -q "noTLSVerify: true" "$cfg" || warn "no noTLSVerify for an https:// origin — cloudflared will reject the loopback SNI mismatch"
        ;;
      http://127.0.0.1:${PORT}|http://localhost:${PORT})
        pass "tunnel goes straight to the panel (${origin}) — nginx is bypassed"
        warn "bypassing nginx means no TLS termination, no security headers and no client_max_body_size on the origin side"
        ;;
      *) warn "unrecognised ingress origin: ${origin:-<none>}" ;;
    esac
    grep -q "$DOMAIN" "$cfg" && pass "hostname ${DOMAIN} present in ingress" || fail "hostname ${DOMAIN} is not in the ingress rules"
    grep -q "http_status:404" "$cfg" && pass "catch-all route present" || warn "missing '- service: http_status:404' catch-all — cloudflared refuses to start without it"
  else
    fail "no cloudflared config.yml found"
    fix "cp deploy/cloudflared/config.yml ~/.cloudflared/config.yml (fill in the tunnel UUID) && sudo systemctl restart cloudflared"
  fi

  connectors=$(cloudflared tunnel info "$DOMAIN" 2>/dev/null | tail -n +5 | wc -l || echo 0)
  echo "  connectors: ${connectors}"
else
  echo "  cloudflared not installed (fine if you terminate TLS at a public IP instead)"
fi

# ═══ 9. DNS & PUBLIC REACHABILITY ═════════════════════════════════════════════
head_ "9. DNS & public reachability"

if have dig; then
  ips=$(dig +short "$DOMAIN" A 2>/dev/null | tr '\n' ' ')
  cname=$(dig +short "$DOMAIN" CNAME 2>/dev/null | tr '\n' ' ')
  echo "  A: ${ips:-none} | CNAME: ${cname:-none}"
  if echo "$cname" | grep -q "cfargotunnel.com"; then
    pass "DNS points at the tunnel (${cname})"
  elif [[ -n "$ips" ]]; then
    pass "DNS resolves (Cloudflare-proxied records always show edge IPs, so this does not prove the tunnel route)"
  else
    fail "${DOMAIN} does not resolve"
  fi
fi

pub=$(curl -sS -o /tmp/doctor-pub -w '%{http_code}' --max-time 12 "https://${DOMAIN}/" 2>/dev/null || true)
[[ -n "$pub" ]] || pub="000"
case "$pub" in
  200) pass "https://${DOMAIN}/ → 200" ;;
  301|302|308)
    loc=$(grep -ioE '^location: .*' /tmp/doctor-pub 2>/dev/null | head -1)
    fail "https://${DOMAIN}/ → ${pub} redirect on an HTTPS request (${loc:-no location}) — that is the tunnel→nginx:80 loop"
    fix "point the tunnel at https://127.0.0.1:443 and set Cloudflare SSL/TLS mode to Full" ;;
  530|502|503|521|522|523|524)
    fail "https://${DOMAIN}/ → ${pub} (Cloudflare origin error)"
    fix "530/521 = tunnel or origin down; 522 = origin unreachable; run: cloudflared tunnel info <name>; systemctl status cloudflared nginx ${SERVICE}" ;;
  000) fail "https://${DOMAIN}/ → no response (timed out)" ;;
  *)   warn "https://${DOMAIN}/ → ${pub}" ;;
esac

api=$(curl -sS -o /tmp/doctor-api -w '%{http_code}' --max-time 12 "https://${DOMAIN}/api/health" 2>/dev/null || true)
[[ -n "$api" ]] || api="000"
[[ "$api" == "200" ]] && { pass "https://${DOMAIN}/api/health → 200"; head -c 200 /tmp/doctor-api; echo; } || fail "https://${DOMAIN}/api/health → ${api}"

# Who actually answered? A Cloudflare Workers service connected to this repo
# (dashboard → Workers & Pages → hosting-portal → Domains & Routes) takes
# priority over a tunnel CNAME, and a Next.js app cannot be built as a Worker
# without @opennextjs/cloudflare — so the build fails and the hostname serves an
# error instead of your panel. nginx always advertises itself; a Worker does not.
hdrs=$(curl -sSI --max-time 12 "https://${DOMAIN}/" 2>/dev/null || true)
if [[ -n "$hdrs" ]]; then
  server_hdr=$(printf '%s' "$hdrs" | grep -iE '^server:' | head -1 | tr -d '\r')
  if printf '%s' "$server_hdr" | grep -qi "nginx"; then
    pass "public responses come from YOUR nginx (${server_hdr})"
  elif [[ -n "$server_hdr" ]]; then
    warn "public 'server' header is '${server_hdr}' — not your nginx"
  else
    warn "no 'server' header from https://${DOMAIN}/ — the response did not come from your nginx"
    fix "Cloudflare dashboard → Workers & Pages: if a Worker (e.g. 'hosting-portal') is bound to ${DOMAIN}, remove that hostname so the tunnel is authoritative. A failing Workers build on this repo does not deploy your panel; it just owns the hostname."
  fi
  printf '%s' "$hdrs" | grep -qiE '^cf-ray:' && echo "          (served via Cloudflare edge — cf-ray present)"
fi

# ═══ 10. FIREWALL & EXPOSED SERVICES ══════════════════════════════════════════
head_ "10. Firewall & exposure"

if have ufw; then
  st=$(sudo -n ufw status 2>/dev/null || ufw status 2>/dev/null || echo "unknown")
  echo "$st" | grep -qi "active" && pass "ufw active" || warn "ufw inactive or unreadable without sudo"
  echo "$st" | grep -E "^(22|80|443)" | sed 's/^/          /'
else
  warn "ufw not installed"
fi

# Services bound to 0.0.0.0 that the panel does not need to publish
exposed=$(ss -tlnp 2>/dev/null | awk '$4 ~ /^0\.0\.0\.0:/ || $4 ~ /^\*:/ {split($4,a,":"); print a[length(a)]}' | sort -un | tr '\n' ' ')
echo "  listening on all interfaces: ${exposed:-none}"
for p in 21 25 110 143 993 995 3306 5432 6379 11434 4000 3001 19999; do
  if ss -tln 2>/dev/null | grep -qE "(0\.0\.0\.0|\*):${p}\b"; then
    svc="?"
    case $p in 21) svc="FTP";; 25) svc="SMTP";; 110) svc="POP3";; 143) svc="IMAP";; 993) svc="IMAPS";; 995) svc="POP3S";; 3306) svc="MySQL";; 5432) svc="PostgreSQL";; 6379) svc="Redis";; 11434) svc="Ollama";; 4000) svc="LiteLLM";; 3001) svc="OpenWebUI";; 19999) svc="Netdata";; esac
    warn "${svc} (port ${p}) is bound to all interfaces"
    fix "bind it to 127.0.0.1, or expose it only over Tailscale — a residential line publishing SMTP/IMAP/FTP will be scanned and abused within hours"
  fi
done

# ═══ 11. CI RUNNER ════════════════════════════════════════════════════════════
head_ "11. Self-hosted Actions runner"

runner=$(systemctl list-units --type=service --all 2>/dev/null | grep -oE 'actions\.runner\.[^ ]+\.service' | head -1 || true)
if [[ -n "$runner" ]]; then
  state=$(systemctl is-active "$runner" 2>/dev/null || echo "?")
  [[ "$state" == "active" ]] && pass "$runner active" || fail "$runner is ${state}"
else
  warn "no actions.runner.* service found — push-to-main deploys will queue forever"
  fix "re-register the runner (Settings → Actions → Runners → New self-hosted runner) with labels: self-hosted, linux, production"
fi

# ═══ 12. Explicit proxy, database and helper authorization checks ═════════════
head_ "12. Proxy service, live DB access & privileged helper policy"

proxy_ok=false
for proxy in nginx caddy; do
  if systemctl is-active --quiet "$proxy" 2>/dev/null; then
    proxy_ok=true
    pass "$proxy is active"
  fi
done
if [[ "$proxy_ok" == false ]]; then warn "neither nginx nor caddy is active"; fi
for p in 80 443; do
  if ss -H -tln sport = ":$p" 2>/dev/null | grep -q .; then
    pass "TCP port $p has a listener"
  else
    warn "no process is listening on TCP port $p"
  fi
done

if [[ -f "$DB_PATH" ]]; then
  if [[ -r "$DB_PATH" && -w "$DB_PATH" ]]; then pass "SQLite database is readable and writable by $(whoami)"; else warn "SQLite DB lacks read/write access for $(whoami): $DB_PATH"; fi
  if id alo-panel >/dev/null 2>&1 && sudo -n -u alo-panel test -r "$DB_PATH" -a -w "$DB_PATH" 2>/dev/null; then
    pass "alo-panel can read and write $DB_PATH"
  else
    warn "alo-panel cannot verify read/write access to $DB_PATH (check ownership/mode and sudo availability)"
  fi
else
  warn "expected absolute production SQLite file does not exist: $DB_PATH"
fi

if ss -H -tln sport = ":3051" 2>/dev/null | grep -q .; then
  pass "upstream port 3051 is bound"
  curl --fail --silent --max-time 3 http://127.0.0.1:3051/api/health >/dev/null 2>&1 && pass "upstream health endpoint responds on 3051" || warn "port 3051 listens but health endpoint did not return success"
else
  if have python3 && python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1",3051)); s.close()' >/dev/null 2>&1; then
    pass "internal port 3051 is free and bindable (no upstream process currently active)"
  else
    fail "internal port 3051 cannot be bound (check port conflict or permissions)"
  fi
fi

policy=/etc/sudoers.d/alo-helpers
if [[ -f "$policy" ]] && have visudo && sudo -n visudo -c -f "$policy" >/dev/null 2>&1; then
  pass "sudoers policy parses cleanly"
  if sudo -n -l -U alo-panel 2>/dev/null | grep -qE '/usr/local/sbin/(provision-site\.sh|ssl-lifecycle\.sh)'; then
    pass "alo-panel is authorized for site provisioning and SSL helpers"
  else
    warn "sudoers policy does not visibly grant the requested site helpers to alo-panel"
  fi
else
  warn "sudoers policy missing, invalid, or not inspectable: $policy"
fi

# ═══ SUMMARY ══════════════════════════════════════════════════════════════════
echo ""
echo -e "${B}════════════════════════════════════════════════════════════════${N}"
total=$((PASS+WARN+FAIL))
echo -e "${B}  ${G}${PASS} pass${N}${B} / ${Y}${WARN} warn${N}${B} / ${R}${FAIL} fail${N}${B}  (${total} checks)${N}"
echo -e "${B}════════════════════════════════════════════════════════════════${N}"
if [[ ${#FIXES[@]} -gt 0 ]]; then
  echo ""
  echo -e "${B}Priority actions:${N}"
  i=0
  for f in "${FIXES[@]}"; do
    [[ "$f" == FAIL:* ]] || continue
    i=$((i+1)); echo -e "  ${R}${i}.${N} ${f#FAIL: }"
  done
  for f in "${FIXES[@]}"; do
    [[ "$f" == WARN:* ]] || continue
    i=$((i+1)); echo -e "  ${Y}${i}.${N} ${f#WARN: }"
  done
  echo ""
fi
[[ "$FAIL" -eq 0 ]] && exit 0 || exit 1
