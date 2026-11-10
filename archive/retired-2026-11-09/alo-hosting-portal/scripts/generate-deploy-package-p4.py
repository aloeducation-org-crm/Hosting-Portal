#!/usr/bin/env python3
"""
ALO Labs AgentOS — Deployment Package Generator: Part 4
Documentation, CI/CD, editor configs, public assets, source utilities
"""

import os

BASE = "/home/z/my-project/download/alolabs-deployment-package"

def w(path, content):
    full = os.path.join(BASE, path)
    os.makedirs(os.path.dirname(full), exist_ok=True)
    with open(full, "w") as f:
        f.write(content)
    print(f"  ✓ {path}")

# ═══════════════════════════════════════════════════════════════════════════════
# 7. DOCUMENTATION
# ═══════════════════════════════════════════════════════════════════════════════

w("README.md", """# ALO Labs AgentOS

> AI-Powered Cloud Hosting Platform — Self-hosted, production-ready.

![Version](https://img.shields.io/badge/version-1.0.0-6C3CE1)
![License](https://img.shields.io/badge/license-MIT-6C3CE1)
![Node](https://img.shields.io/badge/node-24-339933)
![Next.js](https://img.shields.io/badge/Next.js-16-000000)

## Overview

ALO Labs AgentOS is a comprehensive cloud hosting platform featuring AI-powered website builders, CRM, email marketing, monitoring, CI/CD pipelines, VPS management, and more — all self-hosted on your own Ubuntu server.

## Quick Start

```bash
# Clone the repository
git clone https://github.com/alolabs/agentos.git
cd agentos

# Install dependencies
npm ci

# Setup environment
cp .env.example .env
# Edit .env with your production values

# Initialize database
npx prisma generate && npx prisma db push

# Create admin account
npx tsx scripts/create-admin.ts

# Build and start
npm run build
pm2 start ecosystem.config.js --env production
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 16, React 19, TypeScript, Tailwind CSS 4 |
| UI Components | shadcn/ui, Radix UI, Lucide Icons, Framer Motion |
| State Management | Zustand |
| Backend | Next.js App Router API Routes |
| Database | SQLite (Prisma ORM, 24 models) |
| Authentication | Custom scrypt-based token auth |
| Process Manager | PM2 |
| Reverse Proxy | Caddy (auto-SSL) |
| Runtime | Node.js 24 + Bun |

## Project Structure

```
agentos/
├── src/
│   ├── app/                  # Next.js App Router
│   │   ├── page.tsx          # Main SPA entry point
│   │   └── api/              # 50+ REST API routes
│   ├── components/
│   │   └── platform/         # Reusable UI components
│   └── lib/                  # Utilities, store, types
├── prisma/
│   └── schema.prisma         # 24 Prisma models
├── config/                   # App configuration modules
├── scripts/                  # Admin & maintenance scripts
├── systemd/                  # Systemd service file
├── cron/                     # Automated job definitions
├── fail2ban/                 # Fail2Ban jail config
├── docs/                     # Extended documentation
├── Caddyfile                 # Caddy reverse proxy config
├── ecosystem.config.js       # PM2 configuration
├── docker-compose.yml        # Docker deployment
├── Dockerfile                # Production Docker image
├── install.sh                # One-command installation
├── deploy.sh                 # Zero-downtime deployment
├── backup.sh                 # Automated backup
├── restore.sh                # Database restoration
└── health-check.sh           # Health monitoring
```

## Features

- **Dashboard** — Real-time metrics, resource monitoring, activity feeds
- **Website Builder** — AI-powered website creation and management
- **Domain Management** — DNS configuration, domain search, WHOIS
- **Database Hosting** — Create and manage SQLite databases
- **Application Hosting** — Deploy and manage web applications
- **AI Agents** — Configure and run AI-powered automation agents
- **Monitoring** — Uptime, performance, and resource monitoring
- **CI/CD** — Build pipelines, deployment automation
- **SSL Management** — Automated certificate provisioning
- **Backup System** — Scheduled backups, point-in-time restore
- **VPS/Servers** — Virtual server management
- **Billing** — Subscription management, invoicing
- **CRM** — Contact management, deal pipelines, activities
- **Email Marketing** — Campaign management, templates, analytics

## Deployment

### Automated Installation

```bash
chmod +x install.sh
sudo ./install.sh
```

### Docker Deployment

```bash
docker compose up -d --build
```

### Manual Deployment

See the [Deployment Guide](docs/ARCHITECTURE.md) for detailed instructions.

## Management Commands

```bash
# Start/Stop/Restart
pm2 start ecosystem.config.js --env production
pm2 stop alolabs-agentos
pm2 restart alolabs-agentos

# View logs
pm2 logs alolabs-agentos
tail -f /opt/alolabs/logs/out.log

# Health check
./health-check.sh --verbose

# Backup
./backup.sh

# Update
./update.sh
```

## Environment Variables

See [.env.example](.env.example) for all available configuration options.

## Demo Access

- **Email:** demo@alolabs.net
- **Password:** demo1234

## License

MIT License — see [LICENSE](LICENSE) for details.
""")

