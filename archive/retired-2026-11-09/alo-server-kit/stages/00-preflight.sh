#!/usr/bin/env bash
set -Eeuo pipefail
source "$(dirname "$0")/../lib/common.sh"
require_root
STAGE="00-preflight"; log "▶ $STAGE starting"

log "apt update + base utilities"
apt-get -y update >/dev/null
ensure_pkg ca-certificates curl wget gnupg lsb-release apt-transport-https \
           software-properties-common build-essential git rsync unzip jq \
           htop iotop iftop ncdu tree vim less ufw fail2ban \
           python3 python3-pip python3-venv python3-full pipx \
           acl unattended-upgrades apt-listchanges

log "set timezone -> $KIT_TIMEZONE"
timedatectl set-timezone "$KIT_TIMEZONE"
timedatectl set-ntp true

if [[ "$(hostname)" != "$KIT_HOSTNAME" ]]; then
  log "set hostname -> $KIT_HOSTNAME"
  hostnamectl set-hostname "$KIT_HOSTNAME"
  grep -q "$KIT_HOSTNAME" /etc/hosts || echo "127.0.1.1 $KIT_HOSTNAME" >> /etc/hosts
fi

SWAP_FILE=/swapfile
if ! swapon --show | grep -q "$SWAP_FILE"; then
  log "creating 4GB swap at $SWAP_FILE"
  fallocate -l 4G "$SWAP_FILE" 2>/dev/null || dd if=/dev/zero of="$SWAP_FILE" bs=1M count=4096
  chmod 600 "$SWAP_FILE"; mkswap "$SWAP_FILE" >/dev/null; swapon "$SWAP_FILE"
  grep -q "$SWAP_FILE" /etc/fstab || echo "$SWAP_FILE none swap sw 0 0" >> /etc/fstab
else
  log "swap already present"
fi
sysctl -w vm.swappiness=10 >/dev/null
sysctl -w vm.vfs_cache_pressure=50 >/dev/null
printf 'vm.swappiness=10\nvm.vfs_cache_pressure=50\n' > /etc/sysctl.d/99-alo.conf

log "enable unattended-upgrades (security only)"
cat >/etc/apt/apt.conf.d/20auto-upgrades <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT::Periodic::AutocleanInterval "7";
EOF
grep -q 'Automatic-Reboot-Time' /etc/apt/apt.conf.d/50unattended-upgrades || \
  echo 'Unattended-Upgrade::Automatic-Reboot-Time "04:30";' >> /etc/apt/apt.conf.d/50unattended-upgrades

log "disk + LVM audit"
log "root FS: $(df -h / | tail -1)"
vgs 2>/dev/null | tail -n +2 | while read -r vg _ _ _ free _; do
  log "  VG=$vg free=$free"
done
FREE_EXTENTS=$(vgs --noheadings --units g -o vg_free 2>/dev/null | head -1 | xargs || echo "0")
if [[ "${FREE_EXTENTS%[!0-9.]*}" -gt 5 ]] 2>/dev/null; then
  log "WARN: large unallocated VG space (${FREE_EXTENTS}). Extend with:"
  log "  lvextend -l +100%FREE /dev/mapper/ubuntu--vg-ubuntu--lv && resize2fs /dev/mapper/ubuntu--vg-ubuntu--lv"
fi

mark_done "$STAGE"; log "✓ $STAGE complete"
