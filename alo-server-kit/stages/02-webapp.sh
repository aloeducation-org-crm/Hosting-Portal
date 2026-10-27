#!/usr/bin/env bash
set -Eeuo pipefail
source "$(dirname "$0")/../lib/common.sh"
require_root
STAGE="02-webapp"; log "▶ $STAGE starting"
USER_HOME=$(getent passwd "$KIT_PRIMARY_USER" | cut -d: -f6)
NVM_DIR="$USER_HOME/.nvm"

if ! sudo -u "$KIT_PRIMARY_USER" [[ -d "$NVM_DIR" ]]; then
  log "installing NVM as $KIT_PRIMARY_USER"
  sudo -u "$KIT_PRIMARY_USER" bash -c 'curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash'
fi
log "installing Node LTS ($KIT_NODE_LTS) via NVM"
sudo -u "$KIT_PRIMARY_USER" bash -lc "
  source '$NVM_DIR/nvm.sh'
  nvm install --lts '$KIT_NODE_LTS'
  nvm alias default '$KIT_NODE_LTS'
  nvm use --silent default
  npm config set fund false
  npm config set audit false
  npm install -g pm2@latest
"
install -d /usr/local/bin
cat >/usr/local/bin/node <<EOF
#!/bin/sh
exec sudo -u $KIT_PRIMARY_USER bash -lc 'source $NVM_DIR/nvm.sh && exec node "\$@"'
EOF
chmod +x /usr/local/bin/node
cat >/usr/local/bin/pm2 <<EOF
#!/bin/sh
exec sudo -u $KIT_PRIMARY_USER bash -lc 'source $NVM_DIR/nvm.sh && exec pm2 "\$@"'
EOF
chmod +x /usr/local/bin/pm2

log "install PM2 systemd unit"
NODE_BIN=$(ls $NVM_DIR/versions/node 2>/dev/null | tail -1)
write_file /etc/systemd/system/pm2-${KIT_PRIMARY_USER}.service root:root 0644 <<EOF
[Unit]
Description=PM2 process manager for $KIT_PRIMARY_USER
After=network.target

[Service]
Type=forking
User=$KIT_PRIMARY_USER
Environment=PATH=/usr/local/bin:/usr/bin:/bin:$NVM_DIR/versions/node/$NODE_BIN/bin
Environment=PM2_HOME=$USER_HOME/.pm2
ExecStart=$NVM_DIR/versions/node/$NODE_BIN/bin/pm2 resurrect
ExecStop=$NVM_DIR/versions/node/$NODE_BIN/bin/pm2 kill
ExecReload=$NVM_DIR/versions/node/$NODE_BIN/bin/pm2 reload all
Restart=on-failure

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable pm2-${KIT_PRIMARY_USER} || true

log "install Nginx + security headers"
ensure_pkg nginx
install -d -m 0755 /etc/nginx/sites-enabled /etc/nginx/snippets
write_file /etc/nginx/snippets/alo-security.conf root:root 0644 <<'EOF'
add_header X-Frame-Options "SAMEORIGIN" always;
add_header X-Content-Type-Options "nosniff" always;
add_header X-XSS-Protection "1; mode=block" always;
add_header Referrer-Policy "strict-origin-when-cross-origin" always;
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
add_header Permissions-Policy "camera=(), microphone=(), geolocation=()" always;
add_header Content-Security-Policy "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; connect-src 'self'; object-src 'none'; frame-ancestors 'self'; base-uri 'self'; form-action 'self';" always;
server_tokens off;
client_max_body_size 25m;
EOF

write_file /etc/nginx/conf.d/alo-upstream.conf root:root 0644 <<EOF
upstream alo_nextjs {
    least_conn;
    server 127.0.0.1:3000;
    server 127.0.0.1:3001;
    keepalive 32;
}
EOF