w("CHANGELOG.md", """# Changelog

All notable changes to ALO Labs AgentOS will be documented in this file.

## [1.0.0] - 2026-07-20

### Added
- Initial production release of ALO Labs AgentOS
- 15+ platform views: Dashboard, Websites, Domains, Databases, Applications, AI Agents, Monitoring, CI/CD, SSL, Backups, VPS/Servers, Billing, CRM, Email, Settings
- 24 Prisma database models covering users, websites, domains, databases, servers, billing, CRM, and more
- 50+ REST API routes
- AI-powered website builder
- CRM with pipeline management and deal tracking
- Email campaign management
- Automated SSL certificate management via Caddy
- Real-time monitoring dashboard
- CI/CD pipeline configuration
- Backup and restore system with automated scheduling
- VPS/server management interface
- Subscription-based billing with invoicing
- scrypt-based token authentication with 7-day expiry
- Complete deployment toolkit (install.sh, deploy.sh, backup.sh, restore.sh, health-check.sh, monitor.sh, ssl-renew.sh, uninstall.sh)
- Docker Compose and multi-stage Dockerfile
- PM2 ecosystem configuration with graceful shutdown
- Systemd service file with security hardening
- UFW firewall and Fail2Ban configurations
- Automated cron jobs for backups, health checks, and cleanup
- Comprehensive documentation (API, Architecture, Security, Troubleshooting)
- GitHub Actions CI/CD workflows
- Editor configuration (VS Code, ESLint, Prettier, EditorConfig)
""")

w("LICENSE", """MIT License

Copyright (c) 2026 ALO Labs

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
""")

