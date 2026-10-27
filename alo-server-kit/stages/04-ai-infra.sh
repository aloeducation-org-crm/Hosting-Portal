#!/usr/bin/env bash
set -Eeuo pipefail
source "$(dirname "$0")/../lib/common.sh"
require_root
STAGE="04-ai-infra"; log "▶ $STAGE starting"
LITELLM_DIR="/opt/litellm"; OUI_DIR="/opt/open-webui"
OPENWEBUI_PORT="${KIT_OPENWEBUI_PORT:-3005}"
OPENWEBUI_VERSION="${KIT_OPENWEBUI_VERSION:-0.6.5}"
INSTALL_OPENWEBUI="${KIT_INSTALL_OPENWEBUI:-yes}"
EXPOSE_AI_PUBLIC="${KIT_EXPOSE_AI_PUBLIC:-no}"

install -d -m 0700 -o root -g root /root/.alo-secrets
install -d -m 0750 -o root -g "$KIT_PRIMARY_USER" /etc/litellm

# Ensure strong non-placeholder master key
if [[ -z "${KIT_LITELLM_MASTER_KEY:-}" || "$KIT_LITELLM_MASTER_KEY" == *"CHANGE"* ]]; then
  if [[ -f /root/.alo-secrets/ai-gateway.txt ]]; then
    KIT_LITELLM_MASTER_KEY=$(awk -F= '/^LITELLM_MASTER_KEY=/{print $2}' /root/.alo-secrets/ai-gateway.txt | head -1)
  fi
  if [[ -z "${KIT_LITELLM_MASTER_KEY:-}" ]]; then
    KIT_LITELLM_MASTER_KEY="sk-alo-$(openssl rand -hex 24)"
  fi
fi

write_file /root/.alo-secrets/ai-gateway.txt root:root 0600 <<EOF
LITELLM_MASTER_KEY=${KIT_LITELLM_MASTER_KEY}
LITELLM_URL=http://127.0.0.1:${KIT_LITELLM_PORT}/v1
EOF

# 0600 env file read by systemd — keeps API keys out of world-readable 0644 unit files!
write_file /etc/litellm/litellm.env root:root 0600 <<EOF
LITELLM_MASTER_KEY=${KIT_LITELLM_MASTER_KEY}
GEMINI_API_KEY=${KIT_GEMINI_API_KEY:-}
GROQ_API_KEY=${KIT_GROQ_API_KEY:-}
EOF

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

log "installing LiteLLM proxy (bound to 127.0.0.1:${KIT_LITELLM_PORT})"
install -d -m 0755 -o "$KIT_PRIMARY_USER" -g "$KIT_PRIMARY_USER" "$LITELLM_DIR"
if [[ ! -d "$LITELLM_DIR/venv" ]]; then
  python3 -m venv "$LITELLM_DIR/venv"
fi
chown -R "$KIT_PRIMARY_USER:$KIT_PRIMARY_USER" "$LITELLM_DIR"
sudo -u "$KIT_PRIMARY_USER" "$LITELLM_DIR/venv/bin/pip" install --quiet --upgrade pip
sudo -u "$KIT_PRIMARY_USER" "$LITELLM_DIR/venv/bin/pip" install --quiet 'litellm[proxy]==1.52.0' 'uvicorn[standard]' 'fastapi' 'gunicorn'

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
EnvironmentFile=/etc/litellm/litellm.env
ExecStart=$LITELLM_DIR/venv/bin/litellm --config $LITELLM_DIR/config.yaml --host 127.0.0.1 --port ${KIT_LITELLM_PORT}
Restart=on-failure
RestartSec=5s
MemoryMax=1G
NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=yes
ReadWritePaths=$LITELLM_DIR

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable --now litellm

