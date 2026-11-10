[Unit]
Description=Open WebUI (frontend for LiteLLM + Ollama)
After=network.target litellm.service
[Service]
Type=simple
User=__KIT_PRIMARY_USER__
Group=__KIT_PRIMARY_USER__
WorkingDirectory=/opt/open-webui
Environment=WEBUI_AUTH=true
Environment=OPENAI_API_BASE_URL=http://127.0.0.1:__KIT_LITELLM_PORT__
Environment=OPENAI_API_KEY=__KIT_LITELLM_MASTER_KEY__
Environment=OLLAMA_API_BASE_URL=http://127.0.0.1:__KIT_OLLAMA_PORT__
ExecStart=/opt/open-webui/venv/bin/open-webui serve --host 127.0.0.1 --port __KIT_OPENWEBUI_PORT__
Restart=on-failure
RestartSec=5s
MemoryMax=2G
[Install]
WantedBy=multi-user.target