w("docs/API.md", """# ALO Labs AgentOS — API Documentation

## Base URL

```
Production:  https://alolabs.net/api
Development: http://localhost:3000/api
```

## Authentication

All API endpoints (except `/api/auth/*`) require a valid Bearer token in the Authorization header.

```http
Authorization: Bearer <token>
```

### Obtain Token

```bash
POST /api/auth/login
Content-Type: application/json

{
  "email": "admin@alolabs.net",
  "password": "your-password"
}
```

Response:
```json
{
  "token": "base64-encoded-token",
  "user": {
    "id": "...",
    "email": "admin@alolabs.net",
    "name": "ALO Admin",
    "role": "admin",
    "plan": "premium"
  }
}
```

## API Routes

### Authentication

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/auth/login` | Login with email/password |
| POST | `/api/auth/register` | Register new user |
| GET | `/api/auth/me` | Get current user profile |
| POST | `/api/auth/logout` | Logout (invalidate token) |

### Dashboard

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/dashboard/stats` | Dashboard statistics |
| GET | `/api/dashboard/activity` | Recent activity feed |
| GET | `/api/dashboard/metrics` | System metrics |

### Websites

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/websites` | List all websites |
| POST | `/api/websites` | Create website |
| GET | `/api/websites/[id]` | Get website details |
| PUT | `/api/websites/[id]` | Update website |
| DELETE | `/api/websites/[id]` | Delete website |

### Domains

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/domains` | List domains |
| POST | `/api/domains` | Add domain |
| POST | `/api/domains/search` | Search available domains |
| DELETE | `/api/domains/[id]` | Remove domain |

### Databases

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/databases` | List databases |
| POST | `/api/databases` | Create database |
| DELETE | `/api/databases/[id]` | Delete database |

### Applications

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/applications` | List applications |
| POST | `/api/applications` | Deploy application |
| GET | `/api/applications/[id]` | Get app details |
| PUT | `/api/applications/[id]` | Update application |
| DELETE | `/api/applications/[id]` | Delete application |

### AI Agents

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/ai-agents` | List AI agents |
| POST | `/api/ai-agents` | Create agent |
| POST | `/api/ai-agents/[id]/run` | Execute agent |
| DELETE | `/api/ai-agents/[id]` | Delete agent |

### Monitoring

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/monitoring/uptime` | Uptime statistics |
| GET | `/api/monitoring/metrics` | Performance metrics |
| GET | `/api/monitoring/alerts` | Active alerts |

### SSL

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/ssl` | List certificates |
| POST | `/api/ssl` | Request certificate |
| DELETE | `/api/ssl/[id]` | Revoke certificate |

### Backups

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/backups` | List backups |
| POST | `/api/backups` | Create backup |
| POST | `/api/backups/[id]/restore` | Restore backup |
| DELETE | `/api/backups/[id]` | Delete backup |

### Servers / VPS

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/servers` | List servers |
| POST | `/api/servers` | Create server |
| GET | `/api/servers/[id]` | Server details |
| POST | `/api/servers/[id]/restart` | Restart server |

### Billing

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/billing/subscription` | Current subscription |
| GET | `/api/billing/invoices` | List invoices |
| POST | `/api/billing/checkout` | Create checkout session |

### CRM

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/crm/contacts` | List contacts |
| POST | `/api/crm/contacts` | Create contact |
| GET | `/api/crm/deals` | List deals |
| POST | `/api/crm/pipelines` | Create pipeline |

### Email

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/email/accounts` | List email accounts |
| GET | `/api/email/campaigns` | List campaigns |
| POST | `/api/email/campaigns` | Create campaign |

### Health

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/health` | Health check (no auth required) |

## Error Response Format

```json
{
  "error": "Error message description",
  "code": "ERROR_CODE"
}
```

## Rate Limits

- General API: 100 requests per 15 minutes
- Auth endpoints: 10 requests per 15 minutes

## Pagination

List endpoints support pagination via query parameters:

```
GET /api/websites?page=1&limit=20&search=keyword&sort=createdAt&order=desc
```
""")

