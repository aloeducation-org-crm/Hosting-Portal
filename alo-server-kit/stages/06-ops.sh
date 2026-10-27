#!/usr/bin/env bash
set -Eeuo pipefail
source "$(dirname "$0")/../lib/common.sh"
require_root
STAGE="06-ops"; log "▶ $STAGE starting"
install -d -m 0700 -o root -g root /root/.alo-secrets

log "install Netdata (kickstart, bind 127.0.0.1)"
if ! command -v netdata >/dev/null; then
  curl -fsSL https://get.netdata.cloud/kickstart.sh | bash -s -- --dont-wait --disable-telemetry --stable-channel
fi
NETDATA_CONF=/etc/netdata/netdata.conf
if [[ -f "$NETDATA_CONF" ]]; then
  backup_file "$NETDATA_CONF"
  if ! grep -q 'bind to' "$NETDATA_CONF"; then
    printf '\n[web]\n    bind to = 127.0.0.1:%s\n' "$KIT_NETDATA_PORT" >> "$NETDATA_CONF"
  else
    sed -i "s|^\s*# bind to.*|    bind to = 127.0.0.1:${KIT_NETDATA_PORT}|" "$NETDATA_CONF"
  fi
fi
systemctl enable --now netdata
systemctl restart netdata || true

ensure_pkg apache2-utils
if [[ ! -f /etc/nginx/.htpasswd-netdata ]]; then
  ND_HTTP_PW="${KIT_HTTP_BASIC_PASS:-$(openssl rand -base64 18 | tr -d '/+=')}"
  htpasswd -bc /etc/nginx/.htpasswd-netdata "$KIT_PRIMARY_USER" "$ND_HTTP_PW" >/dev/null 2>&1
  chown root:www-data /etc/nginx/.htpasswd-netdata
  chmod 0640 /etc/nginx/.htpasswd-netdata
  printf 'NETDATA_BASIC_AUTH_USER=%s\nNETDATA_BASIC_AUTH_PASS=%s\n' "$KIT_PRIMARY_USER" "$ND_HTTP_PW" >> /root/.alo-secrets/http-basic-auth.txt
  chmod 0600 /root/.alo-secrets/http-basic-auth.txt
fi

write_file /etc/nginx/snippets/alo-netdata.conf root:root 0644 <<EOF
location /netdata/ {
    allow 127.0.0.1;
    allow ${KIT_LAN_CIDR};
    allow 100.64.0.0/10;
    deny all;
    auth_basic "Netdata";
    auth_basic_user_file /etc/nginx/.htpasswd-netdata;
    proxy_pass http://127.0.0.1:${KIT_NETDATA_PORT}/;
    proxy_http_version 1.1;
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
}
EOF
DEFAULT_SITE=/etc/nginx/sites-available/alo-default
if [[ -f "$DEFAULT_SITE" ]] && ! grep -q "alo-netdata.conf" "$DEFAULT_SITE"; then
  sed -i '/include \/etc\/nginx\/snippets\/alo-litellm.conf;/a\    include /etc/nginx/snippets/alo-netdata.conf;' "$DEFAULT_SITE"
fi
nginx -t && systemctl reload nginx

log "install health-check cron"
install -d -m 0755 /usr/local/sbin
cat >/usr/local/sbin/alo-healthcheck.sh <<EOF
#!/usr/bin/env bash
set -Eeuo pipefail
source "${KIT_ROOT}/lib/common.sh" 2>/dev/null || true
HOST="\${KIT_HOSTNAME:-alo-server-lap}"
TG="\${KIT_TELEGRAM_BOT_TOKEN:-}"; TG_CHAT="\${KIT_TELEGRAM_CHAT_ID:-}"
fail() {
  local msg="⚠️ *\${HOST} health* failure: \$1"
  echo "\$msg"
  if [[ -n "\$TG" && -n "\$TG_CHAT" ]]; then
    curl -sS --max-time 10 -X POST "https://api.telegram.org/bot\${TG}/sendMessage" -d chat_id="\$TG_CHAT" -d text="\$msg" -d parse_mode=Markdown >/dev/null
  fi
}
for svc in ssh nginx postgresql mysql pm2-\${KIT_PRIMARY_USER:-alamin} litellm ollama netdata; do
  systemctl is-active --quiet "\$svc" 2>/dev/null || fail "service \$svc not active"
done
while read -r line; do
  usage=\$(echo "\$line" | awk '{print \$5}' | tr -d '%')
  mnt=\$(echo "\$line" | awk '{print \$6}')
  if [[ "\${usage:-0}" -gt 90 ]]; then fail "disk \$mnt at \${usage}%"; fi
done < <(df -h | awk 'NR>1 && /^\/dev\//')
swap_used=\$(free -m | awk '/^Swap/ {print int(\$3/(\$2+1)*100)}')
if [[ "\${swap_used:-0}" -gt 80 ]]; then fail "swap usage \${swap_used}%"; fi
if ! curl -fsS --max-time 5 http://127.0.0.1:\${KIT_OLLAMA_PORT:-11434}/api/tags >/dev/null 2>&1; then fail "Ollama API not responding"; fi
if ! curl -fsS --max-time 5 http://127.0.0.1:\${KIT_LITELLM_PORT:-4000}/health/liveness >/dev/null 2>&1; then fail "LiteLLM health endpoint down"; fi
EOF
chmod 0750 /usr/local/sbin/alo-healthcheck.sh
write_file /etc/cron.d/alo-healthcheck root:root 0644 <<'EOF'
*/5 * * * * root /usr/local/sbin/alo-healthcheck.sh >> /var/log/alo-healthcheck.log 2>&1
EOF

log "deploy CI/CD script: /usr/local/sbin/alo-deploy.sh"
cat >/usr/local/sbin/alo-deploy.sh <<EOF
#!/usr/bin/env bash
set -Eeuo pipefail
APP_DIR=${KIT_APP_DIR:-/srv/alo-app}
USER=${KIT_PRIMARY_USER:-alamin}
NVM_DIR="/home/\$USER/.nvm"
cd "\$APP_DIR" || exit 1
sudo -u "\$USER" bash -lc "
  source \$NVM_DIR/nvm.sh
  git fetch --all
  git pull --ff-only origin main
  npm ci --include=dev
  npm run build
  pm2 reload ecosystem.config.cjs --update-env
  pm2 save
"
echo "[\$(date -Iseconds)] deploy complete"
EOF
chmod 0750 /usr/local/sbin/alo-deploy.sh

mark_done "$STAGE"; log "✓ $STAGE complete"
