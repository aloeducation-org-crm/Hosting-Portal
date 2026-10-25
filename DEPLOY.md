# ALO Labs — Production Deployment Guide

Complete guide to deploy ALO Labs Hosting Platform on Ubuntu 22.04 / 24.04 LTS.

> ## ⚠️ Read before deploying
>
> **The application is the repository ROOT.** `alo-hosting-portal/` is a legacy
> snapshot (55 Prisma models, no `/login` route) — deploying it produces a panel
> that returns 200 on `/` and cannot be logged into. See `README.md`.
>
> **The database is SQLite via the libSQL adapter**, not PostgreSQL.
> `prisma/schema.prisma` is `provider = "sqlite"` and
> `prisma/migrations/migration_lock.toml` is locked to `sqlite`, so a
> `postgresql://` URL cannot be opened by the generated client. The PostgreSQL
> instructions further down this file are retained for the Caddy/`/opt` variant
> of `scripts/deploy-alo-portal.sh` and require a provider migration first.
>
> **The live database must be an absolute path outside the repository**
> (`file:/var/lib/alo-hosting/alo.db`). A relative `file:` URL resolves against
> the process working directory, and `db/custom.db` is tracked by git — so a
> checkout replaces production data with the committed snapshot.
>
> Current production (`hosting.alolabs.net` on `alo-server-lap`) uses nginx +
> Let's Encrypt behind a Cloudflare Tunnel, systemd, and the self-hosted Actions
> runner. Templates: `deploy/systemd/`, `deploy/nginx/`, `deploy/cloudflared/`,
> `deploy/sudoers/`. Workflow: `.github/workflows/deploy.yml`.
> Recovery runbook: **`docs/RECOVERY-hosting.alolabs.net.md`**.
> Audit the whole chain at any time with `bash scripts/server-doctor.sh`.

## Architecture (current production)

```
Internet
    ↓
Cloudflare edge (SSL mode: Full)
    ↓
Cloudflare Tunnel — cloudflared, ingress: https://127.0.0.1:443
    ↓
nginx 443 (Let's Encrypt, certbot.timer) ── 80 → 443 redirect
    ↓
127.0.0.1:3051  Next.js standalone (systemd: alo-hosting-panel)
    ↓
SQLite /var/lib/alo-hosting/alo.db  +  Redis 127.0.0.1:6379 (optional)
```

The tunnel **must** terminate on 443. If its ingress points at
`http://localhost:80`, nginx answers with the certbot 301 → `https://…`, the
browser re-enters the same tunnel, and the loop returns HTTP 530 publicly while
`curl http://127.0.0.1:3051` on the server looks perfectly healthy.

## Architecture (Caddy / `/opt` variant)

```
Internet
    ↓
Public IP (103.231.239.79)
    ↓
Caddy (Reverse Proxy + Auto SSL)
    ↓
127.0.0.1:$PORT  (default 3101)
    ↓
Next.js (Standalone)
    ↓
SQLite (libSQL adapter) + Redis 7
```

Provisioned by `sudo bash scripts/deploy-alo-portal.sh` (7 phases, app user
`alo-panel`, app dir `/opt/alo-hosting-portal`, 19 privileged helpers in
`/usr/local/sbin`).

## Server Requirements

- **OS**: Ubuntu 24.04 LTS
- **CPU**: 2+ cores
- **RAM**: 4GB+ (8GB recommended)
- **Disk**: 50GB+ SSD
- **Node.js**: 22 LTS
- **PostgreSQL**: 17
- **Redis**: 7 (optional, for caching)
- **Domain**: Point your domain to the server IP

## Step 1: Server Setup

```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install essential tools
sudo apt install -y curl wget git build-essential ufw

# Install Node.js 22 LTS
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs

# Verify installations
node --version  # v22.x
npm --version   # 10.x

# Install PostgreSQL 17
sudo apt install -y postgresql-17 postgresql-client-17

# Install Redis (optional)
sudo apt install -y redis-server
```

## Step 2: PostgreSQL Setup

```bash
# Switch to postgres user
sudo -u postgres psql

# Create database and user
CREATE USER alolabs WITH PASSWORD 'your_secure_password';
CREATE DATABASE alolabs OWNER alolabs;
GRANT ALL PRIVILEGES ON DATABASE alolabs TO alolabs;
\q

# Test connection
psql -h localhost -U alolabs -d alolabs
```

## Step 3: Deploy Application

```bash
# Create application user
sudo useradd -m -s /bin/bash aloedu
sudo usermod -aG sudo aloedu

# Create application directory
sudo mkdir -p /opt/app
sudo chown aloedu:aloedu /opt/app

# Clone and install (as aloedu)
sudo su - aloedu
cd /opt/app

# Clone your repository or copy project files
git clone <your-repo-url> .
# OR: scp -r ./project/* aloedu@server:/opt/app/

# Install dependencies
npm ci

# Setup environment
cp .env.example .env
nano .env  # Edit with production values
```

