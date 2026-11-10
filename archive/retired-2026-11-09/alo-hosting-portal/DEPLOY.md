# ALO Labs — Production Deployment Guide

Complete guide to deploy ALO Labs Hosting Platform on Ubuntu 24.04 LTS.

## Architecture

```
Internet
    ↓
Public IP (103.231.239.79)
    ↓
Caddy (Reverse Proxy + Auto SSL)
    ↓
127.0.0.1:3101
    ↓
Next.js (Standalone)
    ↓
PostgreSQL 17 + Redis 7
```

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

Add to Caddyfile:
```
hosting.alolabs.net {
    reverse_proxy 127.0.0.1:3101
}
```

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
./scripts/healthcheck.sh http://127.0.0.1:3101/api

# API health endpoint
curl http://127.0.0.1:3101/api
```

## CI/CD with GitHub Actions

The project includes a GitHub Actions workflow at `.github/workflows/ci-cd.yml`.

### Required Secrets
| Secret | Description |
|--------|-------------|
| `SERVER_HOST` | Server IP address |
| `SERVER_USER` | SSH username (aloedu) |
| `SSH_KEY` | SSH private key |
| `DATABASE_URL` | Production database URL |

### Pipeline
1. **Lint & TypeCheck** — ESLint + TypeScript on every push
2. **Build** — `npm run build` on every push
3. **Deploy** — SSH into server, pull, build, migrate, restart (main branch only)

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
Internet → Public IP (103.231.239.79) → Caddy → 127.0.0.1:3101 → Next.js
```

Node.js MUST always run behind Caddy. Never expose port 3101 directly to the internet.