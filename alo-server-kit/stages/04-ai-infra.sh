#!/usr/bin/env bash
set -Eeuo pipefail
source "$(dirname "$0")/../lib/common.sh"
require_root
STAGE="04-ai-infra"; log "▶ $STAGE starting"
USER_HOME=$(getent passwd "$KIT_PRIMARY_USER" | cut -d: -f6)
LITELLM_DIR="/opt/litellm"; OUI_DIR="/opt/open-webui"
install -d -m 0700 -o root -g root /etc/alo-server-kit /root/.alo-secrets

log "installing Ollama (localhost-only, MemoryMax=${KIT_OLLAMA_MEM_MAX})"
if ! command -v ollama >/dev/null; then
  curl -fsSL https://ollama.com/install.sh | sh
fi
OllamaSVC=/etc/systemd/system/ollama.service
if [[ -f "$OllamaSVC" ]]; then
  backup_file "$OllamaSVC"
  if ! grep -q "MemoryMax=" "$OllamaSVC"; then
    sed -i '/^\[Service\]/a MemoryMax='"$KIT_OLLAMA_MEM_MAX"'\nCPUQuota=200%\nTasksMax=512\nNoNewPrivileges=yes\nProtectSystem=strict\nProtectHome=yes\nReadWritePaths=/usr/share/ollama /var/log' "$OllamaSVC"
  fi
  if ! grep -q 'OLLAMA_HOST=' "$OllamaSVC"; then
    sed -i '/^\[Service\]/a Environment="OLLAMA_HOST=127.0.0.1:'"$KIT_OLLAMA_PORT"'"' "$OllamaSVC"
  fi
fi
systemctl daemon-reload
systemctl enable --now ollama

log "pulling Ollama models: $KIT_OLLAMA_MODELS"
for m in $KIT_OLLAMA_MODELS; do
  if ! ollama list 2>/dev/null | awk '{print $1}' | grep -qx "$m"; then
    ollama pull "$m"
  fi
done

log "installing LiteLLM proxy (pinned 1.106.4)"
install -d -m 0750 -o "$KIT_PRIMARY_USER" -g "$KIT_PRIMARY_USER" "$LITELLM_DIR"
if [[ ! -d "$LITELLM_DIR/venv" ]]; then
  python3 -m venv "$LITELLM_DIR/venv"
fi
chown -R "$KIT_PRIMARY_USER:$KIT_PRIMARY_USER" "$LITELLM_DIR"
sudo -u "$KIT_PRIMARY_USER" "$LITELLM_DIR/venv/bin/pip" install --quiet --upgrade pip
sudo -u "$KIT_PRIMARY_USER" "$LITELLM_DIR/venv/bin/pip" install --quiet 'litellm[proxy]==1.106.4' 'uvicorn[standard]' 'fastapi' 'gunicorn'

TEMPLATE="$KIT_ROOT/configs/litellm/config.yaml.tpl"
if [[ -f "$TEMPLATE" ]] && command -v envsubst >/dev/null; then
  envsubst < "$TEMPLATE" > "$LITELLM_DIR/config.yaml"
  chown "$KIT_PRIMARY_USER:$KIT_PRIMARY_USER" "$LITELLM_DIR/config.yaml"
  chmod 0600 "$LITELLM_DIR/config.yaml"
fi

write_file /etc/systemd/system/litellm.service root:root 0644 <<EOF
[Unit]
Description=LiteLLM Proxy (OpenAI-compatible gateway)
After=network.target ollama.service

[Service]
Type=simple
User=$KIT_PRIMARY_USER
Group=$KIT_PRIMARY_USER
WorkingDirectory=$LITELLM_DIR
ExecStart=$LITELLM_DIR/venv/bin/litellm --config $LITELLM_DIR/config.yaml --host 127.0.0.1 --port ${KIT_LITELLM_PORT}
Restart=on-failure
RestartSec=5s
MemoryMax=1G
NoNewPrivileges=yes
PrivateTmp=yes
ProtectSystem=strict
ProtectHome=yes
ReadWritePaths=$LITELLM_DIR

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable --now litellm

# NOTE: Open WebUI uses the Open WebUI License (source-available, branding must be preserved).
# Pinned to 0.12.4 (requires Python >=3.11,<3.13; Ubuntu 24.04 ships Python 3.12).
log "installing Open WebUI 0.12.4 on :${KIT_OPENWEBUI_PORT} (internal staff use only)"
install -d -m 0750 -o "$KIT_PRIMARY_USER" -g "$KIT_PRIMARY_USER" "$OUI_DIR" "$OUI_DIR/data"
OUI_PY="python3"
command -v python3.12 >/dev/null 2>&1 && OUI_PY="python3.12"
if [[ ! -d "$OUI_DIR/venv" ]]; then "$OUI_PY" -m venv "$OUI_DIR/venv"; fi
chown -R "$KIT_PRIMARY_USER:$KIT_PRIMARY_USER" "$OUI_DIR"
sudo -u "$KIT_PRIMARY_USER" "$OUI_DIR/venv/bin/pip" install --quiet --upgrade pip
sudo -u "$KIT_PRIMARY_USER" "$OUI_DIR/venv/bin/pip" install --quiet 'open-webui==0.12.4'

