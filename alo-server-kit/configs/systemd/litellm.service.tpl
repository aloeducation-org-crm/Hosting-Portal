[Unit]
Description=LiteLLM Proxy (OpenAI-compatible gateway)
After=network.target ollama.service
[Service]
Type=simple
User=__KIT_PRIMARY_USER__
Group=__KIT_PRIMARY_USER__
WorkingDirectory=/opt/litellm
ExecStart=/opt/litellm/venv/bin/litellm --config /opt/litellm/config.yaml --host 127.0.0.1 --port __KIT_LITELLM_PORT__
Restart=on-failure
RestartSec=5s
MemoryMax=1G
NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=yes
ReadWritePaths=/opt/litellm
[Install]
WantedBy=multi-user.target
