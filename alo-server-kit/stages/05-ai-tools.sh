#!/usr/bin/env bash
set -Eeuo pipefail
source "$(dirname "$0")/../lib/common.sh"
[[ $EUID -eq 0 ]] || exec sudo -E bash "$0" "$@"
STAGE="05-ai-tools"; log "▶ $STAGE starting"
USER_HOME=$(getent passwd "$KIT_PRIMARY_USER" | cut -d: -f6)

log "install VS Code"
if ! command -v code >/dev/null; then
  curl -fsSL https://packages.microsoft.com/keys/microsoft.asc | gpg --dearmor -o /usr/share/keyrings/microsoft.gpg
  echo "deb [arch=amd64,arm64 signed-by=/usr/share/keyrings/microsoft.gpg] https://packages.microsoft.com/repos/code stable main" > /etc/apt/sources.list.d/vscode.list
  apt-get -y update >/dev/null
  ensure_pkg code
fi

log "install Aider via pipx (0600 secret config)"
sudo -u "$KIT_PRIMARY_USER" pipx install aider-chat >/dev/null 2>&1 || sudo -u "$KIT_PRIMARY_USER" pipx upgrade aider-chat
install -d -m 0700 -o "$KIT_PRIMARY_USER" -g "$KIT_PRIMARY_USER" "$USER_HOME/.aider" "$USER_HOME/.aider/conf.d"
write_file "$USER_HOME/.aider/conf.d/alo.yml" "$KIT_PRIMARY_USER:$KIT_PRIMARY_USER" 0600 <<EOF
model: openai/qwen2.5:7b
openai-api-base: http://127.0.0.1:${KIT_LITELLM_PORT}/v1
openai-api-key: ${KIT_LITELLM_MASTER_KEY}
edit-format: diff
auto-commits: true
auto-lint: true
EOF

log "install VS Code extensions"
sudo -u "$KIT_PRIMARY_USER" bash -lc 'code --install-extension continue.continue --force 2>/dev/null || true'
sudo -u "$KIT_PRIMARY_USER" bash -lc 'code --install-extension saoudrizwan.claude-dev --force 2>/dev/null || true'

CONTINUE_DIR="$USER_HOME/.continue"
install -d -m 0700 -o "$KIT_PRIMARY_USER" -g "$KIT_PRIMARY_USER" "$CONTINUE_DIR"
write_file "$CONTINUE_DIR/config.json" "$KIT_PRIMARY_USER:$KIT_PRIMARY_USER" 0600 <<EOF
{
  "models": [
    {"title": "ALO LiteLLM (qwen2.5)", "provider": "openai", "model": "qwen2.5:7b",
     "apiBase": "http://127.0.0.1:${KIT_LITELLM_PORT}/v1", "apiKey": "${KIT_LITELLM_MASTER_KEY}"},
    {"title": "ALO LiteLLM (llama3.1)", "provider": "openai", "model": "llama3.1:8b",
     "apiBase": "http://127.0.0.1:${KIT_LITELLM_PORT}/v1", "apiKey": "${KIT_LITELLM_MASTER_KEY}"},
    {"title": "ALO LiteLLM (gemini)", "provider": "openai", "model": "gemini-1.5-flash",
     "apiBase": "http://127.0.0.1:${KIT_LITELLM_PORT}/v1", "apiKey": "${KIT_LITELLM_MASTER_KEY}"}
  ],
  "tabAutocompleteModel": {"title": "ALO Codellama", "provider": "openai", "model": "codellama:7b",
    "apiBase": "http://127.0.0.1:${KIT_LITELLM_PORT}/v1", "apiKey": "${KIT_LITELLM_MASTER_KEY}"},
  "allowAnonymousTelemetry": false
}
EOF

CLINE_DIR="$USER_HOME/.config/Code/User/globalStorage/saoudrizwan.claude-dev/settings"
install -d -m 0700 -o "$KIT_PRIMARY_USER" -g "$KIT_PRIMARY_USER" "$CLINE_DIR"
write_file "$CLINE_DIR/alo-litellm.json" "$KIT_PRIMARY_USER:$KIT_PRIMARY_USER" 0600 <<EOF
{
  "apiProvider": "openai",
  "openAiBaseUrl": "http://127.0.0.1:${KIT_LITELLM_PORT}/v1",
  "openAiApiKey": "${KIT_LITELLM_MASTER_KEY}",
  "openAiModelId": "qwen2.5:7b",
  "openAiCustomModelInfo": {"maxTokens": 32768, "contextWindow": 32768, "supportsImages": false, "supportsComputerUse": false}
}
EOF

mark_done "$STAGE"; log "✓ $STAGE complete"
