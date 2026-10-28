#!/usr/bin/env bash
# =============================================================================
# ALO Hosting Portal — Hardened Site Deploy Script for alo-server-lap
# Host: Ubuntu 22.04 LTS @ 103.231.239.79 (Nginx 1.18.0 + PM2 7.1.1 + Node v24)
#
# Usage:
#   ./scripts/deploy-new-site.sh <project-name> <domain> <port|auto>
# Example:
#   ./scripts/deploy-new-site.sh blog blog.alolabs.net 3062
#   ./scripts/deploy-new-site.sh crm-web crm.alolabs.net auto
#
# Note: You can also deploy Web, Server & Mobile projects with zero SSH from
# the dashboard at https://hosting.alolabs.net/ai/auto-deploy
# =============================================================================
set -euo pipefail

APP="${1:-}"
DOMAIN="${2:-}"
PORT_ARG="${3:-}"
PROJECTS_ROOT="${ALO_PROJECTS_DIR:-$HOME/projects}"
PUBLIC_IP="${ALO_PUBLIC_IP:-103.231.239.79}"
RESERVED_PORT_PORTAL=3051

HEALTH_PATH="${ALO_HEALTH_PATH:-${4:-/}}"
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
RESOLVER="${SCRIPT_DIR}/resolve-start-entry.mjs"

fail() { printf 'Error: %s\n' "$*" >&2; exit 1; }

if [[ -z "$APP" || -z "$DOMAIN" || -z "$PORT_ARG" ]]; then
  echo "Usage: $0 <app-name> <domain> <port|auto> [health-path]" >&2
  echo "Example: $0 blog blog.alolabs.net 3062 /api/health" >&2
  exit 1
fi

[[ -f "$RESOLVER" ]] || fail "missing $RESOLVER (part of this repository; re-clone scripts/)"

# 1. Strict input validation (prevents path traversal & Nginx directive injection)
if [[ ! "$APP" =~ ^[a-zA-Z0-9][a-zA-Z0-9_-]{0,62}$ ]]; then
  echo "Error: invalid <app-name> '$APP' (use alphanumeric, '-' or '_')." >&2
  exit 1
fi

DOMAIN="$(printf '%s' "$DOMAIN" | tr '[:upper:]' '[:lower:]')"
if [[ ! "$DOMAIN" =~ ^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$ ]]; then
  echo "Error: invalid <domain> '$DOMAIN'." >&2
  exit 1
fi

if [[ "$DOMAIN" == "hosting.alolabs.net" ]]; then
  echo "Error: 'hosting.alolabs.net' is the reserved ALO Hosting Portal domain (port 3051)." >&2
  exit 1
fi

is_port_in_use() {
  local candidate="$1"
  if command -v ss >/dev/null 2>&1; then
    ss -tln | awk '{print $4}' | grep -Eq "(^|:)${candidate}$"
  else
    return 1
  fi
}

# 2. Port validation or automatic next-available allocation starting at 3062
if [[ "$PORT_ARG" == "auto" ]]; then
  PORT=3062
  while [[ "$PORT" -le 3999 ]]; do
    if [[ "$PORT" -ne "$RESERVED_PORT_PORTAL" && "$PORT" -ne 3000 && "$PORT" -ne 5432 && "$PORT" -ne 6379 && "$PORT" -ne 8080 ]]; then
      if ! is_port_in_use "$PORT"; then
        break
      fi
    fi
    PORT=$((PORT + 1))
  done
else
  if [[ ! "$PORT_ARG" =~ ^[0-9]{4,5}$ ]]; then
    echo "Error: invalid <port> '$PORT_ARG' (expected integer 1024..65535 or 'auto')." >&2
    exit 1
  fi
  PORT="$PORT_ARG"
fi

if (( PORT < 1024 || PORT > 65535 )); then
  echo "Error: port $PORT out of allowed range (1024..65535)." >&2
  exit 1
fi

if (( PORT == RESERVED_PORT_PORTAL )); then
  echo "Error: port 3051 is reserved for 'alo-hosting' (hosting.alolabs.net)." >&2
  exit 1
fi

PROJECT_DIR="${PROJECTS_ROOT}/${APP}"
if [[ ! -d "$PROJECT_DIR" ]]; then
  echo "Error: project directory '$PROJECT_DIR' does not exist." >&2
  exit 1
fi

echo "Deploying $APP -> $DOMAIN on 127.0.0.1:$PORT"

# 3. Verify the toolchain the project actually asks for, then build.
#    A bun/pnpm lockfile is a real provisioning requirement: npm ci would ignore
#    it and silently drift from the committed dependency tree.
cd "$PROJECT_DIR"
if [[ -f bun.lock || -f bun.lockb ]]; then
  command -v bun >/dev/null 2>&1 || fail \
    "$APP is locked with bun ($( [[ -f bun.lock ]] && echo bun.lock || echo bun.lockb )) but 'bun' is not installed.
       Install it on the host:  curl -fsSL https://bun.sh/install | bash
       (running 'npm ci' instead would bypass the committed lockfile)"
  bun install --frozen-lockfile
  bun run build
elif [[ -f pnpm-lock.yaml ]]; then
  command -v pnpm >/dev/null 2>&1 || fail "$APP is locked with pnpm but pnpm is not installed (npm i -g pnpm)"
  pnpm install --frozen-lockfile
  pnpm run build
elif [[ -f yarn.lock ]]; then
  command -v yarn >/dev/null 2>&1 || fail "$APP is locked with yarn but yarn is not installed"
  yarn install --frozen-lockfile
  yarn run build
else
  if [[ -f package-lock.json ]]; then npm ci; else npm install; fi
  npm run build
