#!/usr/bin/env bash
# ALO Labs Hosting Portal - Rollback Script
# Usage: sudo bash rollback.sh [backup_env_file]

set -euo pipefail

INSTALL_DIR="/opt/alo-hosting-portal"
BACKUP_DIR="$INSTALL_DIR/backups"

if [[ $EUID -ne 0 ]]; then
  echo "This script must be run as root (use sudo)"
  exit 1
fi

ENV_BACKUP="${1:-$(ls -t "$INSTALL_DIR"/.env.backup.* 2>/dev/null | head -1)}"

if [[ -z "$ENV_BACKUP" || ! -f "$ENV_BACKUP" ]]; then
  echo "No backup found. Usage: sudo bash rollback.sh [backup_env_file]"
  exit 1
fi

echo "=== ALO Labs Hosting Portal Rollback ==="
echo "Restoring from: $ENV_BACKUP"

# Stop service
echo "[1/3] Stopping service..."
systemctl stop alo-server-hosting 2>/dev/null || true

# Restore .env
echo "[2/3] Restoring configuration..."
cp "$ENV_BACKUP" "$INSTALL_DIR/.env"

# Rollback database
echo "[3/3] Rolling back database..."
su - aloedu -c "cd $INSTALL_DIR && npx prisma migrate resolve --rolled-back" 2>/dev/null || echo "Manual migration rollback may be needed"

# Start service
systemctl start alo-server-hosting
sleep 2
STATUS=$(systemctl is-active alo-server-hosting)
echo "Rollback complete! Service status: $STATUS"