if [[ "$INSTALL_OPENWEBUI" == "yes" ]]; then
  log "installing Open WebUI == ${OPENWEBUI_VERSION} on 127.0.0.1:${OPENWEBUI_PORT}"
  log "LICENSE NOTICE: Open WebUI License restricts branding modification >50 users; use LibreChat (MIT) for white-label/multi-tenant."
  install -d -m 0755 -o "$KIT_PRIMARY_USER" -g "$KIT_PRIMARY_USER" "$OUI_DIR"
  if [[ ! -d "$OUI_DIR/venv" ]]; then python3 -m venv "$OUI_DIR/venv"; fi
  chown -R "$KIT_PRIMARY_USER:$KIT_PRIMARY_USER" "$OUI_DIR"
  sudo -u "$KIT_PRIMARY_USER" "$OUI_DIR/venv/bin/pip" install --quiet --upgrade pip
  sudo -u "$KIT_PRIMARY_USER" "$OUI_DIR/venv/bin/pip" install --quiet "open-webui==${OPENWEBUI_VERSION}"

  WEBUI_SECRET=$(openssl rand -hex 24)
  write_file /etc/litellm/open-webui.env root:root 0600 <<EOF
WEBUI_AUTH=true
WEBUI_SECRET_KEY=${WEBUI_SECRET}
OPENAI_API_BASE_URL=http://127.0.0.1:${KIT_LITELLM_PORT}/v1
OPENAI_API_KEY=${KIT_LITELLM_MASTER_KEY}
OLLAMA_BASE_URL=http://127.0.0.1:${KIT_OLLAMA_PORT}
EOF

  write_file /etc/systemd/system/open-webui.service root:root 0644 <<EOF
[Unit]
Description=Open WebUI (Internal Team Workspace)
After=network.target litellm.service

[Service]
Type=simple
User=$KIT_PRIMARY_USER
Group=$KIT_PRIMARY_USER
WorkingDirectory=$OUI_DIR
EnvironmentFile=/etc/litellm/open-webui.env
ExecStart=$OUI_DIR/venv/bin/open-webui serve --host 127.0.0.1 --port ${OPENWEBUI_PORT}
Restart=on-failure
RestartSec=5s
MemoryMax=2G
NoNewPrivileges=yes

[Install]
WantedBy=multi-user.target
EOF
  systemctl daemon-reload
  systemctl enable --now open-webui
fi

log "configure Nginx /ai/ -> LiteLLM (LAN/Tailscale restricted by default + basic auth)"
ensure_pkg apache2-utils
if [[ ! -f /etc/nginx/.htpasswd-ai ]]; then
  AI_HTTP_PW="${KIT_HTTP_BASIC_PASS:-$(openssl rand -base64 18 | tr -d '/+=')}"
  htpasswd -bc /etc/nginx/.htpasswd-ai "$KIT_PRIMARY_USER" "$AI_HTTP_PW" >/dev/null 2>&1
  chown root:www-data /etc/nginx/.htpasswd-ai
  chmod 0640 /etc/nginx/.htpasswd-ai
  printf 'AI_BASIC_AUTH_USER=%s\nAI_BASIC_AUTH_PASS=%s\n' "$KIT_PRIMARY_USER" "$AI_HTTP_PW" >> /root/.alo-secrets/http-basic-auth.txt
  chmod 0600 /root/.alo-secrets/http-basic-auth.txt
fi

if [[ "$EXPOSE_AI_PUBLIC" == "yes" ]]; then
  AI_ACL_BLOCK="    # Public exposure explicitly opted in via KIT_EXPOSE_AI_PUBLIC=yes"
else
  AI_ACL_BLOCK="    allow 127.0.0.1;
    allow ${KIT_LAN_CIDR};
    allow 100.64.0.0/10;
    deny all;"
fi

write_file /etc/nginx/snippets/alo-litellm.conf root:root 0644 <<EOF
location /ai/ {
${AI_ACL_BLOCK}
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
if [[ -f "$DEFAULT_SITE" ]] && ! grep -q "alo-litellm.conf" "$DEFAULT_SITE"; then
  sed -i '/location @nextjs/i\    include /etc/nginx/snippets/alo-litellm.conf;\n' "$DEFAULT_SITE"
fi
nginx -t && systemctl reload nginx

mark_done "$STAGE"; log "✓ $STAGE complete"