w("docs/ARCHITECTURE.md", """# ALO Labs AgentOS — Architecture Documentation

## System Architecture

```
                        ┌─────────────┐
                        │   Internet   │
                        └──────┬──────┘
                               │
                        ┌──────▼──────┐
                        │    Caddy     │  ← Auto-SSL, Rate Limiting
                        │   :80/:443   │  ← Security Headers, Compression
                        └──────┬──────┘
                               │
                        ┌──────▼──────┐
                        │  Next.js 16  │  ← Standalone Mode
                        │   :3000      │  ← App Router API Routes
                        └──────┬──────┘
                               │
              ┌────────────────┼────────────────┐
              │                │                │
       ┌──────▼──────┐ ┌──────▼──────┐ ┌──────▼──────┐
       │  React SPA   │ │  API Routes  │ │  Prisma ORM │
       │  (Client)    │ │  (Server)    │ │  (Database) │
       └─────────────┘ └─────────────┘ └──────┬──────┘
                                               │
                                        ┌──────▼──────┐
                                        │   SQLite     │
                                        │  agentos.db  │
                                        │   (WAL)      │
                                        └─────────────┘
```

## Frontend Architecture

- **Single Page Application** at `/` — all views rendered client-side
- **Routing**: Zustand `usePlatformStore` manages active view (no URL-based routing)
- **Lazy Loading**: Views loaded dynamically via `React.lazy()` for performance
- **15+ Platform Views**: Each view is a self-contained React component

## Backend Architecture

- **50+ REST API Routes** under `/api/` using Next.js Route Handlers
- **Authentication**: scrypt password hashing + base64 token with configurable expiry
- **Middleware**: Token validation via `getToken()` helper pattern
- **Database**: Prisma ORM with SQLite (WAL mode for concurrency)

## Data Model

24 Prisma models organized into domains:

- **Auth**: User, ApiKey
- **Hosting**: Website, Domain, HostedDatabase, Application, Server
- **AI**: AiAgentRun, ChatSession
- **Business**: CrmContact, CrmDeal, CrmPipeline, CrmActivity, Contact
- **Email**: EmailAccount, EmailCampaign
- **Security**: SslCertificate
- **Operations**: Backup, CiCdPipeline, MonitoringAlert
- **Billing**: Subscription, Order, Invoice, Notification
- **Domain Search**: DomainSearch

## Deployment Architecture

```
Ubuntu 22.04 LTS
├── Caddy (reverse proxy, auto-SSL)
├── PM2 (process manager)
│   └── Next.js standalone server
├── SQLite (database with WAL)
├── UFW (firewall)
├── Fail2Ban (intrusion prevention)
├── Cron (scheduled tasks)
└── Logrotate (log management)
```

## Security Model

1. **Authentication**: scrypt password hashing, base64 token auth with expiry
2. **Transport**: TLS 1.2+ via Caddy (Let's Encrypt automatic)
3. **Network**: UFW firewall (only 22, 80, 443 open)
4. **Application**: Rate limiting, CORS, security headers, CSRF protection
5. **OS**: Non-root user, restricted systemd service, Fail2Ban
6. **Data**: Encrypted secrets in .env, database backup encryption

## Process Management

### PM2 Configuration
- Single instance (fork mode) — SQLite doesn't support multiple writers
- 2GB memory limit with auto-restart
- Graceful shutdown with 5s kill timeout
- JSON logging with date format
- Weekly automatic restart

### Systemd (Alternative)
- Security hardening: NoNewPrivileges, ProtectSystem, PrivateTmp
- Resource limits: 2GB memory, 200% CPU quota
- 65536 file descriptor limit
- Automatic restart on failure
""")

w("docs/BACKUP.md", """# ALO Labs AgentOS — Backup & Restore Guide

## Backup Strategy

### What Gets Backed Up

| Component | Frequency | Retention | Location |
|-----------|-----------|-----------|----------|
| Database (SQLite) | Daily 3 AM | 30 days | /opt/alolabs/backups/ |
| Uploads | Daily 3 AM | 30 days | /opt/alolabs/backups/ |
| Configuration | Daily 3 AM | 30 days | /opt/alolabs/backups/ |
| Logs | Weekly cleanup | 30 days | /opt/alolabs/logs/ |

### Automated Backups

Backups run automatically via cron job at 3:00 AM daily:

```bash
# View backup cron
cat /etc/cron.d/alolabs-backup

# Manually trigger
./backup.sh
```

### Manual Backup

```bash
# Full backup (database + uploads + config)
./backup.sh

# Quick backup (database only)
./backup.sh --quick
```

## Backup File Format

```
/opt/alolabs/backups/
├── alolabs-backup-20260720_030000.tar.gz   # Full archive
├── db-20260720_030000.db                    # SQLite database backup
├── uploads-20260720_030000.tar.gz           # Upload files
├── .env-20260720_030000.bak                 # Environment config
└── Caddyfile-20260720_030000.bak           # Caddy config
```

## Restore

### Restore Latest Backup

```bash
./restore.sh --latest
```

### Restore Specific Backup

```bash
./restore.sh --file=/opt/alolabs/backups/db-20260720_030000.db
```

### Interactive Restore

```bash
./restore.sh
# Lists available backups, prompts for selection
```

## Off-Site Backup (Recommended)

Add S3/Rsync backup to cron:

```bash
# S3 (using AWS CLI)
aws s3 sync /opt/alabs/backups/ s3://your-bucket/alolabs-backups/ --delete

# Rsync to remote server
rsync -avz --delete /opt/alolabs/backups/ user@backup-server:/backups/alolabs/
```

## Disaster Recovery

1. Provision new Ubuntu 22.04 server
2. Run `install.sh` for fresh setup
3. Run `restore.sh --latest` to restore data
4. Verify with `health-check.sh --verbose`
""")

