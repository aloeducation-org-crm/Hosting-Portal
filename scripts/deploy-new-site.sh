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

if [[ -z "$APP" || -z "$DOMAIN" || -z "$PORT_ARG" ]]; then
  echo "Usage: $0 <app-name> <domain> <port|auto>" >&2
  echo "Example: $0 blog blog.alolabs.net 3062" >&2
  exit 1
fi

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

# 3. Install dependencies & build project cleanly
cd "$PROJECT_DIR"
if [[ -f package-lock.json ]]; then
  npm ci
else
  npm install
fi
npm run build

# 4. Start or zero-downtime reload with PM2
if pm2 describe "$APP" >/dev/null 2>&1; then
  PORT="$PORT" HOSTNAME="127.0.0.1" pm2 restart "$APP" --update-env
else
  PORT="$PORT" HOSTNAME="127.0.0.1" pm2 start npm --name "$APP" -- start
fi
pm2 save

# 5. Atomic Nginx vhost write + test + rollback-on-failure
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

[[ -n "$NGINX_BACKUP" && -f "$NGINX_BACKUP" ]] && rm -f "$NGINX_BACKUP"
sudo systemctl reload nginx

echo ""
echo "Deployed successfully! Next steps:"
echo "  1. Add Cloudflare DNS: A record '${DOMAIN}' -> ${PUBLIC_IP} (Proxied)"
echo "  2. Local health check: curl -I http://127.0.0.1:${PORT}"
echo "  3. Edge HTTPS check:   curl -I https://${DOMAIN}"
echo "  4. Optional Strict TLS: sudo certbot --nginx -d ${DOMAIN} (then set Cloudflare SSL to Full Strict)"
