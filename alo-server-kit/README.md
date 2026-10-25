# alo-server-kit

A complete, idempotent, **7-layer Ubuntu server setup kit** for `alo-server-lap`
(Ubuntu 22.04, 15 GB RAM, user `alamin`, Tailscale IP `100.94.234.101`).
Zero-budget, security-first, all configs in version control.

> **What this kit is NOT:** it is not a Docker Compose stack or a hosted
> service. It is a collection of staged bash scripts that turn a fresh Ubuntu
> install into a fully-configured dev/production server, executed on the
> server itself with one command. Designed for a single physical box with
> ~15 GB RAM.

---

## ✨ The 7 layers

| Layer | Concern        | Highlights |
|-------|----------------|------------|
| **L1** | Security       | SSH port 2244 · key-only · root disabled · `AllowUsers alamin` · UFW (2244/80/443 + LAN-only DB/Samba) · Fail2Ban 3→24h · sysctl hardening |
| **L2** | Web/App       | NVM + Node LTS · PM2 cluster (×2) · Nginx reverse proxy + security headers + Let's Encrypt · Python venv-only (PEP 668) |
| **L3** | Databases     | PostgreSQL (scram-sha-256, dedicated app user, LAN-only) · MySQL 8 (validate_password MEDIUM, no remote root, LAN-only) · daily gzip backups with 7/30/365-day retention |
| **L4** | AI Infra      | Ollama (qwen2.5:7b, llama3.1:8b, codellama:7b, MemoryMax=8G) · LiteLLM proxy on :4000 (Gemini→Groq→Cloudflare→Ollama fallbacks, per-key budgets) · Open WebUI on :3001 |
| **L5** | AI Coding     | VS Code + Continue.dev + Cline extensions + Aider (pipx) — all backends pointing at LiteLLM |
| **L6** | Ops/CI-CD     | Netdata (localhost, proxied) · 5-min cron health checks · Telegram alerts · GitHub Actions → SSH → `git pull → build → pm2 reload` |
| **L7** | File Sync     | Syncthing (~/shared/{documents,projects}) · Samba LAN shares (documents RW, projects RW, backups RO) · Nginx proxy + basic auth |

**Constraints honored:** $0 budget · 15 GB RAM · nothing public except 80/443 ·
fewer multi-purpose tools · all configs in version control.

---

## 🚀 Quick start

```bash
# 1. Clone onto alo-server-lap
git clone https://github.com/<you>/alo-server-kit.git
cd alo-server-kit

# 2. Configure
cp config.env.example config.env
$EDITOR config.env        # set domain, LAN CIDR, API keys, Telegram bot, etc.

# 3. Run the full install (one command, idempotent)
sudo ./setup.sh

# 4. VERIFY SSH ON PORT 2244 FROM ANOTHER TERMINAL BEFORE CONTINUING
ssh -p 2244 alamin@100.94.234.101

# 5. Once 2244 works, close port 22 (lockout protection)
sudo ./scripts/close-ssh-22.sh

# 6. Audit every layer
sudo ./verify.sh

# 7. After DNS points to the box, issue TLS
sudo /usr/local/bin/alo-issue-tls.sh
```

Re-run any single stage safely:

```bash
sudo ./setup.sh 04          # re-run only the AI Infra stage
sudo ./setup.sh --reset     # clear state, re-run everything
```

---

## 📂 Repository layout

