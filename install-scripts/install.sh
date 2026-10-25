#!/usr/bin/env bash
# ALO Labs Hosting Portal - Server Installation Script
# Run as root or with sudo on Ubuntu 22.04
# Usage: sudo bash install.sh

set -euo pipefail

INSTALL_DIR="/opt/alo-hosting-portal"
SITE_BASE="/srv/alo-sites"
BACKUP_BASE="/var/backups/alo-sites"
CADDY_DIR="/etc/caddy/sites-enabled"
HELPER_DIR="/usr/local/sbin"
SUDOERS_FILE="/etc/sudoers.d/alo-hosting-portal"
SERVICE_FILE="/etc/systemd/system/alo-server-hosting.service"
APP_USER="aloedu"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

echo "=== ALO Labs Hosting Portal Installer ==="
echo ""

# Check root
if [[ $EUID -ne 0 ]]; then
  echo "This script must be run as root (use sudo)"
  exit 1
fi

# Check Ubuntu
if ! grep -q "Ubuntu 22" /etc/os-release 2>/dev/null; then
  echo "WARNING: This script is designed for Ubuntu 22.04 LTS"
  read -p "Continue anyway? (y/N) " -n 1 -r
  echo
  [[ ! $REPLY =~ ^[Yy]$ ]] && exit 1
fi

echo "[1/8] Creating application user..."
if ! id "$APP_USER" &>/dev/null; then
  useradd -m -s /bin/bash "$APP_USER"
  echo "Created user: $APP_USER"
else
  echo "User $APP_USER already exists"
fi

mkdir -p "$SITE_BASE" "$BACKUP_BASE" "$CADDY_DIR" "/var/log/caddy/alo-sites"
chown -R "$APP_USER:$APP_USER" "$SITE_BASE" "$BACKUP_BASE"
chown -R "root:root" "$CADDY_DIR" "/var/log/caddy/alo-sites"
chmod 755 "$SITE_BASE" "$BACKUP_BASE"

# Generate secrets if not in env
NEXTAUTH_SECRET="${NEXTAUTH_SECRET:-$(openssl rand -base64 48)}"
JWT_SECRET="${JWT_SECRET:-$(openssl rand -base64 48)}"

echo "[2/8] Installing helper scripts..."
cp "$PROJECT_DIR/server-helpers/"* "$HELPER_DIR/"
chmod +x "$HELPER_DIR/alo-"*
echo "Installed $(ls "$HELPER_DIR/alo-"* | wc -l) helper scripts"

echo "[3/8] Installing sudo policy..."
cp "$PROJECT_DIR/server-config/alo-hosting-portal.sudoers" "$SUDOERS_FILE"
chmod 0440 "$SUDOERS_FILE"
visudo -c -f "$SUDOERS_FILE" && echo "Sudo policy validated" || { echo "ERROR: Invalid sudoers file"; exit 1; }

echo "[4/8] Installing application files..."
mkdir -p "$INSTALL_DIR"
if [[ -d "$PROJECT_DIR/.next/standalone" ]]; then
  cp -a "$PROJECT_DIR/.next/standalone/"* "$INSTALL_DIR/"
  cp -a "$PROJECT_DIR/.next/static" "$INSTALL_DIR/.next/static" 2>/dev/null || true
  cp -a "$PROJECT_DIR/public" "$INSTALL_DIR/public" 2>/dev/null || true
else
  cp -a "$PROJECT_DIR/"* "$INSTALL_DIR/"
fi
chown -R "$APP_USER:$APP_USER" "$INSTALL_DIR"

echo "[5/8] Creating .env.production..."
cat > "$INSTALL_DIR/.env" << ENV_EOF
NODE_ENV=production
HOSTNAME=127.0.0.1
PORT=3101
APP_URL=https://hosting.alolabs.net
NEXTAUTH_URL=https://hosting.alolabs.net
NEXTAUTH_SECRET=$NEXTAUTH_SECRET
JWT_SECRET=$JWT_SECRET
DATABASE_URL=${DATABASE_URL:-postgresql://aloedu:changeme@localhost:5432/alo_hosting}
SITE_BASE=$SITE_BASE
BACKUP_BASE=$BACKUP_BASE
CADDY_CONFIG_DIR=$CADDY_DIR
CADDY_LOG_DIR=/var/log/caddy/alo-sites
HELPER_TIMEOUT_SECONDS=120
DEPLOY_TIMEOUT_SECONDS=1800
BACKUP_RETENTION_COUNT=14
MAX_UPLOAD_SIZE_MB=500
ALLOW_STATIC=true
ALLOW_PHP=true
ALLOW_NODE=true
ALLOW_NEXTJS=true
COMMERCIAL_HOSTING=false
ENV_EOF
chown "$APP_USER:$APP_USER" "$INSTALL_DIR/.env"
chmod 600 "$INSTALL_DIR/.env"

echo "[6/8] Setting up database..."
su - "$APP_USER" -c "cd $INSTALL_DIR && npx prisma migrate deploy" 2>/dev/null || {
  echo "Running initial migration..."
  su - "$APP_USER" -c "cd $INSTALL_DIR && npx prisma migrate dev --name init"
}
su - "$APP_USER" -c "cd $INSTALL_DIR && npx prisma db seed" 2>/dev/null || echo "Seed already applied or failed (non-critical)"

echo "[7/8] Installing systemd service..."
cp "$PROJECT_DIR/server-config/alo-server-hosting.service" "$SERVICE_FILE"
systemctl daemon-reload
systemctl enable alo-server-hosting
systemctl start alo-server-hosting
sleep 2
SERVICE_STATUS=$(systemctl is-active alo-server-hosting)
echo "Service status: $SERVICE_STATUS"

if [[ "$SERVICE_STATUS" == "active" ]]; then
  echo "[8/8] Installation complete!"
  echo ""
  echo "  Portal URL:    https://hosting.alolabs.net"
  echo "  Admin Email:   admin@alolabs.net"
  echo "  Admin Pass:    (see SEED_ADMIN_PASSWORD env or default: Admin@123456)"
  echo "  Service:       systemctl status alo-server-hosting"
  echo "  Logs:          journalctl -u alo-server-hosting -f"
  echo ""
  echo "  IMPORTANT: Change the admin password and .env secrets immediately!"
else
  echo "[8/8] Installation finished but service not active. Check logs:"
  echo "  journalctl -u alo-server-hosting -n 50"
fi
