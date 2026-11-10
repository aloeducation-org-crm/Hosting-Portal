#!/usr/bin/env python3
"""
ALO Labs AgentOS — Deployment Package Generator: Part 2
Shell scripts, systemd, security configs, cron jobs
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
# 2. SHELL SCRIPTS
# ═══════════════════════════════════════════════════════════════════════════════

w("install.sh", r"""#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════════════
# ALO Labs AgentOS — Full Installation Script (Ubuntu 22.04)
# Usage: chmod +x install.sh && sudo ./install.sh
# ══════════════════════════════════════════════════════════════════════════
set -euo pipefail

# ── Colors ──────────────────────────────────────────────────────
PURPLE="\033[0;35m"
GREEN="\033[0;32m"
YELLOW="\033[1;33m"
RED="\033[0;31m"
NC="\033[0m"

log_info()  { echo -e "${PURPLE}[ALO]${NC} $1"; }
log_ok()    { echo -e "${GREEN}[OK]${NC} $1"; }
log_warn()  { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1" >&2; }

# ── Requirements Check ──────────────────────────────────────────
if [[ $EUID -ne 0 ]]; then
    log_error "This script must be run as root (use sudo)."
    exit 1
fi

if ! lsb_release -d | grep -q "Ubuntu 22.04"; then
    log_warn "This script is designed for Ubuntu 22.04. Your system: $(lsb_release -d | awk -F'\t' '{print $2}')"
    read -p "Continue anyway? (y/N) " -n 1 -r
    echo
    [[ ! $REPLY =~ ^[Yy]$ ]] && exit 1
fi

INSTALL_DIR="/opt/alolabs"
APP_USER="alolabs"

# ── 1. System Update ───────────────────────────────────────────
log_info "Updating system packages..."
apt-get update -y && apt-get upgrade -y
log_ok "System updated"

# ── 2. Create User ─────────────────────────────────────────────
log_info "Creating application user: ${APP_USER}"
if ! id "$APP_USER" &>/dev/null; then
    useradd -m -s /bin/bash "$APP_USER"
    log_ok "User ${APP_USER} created"
else
    log_ok "User ${APP_USER} already exists"
fi

# ── 3. Install Dependencies ────────────────────────────────────
log_info "Installing system dependencies..."
apt-get install -y --no-install-recommends \
    curl \
    wget \
    git \
    build-essential \
    libssl-dev \
    ca-certificates \
    gnupg \
    ufw \
    fail2ban \
    logrotate \
    unzip \
    jq \
    software-properties-common \
    apt-transport-https

log_ok "System dependencies installed"

# ── 4. Install Node.js 24 ──────────────────────────────────────
log_info "Installing Node.js 24.x..."
if ! command -v node &>/dev/null || [[ $(node -v) != "v24"* ]]; then
    curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
    apt-get install -y nodejs
    log_ok "Node.js $(node -v) installed"
else
    log_ok "Node.js $(node -v) already installed"
fi

# ── 5. Install Bun Runtime ─────────────────────────────────────
log_info "Installing Bun runtime..."
if ! command -v bun &>/dev/null; then
    curl -fsSL https://bun.sh/install | bash
    export BUN_INSTALL="$HOME/.bun"
    export PATH="$BUN_INSTALL/bin:$PATH"
    log_ok "Bun $(bun --version) installed"
else
    log_ok "Bun $(bun --version) already installed"
fi

# ── 6. Install PM2 ─────────────────────────────────────────────
log_info "Installing PM2 process manager..."
npm install -g pm2@latest
pm2 startup systemd -u "$APP_USER" --hp "/home/$APP_USER" 2>/dev/null || true
log_ok "PM2 $(pm2 -v) installed"

# ── 7. Install Caddy ───────────────────────────────────────────
log_info "Installing Caddy web server..."
if ! command -v caddy &>/dev/null; then
    apt install -y debian-keyring debian-archive-keyring apt-transport-https
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list
    apt-get update -y
    apt-get install -y caddy
    log_ok "Caddy $(caddy version | head -1) installed"
else
    log_ok "Caddy already installed"
fi

# ── 8. Setup Application Directory ─────────────────────────────
log_info "Setting up application directory: ${INSTALL_DIR}"
mkdir -p "${INSTALL_DIR}"/{db,logs,backups,uploads,storage,public}
chown -R "${APP_USER}:${APP_USER}" "${INSTALL_DIR}"
chmod -R 755 "${INSTALL_DIR}"
log_ok "Directory structure created"

# ── 9. Clone / Copy Application ────────────────────────────────
log_info "Checking for application source..."
if [[ -f "${INSTALL_DIR}/package.json" ]]; then
    log_ok "Application source found at ${INSTALL_DIR}"
else
    log_warn "No application source found. Please copy your project to ${INSTALL_DIR}"
    log_info "Example: cp -r /path/to/agentos/* ${INSTALL_DIR}/"
fi

# ── 10. Install Node Dependencies ──────────────────────────────
if [[ -f "${INSTALL_DIR}/package.json" ]]; then
    log_info "Installing npm dependencies..."
    cd "${INSTALL_DIR}"
    su -c "npm ci --production=false" "$APP_USER"
    log_ok "Dependencies installed"
fi

# ── 11. Setup Prisma / Database ────────────────────────────────
if [[ -f "${INSTALL_DIR}/prisma/schema.prisma" ]]; then
    log_info "Setting up database..."
    cd "${INSTALL_DIR}"
    su -c "npx prisma generate" "$APP_USER"
    su -c "npx prisma db push" "$APP_USER"
    log_ok "Database initialized"
fi

# ── 12. Build Application ──────────────────────────────────────
if [[ -f "${INSTALL_DIR}/package.json" ]]; then
    log_info "Building Next.js application..."
    cd "${INSTALL_DIR}"
    su -c "npm run build" "$APP_USER"
    log_ok "Build complete"
fi

# ── 13. Configure Environment ──────────────────────────────────
if [[ ! -f "${INSTALL_DIR}/.env" ]] && [[ -f "${INSTALL_DIR}/.env.example" ]]; then
    cp "${INSTALL_DIR}/.env.example" "${INSTALL_DIR}/.env"
    log_warn ".env created from template — PLEASE EDIT ${INSTALL_DIR}/.env BEFORE STARTING"
fi

# ── 14. Configure Caddy ────────────────────────────────────────
if [[ -f "${INSTALL_DIR}/Caddyfile" ]]; then
    cp "${INSTALL_DIR}/Caddyfile" /etc/caddy/Caddyfile
    log_ok "Caddyfile deployed to /etc/caddy/Caddyfile"
fi

# ── 15. Setup Firewall ─────────────────────────────────────────
log_info "Configuring UFW firewall..."
ufw --force reset
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp    comment 'SSH'
ufw allow 80/tcp    comment 'HTTP'
ufw allow 443/tcp   comment 'HTTPS'
ufw allow 443/udp   comment 'HTTP/3'
ufw --force enable
log_ok "Firewall configured"

# ── 16. Setup Fail2Ban ─────────────────────────────────────────
log_info "Configuring Fail2Ban..."
if [[ -f "${INSTALL_DIR}/fail2ban/jail.local" ]]; then
    cp "${INSTALL_DIR}/fail2ban/jail.local" /etc/fail2ban/jail.d/alolabs.local
fi
systemctl enable fail2ban
systemctl restart fail2ban
log_ok "Fail2Ban configured"

# ── 17. Setup Log Rotation ─────────────────────────────────────
log_info "Setting up log rotation..."
cat > /etc/logrotate.d/alolabs << 'LOGROTATE'
/opt/alolabs/logs/*.log {
    daily
    rotate 30
    compress
    delaycompress
    missingok
    notifempty
    copytruncate
    create 0644 alolabs alolabs
}
LOGROTATE
log_ok "Log rotation configured"

# ── 18. Setup Cron Jobs ────────────────────────────────────────
log_info "Setting up cron jobs..."
if [[ -f "${INSTALL_DIR}/cron/backup.cron" ]]; then
    cp "${INSTALL_DIR}/cron/backup.cron" /etc/cron.d/alolabs-backup
fi
if [[ -f "${INSTALL_DIR}/cron/health.cron" ]]; then
    cp "${INSTALL_DIR}/cron/health.cron" /etc/cron.d/alolabs-health
fi
if [[ -f "${INSTALL_DIR}/cron/cleanup.cron" ]]; then
    cp "${INSTALL_DIR}/cron/cleanup.cron" /etc/cron.d/alolabs-cleanup
fi
log_ok "Cron jobs configured"

# ── 19. Setup Systemd Service ──────────────────────────────────
if [[ -f "${INSTALL_DIR}/systemd/alolabs.service" ]]; then
    cp "${INSTALL_DIR}/systemd/alolabs.service" /etc/systemd/system/
    systemctl daemon-reload
    systemctl enable alolabs
    log_ok "Systemd service installed"
fi

# ── Done ───────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}═══════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}  ALO Labs AgentOS — Installation Complete!${NC}"
echo -e "${GREEN}═══════════════════════════════════════════════════════${NC}"
echo ""
echo "  Next steps:"
echo "  1. Edit configuration:  nano ${INSTALL_DIR}/.env"
echo "  2. Start the service:   sudo systemctl start alolabs"
echo "     OR with PM2:         cd ${INSTALL_DIR} && pm2 start ecosystem.config.js --env production"
echo "  3. Start Caddy:         sudo systemctl restart caddy"
echo "  4. Create admin account: cd ${INSTALL_DIR} && npx tsx scripts/create-admin.ts"
echo "  5. Check status:        sudo systemctl status alolabs"
echo "  6. View logs:           tail -f ${INSTALL_DIR}/logs/out.log"
echo ""
echo -e "  ${YELLOW}⚠  Remember to edit .env with your production secrets!${NC}"
echo ""
""")

w("deploy.sh", r"""#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════════════
# ALO Labs AgentOS — Deployment Script
# Usage: chmod +x deploy.sh && ./deploy.sh [--docker|--pm2]
# ══════════════════════════════════════════════════════════════════════════
set -euo pipefail

INSTALL_DIR="/opt/alolabs"
BACKUP_DIR="/opt/alolabs/backups"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
DEPLOY_METHOD="${1:-pm2}"

echo "╔═══════════════════════════════════════════════════════════╗"
echo "║   ALO Labs AgentOS — Deployment                          ║"
echo "╚═══════════════════════════════════════════════════════════╝"
echo ""

# ── Pre-deploy Backup ──────────────────────────────────────────
echo "[1/6] Creating pre-deploy backup..."
mkdir -p "$BACKUP_DIR"
if [[ -f "${INSTALL_DIR}/db/agentos.db" ]]; then
    cp "${INSTALL_DIR}/db/agentos.db" "${BACKUP_DIR}/pre-deploy-${TIMESTAMP}.db"
    echo "  ✓ Database backed up"
fi

# ── Pull Latest Code ───────────────────────────────────────────
echo "[2/6] Pulling latest code..."
cd "$INSTALL_DIR"
git pull origin main 2>/dev/null || echo "  ⚠ Not a git repo, skipping pull"

# ── Install Dependencies ───────────────────────────────────────
echo "[3/6] Installing dependencies..."
npm ci --production=false

# ── Database Migration ─────────────────────────────────────────
echo "[4/6] Running database migrations..."
npx prisma generate
npx prisma db push

# ── Build ──────────────────────────────────────────────────────
echo "[5/6] Building application..."
npm run build

# ── Deploy ─────────────────────────────────────────────────────
echo "[6/6] Deploying with ${DEPLOY_METHOD}..."
case "$DEPLOY_METHOD" in
    --docker)
        docker compose up -d --build
        echo "  ✓ Docker deployment complete"
        ;;
    --pm2|*)
        pm2 restart ecosystem.config.js --env production
        echo "  ✓ PM2 deployment complete"
        ;;
esac

# ── Health Check ───────────────────────────────────────────────
echo ""
echo "Running health check..."
sleep 5
if curl -sf http://localhost:3000/api/health > /dev/null 2>&1; then
    echo "  ✓ Application is healthy"
else
    echo "  ✗ Health check failed — check logs at ${INSTALL_DIR}/logs/"
    exit 1
fi

echo ""
echo "✅ Deployment complete at $(date)"
""")

w("update.sh", r"""#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════════════
# ALO Labs AgentOS — Update Script
# Usage: chmod +x update.sh && sudo ./update.sh
# ══════════════════════════════════════════════════════════════════════════
set -euo pipefail

INSTALL_DIR="/opt/alolabs"
APP_USER="alolabs"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

echo "╔═══════════════════════════════════════════════════════════╗"
echo "║   ALO Labs AgentOS — Update                              ║"
echo "╚═══════════════════════════════════════════════════════════╝"

# ── Pre-update Backup ──────────────────────────────────────────
echo "[1/7] Creating pre-update backup..."
bash "${INSTALL_DIR}/backup.sh" --quick

# ── Pull Code ──────────────────────────────────────────────────
echo "[2/7] Pulling latest code..."
cd "$INSTALL_DIR"
sudo -u "$APP_USER" git fetch origin
sudo -u "$APP_USER" git reset --hard origin/main

# ── Update Dependencies ────────────────────────────────────────
echo "[3/7] Updating dependencies..."
sudo -u "$APP_USER" npm ci --production=false

# ── Prisma Migration ───────────────────────────────────────────
echo "[4/7] Running Prisma migrations..."
sudo -u "$APP_USER" npx prisma generate
sudo -u "$APP_USER" npx prisma db push

# ── Build ──────────────────────────────────────────────────────
echo "[5/7] Rebuilding application..."
sudo -u "$APP_USER" npm run build

# ── Copy Static Assets ─────────────────────────────────────────
echo "[6/7] Copying static assets..."
cp -r "${INSTALL_DIR}/.next/static" "${INSTALL_DIR}/.next/standalone/.next/"
cp -r "${INSTALL_DIR}/public" "${INSTALL_DIR}/.next/standalone/"

# ── Restart Service ────────────────────────────────────────────
echo "[7/7] Restarting services..."
if command -v pm2 &>/dev/null && pm2 pid alolabs-agentos &>/dev/null; then
    pm2 restart alolabs-agentos --update-env
    pm2 save
    echo "  ✓ PM2 service restarted"
elif systemctl is-active --quiet alolabs; then
    systemctl restart alolabs
    echo "  ✓ Systemd service restarted"
else
    echo "  ⚠ No running service found. Start with: pm2 start ecosystem.config.js --env production"
fi

# ── Health Check ───────────────────────────────────────────────
sleep 5
if curl -sf http://localhost:3000/api/health > /dev/null 2>&1; then
    echo ""
    echo "✅ Update complete — application is healthy"
else
    echo ""
    echo "❌ Health check failed — rolling back..."
    bash "${INSTALL_DIR}/restore.sh" --latest
    exit 1
fi
""")

w("backup.sh", r"""#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════════════
# ALO Labs AgentOS — Backup Script
# Usage: chmod +x backup.sh && ./backup.sh [--quick]
# ══════════════════════════════════════════════════════════════════════════
set -euo pipefail

INSTALL_DIR="/opt/alolabs"
BACKUP_DIR="${INSTALL_DIR}/backups"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
QUICK="${1:-}"
RETENTION_DAYS=${BACKUP_RETENTION_DAYS:-30}

mkdir -p "$BACKUP_DIR"

echo "╔═══════════════════════════════════════════════════════════╗"
echo "║   ALO Labs AgentOS — Backup                              ║"
echo "╚═══════════════════════════════════════════════════════════╝"

BACKUP_FILE="${BACKUP_DIR}/alolabs-backup-${TIMESTAMP}.tar.gz"

if [[ "$QUICK" == "--quick" ]]; then
    # Quick backup: database only
    echo "[Quick] Backing up database only..."
    if [[ -f "${INSTALL_DIR}/db/agentos.db" ]]; then
        sqlite3 "${INSTALL_DIR}/db/agentos.db" ".backup '${BACKUP_DIR}/db-${TIMESTAMP}.db'"
        echo "  ✓ Database backed up: db-${TIMESTAMP}.db"
    fi
else
    # Full backup
    echo "[1/4] Backing up database..."
    if [[ -f "${INSTALL_DIR}/db/agentos.db" ]]; then
        # Use SQLite backup API for consistency
        sqlite3 "${INSTALL_DIR}/db/agentos.db" ".backup '${BACKUP_DIR}/db-${TIMESTAMP}.db'"
        echo "  ✓ Database: db-${TIMESTAMP}.db"
    else
        echo "  ⚠ No database file found"
    fi

    echo "[2/4] Backing up uploads..."
    if [[ -d "${INSTALL_DIR}/uploads" ]] && [[ "$(ls -A ${INSTALL_DIR}/uploads 2>/dev/null)" ]]; then
        tar -czf "${BACKUP_DIR}/uploads-${TIMESTAMP}.tar.gz" -C "${INSTALL_DIR}" uploads/
        echo "  ✓ Uploads: uploads-${TIMESTAMP}.tar.gz"
    fi

    echo "[3/4] Backing up configuration..."
    for f in .env Caddyfile ecosystem.config.js pm2.config.js; do
        if [[ -f "${INSTALL_DIR}/${f}" ]]; then
            cp "${INSTALL_DIR}/${f}" "${BACKUP_DIR}/${f}-${TIMESTAMP}.bak"
        fi
    done
    echo "  ✓ Configuration files backed up"

    echo "[4/4] Creating full archive..."
    tar -czf "$BACKUP_FILE" \
        -C "$BACKUP_DIR" "db-${TIMESTAMP}.db" 2>/dev/null || true
    echo "  ✓ Full archive: $(du -h "$BACKUP_FILE" | cut -f1)"
fi

# ── Cleanup Old Backups ────────────────────────────────────────
echo ""
echo "Cleaning up backups older than ${RETENTION_DAYS} days..."
find "$BACKUP_DIR" -name "alolabs-backup-*.tar.gz" -mtime +${RETENTION_DAYS} -delete 2>/dev/null || true
find "$BACKUP_DIR" -name "db-*.db" -mtime +${RETENTION_DAYS} -delete 2>/dev/null || true
find "$BACKUP_DIR" -name "uploads-*.tar.gz" -mtime +${RETENTION_DAYS} -delete 2>/dev/null || true

echo ""
echo "✅ Backup complete"
ls -lh "$BACKUP_DIR" | tail -5
""")

w("restore.sh", r"""#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════════════
# ALO Labs AgentOS — Restore Script
# Usage: chmod +x restore.sh && ./restore.sh [--latest|--file=backup-file]
# ══════════════════════════════════════════════════════════════════════════
set -euo pipefail

INSTALL_DIR="/opt/alolabs"
BACKUP_DIR="${INSTALL_DIR}/backups"

echo "╔═══════════════════════════════════════════════════════════╗"
echo "║   ALO Labs AgentOS — Restore                             ║"
echo "╚═══════════════════════════════════════════════════════════╝"
echo ""

# ── Find Backup ────────────────────────────────────────────────
if [[ "${1:-}" == "--latest" ]]; then
    DB_BACKUP=$(ls -t "${BACKUP_DIR}"/db-*.db 2>/dev/null | head -1)
    if [[ -z "$DB_BACKUP" ]]; then
        echo "❌ No database backup found"
        exit 1
    fi
    echo "Latest backup: $(basename "$DB_BACKUP")"
elif [[ "${1:-}" == --file=* ]]; then
    DB_BACKUP="${1#--file=}"
    if [[ ! -f "$DB_BACKUP" ]]; then
        echo "❌ Backup file not found: $DB_BACKUP"
        exit 1
    fi
else
    echo "Available backups:"
    ls -lht "${BACKUP_DIR}"/db-*.db 2>/dev/null || echo "  No backups found"
    echo ""
    read -p "Enter backup file path: " DB_BACKUP
    if [[ ! -f "$DB_BACKUP" ]]; then
        echo "❌ File not found: $DB_BACKUP"
        exit 1
    fi
fi

# ── Confirm ────────────────────────────────────────────────────
echo ""
echo "⚠  This will replace the current database with the backup."
echo "   Current database: ${INSTALL_DIR}/db/agentos.db"
echo "   Backup source:    $(basename "$DB_BACKUP")"
read -p "Continue? (y/N) " -n 1 -r
echo
[[ ! $REPLY =~ ^[Yy]$ ]] && exit 0

# ── Stop Service ───────────────────────────────────────────────
echo "[1/4] Stopping services..."
pm2 stop alolabs-agentos 2>/dev/null || systemctl stop alolabs 2>/dev/null || true
sleep 2

# ── Backup Current DB ──────────────────────────────────────────
echo "[2/4] Backing up current database..."
if [[ -f "${INSTALL_DIR}/db/agentos.db" ]]; then
    cp "${INSTALL_DIR}/db/agentos.db" "${BACKUP_DIR}/pre-restore-$(date +%Y%m%d_%H%M%S).db"
    echo "  ✓ Current DB saved"
fi

# ── Restore ────────────────────────────────────────────────────
echo "[3/4] Restoring database..."
cp "$DB_BACKUP" "${INSTALL_DIR}/db/agentos.db"
chown alolabs:alolabs "${INSTALL_DIR}/db/agentos.db"
echo "  ✓ Database restored"

# ── Restart Service ────────────────────────────────────────────
echo "[4/4] Starting services..."
pm2 restart alolabs-agentos 2>/dev/null || systemctl start alolabs 2>/dev/null || true
sleep 3

# ── Health Check ───────────────────────────────────────────────
if curl -sf http://localhost:3000/api/health > /dev/null 2>&1; then
    echo "  ✓ Application is healthy"
else
    echo "  ⚠ Health check failed — manual intervention may be needed"
fi

echo ""
echo "✅ Restore complete"
""")

w("health-check.sh", r"""#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════════════
# ALO Labs AgentOS — Health Check Script
# Usage: ./health-check.sh [--verbose]
# ══════════════════════════════════════════════════════════════════════════
set -euo pipefail

VERBOSE="${1:-}"
APP_URL="${APP_URL:-http://localhost:3000}"
HEALTH_PATH="${HEALTH_CHECK_PATH:-/api/health}"
EXIT_CODE=0

check() {
    local name="$1" cmd="$2"
    if eval "$cmd" > /dev/null 2>&1; then
        echo "  ✓ $name"
    else
        echo "  ✗ $name"
        EXIT_CODE=1
    fi
}

echo "═════════════════════════════════════════════"
echo "  ALO Labs AgentOS — Health Check"
echo "  $(date '+%Y-%m-%d %H:%M:%S %Z')"
echo "═════════════════════════════════════════════"
echo ""

echo "[Services]"
check "Next.js App (port 3000)"   "curl -sf ${APP_URL}${HEALTH_PATH}"
check "Caddy (port 80)"           "curl -sf -o /dev/null -w '%{http_code}' http://localhost:80"
check "HTTPS (port 443)"         "curl -sf -o /dev/null -w '%{http_code}' https://alolabs.net 2>/dev/null || curl -skf -o /dev/null -w '%{http_code}' https://localhost 2>/dev/null"

echo ""
echo "[System]"
check "PM2 Process"               "pm2 pid alolabs-agentos"
check "Systemd Service"           "systemctl is-active alolabs"
check "Database File"             "test -f /opt/alolabs/db/agentos.db"
check "Disk Space (>10% free)"    "df / | awk 'NR==2 {exit !(\$5+0 < 90)}'"

echo ""
echo "[Resources]"
MEM_USED=$(free -m | awk 'NR==2{printf "%dMB", $3}')
MEM_TOTAL=$(free -m | awk 'NR==2{printf "%dMB", $2}')
CPU_LOAD=$(uptime | awk -F'load average:' '{print $2}' | awk '{print $1}')
DISK_USED=$(df -h / | awk 'NR==2{print $5}')
echo "  Memory:  ${MEM_USED} / ${MEM_TOTAL}"
echo "  CPU:     ${CPU_LOAD}"
echo "  Disk:    ${DISK_USED} used"

if [[ "$VERBOSE" == "--verbose" ]]; then
    echo ""
    echo "[PM2 Details]"
    pm2 list 2>/dev/null || echo "  PM2 not running"
    echo ""
    echo "[Recent Errors (last 20 lines)]"
    tail -20 /opt/alolabs/logs/error.log 2>/dev/null || echo "  No error log found"
fi

echo ""
if [[ $EXIT_CODE -eq 0 ]]; then
    echo "✅ All checks passed"
else
    echo "❌ Some checks failed"
fi

exit $EXIT_CODE
""")

w("monitor.sh", r"""#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════════════
# ALO Labs AgentOS — Real-time Monitoring
# Usage: ./monitor.sh
# Press Ctrl+C to stop
# ══════════════════════════════════════════════════════════════════════════

APP_URL="${APP_URL:-http://localhost:3000}"
INTERVAL=5

trap 'echo -e "\nMonitor stopped."; exit 0' INT

echo "╔═══════════════════════════════════════════════════════════╗"
echo "║   ALO Labs AgentOS — Real-time Monitor                    ║"
echo "║   Refresh: ${INTERVAL}s | Press Ctrl+C to stop            ║"
echo "╚═══════════════════════════════════════════════════════════╝"
echo ""

while true; do
    clear
    echo "═════════════════════════════════════════════"
    echo "  ALO Labs AgentOS — $(date '+%Y-%m-%d %H:%M:%S')"
    echo "═════════════════════════════════════════════"
    echo ""

    # System Resources
    echo "[System Resources]"
    echo "  CPU Load:  $(uptime | awk -F'load average:' '{print $2}')"
    free -h | awk 'NR==2{printf "  Memory:    %s / %s (%.1f%% used)\n", $3, $2, $3*100/$2}'
    df -h / | awk 'NR==2{printf "  Disk:      %s / %s (%s used)\n", $3, $2, $5}'
    echo ""

    # Service Status
    echo "[Service Status]"
    if pm2 pid alolabs-agentos &>/dev/null; then
        echo "  PM2:       $(pm2 jlist | python3 -c 'import json,sys; d=json.load(sys.stdin)[0]; print(f\"Running (PID: {d[\"pid\"]}, Uptime: {d[\"pm2_env\"].get(\"pm_uptime\",\"N/A\")}, Restarts: {d[\"pm2_env\"].get(\"restart_time\",0)})")' 2>/dev/null || echo "  PM2:       Running")"
    else
        echo "  PM2:       Not running"
    fi
    echo "  Caddy:     $(systemctl is-active caddy 2>/dev/null || echo 'unknown')"
    echo "  Fail2Ban:  $(systemctl is-active fail2ban 2>/dev/null || echo 'unknown')"
    echo ""

    # Application Health
    echo "[Application]"
    HTTP_CODE=$(curl -sf -o /dev/null -w '%{http_code}' "${APP_URL}/api/health" 2>/dev/null || echo "000")
    RESP_TIME=$(curl -sf -o /dev/null -w '%{time_total}s' "${APP_URL}/api/health" 2>/dev/null || echo "N/A")
    echo "  Health:    HTTP ${HTTP_CODE} (${RESP_TIME})"

    # Active Connections
    CONN_COUNT=$(ss -tn | grep -c ':3000\|:80\|:443' 2>/dev/null || echo "0")
    echo "  Active Connections: ${CONN_COUNT}"
    echo ""

    # Recent Logs
    echo "[Recent Logs (last 5)]"
    tail -5 /opt/alolabs/logs/out.log 2>/dev/null | sed 's/^/  /' || echo "  No logs available"

    sleep "$INTERVAL"
done
""")

w("ssl-renew.sh", r"""#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════════════
# ALO Labs AgentOS — SSL Certificate Management
# Usage: ./ssl-renew.sh [--force|--check]
# ══════════════════════════════════════════════════════════════════════════
set -euo pipefail

echo "╔═══════════════════════════════════════════════════════════╗"
echo "║   ALO Labs AgentOS — SSL Certificate Management          ║"
echo "╚═══════════════════════════════════════════════════════════╝"
echo ""

DOMAIN="alolabs.net"

# ── Check Mode ─────────────────────────────────────────────────
if [[ "${1:-}" == "--check" ]]; then
    echo "Checking SSL certificate status..."
    echo ""
    echo | openssl s_client -servername "$DOMAIN" -connect "$DOMAIN":443 2>/dev/null \
        | openssl x509 -noout -subject -issuer -dates -ext subjectAltName 2>/dev/null \
        || echo "Could not retrieve certificate — Caddy may handle TLS automatically"
    echo ""
    echo "Note: Caddy automatically manages Let's Encrypt certificates."
    echo "No manual renewal is typically needed."
    exit 0
fi

# ── Force Renewal ──────────────────────────────────────────────
if [[ "${1:-}" == "--force" ]]; then
    echo "Forcing certificate renewal..."
    # Stop Caddy to release certificate lock
    systemctl stop caddy
    sleep 2

    # Remove old certificates
    rm -rf /var/lib/caddy/.local/share/caddy/certificates 2>/dev/null || true

    # Restart Caddy (will obtain new certificates)
    systemctl start caddy
    sleep 5

    # Verify
    echo | openssl s_client -servername "$DOMAIN" -connect "$DOMAIN":443 2>/dev/null \
        | openssl x509 -noout -dates
    echo ""
    echo "✅ Certificate renewal complete"
else
    echo "Caddy automatically manages SSL certificates via Let's Encrypt."
    echo ""
    echo "Commands:"
    echo "  ./ssl-renew.sh --check    Check current certificate status"
    echo "  ./ssl-renew.sh --force    Force certificate renewal"
    echo ""
    echo "Certificate storage: /var/lib/caddy/.local/share/caddy/certificates/"
fi
""")

w("uninstall.sh", r"""#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════════════
# ALO Labs AgentOS — Uninstall Script
# Usage: chmod +x uninstall.sh && sudo ./uninstall.sh
# ⚠️  THIS WILL REMOVE ALL ALO LABS DATA — USE WITH CAUTION
# ══════════════════════════════════════════════════════════════════════════
set -euo pipefail

INSTALL_DIR="/opt/alolabs"
APP_USER="alolabs"

echo "╔═══════════════════════════════════════════════════════════╗"
echo "║   ALO Labs AgentOS — Uninstall                           ║"
echo "║   ⚠️  THIS WILL REMOVE ALL DATA                          ║"
echo "╚═══════════════════════════════════════════════════════════╝"
echo ""
echo "⚠️  WARNING: This will permanently remove:"
echo "  - Application files at ${INSTALL_DIR}"
echo "  - Database and all user data"
echo "  - Backups"
echo "  - Systemd service, PM2 process, Caddy config"
echo "  - Cron jobs"
echo "  - Firewall rules"
echo ""
read -p "Type 'UNINSTALL' to confirm: " CONFIRM
if [[ "$CONFIRM" != "UNINSTALL" ]]; then
    echo "Cancelled."
    exit 0
fi

echo ""
echo "[1/7] Stopping services..."
pm2 delete alolabs-agentos 2>/dev/null || true
systemctl stop alolabs 2>/dev/null || true
systemctl disable alolabs 2>/dev/null || true

echo "[2/7] Removing systemd service..."
rm -f /etc/systemd/system/alolabs.service
systemctl daemon-reload

echo "[3/7] Removing Caddy config..."
if [[ -f /etc/caddy/Caddyfile ]]; then
    rm -f /etc/caddy/Caddyfile.bak
    mv /etc/caddy/Caddyfile /etc/caddy/Caddyfile.bak 2>/dev/null || true
fi

echo "[4/7] Removing cron jobs..."
rm -f /etc/cron.d/alolabs-*

echo "[5/7] Removing firewall rules..."
ufw delete allow 80/tcp 2>/dev/null || true
ufw delete allow 443/tcp 2>/dev/null || true
ufw delete allow 443/udp 2>/dev/null || true

echo "[6/7] Removing application files..."
rm -rf "${INSTALL_DIR}"
rm -f /etc/logrotate.d/alolabs

echo "[7/7] Removing user (optional)..."
read -p "Remove user '${APP_USER}' too? (y/N) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    userdel -r "$APP_USER" 2>/dev/null || true
    echo "  ✓ User removed"
fi

echo ""
echo "✅ ALO Labs AgentOS has been uninstalled."
echo "   Backup configs at /etc/caddy/Caddyfile.bak if needed."
""")

print("\n[2/8] Shell scripts done.")