write_file /etc/nginx/sites-available/alo-default root:root 0644 <<EOF
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name _ ${KIT_DOMAIN};
    root $KIT_NGINX_WEBROOT;
    index index.html;
    include /etc/nginx/snippets/alo-security.conf;
    location /.well-known/acme-challenge/ { root /var/www/letsencrypt; }
    location / { try_files \$uri \$uri/ =404; }
    location @nextjs {
        proxy_pass http://alo_nextjs;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
    }
}
EOF
ln -sf /etc/nginx/sites-available/alo-default /etc/nginx/sites-enabled/alo-default
rm -f /etc/nginx/sites-enabled/default
nginx -t || die "nginx config invalid"
systemctl enable --now nginx
systemctl reload nginx

log "install certbot"
ensure_pkg certbot python3-certbot-nginx
install -d -m 0755 /var/www/letsencrypt
cat >/usr/local/bin/alo-issue-tls.sh <<'EOF'
#!/usr/bin/env bash
set -Eeuo pipefail
[[ -f /etc/alo-server-kit/kit.conf ]] && source /etc/alo-server-kit/kit.conf
DOMAIN="${KIT_DOMAIN:-alo.example.com}"
EMAIL="${KIT_ADMIN_EMAIL:-alamin@example.com}"
certbot certonly --webroot -w /var/www/letsencrypt -d "$DOMAIN" --email "$EMAIL" --agree-tos --no-eff-email --non-interactive
certbot --nginx -d "$DOMAIN" --redirect --non-interactive --keep-until-expiring
systemctl reload nginx
echo "TLS issued for $DOMAIN"
EOF
chmod +x /usr/local/bin/alo-issue-tls.sh

log "enforce python venv-only (PEP 668)"
ensure_pkg python3-venv python3-full pipx
if [[ ! -f /usr/lib/python3/dist-packages/EXTERNALLY-MANAGED ]]; then
  write_file /usr/lib/python3/dist-packages/EXTERNALLY-MANAGED root:root 0644 <<'EOF'
[externally-managed]
Error=This system Python is managed by apt. Use a venv: python3 -m venv .venv && source .venv/bin/activate
EOF
fi
sudo -u "$KIT_PRIMARY_USER" pipx ensurepath >/dev/null 2>&1 || true

log "deploying demo Next.js app"
APP_DIR="$KIT_APP_DIR"
install -d -m 0755 -o "$KIT_PRIMARY_USER" -g "$KIT_PRIMARY_USER" "$APP_DIR"
if sudo -u "$KIT_PRIMARY_USER" [[ ! -d "$APP_DIR/.git" ]] && [[ -d "$KIT_ROOT/demo-app" ]]; then
  sudo -u "$KIT_PRIMARY_USER" bash -lc "
    cp -r '$KIT_ROOT/demo-app' '$APP_DIR'
    cd '$APP_DIR'
    source $NVM_DIR/nvm.sh
    npm ci --include=dev
    NODE_ENV=production npm run build
  "
fi

write_file "$APP_DIR/ecosystem.config.cjs" "$KIT_PRIMARY_USER:$KIT_PRIMARY_USER" 0644 <<EOF
module.exports = {
  apps: [{
    name: 'alo-nextjs',
    script: './.next/standalone/server.js',
    instances: ${KIT_PM2_INSTANCES},
    exec_mode: 'cluster',
    max_memory_restart: '512M',
    env: { NODE_ENV: 'production', PORT: 3000, HOST: '127.0.0.1' },
    error_file: '$USER_HOME/.pm2/logs/alo-nextjs-err.log',
    out_file: '$USER_HOME/.pm2/logs/alo-nextjs-out.log',
    time: true
  }]
};
EOF

sudo -u "$KIT_PRIMARY_USER" bash -lc "
  source $NVM_DIR/nvm.sh
  cd $APP_DIR
  pm2 startOrReload ecosystem.config.cjs
  pm2 save
"
systemctl restart pm2-${KIT_PRIMARY_USER} || true

mark_done "$STAGE"; log "✓ $STAGE complete"
