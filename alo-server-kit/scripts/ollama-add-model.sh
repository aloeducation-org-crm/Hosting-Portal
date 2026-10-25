#!/usr/bin/env bash
set -Eeuo pipefail
source "$(dirname "$0")/../lib/common.sh"
require_root
MODEL="${1:-}"; LITELLM_NAME="${2:-$MODEL}"
[[ -n "$MODEL" ]] || die "usage: $0 <ollama-model> [litellm-model-name]"
log "pulling $MODEL"
ollama pull "$MODEL"
LITELLM_CFG=/opt/litellm/config.yaml
backup_file "$LITELLM_CFG"
if ! grep -q "model_name: ${LITELLM_NAME}$" "$LITELLM_CFG" 2>/dev/null; then
  python3 - "$LITELLM_CFG" "$LITELLM_NAME" "$MODEL" <<'PY'
import sys, yaml
cfg_path, name, model = sys.argv[1], sys.argv[2], sys.argv[3]
with open(cfg_path) as f: cfg = yaml.safe_load(f) or {}
cfg.setdefault('model_list', []).append({
    'model_name': name,
    'litellm_params': {'model': f'ollama/{model}', 'api_base': 'http://127.0.0.1:11434'}
})
with open(cfg_path, 'w') as f: yaml.safe_dump(cfg, f, sort_keys=False)
print(f"added {name} -> ollama/{model}")
PY
  chown "$KIT_PRIMARY_USER:$KIT_PRIMARY_USER" "$LITELLM_CFG"
  chmod 0600 "$LITELLM_CFG"
  systemctl restart litellm
  log "✓ $MODEL added to LiteLLM as '$LITELLM_NAME'"
else
  log "model '$LITELLM_NAME' already in LiteLLM config"
fi