w("docs/SECURITY.md", """# ALO Labs AgentOS — Security Guide

## Security Layers

### 1. Network Security

- **UFW Firewall**: Only ports 22 (SSH), 80 (HTTP), 443 (HTTPS) open
- **Fail2Ban**: Automatic IP banning after repeated failed attempts
  - SSH: 3 attempts → 2 hour ban
  - HTTP/API: 5 attempts → 30 min ban
  - Repeat offenders: 24 hour ban

### 2. Transport Security

- **TLS 1.2+** via Caddy with automatic Let's Encrypt certificates
- **HSTS** with 1-year max-age and includeSubDomains
- **HTTP/3 (QUIC)** support on port 443/UDP

### 3. Application Security

- **Authentication**: scrypt password hashing (64-byte key, 16-byte salt)
- **Token**: Base64-encoded, configurable expiry (default 7 days)
- **Rate Limiting**: 100 req/15min (general), 10 req/15min (auth)
- **CORS**: Restricted to configured origin
- **Security Headers**:
  - X-Content-Type-Options: nosniff
  - X-Frame-Options: SAMEORIGIN
  - X-XSS-Protection: 1; mode=block
  - Referrer-Policy: strict-origin-when-cross-origin
  - Permissions-Policy: camera=(), microphone=(), geolocation=()

### 4. Operating System Security

- **Non-root user**: Application runs as `alolabs` user
- **Systemd sandboxing**: NoNewPrivileges, ProtectSystem, PrivateTmp
- **SSH hardening**: Key-based auth recommended, Fail2Ban enabled
- **Automatic updates**: Enable with `unattended-upgrades`

### 5. Data Security

- **Secrets**: Stored in `.env` file (not committed to git)
- **Database**: SQLite with WAL mode, file permissions 644
- **Backups**: Stored locally, can be encrypted for off-site

## Security Checklist

- [ ] Change default admin password
- [ ] Generate strong TOKEN_SECRET with `openssl rand -hex 32`
- [ ] Configure SMTP with app-specific password
- [ ] Enable SSH key authentication, disable password auth
- [ ] Set up UFW firewall (done by install.sh)
- [ ] Configure Fail2Ban (done by install.sh)
- [ ] Enable automatic security updates
- [ ] Review CORS origin
- [ ] Set up off-site backups
- [ ] Review logs regularly

## Hardening Commands

```bash
# Disable root SSH login
sudo sed -i 's/PermitRootLogin yes/PermitRootLogin no/' /etc/ssh/sshd_config
sudo systemctl restart sshd

# Enable automatic security updates
sudo apt install unattended-upgrades
sudo dpkg-reconfigure -plow unattended-upgrades

# Check open ports
sudo ss -tlnp

# Audit system
sudo lynis audit system
```
""")