fi

# 4. Resolve an argv start command against the build that actually exists.
#    `scripts.start` is written for a human shell (pipes, `tee`, bun...) and
#    `pm2 start npm -- start` cannot supervise a pipeline: the process PM2
#    watches exits with tee's status, and a missing runtime or a nested
#    standalone bundle turns into a silent crash-loop. Refuse to start instead.
# PM2 only parses *.config.cjs as an ecosystem config; any other name is treated
# as the app script itself (which registers an app named after the file).
ECOSYSTEM="${PROJECT_DIR}/ecosystem.alo.config.cjs"
if ! RESOLVE_OUT="$(node "$RESOLVER" --dir "$PROJECT_DIR" --port "$PORT" --name "$APP" \
                      --stage-assets --write-ecosystem "$ECOSYSTEM" 2>&1)"; then
  printf '%s\n' "$RESOLVE_OUT" | sed 's/^/  /' >&2
  fail "$APP has no runnable start entry point; refusing to (re)start it with a command that will crash-loop"
fi
printf '%s\n' "$RESOLVE_OUT" | sed 's/^/  /'

# 5. Start from the generated ecosystem file. `pm2 restart` would keep the
#    ORIGINAL script (`npm`), so an app previously started as
#    `pm2 start npm -- start` must be deleted and re-created to pick up argv.
if pm2 describe "$APP" >/dev/null 2>&1; then
  pm2 delete "$APP" >/dev/null 2>&1 || true
fi
pm2 start "$ECOSYSTEM"
if ! pm2 describe "$APP" >/dev/null 2>&1; then
  fail "PM2 did not register '${APP}'; the ecosystem file (${ECOSYSTEM}) was not parsed as a config"
fi
pm2 save

# 6. Health-gate the activation. 000 here used to be printed next to
#    "Deployed successfully", which is how two dead sites stayed "deployed".
http_code() {
  # `curl -w` already prints 000 on failure; appending another "000" produced
  # the unreadable "HTTP 000000" that made this log useless on 2026-10-27.
  local code
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 "http://127.0.0.1:${PORT}${HEALTH_PATH}" 2>/dev/null)" || true
  printf '%s' "${code:-000}"
}
CODE="$(http_code)"
for _ in $(seq 1 30); do
  [[ "$CODE" =~ ^[23] ]] && break
  sleep 1
  CODE="$(http_code)"
done
if [[ ! "$CODE" =~ ^[23] ]]; then
  echo "Error: $APP did not become healthy at http://127.0.0.1:${PORT}${HEALTH_PATH} (last HTTP $CODE)" >&2
  pm2 describe "$APP" >&2 || true
  pm2 logs "$APP" --lines 40 --nostream 2>&1 | tail -n 40 >&2 || true
  fail "activation failed; Nginx was left untouched so the previous release keeps serving"
fi
echo "Local health: HTTP $CODE on http://127.0.0.1:${PORT}${HEALTH_PATH}"

# 7. Atomic Nginx vhost write + test + rollback-on-failure
NGINX_AVAIL="/etc/nginx/sites-available/${DOMAIN}"
NGINX_ENABLED="/etc/nginx/sites-enabled/${DOMAIN}"
NGINX_BACKUP=""

if [[ -f "$NGINX_AVAIL" ]]; then
  NGINX_BACKUP="/tmp/${DOMAIN}.nginx.bak.$$"
  sudo cp -p "$NGINX_AVAIL" "$NGINX_BACKUP"
fi

sudo tee "$NGINX_AVAIL" >/dev/null <<EOF
# Managed by ALO Hosting Panel — alo-server-lap ($PUBLIC_IP)
server {
    listen 80;
    listen [::]:80;
    server_name ${DOMAIN};
    server_tokens off;
    client_max_body_size 50M;

    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
        default_type "text/plain";
    }

    location / {
        proxy_pass http://127.0.0.1:${PORT};
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
    }
}
EOF

sudo ln -sfn "$NGINX_AVAIL" "$NGINX_ENABLED"

if ! sudo nginx -t; then
  echo "Error: nginx configuration check failed! Rolling back $DOMAIN..." >&2
  sudo rm -f "$NGINX_ENABLED"
  if [[ -n "$NGINX_BACKUP" && -f "$NGINX_BACKUP" ]]; then
    sudo mv "$NGINX_BACKUP" "$NGINX_AVAIL"
    sudo ln -sfn "$NGINX_AVAIL" "$NGINX_ENABLED"
  else
    sudo rm -f "$NGINX_AVAIL"
  fi
  exit 1
fi

# `[[ ... ]] && rm` returns 1 when the test is false, which `set -e` treats as a
# fatal error - keep it as an explicit branch.
if [[ -n "$NGINX_BACKUP" && -f "$NGINX_BACKUP" ]]; then
  rm -f "$NGINX_BACKUP"
fi
sudo systemctl reload nginx

echo ""
echo "Deployed $APP ($(printf '%s' "$RESOLVE_OUT" | awk -F= '/^entry=/{print $2}')) -> $DOMAIN on 127.0.0.1:$PORT (verified HTTP $CODE)"
echo "Next steps:"
echo "  1. Add Cloudflare DNS: A record '${DOMAIN}' -> ${PUBLIC_IP} (Proxied)"
echo "  2. Local health check: curl -I http://127.0.0.1:${PORT}${HEALTH_PATH}"
echo "  3. Edge HTTPS check:   curl -I https://${DOMAIN}"
echo "  4. Optional Strict TLS: sudo certbot --nginx -d ${DOMAIN} (then set Cloudflare SSL to Full Strict)"