```
alo-server-kit/
├── setup.sh                # orchestrator — run all stages in order
├── verify.sh                # on-machine audit (✅/⚠️/❌ per layer)
├── status.sh                # quick live snapshot of every service
├── backup.sh                # on-demand DB + config snapshot
├── restore.sh               # restore configs / DB from a tarball
├── config.env.example
├── .gitignore
│
├── lib/common.sh            # shared helpers: log, die, write_file, mark_done, send_telegram
│
├── stages/
│   ├── 00-preflight.sh      # packages, TZ, swap, unattended-upgrades, LVM audit
│   ├── 01-security.sh       # SSH 2244, UFW, Fail2Ban, sysctl
│   ├── 02-webapp.sh         # NVM, Node LTS, PM2, Nginx, Certbot, Python venv
│   ├── 03-databases.sh      # PostgreSQL, MySQL, backups w/ rotation
│   ├── 04-ai-infra.sh       # Ollama, LiteLLM, Open WebUI
│   ├── 05-ai-tools.sh       # Aider, VS Code, Continue.dev, Cline
│   ├── 06-ops.sh             # Netdata, cron health, Telegram, CI/CD deploy
│   └── 07-filesync.sh       # Syncthing, Samba, basic-auth Nginx
│
├── scripts/                 # operational helpers
│   ├── close-ssh-22.sh      # close temp SSH port after verifying 2244
│   ├── ssh-key.sh           # add/list/remove authorized_keys entries
│   ├── rotate-litellm-key.sh # rotate LiteLLM master key across all consumers
│   └── ollama-add-model.sh  # pull a new Ollama model + register in LiteLLM
│
├── configs/
│   ├── nginx/               # default-site template + snippets
│   ├── systemd/             # service unit templates (.tpl files)
│   ├── litellm/config.yaml.tpl
│   ├── pm2/ecosystem.config.cjs
│   ├── ai-tools/            # Continue.dev, Cline, Aider reference configs
│   ├── github-actions/deploy.yml
│   ├── alo-db-backup.cron
│   └── alo-healthcheck.cron
│
├── demo-app/                # minimal Next.js 14 app for end-to-end testing
│   ├── package.json
│   ├── next.config.js
│   ├── tsconfig.json
│   └── src/app/
│       ├── layout.tsx
│       ├── page.tsx
│       ├── globals.css
│       └── healthz/route.ts
│
└── README.md (this file)
```

---

## 🛡️ Security model

### Firewall (UFW)
- **Public**: 2244/tcp (SSH), 80/tcp (HTTP), 443/tcp (HTTPS).
- **Tailscale**: full trust on `tailscale0` interface.
- **LAN-only** (`192.168.0.0/24`): PostgreSQL 5432, MySQL 3306, Samba 137/138/139/445, Syncthing admin 8384.
- **Localhost-only** (explicit `deny`): Ollama 11434, LiteLLM 4000, Open WebUI 3001, Netdata 19999.

### SSH
- Custom port `2244`, key-only, `PermitRootLogin no`, `AllowUsers alamin`.
- **Lockout protection**: keeps port 22 open until you run `sudo ./scripts/close-ssh-22.sh`.

### Fail2Ban
- 3 retries within 10 minutes → 24-hour ban.

### Databases
- PostgreSQL: `scram-sha-256`, app user restricted to its own DB.
- MySQL 8: `validate_password` MEDIUM, root restricted to `localhost`.

### Backups
- Daily gzip at 02:30. Retention: 7 / 30 / 365 days.
- Stored at `/var/backups/alo-db/{daily,weekly,monthly}/`.
- Exposed read-only over Samba to LAN.

---

## 🤖 AI infrastructure

### LiteLLM proxy (`/opt/litellm`, port 4000)
- OpenAI-compatible gateway.
- **Fallback chain**:
  - `gemini-1.5-flash` → `groq-llama-3.1-8b-instant` → `cf-llama-3.1-8b-instruct` → `qwen2.5:7b` (local)
  - `gemini-1.5-pro`   → `groq-llama-3.3-70b-versatile` → `llama3.1:8b` (local)
  - `codellama:7b`     → `groq-llama-3.1-8b-instant` → `gemini-1.5-flash`
- **Per-key budgets**: create virtual keys for each consumer.
- Tracked in SQLite at `/opt/litellm/litellm.db`.
- Exposed at `https://<host>/ai/` via Nginx with HTTP basic-auth + the LiteLLM master key.

