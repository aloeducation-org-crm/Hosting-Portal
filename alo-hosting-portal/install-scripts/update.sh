#!/usr/bin/env bash
# ALO Labs Hosting Portal - Update Script
# Usage: sudo bash update.sh

set -euo pipefail

INSTALL_DIR="/opt/alo-hosting-portal"
HELPER_DIR="/usr/local/sbin"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

if [[ $EUID -ne 0 ]]; then
  echo "This script must be run as root (use sudo)"
  exit 1
fi

echo "=== ALO Labs Hosting Portal Update ==="

# Backup current .env
echo "[1/5] Backing up configuration..."
cp "$INSTALL_DIR/.env" "$INSTALL_DIR/.env.backup.$(date +%Y%m%d%H%M%S)"

# Stop service
echo "[2/5] Stopping service..."
systemctl stop alo-server-hosting 2>/dev/null || true

# Install new helper scripts
echo "[3/5] Updating helper scripts..."
cp "$PROJECT_DIR/server-helpers/"* "$HELPER_DIR/"
chmod +x "$HELPER_DIR/alo-"*

# Update application files
echo "[4/5] Updating application..."
mkdir -p "$INSTALL_DIR"
if [[ -d "$PROJECT_DIR/.next/standalone" ]]; then
  cp -a "$PROJECT_DIR/.next/standalone/"* "$INSTALL_DIR/"
  cp -a "$PROJECT_DIR/.next/static" "$INSTALL_DIR/.next/static" 2>/dev/null || true
  cp -a "$PROJECT_DIR/public" "$INSTALL_DIR/public" 2>/dev/null || true
else
  cp -a "$PROJECT_DIR/"* "$INSTALL_DIR/"
fi
chown -R aloedu:aloedu "$INSTALL_DIR"

# Run migrations
echo "[5/5] Running database migrations..."
su - aloedu -c "cd $INSTALL_DIR && npx prisma migrate deploy"

# Start service
systemctl start alo-server-hosting
sleep 2
STATUS=$(systemctl is-active alo-server-hosting)
echo "Update complete! Service status: $STATUS"
echo "Logs: journalctl -u alo-server-hosting -f"
