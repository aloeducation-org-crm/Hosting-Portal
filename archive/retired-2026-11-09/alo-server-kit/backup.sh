#!/usr/bin/env bash
set -Eeuo pipefail
source "$(dirname "$0")/../lib/common.sh"
require_root
TS=$(date +%Y%m%d-%H%M%S)
SNAP_DIR="/var/backups/alo-files"
install -d -m 0750 "$SNAP_DIR"
log "running DB backup"
/usr/local/sbin/alo-db-backup.sh
log "snapshotting critical configs"
TARBALL="$SNAP_DIR/alo-configs-$TS.tar.gz"
tar -czf "$TARBALL" \
  /etc/nginx /etc/postgresql /etc/mysql \
  /etc/systemd/system/litellm.service /etc/systemd/system/open-webui.service \
  /etc/systemd/system/pm2-$KIT_PRIMARY_USER.service /etc/samba/smb.conf \
  /etc/fail2ban/jail.local /etc/sysctl.d/99-alo-security.conf \
  /etc/cron.d/alo-* "$KIT_ROOT/config.env" 2>/dev/null || true
chmod 0600 "$TARBALL"; chown root:root "$TARBALL"
find "$SNAP_DIR" -type f -mtime +30 -delete
log "backup complete: $TARBALL"
