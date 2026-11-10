[Unit]
Description=Ollama — local LLM runtime (RAM-capped, localhost-only)
After=network.target
[Service]
Type=simple
User=ollama
Group=ollama
Environment="OLLAMA_HOST=127.0.0.1:11434"
Environment="OLLAMA_KEEP_ALIVE=24h"
Environment="OLLAMA_MAX_LOADED_MODELS=2"
ExecStart=/usr/local/bin/ollama serve
Restart=on-failure
RestartSec=5s
MemoryMax=__KIT_OLLAMA_MEM_MAX__
CPUQuota=200%
TasksMax=512
NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=yes
ReadWritePaths=/usr/share/ollama /var/log
[Install]
WantedBy=multi-user.target