WEBUI_SECRET=$(openssl rand -hex 32)
if [[ -f /etc/alo-server-kit/open-webui.env ]] && grep -q '^WEBUI_SECRET_KEY=' /etc/alo-server-kit/open-webui.env; then
  WEBUI_SECRET=$(grep '^WEBUI_SECRET_KEY=' /etc/alo-server-kit/open-webui.env | head -1 | cut -d= -f2-)
fi

write_file /etc/alo-server-kit/open-webui.env root:root 0600 <<EOF
WEBUI_AUTH=true
WEBUI_SECRET_KEY=${WEBUI_SECRET}
DATA_DIR=${OUI_DIR}/data
SCARF_NO_ANALYTICS=true
DO_NOT_TRACK=true
ANONYMIZED_TELEMETRY=false
OPENAI_API_BASE_URL=http://127.0.0.1:${KIT_LITELLM_PORT}/v1
OPENAI_API_KEY=${KIT_LITELLM_MASTER_KEY}
OLLAMA_BASE_URL=http://127.0.0.1:${KIT_OLLAMA_PORT}
EOF

write_file /etc/systemd/system/open-webui.service root:root 0644 <<EOF
[Unit]
Description=Open WebUI (Internal Staff Workspace)
After=network.target litellm.service

[Service]
Type=simple
User=$KIT_PRIMARY_USER
Group=$KIT_PRIMARY_USER
WorkingDirectory=$OUI_DIR
EnvironmentFile=/etc/alo-server-kit/open-webui.env
ExecStart=$OUI_DIR/venv/bin/open-webui serve --host 127.0.0.1 --port ${KIT_OPENWEBUI_PORT}
Restart=on-failure
RestartSec=5s
MemoryMax=2G
NoNewPrivileges=yes
PrivateTmp=yes
ProtectSystem=strict
ProtectHome=yes
ReadWritePaths=$OUI_DIR

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable --now open-webui

log "configure Nginx /ai/ -> LiteLLM (LAN + Tailscale + Basic Auth)"
ensure_pkg apache2-utils
if [[ ! -f /etc/nginx/.htpasswd-ai ]]; then
  if [[ -t 0 ]] && [[ -z "${KIT_AI_BASIC_AUTH_PASS:-}" ]]; then
    echo "Create a password for the LiteLLM basic-auth user '${KIT_PRIMARY_USER}':"
    htpasswd -c /etc/nginx/.htpasswd-ai "$KIT_PRIMARY_USER"
  else
    AI_PASS="${KIT_AI_BASIC_AUTH_PASS:-$(openssl rand -base64 24 | tr -d '/+=' | head -c 24)}"
    htpasswd -bc /etc/nginx/.htpasswd-ai "$KIT_PRIMARY_USER" "$AI_PASS"
    write_file /root/.alo-secrets/litellm-basic-auth.txt root:root 0600 <<EOF
AI_GATEWAY_USER=${KIT_PRIMARY_USER}
AI_GATEWAY_PASSWORD=${AI_PASS}
EOF
  fi
fi
chown root:www-data /etc/nginx/.htpasswd-ai 2>/dev/null || true
chmod 0640 /etc/nginx/.htpasswd-ai

write_file /etc/nginx/snippets/alo-litellm.conf root:root 0644 <<EOF
location /ai/ {
    allow 127.0.0.1;
    allow ::1;
    allow ${KIT_LAN_CIDR};
    allow 100.64.0.0/10;
    deny all;
    auth_basic "LiteLLM Gateway";
    auth_basic_user_file /etc/nginx/.htpasswd-ai;
    proxy_pass http://127.0.0.1:${KIT_LITELLM_PORT}/;
    proxy_http_version 1.1;
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
    proxy_buffering off;
    proxy_read_timeout 300s;
    proxy_send_timeout 300s;
}
EOF

DEFAULT_SITE=/etc/nginx/sites-available/alo-default
if ! grep -q "alo-litellm.conf" "$DEFAULT_SITE"; then
  sed -i '/location @nextjs/i\    include /etc/nginx/snippets/alo-litellm.conf;\n' "$DEFAULT_SITE"
fi
nginx -t && systemctl reload nginx

mark_done "$STAGE"; log "✓ $STAGE complete"