Edit `.env` with production values:
```
NODE_ENV=production
# The panel port is env-driven. 3101 is the default; use whatever your
# Caddy upstream / firewall expect (e.g. 3051).
PORT=3101
HOSTNAME=127.0.0.1
APP_NAME=ALO Labs
APP_URL=https://hosting.alolabs.net
DATABASE_URL=postgresql://alolabs:your_secure_password@localhost:5432/alolabs
JWT_SECRET=<generate with: node -e "console.log(require('crypto').randomBytes(64).toString('hex'))">
NEXTAUTH_SECRET=<generate same way>
NEXTAUTH_URL=https://hosting.alolabs.net
```

## Step 4: Database Migration

```bash
cd /opt/app

# Generate Prisma client
npx prisma generate

# Run migrations
npx prisma migrate deploy

# Seed initial data
npx prisma db seed
```

## Step 5: Build Application

```bash
npm run build
```

## Step 6: Systemd Service

```bash
# Copy service file
sudo cp scripts/alolabs.service /etc/systemd/system/

# Enable and start
sudo systemctl daemon-reload
sudo systemctl enable alolabs
sudo systemctl start alolabs

# Check status
sudo systemctl status alolabs

# View logs
sudo journalctl -u alolabs -f
```

## Step 7: Caddy Reverse Proxy

```bash
# Install Caddy
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update
sudo apt install -y caddy

# Configure Caddy
sudo nano /etc/caddy/Caddyfile
```

Add to Caddyfile. `{$PORT:3101}` reads the PORT environment variable of the
Caddy service, falling back to 3101 — so the port is defined in exactly one place:
```
hosting.alolabs.net {
    reverse_proxy 127.0.0.1:{$PORT:3101}
}
```

If Caddy runs without PORT in its environment, set it in the unit
(`systemctl edit caddy` → `Environment=PORT=3101`).

```bash
# Reload Caddy
sudo systemctl reload caddy
```

Caddy will automatically obtain and renew SSL certificates via Let's Encrypt.

## Step 8: Firewall

```bash
sudo ufw allow 22/tcp     # SSH
sudo ufw allow 80/tcp     # HTTP
sudo ufw allow 443/tcp    # HTTPS
sudo ufw enable
```

## Docker Deployment (Alternative)

```bash
# Copy project to server
cd /opt/app

# Configure .env
cp .env.example .env
nano .env

# Start all services
docker compose up -d

# Check logs
docker compose logs -f app
```

## Backup & Restore

### Manual Backup
```bash
./scripts/backup.sh /opt/backups
```

### Manual Restore
```bash
./scripts/restore.sh /opt/backups/alolabs_backup_20260721_120000.sql
```

### Automated Backup (Cron)
```bash
# Add daily backup at 2 AM
crontab -e
# Add: 0 2 * * * /opt/app/scripts/backup.sh /opt/backups >> /var/log/alolabs-backup.log 2>&1
```

## Health Monitoring

```bash
# Manual health check
./scripts/healthcheck.sh http://127.0.0.1:${PORT:-3101}/api

# API health endpoint
curl http://127.0.0.1:${PORT:-3101}/api
```

## CI/CD with GitHub Actions

The workflow lives at `.github/workflows/ci-cd.yml` and covers **verification only**:

1. **Lint, typecheck & test** — `npm ci` → `npm run lint` → `npm run typecheck` → `npm test`
2. **Build** — `npm ci` → `npm run db:generate` → `npm run build` → asserts `.next/standalone/server.js` exists

### A note on `NODE_ENV` in CI

Do **not** set `NODE_ENV=production` at the workflow or job level. `npm ci` honours it
and silently skips `devDependencies`, so `eslint`, `typescript` and `tailwindcss` are
never installed — `npm run lint` then fails with exit code `127` (`eslint: not found`).
That is exactly what made runs #1–#7 red. Production values belong on the server.

### Deploying (manual)

Deployment is deliberately not automated, so a push to `main` can never restart
production unattended. Ship with the deploy script:

```bash
# On the server
sudo bash scripts/deploy-alo-portal.sh

# Or from your machine, over SSH
bash scripts/deploy-alo-portal.sh --target alamin@100.94.234.101

# Preview without changing anything
bash scripts/deploy-alo-portal.sh --dry-run
```

The script reads `PORT` from the environment (default `3101`), writes it into
`.env.production`, the generated systemd unit and the generated Caddyfile, so the
port stays consistent end to end:

```bash
PORT=3051 sudo bash scripts/deploy-alo-portal.sh
```

After deploying, verify:

```bash
./scripts/healthcheck.sh    # uses $PORT, default 3101
./scripts/verify.sh         # full post-deploy verification
```

## Troubleshooting

### Application won't start
```bash
sudo journalctl -u alolabs -n 50
```

### Database connection errors
```bash
# Check PostgreSQL is running
sudo systemctl status postgresql

# Test connection
psql -h localhost -U alolabs -d alolabs -c "SELECT 1"
```

### Permission denied
```bash
sudo chown -R aloedu:aloedu /opt/app
```

### Clear Node.js cache
```bash
rm -rf .next
npm run build
sudo systemctl restart alolabs
```

## IP Architecture (Never Expose Node.js Directly)

```
Internet → Public IP (103.231.239.79) → Caddy → 127.0.0.1:$PORT → Next.js
```

Node.js MUST always run behind Caddy. Never expose the panel port directly to the
internet — bind it to 127.0.0.1 and let Caddy terminate TLS.