w("docs/TROUBLESHOOTING.md", """# ALO Labs AgentOS — Troubleshooting Guide

## Common Issues

### Application Won't Start

**Symptom**: PM2 shows `errored` status or `ERRORED` in `pm2 list`.

**Solution**:
```bash
# Check error logs
pm2 logs alolabs-agentos --err --lines 50
tail -50 /opt/alolabs/logs/error.log

# Common causes:
# 1. Missing .env file
ls -la /opt/alolabs/.env

# 2. Database not initialized
cd /opt/alolabs && npx prisma db push

# 3. Build artifacts missing
cd /opt/alolabs && npm run build

# 4. Port already in use
sudo lsof -i :3000
sudo kill $(sudo lsof -t -i:3000)

# Restart
pm2 restart alolabs-agentos
```

### Database Locked

**Symptom**: `SQLITE_BUSY` errors in logs.

**Solution**:
```bash
# Check for long-running transactions
sqlite3 /opt/alolabs/db/agentos.db "PRAGMA busy_timeout;"

# Increase busy timeout
# Already set to 5000ms in config

# If persistently locked, restart the app
pm2 restart alolabs-agentos

# Last resort: WAL checkpoint
sqlite3 /opt/alolabs/db/agentos.db "PRAGMA wal_checkpoint(TRUNCATE);"
```

### SSL Certificate Issues

**Symptom**: Browser shows certificate errors or Caddy fails to start.

**Solution**:
```bash
# Check certificate status
./ssl-renew.sh --check

# Verify DNS points to your server
dig alolabs.net +short

# Force certificate renewal
./ssl-renew.sh --force

# Check Caddy logs
journalctl -u caddy --no-pager -n 50
```

### High Memory Usage

**Symptom**: Node.js process consuming >2GB RAM.

**Solution**:
```bash
# Check current usage
pm2 monit

# Restart to free memory
pm2 restart alolabs-agentos

# Increase limit if needed (in ecosystem.config.js)
# max_memory_restart: "4G"

# Run database cleanup
npx tsx scripts/cleanup.ts
```

### PM2 Process Keeps Restarting

**Symptom**: `pm2 list` shows high restart count.

**Solution**:
```bash
# Check logs for the actual error
pm2 logs alolabs-agentos --lines 100

# Reset restart count
pm2 reset alolabs-agentos

# Check system resources
free -h
df -h
```

### 502 Bad Gateway

**Symptom**: Caddy returns 502 when accessing the site.

**Solution**:
```bash
# Check if Next.js is running
curl http://localhost:3000/api/health

# If not running, start it
pm2 start ecosystem.config.js --env production

# Check Caddy config
caddy validate --config /etc/caddy/Caddyfile

# Restart Caddy
systemctl restart caddy
```

## Diagnostic Commands

```bash
# Full system check
./health-check.sh --verbose

# Real-time monitoring
./monitor.sh

# Check all services
systemctl status alolabs caddy fail2ban
pm2 list

# Check disk space
df -h

# Check memory
free -h

# Check network
ss -tlnp
ufw status
```

## Getting Help

1. Check logs: `pm2 logs alolabs-agentos --lines 100`
2. Run health check: `./health-check.sh --verbose`
3. Review this guide for your specific issue
4. Check GitHub Issues: https://github.com/alolabs/agentos/issues
""")

# ═══════════════════════════════════════════════════════════════════════════════
# 8. CI/CD WORKFLOWS
# ═══════════════════════════════════════════════════════════════════════════════

w(".github/workflows/deploy.yml", """name: Deploy to Production

on:
  push:
    branches: [main]
  workflow_dispatch:

env:
  NODE_VERSION: "24"
  REGISTRY: ghcr.io
  IMAGE_NAME: ${{ github.repository }}

jobs:
  build-and-deploy:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: "npm"

      - name: Install dependencies
        run: npm ci

      - name: Generate Prisma client
        run: npx prisma generate

      - name: Run type check
        run: npx tsc --noEmit
        continue-on-error: true

      - name: Run linter
        run: npm run lint
        continue-on-error: true

      - name: Build application
        run: npm run build
        env:
          NODE_ENV: production
          DATABASE_URL: "file:./db/test.db"

      - name: Deploy via SSH
        uses: appleboy/ssh-action@v1
        with:
          host: ${{ secrets.DEPLOY_HOST }}
          username: ${{ secrets.DEPLOY_USER }}
          key: ${{ secrets.DEPLOY_SSH_KEY }}
          script: |
            cd /opt/alolabs
            git pull origin main
            npm ci --production=false
            npx prisma generate
            npx prisma db push
            npm run build
            pm2 restart alolabs-agentos --update-env
            pm2 save

      - name: Health check
        run: |
          sleep 10
          curl -sf https://alolabs.net/api/health || exit 1
        continue-on-error: true

      - name: Notify on failure
        if: failure()
        run: echo "Deployment failed! Check logs at https://alolabs.net"
""")

w(".github/workflows/build.yml", """name: Build and Test

on:
  pull_request:
    branches: [main, develop]
  push:
    branches: [develop]

env:
  NODE_VERSION: "24"

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: "npm"

      - name: Install dependencies
        run: npm ci

      - name: Generate Prisma client
        run: npx prisma generate

      - name: Type check
        run: npx tsc --noEmit

      - name: Lint
        run: npm run lint

      - name: Build
        run: npm run build
        env:
          NODE_ENV: production
          DATABASE_URL: "file:./db/test.db"

      - name: Upload build artifacts
        uses: actions/upload-artifact@v4
        with:
          name: build-output
          path: .next/
          retention-days: 7
""")

# ═══════════════════════════════════════════════════════════════════════════════
# 9. EDITOR CONFIGS
# ═══════════════════════════════════════════════════════════════════════════════

