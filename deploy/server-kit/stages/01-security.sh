#!/usr/bin/env bash
set -Eeuo pipefail
source "$(dirname "$0")/../lib/common.sh"
require_root
STAGE="01-security"; log "▶ $STAGE starting"
SSH_PORT="${KIT_SSH_PORT:-2244}"

log "apply sysctl hardening"
write_file /etc/sysctl.d/99-alo-security.conf root:root 0644 <<'EOF'
net.ipv4.ip_forward = 0
net.ipv4.conf.all.rp_filter = 1
net.ipv4.conf.default.rp_filter = 1
net.ipv4.conf.all.log_martians = 1
net.ipv4.icmp_echo_ignore_broadcasts = 1
net.ipv4.tcp_syncookies = 1
net.ipv4.tcp_max_syn_backlog = 4096
net.ipv4.conf.all.accept_redirects = 0
net.ipv4.conf.all.send_redirects = 0
net.ipv4.conf.default.accept_redirects = 0
net.ipv4.conf.default.send_redirects = 0
net.ipv6.conf.default.accept_ra = 0
kernel.kptr_restrict = 2
kernel.dmesg_restrict = 1
EOF
sysctl --system >/dev/null

log "hardening sshd_config (keep port 22 for now, add $SSH_PORT)"
SSHD=/etc/ssh/sshd_config
backup_file "$SSHD"
sed -i '/^#\?Port /d' "$SSHD"
sed -i '1i Port 22\nPort '"$SSH_PORT"'' "$SSHD"

declare -A OPTS=(
  [PermitRootLogin]="no"
  [PasswordAuthentication]="no"
  [ChallengeResponseAuthentication]="no"
  [KbdInteractiveAuthentication]="no"
  [UsePAM]="yes"
  [PubkeyAuthentication]="yes"
  [PermitEmptyPasswords]="no"
  [X11Forwarding]="no"
  [AllowAgentForwarding]="no"
  [AllowTcpForwarding]="no"
  [ClientAliveInterval]="300"
  [ClientAliveCountMax]="2"
  [LoginGraceTime]="30"
  [MaxAuthTries]="3"
  [AllowUsers]="$KIT_PRIMARY_USER"
)
for k in "${!OPTS[@]}"; do
  sed -i "/^#\?\s*${k}\s\+/d" "$SSHD"
  printf '%s %s\n' "$k" "${OPTS[$k]}" >> "$SSHD"
done
sshd -t || die "sshd_config syntax invalid"
systemctl reload ssh || systemctl reload sshd

log "configuring UFW"
ufw --force reset >/dev/null
ufw default deny incoming
ufw default allow outgoing
ufw allow in on "$KIT_TAILSCALE_IF" comment "tailscale full trust"
ufw allow 22/tcp     comment "SSH-22 (TEMP until 2244 verified)"
ufw allow "$SSH_PORT"/tcp comment "SSH-custom"
ufw allow 80/tcp     comment "HTTP"
ufw allow 443/tcp    comment "HTTPS"
ufw allow from "$KIT_LAN_CIDR" to any port 5432 proto tcp comment "PG LAN-only"
ufw allow from "$KIT_LAN_CIDR" to any port 3306 proto tcp comment "MySQL LAN-only"
ufw allow from "$KIT_LAN_CIDR" to any port 139 proto tcp comment "Samba LAN-only"
ufw allow from "$KIT_LAN_CIDR" to any port 445 proto tcp comment "Samba LAN-only"
ufw allow from "$KIT_LAN_CIDR" to any port 137 proto udp comment "Samba NetBIOS LAN-only"
ufw allow from "$KIT_LAN_CIDR" to any port 138 proto udp comment "Samba NetBIOS LAN-only"
ufw allow from "$KIT_LAN_CIDR" to any port 8384 proto tcp comment "Syncthing admin LAN-only"
ufw deny 11434/tcp comment "Ollama localhost-only"
ufw deny 4000/tcp  comment "LiteLLM localhost-only"
ufw deny 3001/tcp  comment "Open WebUI localhost-only"
ufw deny 19999/tcp comment "Netdata localhost-only"
ufw --force enable
ufw status verbose | tee "$LOG_DIR/ufw-state.log" >/dev/null

log "configure fail2ban (3 retries -> 24h ban)"
write_file /etc/fail2ban/jail.local root:root 0644 <<EOF
[DEFAULT]
bantime  = 24h
findtime = 10m
maxretry = 3
backend  = systemd
destemail = ${KIT_ADMIN_EMAIL}
sender   = fail2ban@${KIT_HOSTNAME}
action   = %(action_)s

[sshd]
enabled  = true
port     = 22,${SSH_PORT}
logpath  = %(sshd_log)s
EOF
systemctl enable --now fail2ban
systemctl restart fail2ban

echo ""
echo "============================================================"
echo "  SSH LOCKOUT PROTECTION"
echo "  Port 22 still open. Verify ${SSH_PORT} works first:"
echo "    ssh -p ${SSH_PORT} ${KIT_PRIMARY_USER}@<this-host>"
echo "  Then close port 22:  sudo ./scripts/close-ssh-22.sh"
echo "============================================================"
echo ""

mark_done "$STAGE"; log "✓ $STAGE complete"
