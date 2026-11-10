#!/usr/bin/env bash
set -Eeuo pipefail
source "$(dirname "$0")/../lib/common.sh"
require_root
NEW_KEY="sk-alolitellm-$(openssl rand -hex 16)"
log "new LiteLLM master key: $NEW_KEY"
sed -i "s|^master_key:.*|master_key: ${NEW_KEY}|" /opt/litellm/config.yaml 2>/dev/null || true
grep -q "^master_key:" /opt/litellm/config.yaml 2>/dev/null || echo "master_key: $NEW_KEY" >> /opt/litellm/config.yaml
chown "$KIT_PRIMARY_USER:$KIT_PRIMARY_USER" /opt/litellm/config.yaml
chmod 0600 /opt/litellm/config.yaml
systemctl restart litellm
sed -i "s|OPENAI_API_KEY=.*|OPENAI_API_KEY=${NEW_KEY}|" /etc/systemd/system/open-webui.service
systemctl daemon-reload && systemctl restart open-webui
USER_HOME=$(getent passwd "$KIT_PRIMARY_USER" | cut -d: -f6)
sed -i "s|\"apiKey\": \".*\"|\"apiKey\": \"${NEW_KEY}\"|g" "$USER_HOME/.continue/config.json" 2>/dev/null || true
CLINE_CFG="$USER_HOME/.config/Code/User/globalStorage/saoudrizwan.claude-dev/settings/alo-litellm.json"
sed -i "s|\"openAiApiKey\": \".*\"|\"openAiApiKey\": \"${NEW_KEY}\"|g" "$CLINE_CFG" 2>/dev/null || true
sed -i "s|^openai-api-key:.*|openai-api-key: ${NEW_KEY}|" "$USER_HOME/.aider/conf.d/alo.yml" 2>/dev/null || true
sed -i "s|^KIT_LITELLM_MASTER_KEY=.*|KIT_LITELLM_MASTER_KEY=${NEW_KEY}|" "$KIT_ROOT/config.env"
log "✓ key rotated across LiteLLM, Open-WebUI, Continue, Cline, Aider, config.env"