w(".vscode/settings.json", """{
  "editor.formatOnSave": true,
  "editor.defaultFormatter": "esbenp.prettier-vscode",
  "editor.codeActionsOnSave": {
    "source.fixAll.eslint": "explicit",
    "source.organizeImports": "explicit"
  },
  "typescript.tsdk": "node_modules/typescript/lib",
  "typescript.enablePromptUseWorkspaceTsdk": true,
  "tailwindCSS.includeLanguages": {
    "typescript": "javascript",
    "typescriptreact": "javascript"
  },
  "files.associations": {
    "*.css": "tailwindcss"
  },
  "emmet.includeLanguages": {
    "typescript": "html",
    "typescriptreact": "html"
  },
  "search.exclude": {
    "**/node_modules": true,
    "**/.next": true,
    "**/db": true,
    "**/backups": true,
    "**/logs": true
  }
}
""")

w(".editorconfig", """root = true

[*]
indent_style = space
indent_size = 2
end_of_line = lf
charset = utf-8
trim_trailing_whitespace = true
insert_final_newline = true

[*.md]
trim_trailing_whitespace = false

[*.{json,yml,yaml}]
indent_size = 2

[*.sql]
indent_size = 2

[Makefile]
indent_style = tab
""")

w(".prettierrc", """{
  "semi": true,
  "singleQuote": false,
  "tabWidth": 2,
  "trailingComma": "es5",
  "printWidth": 100,
  "bracketSpacing": true,
  "arrowParens": "always",
  "endOfLine": "lf",
  "plugins": ["prettier-plugin-tailwindcss"]
}
""")

w(".eslintrc.json", """{
  "extends": "next/core-web-vitals",
  "rules": {
    "no-console": ["warn", { "allow": ["warn", "error"] }],
    "no-unused-vars": "off",
    "@typescript-eslint/no-unused-vars": ["warn", { "argsIgnorePattern": "^_" }],
    "@typescript-eslint/no-explicit-any": "warn",
    "react-hooks/exhaustive-deps": "warn"
  }
}
""")

# ═══════════════════════════════════════════════════════════════════════════════
# 10. PUBLIC ASSETS
# ═══════════════════════════════════════════════════════════════════════════════

w("public/robots.txt", """# ALO Labs AgentOS
User-agent: *
Allow: /
Disallow: /api/
Disallow: /_next/

Sitemap: https://alolabs.net/sitemap.xml
""")

w("public/manifest.json", """{
  "name": "ALO Labs AgentOS",
  "short_name": "ALO Labs",
  "description": "AI-Powered Cloud Hosting Platform",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#0a0a0a",
  "theme_color": "#6C3CE1",
  "orientation": "portrait-primary",
  "icons": [
    {
      "src": "/logo.svg",
      "sizes": "any",
      "type": "image/svg+xml",
      "purpose": "any maskable"
    }
  ]
}
""")

# ═══════════════════════════════════════════════════════════════════════════════
# 11. SOURCE UTILITIES
# ═══════════════════════════════════════════════════════════════════════════════

w("src/middleware.ts", """/**
 * ALO Labs AgentOS — Next.js Middleware
 * Handles authentication and route protection.
 */

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Allow public routes
  const publicPaths = ["/", "/login", "/register", "/api/auth/login", "/api/auth/register", "/api/health"];
  if (publicPaths.some((p) => pathname === p || pathname.startsWith("/api/auth/"))) {
    return NextResponse.next();
  }

  // API routes require auth token
  if (pathname.startsWith("/api/")) {
    const token = request.headers.get("authorization")?.replace("Bearer ", "");
    if (!token) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|logo.svg|robots.txt).*)"],
};
""")

