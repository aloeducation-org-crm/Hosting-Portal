#!/usr/bin/env bash
set -Eeuo pipefail
source "$(dirname "$0")/../lib/common.sh"
require_root
echo "Before continuing, confirm you can SSH on port $KIT_SSH_PORT from another terminal:"
echo "  ssh -p $KIT_SSH_PORT $KIT_PRIMARY_USER@<host>"
echo ""
read -r -p "Have you verified login on port $KIT_SSH_PORT? [yes/no]: " ans
if [[ "$ans" != "yes" ]]; then
  echo "Aborting — please verify port $KIT_SSH_PORT first."
  exit 1
fi
ufw delete allow 22/tcp
sed -i '/^Port 22$/d' /etc/ssh/sshd_config
sshd -t || die "sshd_config syntax invalid"
systemctl reload ssh || systemctl reload sshd
sed -i "s/^port\s*=\s*22,${KIT_SSH_PORT}/port = ${KIT_SSH_PORT}/" /etc/fail2ban/jail.local 2>/dev/null || true
systemctl reload fail2ban || systemctl restart fail2ban
echo "✓ Port 22 closed. SSH now ONLY on port $KIT_SSH_PORT."
ufw status | head -20