### Ollama (port 11434, localhost-only)
- Pre-pulls `qwen2.5:7b`, `llama3.1:8b`, `codellama:7b` (≈6-8 GB RAM).
- Systemd-hardened: `MemoryMax=8G` so it can never OOM the 15 GB box.
- `OLLAMA_KEEP_ALIVE=24h`, `OLLAMA_MAX_LOADED_MODELS=2`.

### Open WebUI (port 3001, localhost-only)
- Frontend for LiteLLM + Ollama.

### Free-tier upstreams
- **Google Gemini** — `gemini-1.5-flash`, `gemini-1.5-pro`
- **Groq** — `llama-3.1-8b-instant`, `llama-3.3-70b-versatile`
- **Cloudflare Workers AI** — `llama-3.1-8b-instruct`

Add a new model:
```bash
sudo ./scripts/ollama-add-model.sh deepseek-coder:6.7b deepseek-coder
```

Rotate the LiteLLM master key:
```bash
sudo ./scripts/rotate-litellm-key.sh
```

---

## 📡 Ops / CI/CD

### GitHub Actions → SSH deploy
1. Put `configs/github-actions/deploy.yml` into your app repo at `.github/workflows/deploy.yml`.
2. Add repo secrets:
   - `ALA_SERVER_HOST` — Tailscale IP (`100.94.234.101`).
   - `ALA_SERVER_PORT` — `2244`.
   - `ALA_SERVER_SSH_KEY` — private key.
3. On every push to `main`, the workflow SSHes in and runs `sudo /usr/local/sbin/alo-deploy.sh`.

### Monitoring
- **Netdata** at `https://<host>/netdata/` (LAN-only, basic-auth).
- **5-minute cron** verifies all services + disk + swap + Ollama/LiteLLM APIs.
- On any failure → Telegram message.

---

## 📁 File sync

### Syncthing (user service, runs as `alamin`)
- Folders: `~/shared/documents`, `~/shared/projects`.
- Admin at `https://<host>/syncthing/` (LAN-only, basic-auth).

### Samba (LAN-only)
| Share        | Path                          | Mode     |
|--------------|-------------------------------|----------|
| `documents`  | `~/shared/documents`          | RW       |
| `projects`   | `~/shared/projects`           | RW       |
| `backups`    | `/var/backups/alo-db`         | **RO**   |

---

## 🔍 Verification

```bash
sudo ./verify.sh
```

Exit code is non-zero if any ❌ — CI-friendly.

---

## 🆘 Troubleshooting

### SSH locked out
- The kit keeps port 22 open **until** you run `sudo ./scripts/close-ssh-22.sh`.

### LiteLLM returns 401
- Master key in `/root/.alo-secrets/` (or `config.env`).
- Rotate with `sudo ./scripts/rotate-litellm-key.sh`.

### Ollama OOMs
- Lower `KIT_OLLAMA_MEM_MAX` in `config.env` and re-run `sudo ./setup.sh 04`.

### Disk full
- Preflight **flags** unallocated LVM space but does **not** auto-extend.
- Extend manually:
  ```bash
  sudo lvextend -l +100%FREE /dev/mapper/ubuntu--vg-ubuntu--lv
  sudo resize2fs /dev/mapper/ubuntu--vg-ubuntu--lv
  ```

---

## 📜 License

MIT — fork, modify, deploy. Pull requests welcome.

## 🤝 Acknowledgements

[Ollama](https://ollama.com) · [LiteLLM](https://github.com/BerriAI/litellm) ·
[Open WebUI](https://github.com/open-webui/open-webui) ·
[Netdata](https://www.netdata.cloud) ·
[Syncthing](https://syncthing.net) ·
[PM2](https://pm2.keymetrics.io) ·
[Nginx](https://nginx.org) ·
[Fail2Ban](https://github.com/fail2ban/fail2ban) ·
[Certbot](https://certbot.eff.org).
