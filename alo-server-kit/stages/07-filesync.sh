#!/usr/bin/env bash
set -Eeuo pipefail
source "$(dirname "$0")/../lib/common.sh"
require_root
STAGE="07-filesync"; log "▶ $STAGE starting"
USER_HOME=$(getent passwd "$KIT_PRIMARY_USER" | cut -d: -f6)
SHARED_ROOT="$USER_HOME/shared"
install -d -m 0755 -o "$KIT_PRIMARY_USER" -g "$KIT_PRIMARY_USER" \
  "$SHARED_ROOT/documents" "$SHARED_ROOT/projects" "$SHARED_ROOT/backups"

log "install Syncthing"
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

log "install Samba (LAN-only RW documents/projects, RO backups)"
ensure_pkg samba samba-common-bin cifs-utils
if ! pdbedit -L | grep -qx "$KIT_SAMBA_USER"; then
  log "create Samba user '$KIT_SAMBA_USER'"
  smbpasswd -a "$KIT_SAMBA_USER" || true
  smbpasswd -e "$KIT_SAMBA_USER" >/dev/null
fi

SMB_CONF=/etc/samba/smb.conf
backup_file "$SMB_CONF"
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
   server min protocol = SMB2
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

[backups]
   comment = DB Backups (READ-ONLY)
   path = /var/backups/alo-db
   browseable = yes
   read only = yes
   guest ok = no
   valid users = ${KIT_SAMBA_USER}
EOF
systemctl enable --now smbd nmbd
systemctl restart smbd nmbd

log "configure Nginx /syncthing/ proxy (LAN-only + basic auth)"
if [[ ! -f /etc/nginx/.htpasswd-syncthing ]]; then
  echo "Create a password for Syncthing basic-auth user '${KIT_SAMBA_USER}':"
  htpasswd -c /etc/nginx/.htpasswd-syncthing "$KIT_SAMBA_USER"
fi
write_file /etc/nginx/snippets/alo-syncthing.conf root:root 0644 <<'EOF'
location /syncthing/ {
    allow 192.168.0.0/24;
    allow 100.64.0.0/10;
    deny all;
    auth_basic "Syncthing";
    auth_basic_user_file /etc/nginx/.htpasswd-syncthing;
    proxy_pass http://127.0.0.1:8384/;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
}
EOF
DEFAULT_SITE=/etc/nginx/sites-available/alo-default
if ! grep -q "alo-syncthing.conf" "$DEFAULT_SITE"; then
  sed -i '/include \/etc\/nginx\/snippets\/alo-netdata.conf;/a\    include /etc/nginx/snippets/alo-syncthing.conf;' "$DEFAULT_SITE"
fi
nginx -t && systemctl reload nginx

mark_done "$STAGE"; log "✓ $STAGE complete"