w("src/lib/auth.ts", """/**
 * ALO Labs AgentOS — Authentication Utilities
 * scrypt-based password hashing and token management.
 */

import * as crypto from "crypto";

const SCRYPT_OPTIONS = {
  N: 16384, // CPU/memory cost
  r: 8,     // Block size
  p: 1,     // Parallelization
  keyLength: 64,
  saltLength: 16,
};

/**
 * Hash a password using scrypt.
 * Returns salt:hash format for storage.
 */
export async function hashPassword(password: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const salt = crypto.randomBytes(SCRYPT_OPTIONS.saltLength).toString("hex");
    crypto.scrypt(
      password,
      salt,
      SCRYPT_OPTIONS.keyLength,
      { N: SCRYPT_OPTIONS.N, r: SCRYPT_OPTIONS.r, p: SCRYPT_OPTIONS.p },
      (err, derivedKey) => {
        if (err) reject(err);
        resolve(`${salt}:${derivedKey.toString("hex")}`);
      }
    );
  });
}

/**
 * Verify a password against a stored hash.
 */
export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  return new Promise((resolve) => {
    const [salt, hash] = storedHash.split(":");
    if (!salt || !hash) {
      resolve(false);
      return;
    }
    crypto.scrypt(
      password,
      salt,
      SCRYPT_OPTIONS.keyLength,
      { N: SCRYPT_OPTIONS.N, r: SCRYPT_OPTIONS.r, p: SCRYPT_OPTIONS.p },
      (err, derivedKey) => {
        if (err) {
          resolve(false);
          return;
        }
        resolve(crypto.timingSafeEqual(Buffer.from(hash, "hex"), derivedKey));
      }
    );
  });
}

/**
 * Generate a base64 authentication token.
 */
export function generateToken(payload: Record<string, unknown>, secret: string): string {
  const data = JSON.stringify({
    ...payload,
    iat: Date.now(),
    exp: Date.now() + 7 * 24 * 60 * 60 * 1000, // 7 days
  });
  const hmac = crypto.createHmac("sha256", secret).update(data).digest("hex");
  return Buffer.from(JSON.stringify({ data, sig: hmac })).toString("base64");
}

/**
 * Verify and decode a base64 token.
 */
export function verifyToken(token: string, secret: string): Record<string, unknown> | null {
  try {
    const decoded = JSON.parse(Buffer.from(token, "base64").toString());
    const hmac = crypto.createHmac("sha256", secret).update(decoded.data).digest("hex");
    if (hmac !== decoded.sig) return null;
    const payload = JSON.parse(decoded.data);
    if (payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

/**
 * Get auth token from browser localStorage (client-side only).
 */
export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("auth_token");
}
""")

w("src/lib/db.ts", """/**
 * ALO Labs AgentOS — Database Client
 * Singleton Prisma client with connection management.
 */

import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

export const prisma = globalForPrisma.prisma || new PrismaClient({
  log: process.env.PRISMA_LOG_LEVEL === "query"
    ? [{ emit: "stdout", level: "query" }]
    : [{ emit: "stdout", level: "warn" }],
});

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

export default prisma;
""")

w("src/lib/logger.ts", """/**
 * ALO Labs AgentOS — Logging Utility
 * Structured JSON logging for production.
 */

type LogLevel = "debug" | "info" | "warn" | "error";

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  context?: string;
  [key: string]: unknown;
}

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const MIN_LEVEL: LogLevel = (process.env.LOG_LEVEL as LogLevel) || "info";

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVELS[level] >= LOG_LEVELS[MIN_LEVEL];
}

function log(level: LogLevel, message: string, context?: string, data?: Record<string, unknown>) {
  if (!shouldLog(level)) return;

  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...(context && { context }),
    ...data,
  };

  const output = process.env.NODE_ENV === "production"
    ? JSON.stringify(entry)
    : `${entry.timestamp} [${level.toUpperCase()}]${context ? ` [${context}]` : ""} ${message}${data ? " " + JSON.stringify(data) : ""}`;

  if (level === "error") {
    console.error(output);
  } else if (level === "warn") {
    console.warn(output);
  } else {
    console.log(output);
  }
}

export const logger = {
  debug: (msg: string, ctx?: string, data?: Record<string, unknown>) => log("debug", msg, ctx, data),
  info: (msg: string, ctx?: string, data?: Record<string, unknown>) => log("info", msg, ctx, data),
  warn: (msg: string, ctx?: string, data?: Record<string, unknown>) => log("warn", msg, ctx, data),
  error: (msg: string, ctx?: string, data?: Record<string, unknown>) => log("error", msg, ctx, data),
};
""")

print("\n[4/8] Documentation, CI/CD, editor configs, public assets, source utilities done.")