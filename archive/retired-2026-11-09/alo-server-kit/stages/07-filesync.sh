#!/usr/bin/env bash
set -Eeuo pipefail
source "$(dirname "$0")/../lib/common.sh"
require_root
STAGE="07-filesync"; log "▶ $STAGE starting"
USER_HOME=$(getent passwd "$KIT_PRIMARY_USER" | cut -d: -f6)
SHARED_ROOT="$USER_HOME/shared"
install -d -m 0750 -o "$KIT_PRIMARY_USER" -g "$KIT_PRIMARY_USER" \
  "$SHARED_ROOT/documents" "$SHARED_ROOT/projects"
install -d -m 0700 -o root -g root /root/.alo-secrets

log "install Syncthing (bound to 127.0.0.1:8384)"
if ! command -v syncthing >/dev/null; then
  curl -fsSL -o /usr/share/keyrings/syncthing-archive-keyring.gpg https://syncthing.net/release-key.gpg
  echo "deb [signed-by=/usr/share/keyrings/syncthing-archive-keyring.gpg] https://apt.syncthing.net/ syncthing stable" > /etc/apt/sources.list.d/syncthing.list
  apt-get -y update >/dev/null
  ensure_pkg syncthing
fi
sudo -u "$KIT_PRIMARY_USER" bash -lc 'mkdir -p ~/.config/systemd/user && systemctl --user daemon-reload' || true
sudo -u "$KIT_PRIMARY_USER" bash -lc 'systemctl --user enable --now syncthing.service' 2>/dev/null || true
ST_CONF="$USER_HOME/.local/state/syncthing/config.xml"
if [[ -f "$ST_CONF" ]]; then
  sudo -u "$KIT_PRIMARY_USER" sed -i 's|<address>0.0.0.0:8384</address>|<address>127.0.0.1:8384</address>|' "$ST_CONF"
  sudo -u "$KIT_PRIMARY_USER" sed -i 's|<address>:::8384</address>|<address>127.0.0.1:8384</address>|' "$ST_CONF"
fi
sudo -u "$KIT_PRIMARY_USER" bash -lc 'systemctl --user restart syncthing.service' 2>/dev/null || true

log "install Samba (LAN-only RW documents/projects — DB backups NEVER shared over SMB)"
ensure_pkg samba samba-common-bin cifs-utils apache2-utils
if ! pdbedit -L 2>/dev/null | cut -d: -f1 | grep -qx "$KIT_SAMBA_USER"; then
  SMB_PW="${KIT_SAMBA_PASS:-$(openssl rand -base64 18 | tr -d '/+=')}"
  printf '%s\n%s\n' "$SMB_PW" "$SMB_PW" | smbpasswd -s -a "$KIT_SAMBA_USER" >/dev/null 2>&1 || true
  smbpasswd -e "$KIT_SAMBA_USER" >/dev/null 2>&1 || true
  printf 'SAMBA_USER=%s\nSAMBA_PASS=%s\n' "$KIT_SAMBA_USER" "$SMB_PW" >> /root/.alo-secrets/samba-credentials.txt
  chmod 0600 /root/.alo-secrets/samba-credentials.txt
fi

SMB_CONF=/etc/samba/smb.conf
backup_file "$SMB_CONF"
# Security: /var/backups/alo-db is intentionally EXCLUDED from Samba shares so
# full pg_dumpall / mysqldump database archives are never exposed over LAN SMB.
write_file "$SMB_CONF" root:root 0644 <<EOF
[global]
   workgroup = ALO
   server string = $KIT_HOSTNAME Samba
   security = user
   map to guest = never
   hosts allow = ${KIT_LAN_CIDR} 127.0.0.1
   hosts deny = ALL
   log file = /var/log/samba/log.%m
   max log size = 1000
   logging = systemd
   server min protocol = SMB3
   smb encrypt = desired
   server role = standalone

[documents]
   comment = Shared Documents
   path = ${SHARED_ROOT}/documents
   browseable = yes
   read only = no
   valid users = ${KIT_SAMBA_USER}
   force group = ${KIT_PRIMARY_USER}
   create mask = 0660
   directory mask = 0770

[projects]
   comment = Shared Projects
   path = ${SHARED_ROOT}/projects
   browseable = yes
   read only = no
   valid users = ${KIT_SAMBA_USER}
   force group = ${KIT_PRIMARY_USER}
   create mask = 0660
   directory mask = 0770
EOF
systemctl enable --now smbd nmbd
systemctl restart smbd nmbd

log "configure Nginx /syncthing/ proxy (LAN-only + basic auth)"
if [[ ! -f /etc/nginx/.htpasswd-syncthing ]]; then
  ST_HTTP_PW="${KIT_HTTP_BASIC_PASS:-$(openssl rand -base64 18 | tr -d '/+=')}"
  htpasswd -bc /etc/nginx/.htpasswd-syncthing "$KIT_SAMBA_USER" "$ST_HTTP_PW" >/dev/null 2>&1
  chown root:www-data /etc/nginx/.htpasswd-syncthing
  chmod 0640 /etc/nginx/.htpasswd-syncthing
  printf 'SYNCTHING_BASIC_AUTH_USER=%s\nSYNCTHING_BASIC_AUTH_PASS=%s\n' "$KIT_SAMBA_USER" "$ST_HTTP_PW" >> /root/.alo-secrets/http-basic-auth.txt
  chmod 0600 /root/.alo-secrets/http-basic-auth.txt
fi

write_file /etc/nginx/snippets/alo-syncthing.conf root:root 0644 <<EOF
location /syncthing/ {
    allow 127.0.0.1;
    allow ${KIT_LAN_CIDR};
    allow 100.64.0.0/10;
    deny all;
    auth_basic "Syncthing";
    auth_basic_user_file /etc/nginx/.htpasswd-syncthing;
    proxy_pass http://127.0.0.1:${KIT_SYNCTHING_PORT:-8384}/;
    proxy_http_version 1.1;
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
    proxy_set_header Upgrade \$http_upgrade;
    proxy_set_header Connection "upgrade";
}
EOF
DEFAULT_SITE=/etc/nginx/sites-available/alo-default
if [[ -f "$DEFAULT_SITE" ]] && ! grep -q "alo-syncthing.conf" "$DEFAULT_SITE"; then
  sed -i '/include \/etc\/nginx\/snippets\/alo-netdata.conf;/a\    include /etc/nginx/snippets/alo-syncthing.conf;' "$DEFAULT_SITE"
fi
nginx -t && systemctl reload nginx

mark_done "$STAGE"; log "✓ $STAGE complete"
