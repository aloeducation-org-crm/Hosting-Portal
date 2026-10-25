#!/usr/bin/env python3
"""Write all 8 alo-server-kit stage scripts + helper scripts in one pass."""
import os
from pathlib import Path

KIT = Path("/home/z/my-project/alo-server-kit")
STAGES = KIT / "stages"
SCRIPTS = KIT / "scripts"
STAGES.mkdir(parents=True, exist_ok=True)
SCRIPTS.mkdir(parents=True, exist_ok=True)

HEADER = '''#!/usr/bin/env bash
set -Eeuo pipefail
source "$(dirname "$0")/../lib/common.sh"
'''

# --- Stage 00 ---
(STAGES / "00-preflight.sh").write_text(HEADER + '''require_root
STAGE="00-preflight"; log "▶ $STAGE starting"

log "apt update + base utilities"
apt-get -y update >/dev/null
ensure_pkg ca-certificates curl wget gnupg lsb-release apt-transport-https \\
           software-properties-common build-essential git rsync unzip jq \\
           htop iotop iftop ncdu tree vim less ufw fail2ban \\
           python3 python3-pip python3-venv python3-full pipx \\
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
printf 'vm.swappiness=10\\nvm.vfs_cache_pressure=50\\n' > /etc/sysctl.d/99-alo.conf

log "enable unattended-upgrades (security only)"
cat >/etc/apt/apt.conf.d/20auto-upgrades <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT::Periodic::AutocleanInterval "7";
EOF
grep -q 'Automatic-Reboot-Time' /etc/apt/apt.conf.d/50unattended-upgrades || \\
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
''')

# --- Stage 01 ---
(STAGES / "01-security.sh").write_text(HEADER + '''require_root
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
sed -i '/^#\\?Port /d' "$SSHD"
sed -i '1i Port 22\\nPort '"$SSH_PORT"'' "$SSHD"

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
  sed -i "/^#\\?\\s*${k}\\s\\+/d" "$SSHD"
  printf '%s %s\\n' "$k" "${OPTS[$k]}" >> "$SSHD"
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
''')

# --- Stage 02 ---
(STAGES / "02-webapp.sh").write_text(HEADER + '''require_root
STAGE="02-webapp"; log "▶ $STAGE starting"
USER_HOME=$(getent passwd "$KIT_PRIMARY_USER" | cut -d: -f6)
NVM_DIR="$USER_HOME/.nvm"

if ! sudo -u "$KIT_PRIMARY_USER" [[ -d "$NVM_DIR" ]]; then
  log "installing NVM as $KIT_PRIMARY_USER"
  sudo -u "$KIT_PRIMARY_USER" bash -c 'curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash'
fi
log "installing Node LTS ($KIT_NODE_LTS) via NVM"
sudo -u "$KIT_PRIMARY_USER" bash -lc "
  source '$NVM_DIR/nvm.sh'
  nvm install --lts '$KIT_NODE_LTS'
  nvm alias default '$KIT_NODE_LTS'
  nvm use --silent default
  npm config set fund false
  npm config set audit false
  npm install -g pm2@latest
"
install -d /usr/local/bin
cat >/usr/local/bin/node <<EOF
#!/bin/sh
exec sudo -u $KIT_PRIMARY_USER bash -lc 'source $NVM_DIR/nvm.sh && exec node "\\$@"'
EOF
chmod +x /usr/local/bin/node
cat >/usr/local/bin/pm2 <<EOF
#!/bin/sh
exec sudo -u $KIT_PRIMARY_USER bash -lc 'source $NVM_DIR/nvm.sh && exec pm2 "\\$@"'
EOF
chmod +x /usr/local/bin/pm2

log "install PM2 systemd unit"
NODE_BIN=$(ls $NVM_DIR/versions/node 2>/dev/null | tail -1)
write_file /etc/systemd/system/pm2-${KIT_PRIMARY_USER}.service root:root 0644 <<EOF
[Unit]
Description=PM2 process manager for $KIT_PRIMARY_USER
After=network.target

[Service]
Type=forking
User=$KIT_PRIMARY_USER
Environment=PATH=/usr/local/bin:/usr/bin:/bin:$NVM_DIR/versions/node/$NODE_BIN/bin
Environment=PM2_HOME=$USER_HOME/.pm2
ExecStart=$NVM_DIR/versions/node/$NODE_BIN/bin/pm2 resurrect
ExecStop=$NVM_DIR/versions/node/$NODE_BIN/bin/pm2 kill
ExecReload=$NVM_DIR/versions/node/$NODE_BIN/bin/pm2 reload all
Restart=on-failure

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable pm2-${KIT_PRIMARY_USER} || true

log "install Nginx + security headers"
ensure_pkg nginx
install -d -m 0755 /etc/nginx/sites-enabled /etc/nginx/snippets
write_file /etc/nginx/snippets/alo-security.conf root:root 0644 <<'EOF'
add_header X-Frame-Options "SAMEORIGIN" always;
add_header X-Content-Type-Options "nosniff" always;
add_header X-XSS-Protection "1; mode=block" always;
add_header Referrer-Policy "strict-origin-when-cross-origin" always;
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
add_header Permissions-Policy "camera=(), microphone=(), geolocation=()" always;
add_header Content-Security-Policy "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; connect-src 'self'; object-src 'none'; frame-ancestors 'self'; base-uri 'self'; form-action 'self';" always;
server_tokens off;
client_max_body_size 25m;
EOF

write_file /etc/nginx/conf.d/alo-upstream.conf root:root 0644 <<EOF
upstream alo_nextjs {
    least_conn;
    server 127.0.0.1:3000;
    server 127.0.0.1:3001;
    keepalive 32;
}
EOF

write_file /etc/nginx/sites-available/alo-default root:root 0644 <<EOF
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name _ ${KIT_DOMAIN};
    root $KIT_NGINX_WEBROOT;
    index index.html;
    include /etc/nginx/snippets/alo-security.conf;
    location /.well-known/acme-challenge/ { root /var/www/letsencrypt; }
    location / { try_files \\$uri \\$uri/ =404; }
    location @nextjs {
        proxy_pass http://alo_nextjs;
        proxy_http_version 1.1;
        proxy_set_header Host \\$host;
        proxy_set_header X-Real-IP \\$remote_addr;
        proxy_set_header X-Forwarded-For \\$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \\$scheme;
        proxy_set_header Upgrade \\$http_upgrade;
        proxy_set_header Connection 'upgrade';
    }
}
EOF
ln -sf /etc/nginx/sites-available/alo-default /etc/nginx/sites-enabled/alo-default
rm -f /etc/nginx/sites-enabled/default
nginx -t || die "nginx config invalid"
systemctl enable --now nginx
systemctl reload nginx

log "install certbot"
ensure_pkg certbot python3-certbot-nginx
install -d -m 0755 /var/www/letsencrypt
cat >/usr/local/bin/alo-issue-tls.sh <<'EOF'
#!/usr/bin/env bash
set -Eeuo pipefail
source /home/z/my-project/alo-server-kit/lib/common.sh 2>/dev/null || true
DOMAIN="${KIT_DOMAIN:-alo.example.com}"
EMAIL="${KIT_ADMIN_EMAIL:-alamin@example.com}"
certbot certonly --webroot -w /var/www/letsencrypt -d "$DOMAIN" --email "$EMAIL" --agree-tos --no-eff-email --non-interactive
certbot --nginx -d "$DOMAIN" --redirect --non-interactive --keep-until-expiring
systemctl reload nginx
echo "TLS issued for $DOMAIN"
EOF
chmod +x /usr/local/bin/alo-issue-tls.sh

log "enforce python venv-only (PEP 668)"
ensure_pkg python3-venv python3-full pipx
if [[ ! -f /usr/lib/python3/dist-packages/EXTERNALLY-MANAGED ]]; then
  write_file /usr/lib/python3/dist-packages/EXTERNALLY-MANAGED root:root 0644 <<'EOF'
[externally-managed]
Error=This system Python is managed by apt. Use a venv: python3 -m venv .venv && source .venv/bin/activate
EOF
fi
sudo -u "$KIT_PRIMARY_USER" pipx ensurepath >/dev/null 2>&1 || true

log "deploying demo Next.js app"
APP_DIR="$KIT_APP_DIR"
install -d -m 0755 -o "$KIT_PRIMARY_USER" -g "$KIT_PRIMARY_USER" "$APP_DIR"
if sudo -u "$KIT_PRIMARY_USER" [[ ! -d "$APP_DIR/.git" ]] && [[ -d "$KIT_ROOT/demo-app" ]]; then
  sudo -u "$KIT_PRIMARY_USER" bash -lc "
    cp -r '$KIT_ROOT/demo-app' '$APP_DIR'
    cd '$APP_DIR'
    source $NVM_DIR/nvm.sh
    npm ci --omit=dev
    npm run build
  "
fi

write_file "$APP_DIR/ecosystem.config.cjs" "$KIT_PRIMARY_USER:$KIT_PRIMARY_USER" 0644 <<EOF
module.exports = {
  apps: [{
    name: 'alo-nextjs',
    script: './.next/standalone/server.js',
    instances: ${KIT_PM2_INSTANCES},
    exec_mode: 'cluster',
    max_memory_restart: '512M',
    env: { NODE_ENV: 'production', PORT: 3000, HOST: '127.0.0.1' },
    error_file: '$USER_HOME/.pm2/logs/alo-nextjs-err.log',
    out_file: '$USER_HOME/.pm2/logs/alo-nextjs-out.log',
    time: true
  }]
};
EOF

sudo -u "$KIT_PRIMARY_USER" bash -lc "
  source $NVM_DIR/nvm.sh
  cd $APP_DIR
  pm2 startOrReload ecosystem.config.cjs
  pm2 save
"
systemctl restart pm2-${KIT_PRIMARY_USER} || true

mark_done "$STAGE"; log "✓ $STAGE complete"
''')

# --- Stage 03 ---
(STAGES / "03-databases.sh").write_text(HEADER + '''require_root
STAGE="03-databases"; log "▶ $STAGE starting"
BACKUP_ROOT="/var/backups/alo-db"
install -d -m 0750 -o root -g root "$BACKUP_ROOT"/{daily,weekly,monthly}

log "install PostgreSQL ${KIT_PG_VERSION}"
ensure_pkg postgresql-${KIT_PG_VERSION} postgresql-contrib-${KIT_PG_VERSION}
PG_HBA=$(find /etc/postgresql -name pg_hba.conf 2>/dev/null | head -1)
PG_CONF=$(find /etc/postgresql -name postgresql.conf 2>/dev/null | head -1)
backup_file "$PG_HBA"; backup_file "$PG_CONF"
sed -i 's/^#\\?password_encryption.*/password_encryption = scram-sha-256/' "$PG_CONF"
LAN_IP_RANGE=$(echo "$KIT_LAN_CIDR" | awk -F/ '{print $1"/"$2}')
cat > "$PG_HBA" <<EOF
# TYPE  DATABASE        USER            ADDRESS                 METHOD
local   all             postgres                                peer
local   all             all                                     scram-sha-256
host    all             all             127.0.0.1/32            scram-sha-256
host    all             all             ::1/128                 scram-sha-256
host    ${KIT_PG_APP_DB} ${KIT_PG_APP_USER} ${LAN_IP_RANGE}    scram-sha-256
host    all             all             0.0.0.0/0               reject
EOF
sed -i "s|^#\\?listen_addresses.*|listen_addresses = 'localhost'|" "$PG_CONF"
systemctl enable --now postgresql
systemctl reload postgresql

PGPW=$(openssl rand -base64 24 | tr -d '/+=' | head -c 28)
sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='${KIT_PG_APP_USER}'" | grep -q 1 || \\
  sudo -u postgres psql -c "CREATE ROLE ${KIT_PG_APP_USER} LOGIN PASSWORD '${PGPW}';"
sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='${KIT_PG_APP_DB}'" | grep -q 1 || \\
  sudo -u postgres psql -c "CREATE DATABASE ${KIT_PG_APP_DB} OWNER ${KIT_PG_APP_USER};"
sudo -u postgres psql -c "ALTER ROLE ${KIT_PG_APP_USER} PASSWORD '${PGPW}';" >/dev/null

install -d -m 0700 -o root -g root /root/.alo-secrets
write_file /root/.alo-secrets/postgres-app.txt root:root 0600 <<EOF
# PostgreSQL app credentials
PGUSER=${KIT_PG_APP_USER}
PGPASSWORD=${PGPW}
PGDATABASE=${KIT_PG_APP_DB}
PGHOST=127.0.0.1
PGPORT=5432
EOF
log "PG app creds saved to /root/.alo-secrets/postgres-app.txt"

log "install MySQL 8"
if ! pkg_installed mysql-server; then
  DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends mysql-server >/dev/null
fi
MYSQL_CNF=/etc/mysql/mysql.conf.d/mysqld.cnf
backup_file "$MYSQL_CNF"
sed -i 's/^#\\?bind-address.*/bind-address = 127.0.0.1/' "$MYSQL_CNF"
grep -q '^bind-address' "$MYSQL_CNF" || echo 'bind-address = 127.0.0.1' >> "$MYSQL_CNF"
systemctl enable --now mysql

mysql <<'SQL'
INSTALL COMPONENT 'file://component_validate_password';
SET GLOBAL validate_password.policy = 'MEDIUM';
SET GLOBAL validate_password.length = 12;
SET GLOBAL validate_password.mixed_case_count = 1;
SET GLOBAL validate_password.number_count = 1;
SET GLOBAL validate_password.special_char_count = 1;
SQL

mysql <<'SQL'
UPDATE mysql.user SET Host='localhost' WHERE User='root' AND Host != 'localhost';
DELETE FROM mysql.user WHERE User='root' AND Host != 'localhost';
FLUSH PRIVILEGES;
SQL

MYPW=$(openssl rand -base64 24 | tr -d '/+=' | head -c 28)
mysql -e "CREATE DATABASE IF NOT EXISTS ${KIT_MYSQL_APP_DB} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
mysql -e "CREATE USER IF NOT EXISTS '${KIT_MYSQL_APP_USER}'@'%' IDENTIFIED BY '${MYPW}';" || true
mysql -e "ALTER USER '${KIT_MYSQL_APP_USER}'@'%' IDENTIFIED BY '${MYPW}';"
mysql -e "GRANT ALL PRIVILEGES ON ${KIT_MYSQL_APP_DB}.* TO '${KIT_MYSQL_APP_USER}'@'%'; FLUSH PRIVILEGES;"

write_file /root/.alo-secrets/mysql-app.txt root:root 0600 <<EOF
# MySQL app credentials
MYSQL_USER=${KIT_MYSQL_APP_USER}
MYSQL_PASSWORD=${MYPW}
MYSQL_DATABASE=${KIT_MYSQL_APP_DB}
MYSQL_HOST=127.0.0.1
MYSQL_PORT=3306
EOF

log "installing db backup + rotation"
install -d -m 0755 /usr/local/sbin
cat >/usr/local/sbin/alo-db-backup.sh <<'EOF'
#!/usr/bin/env bash
set -Eeuo pipefail
BACKUP_ROOT=/var/backups/alo-db
TS=$(date +%Y%m%d-%H%M%S)
install -d "$BACKUP_ROOT/daily" "$BACKUP_ROOT/weekly" "$BACKUP_ROOT/monthly"
if command -v pg_dumpall >/dev/null; then
  sudo -u postgres pg_dumpall | gzip -c > "$BACKUP_ROOT/daily/pg-all-$TS.sql.gz"
fi
if command -v mysqldump >/dev/null; then
  mysqldump --all-databases --single-transaction --routines --triggers | gzip -c > "$BACKUP_ROOT/daily/mysql-all-$TS.sql.gz"
fi
find "$BACKUP_ROOT/daily" -type f -mtime +7 -delete
DOW=$(date +%u); DOM=$(date +%-d)
if [[ "$DOW" == "7" ]]; then cp -a "$BACKUP_ROOT/daily/"*-"$TS".* "$BACKUP_ROOT/weekly/" 2>/dev/null || true; fi
if [[ "$DOM" == "1" ]]; then cp -a "$BACKUP_ROOT/daily/"*-"$TS".* "$BACKUP_ROOT/monthly/" 2>/dev/null || true; fi
find "$BACKUP_ROOT/weekly"  -type f -mtime +30  -delete
find "$BACKUP_ROOT/monthly" -type f -mtime +365 -delete
EOF
chmod +x /usr/local/sbin/alo-db-backup.sh
write_file /etc/cron.d/alo-db-backup root:root 0644 <<'EOF'
30 2 * * * root /usr/local/sbin/alo-db-backup.sh >> /var/log/alo-db-backup.log 2>&1
EOF
systemctl reload cron || true

mark_done "$STAGE"; log "✓ $STAGE complete"
''')

# --- Stage 04 ---
(STAGES / "04-ai-infra.sh").write_text(HEADER + '''require_root
STAGE="04-ai-infra"; log "▶ $STAGE starting"
USER_HOME=$(getent passwd "$KIT_PRIMARY_USER" | cut -d: -f6)
LITELLM_DIR="/opt/litellm"; OUI_DIR="/opt/open-webui"

log "installing Ollama (localhost-only, MemoryMax=${KIT_OLLAMA_MEM_MAX})"
if ! command -v ollama >/dev/null; then
  curl -fsSL https://ollama.com/install.sh | sh
fi
OllamaSVC=/etc/systemd/system/ollama.service
if [[ -f "$OllamaSVC" ]]; then
  backup_file "$OllamaSVC"
  if ! grep -q "MemoryMax=" "$OllamaSVC"; then
    sed -i '/^\\[Service\\]/a MemoryMax='"$KIT_OLLAMA_MEM_MAX"'\\nCPUQuota=200%\\nTasksMax=512\\nNoNewPrivileges=yes\\nProtectSystem=strict\\nProtectHome=yes\\nReadWritePaths=/usr/share/ollama /var/log' "$OllamaSVC"
  fi
  if ! grep -q 'OLLAMA_HOST=' "$OllamaSVC"; then
    sed -i '/^\\[Service\\]/a Environment="OLLAMA_HOST=127.0.0.1:'"$KIT_OLLAMA_PORT"'"' "$OllamaSVC"
  fi
fi
systemctl daemon-reload
systemctl enable --now ollama

log "pulling Ollama models: $KIT_OLLAMA_MODELS"
for m in $KIT_OLLAMA_MODELS; do
  if ! ollama list 2>/dev/null | awk '{print $1}' | grep -qx "$m"; then
    ollama pull "$m"
  fi
done

log "installing LiteLLM proxy"
install -d -m 0755 -o "$KIT_PRIMARY_USER" -g "$KIT_PRIMARY_USER" "$LITELLM_DIR"
if [[ ! -d "$LITELLM_DIR/venv" ]]; then
  python3 -m venv "$LITELLM_DIR/venv"
fi
chown -R "$KIT_PRIMARY_USER:$KIT_PRIMARY_USER" "$LITELLM_DIR"
sudo -u "$KIT_PRIMARY_USER" "$LITELLM_DIR/venv/bin/pip" install --quiet --upgrade pip
sudo -u "$KIT_PRIMARY_USER" "$LITELLM_DIR/venv/bin/pip" install --quiet 'litellm[proxy]==1.52.0' 'uvicorn[standard]' 'fastapi' 'gunicorn'

TEMPLATE="$KIT_ROOT/configs/litellm/config.yaml.tpl"
if [[ -f "$TEMPLATE" ]] && command -v envsubst >/dev/null; then
  envsubst < "$TEMPLATE" > "$LITELLM_DIR/config.yaml"
  chown "$KIT_PRIMARY_USER:$KIT_PRIMARY_USER" "$LITELLM_DIR/config.yaml"
  chmod 0600 "$LITELLM_DIR/config.yaml"
fi

write_file /etc/systemd/system/litellm.service root:root 0644 <<EOF
[Unit]
Description=LiteLLM Proxy (OpenAI-compatible gateway)
After=network.target ollama.service

[Service]
Type=simple
User=$KIT_PRIMARY_USER
Group=$KIT_PRIMARY_USER
WorkingDirectory=$LITELLM_DIR
ExecStart=$LITELLM_DIR/venv/bin/litellm --config $LITELLM_DIR/config.yaml --host 127.0.0.1 --port ${KIT_LITELLM_PORT}
Restart=on-failure
RestartSec=5s
MemoryMax=1G
NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=yes
ReadWritePaths=$LITELLM_DIR

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable --now litellm

log "installing Open WebUI on :${KIT_OPENWEBUI_PORT}"
install -d -m 0755 -o "$KIT_PRIMARY_USER" -g "$KIT_PRIMARY_USER" "$OUI_DIR"
if [[ ! -d "$OUI_DIR/venv" ]]; then python3 -m venv "$OUI_DIR/venv"; fi
chown -R "$KIT_PRIMARY_USER:$KIT_PRIMARY_USER" "$OUI_DIR"
sudo -u "$KIT_PRIMARY_USER" "$OUI_DIR/venv/bin/pip" install --quiet --upgrade pip
sudo -u "$KIT_PRIMARY_USER" "$OUI_DIR/venv/bin/pip" install --quiet open-webui

write_file /etc/systemd/system/open-webui.service root:root 0644 <<EOF
[Unit]
Description=Open WebUI
After=network.target litellm.service

[Service]
Type=simple
User=$KIT_PRIMARY_USER
Group=$KIT_PRIMARY_USER
WorkingDirectory=$OUI_DIR
Environment=WEBUI_AUTH=true
Environment=OPENAI_API_BASE_URL=http://127.0.0.1:${KIT_LITELLM_PORT}
Environment=OPENAI_API_KEY=${KIT_LITELLM_MASTER_KEY}
Environment=OLLAMA_API_BASE_URL=http://127.0.0.1:${KIT_OLLAMA_PORT}
ExecStart=$OUI_DIR/venv/bin/open-webui serve --host 127.0.0.1 --port ${KIT_OPENWEBUI_PORT}
Restart=on-failure
RestartSec=5s
MemoryMax=2G

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable --now open-webui

log "configure Nginx /ai/ -> LiteLLM (basic auth)"
ensure_pkg apache2-utils
if [[ ! -f /etc/nginx/.htpasswd-ai ]]; then
  echo "Create a password for the LiteLLM basic-auth user '${KIT_PRIMARY_USER}':"
  htpasswd -c /etc/nginx/.htpasswd-ai "$KIT_PRIMARY_USER"
fi

write_file /etc/nginx/snippets/alo-litellm.conf root:root 0644 <<'EOF'
location /ai/ {
    auth_basic "LiteLLM Gateway";
    auth_basic_user_file /etc/nginx/.htpasswd-ai;
    proxy_pass http://127.0.0.1:4000/;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_buffering off;
    proxy_read_timeout 300s;
    proxy_send_timeout 300s;
}
EOF

DEFAULT_SITE=/etc/nginx/sites-available/alo-default
if ! grep -q "alo-litellm.conf" "$DEFAULT_SITE"; then
  sed -i '/location @nextjs/i\\    include /etc/nginx/snippets/alo-litellm.conf;\\n' "$DEFAULT_SITE"
fi
nginx -t && systemctl reload nginx

mark_done "$STAGE"; log "✓ $STAGE complete"
''')

# --- Stage 05 ---
(STAGES / "05-ai-tools.sh").write_text(HEADER + '''[[ $EUID -eq 0 ]] || exec sudo -E bash "$0" "$@"
STAGE="05-ai-tools"; log "▶ $STAGE starting"
USER_HOME=$(getent passwd "$KIT_PRIMARY_USER" | cut -d: -f6)

log "install VS Code"
if ! command -v code >/dev/null; then
  curl -fsSL https://packages.microsoft.com/keys/microsoft.asc | gpg --dearmor -o /usr/share/keyrings/microsoft.gpg
  echo "deb [arch=amd64,arm64 signed-by=/usr/share/keyrings/microsoft.gpg] https://packages.microsoft.com/repos/code stable main" > /etc/apt/sources.list.d/vscode.list
  apt-get -y update >/dev/null
  ensure_pkg code
fi

log "install Aider via pipx"
sudo -u "$KIT_PRIMARY_USER" pipx install aider-chat >/dev/null 2>&1 || sudo -u "$KIT_PRIMARY_USER" pipx upgrade aider-chat
install -d -m 0755 -o "$KIT_PRIMARY_USER" -g "$KIT_PRIMARY_USER" "$USER_HOME/.aider/conf.d"
write_file "$USER_HOME/.aider/conf.d/alo.yml" "$KIT_PRIMARY_USER:$KIT_PRIMARY_USER" 0644 <<EOF
model: openai/qwen2.5:7b
openai-api-base: http://127.0.0.1:${KIT_LITELLM_PORT}
openai-api-key: ${KIT_LITELLM_MASTER_KEY}
edit-format: diff
auto-commits: true
auto-lint: true
EOF

log "install VS Code extensions"
sudo -u "$KIT_PRIMARY_USER" bash -lc 'code --install-extension continue.continue --force 2>/dev/null || true'
sudo -u "$KIT_PRIMARY_USER" bash -lc 'code --install-extension saoudrizwan.claude-dev --force 2>/dev/null || true'

CONTINUE_DIR="$USER_HOME/.continue"
install -d -m 0755 -o "$KIT_PRIMARY_USER" -g "$KIT_PRIMARY_USER" "$CONTINUE_DIR"
write_file "$CONTINUE_DIR/config.json" "$KIT_PRIMARY_USER:$KIT_PRIMARY_USER" 0644 <<EOF
{
  "models": [
    {"title": "ALO LiteLLM (qwen2.5)", "provider": "openai", "model": "qwen2.5:7b",
     "apiBase": "http://127.0.0.1:${KIT_LITELLM_PORT}/v1", "apiKey": "${KIT_LITELLM_MASTER_KEY}"},
    {"title": "ALO LiteLLM (llama3.1)", "provider": "openai", "model": "llama3.1:8b",
     "apiBase": "http://127.0.0.1:${KIT_LITELLM_PORT}/v1", "apiKey": "${KIT_LITELLM_MASTER_KEY}"},
    {"title": "ALO LiteLLM (gemini)", "provider": "openai", "model": "gemini-1.5-flash",
     "apiBase": "http://127.0.0.1:${KIT_LITELLM_PORT}/v1", "apiKey": "${KIT_LITELLM_MASTER_KEY}"}
  ],
  "tabAutocompleteModel": {"title": "ALO Codellama", "provider": "openai", "model": "codellama:7b",
    "apiBase": "http://127.0.0.1:${KIT_LITELLM_PORT}/v1", "apiKey": "${KIT_LITELLM_MASTER_KEY}"},
  "allowAnonymousTelemetry": false
}
EOF

CLINE_DIR="$USER_HOME/.config/Code/User/globalStorage/saoudrizwan.claude-dev/settings"
install -d -m 0755 -o "$KIT_PRIMARY_USER" -g "$KIT_PRIMARY_USER" "$CLINE_DIR"
write_file "$CLINE_DIR/alo-litellm.json" "$KIT_PRIMARY_USER:$KIT_PRIMARY_USER" 0644 <<EOF
{
  "apiProvider": "openai",
  "openAiBaseUrl": "http://127.0.0.1:${KIT_LITELLM_PORT}/v1",
  "openAiApiKey": "${KIT_LITELLM_MASTER_KEY}",
  "openAiModelId": "qwen2.5:7b",
  "openAiCustomModelInfo": {"maxTokens": 32768, "contextWindow": 32768, "supportsImages": false, "supportsComputerUse": false}
}
EOF

mark_done "$STAGE"; log "✓ $STAGE complete"
''')

# --- Stage 06 ---
(STAGES / "06-ops.sh").write_text(HEADER + '''require_root
STAGE="06-ops"; log "▶ $STAGE starting"

log "install Netdata (kickstart, bind 127.0.0.1)"
if ! command -v netdata >/dev/null; then
  curl -fsSL https://get.netdata.cloud/kickstart.sh | bash -s -- --dont-wait --disable-telemetry --stable-channel
fi
NETDATA_CONF=/etc/netdata/netdata.conf
if [[ -f "$NETDATA_CONF" ]]; then
  backup_file "$NETDATA_CONF"
  if ! grep -q 'bind to' "$NETDATA_CONF"; then
    printf '\\n[web]\\n    bind to = 127.0.0.1:%s\\n' "$KIT_NETDATA_PORT" >> "$NETDATA_CONF"
  else
    sed -i "s|^\\s*# bind to.*|    bind to = 127.0.0.1:${KIT_NETDATA_PORT}|" "$NETDATA_CONF"
  fi
fi
systemctl enable --now netdata
systemctl restart netdata || true

if [[ ! -f /etc/nginx/.htpasswd-netdata ]]; then
  echo "Create a password for Netdata basic-auth user '${KIT_PRIMARY_USER}':"
  htpasswd -c /etc/nginx/.htpasswd-netdata "$KIT_PRIMARY_USER"
fi
write_file /etc/nginx/snippets/alo-netdata.conf root:root 0644 <<'EOF'
location /netdata/ {
    allow 192.168.0.0/24;
    allow 100.64.0.0/10;
    deny all;
    auth_basic "Netdata";
    auth_basic_user_file /etc/nginx/.htpasswd-netdata;
    proxy_pass http://127.0.0.1:19999/;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
EOF
DEFAULT_SITE=/etc/nginx/sites-available/alo-default
if ! grep -q "alo-netdata.conf" "$DEFAULT_SITE"; then
  sed -i '/include \\/etc\\/nginx\\/snippets\\/alo-litellm.conf;/a\\    include /etc/nginx/snippets/alo-netdata.conf;' "$DEFAULT_SITE"
fi
nginx -t && systemctl reload nginx

log "install health-check cron"
install -d -m 0755 /usr/local/sbin
cat >/usr/local/sbin/alo-healthcheck.sh <<'EOF'
#!/usr/bin/env bash
set -Eeuo pipefail
source /home/z/my-project/alo-server-kit/lib/common.sh 2>/dev/null || true
HOST="${KIT_HOSTNAME:-alo-server-lap}"
TG="${KIT_TELEGRAM_BOT_TOKEN:-}"; TG_CHAT="${KIT_TELEGRAM_CHAT_ID:-}"
fail() {
  local msg="⚠️ *${HOST} health* failure: $1"
  echo "$msg"
  if [[ -n "$TG" && -n "$TG_CHAT" ]]; then
    curl -sS -X POST "https://api.telegram.org/bot${TG}/sendMessage" -d chat_id="$TG_CHAT" -d text="$msg" -d parse_mode=Markdown >/dev/null
  fi
}
for svc in ssh nginx postgresql mysql pm2-${KIT_PRIMARY_USER:-alamin} litellm ollama open-webui netdata; do
  systemctl is-active --quiet "$svc" 2>/dev/null || fail "service $svc not active"
done
while read -r line; do
  usage=$(echo "$line" | awk '{print $5}' | tr -d '%')
  mnt=$(echo "$line" | awk '{print $6}')
  if [[ "${usage:-0}" -gt 90 ]]; then fail "disk $mnt at ${usage}%"; fi
done < <(df -h | awk 'NR>1 && /^\\/dev\\//')
swap_used=$(free -m | awk '/^Swap/ {print int($3/($2+1)*100)}')
if [[ "${swap_used:-0}" -gt 80 ]]; then fail "swap usage ${swap_used}%"; fi
if ! curl -fsS http://127.0.0.1:11434/api/tags >/dev/null 2>&1; then fail "Ollama API not responding"; fi
if ! curl -fsS http://127.0.0.1:4000/health/liveness >/dev/null 2>&1; then fail "LiteLLM health endpoint down"; fi
EOF
chmod +x /usr/local/sbin/alo-healthcheck.sh
write_file /etc/cron.d/alo-healthcheck root:root 0644 <<'EOF'
*/5 * * * * root /usr/local/sbin/alo-healthcheck.sh >> /var/log/alo-healthcheck.log 2>&1
EOF

log "deploy CI/CD script: /usr/local/sbin/alo-deploy.sh"
cat >/usr/local/sbin/alo-deploy.sh <<EOF
#!/usr/bin/env bash
set -Eeuo pipefail
APP_DIR=${KIT_APP_DIR:-/srv/alo-app}
USER=${KIT_PRIMARY_USER:-alamin}
NVM_DIR="/home/\\$USER/.nvm"
cd "\$APP_DIR" || exit 1
sudo -u "\$USER" bash -lc "
  source \$NVM_DIR/nvm.sh
  git fetch --all
  git reset --hard origin/main
  npm ci --omit=dev
  npm run build
  pm2 reload ecosystem.config.cjs --update-env
  pm2 save
"
echo "[\$(date -Iseconds)] deploy complete"
EOF
chmod +x /usr/local/sbin/alo-deploy.sh

mark_done "$STAGE"; log "✓ $STAGE complete"
''')

# --- Stage 07 ---
(STAGES / "07-filesync.sh").write_text(HEADER + '''require_root
STAGE="07-filesync"; log "▶ $STAGE starting"
USER_HOME=$(getent passwd "$KIT_PRIMARY_USER" | cut -d: -f6)
SHARED_ROOT="$USER_HOME/shared"
install -d -m 0755 -o "$KIT_PRIMARY_USER" -g "$KIT_PRIMARY_USER" \\
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
  sed -i '/include \\/etc\\/nginx\\/snippets\\/alo-netdata.conf;/a\\    include /etc/nginx/snippets/alo-syncthing.conf;' "$DEFAULT_SITE"
fi
nginx -t && systemctl reload nginx

mark_done "$STAGE"; log "✓ $STAGE complete"
''')

# --- Helper scripts ---
(SCRIPTS / "close-ssh-22.sh").write_text(HEADER + '''require_root
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
sed -i "s/^port\\s*=\\s*22,${KIT_SSH_PORT}/port = ${KIT_SSH_PORT}/" /etc/fail2ban/jail.local 2>/dev/null || true
systemctl reload fail2ban || systemctl restart fail2ban
echo "✓ Port 22 closed. SSH now ONLY on port $KIT_SSH_PORT."
ufw status | head -20
''')

(SCRIPTS / "ssh-key.sh").write_text(HEADER + '''require_root
USER_HOME=$(getent passwd "$KIT_PRIMARY_USER" | cut -d: -f6)
AUTH="$USER_HOME/.ssh/authorized_keys"
install -d -m 0700 -o "$KIT_PRIMARY_USER" -g "$KIT_PRIMARY_USER" "$USER_HOME/.ssh"
touch "$AUTH"; chown "$KIT_PRIMARY_USER:$KIT_PRIMARY_USER" "$AUTH"; chmod 0600 "$AUTH"
cmd="${1:-list}"
case "$cmd" in
  add)
    key=$(cat)
    if [[ -z "$key" ]]; then die "no key on stdin"; fi
    grep -qF "$key" "$AUTH" || echo "$key" >> "$AUTH"
    log "key added"
    ;;
  list) awk '{ printf "%s %s\\n", $1, substr($3,1,30) "..." $4 }' "$AUTH" | nl ;;
  remove)
    fp="${2:-}"
    [[ -n "$fp" ]] || die "usage: $0 remove <fingerprint-substring>"
    grep -vF "$fp" "$AUTH" > "${AUTH}.tmp" && mv "${AUTH}.tmp" "$AUTH"
    log "removed lines matching '$fp'"
    ;;
  *) die "usage: $0 {add|list|remove}" ;;
esac
''')

(SCRIPTS / "rotate-litellm-key.sh").write_text(HEADER + '''require_root
NEW_KEY="sk-alolitellm-$(openssl rand -hex 16)"
log "new LiteLLM master key: $NEW_KEY"
sed -i "s|^master_key:.*|master_key: ${NEW_KEY}|" /opt/litellm/config.yaml 2>/dev/null || true
grep -q "^master_key:" /opt/litellm/config.yaml 2>/dev/null || echo "master_key: $NEW_KEY" >> /opt/litellm/config.yaml
chown "$KIT_PRIMARY_USER:$KIT_PRIMARY_USER" /opt/litellm/config.yaml
chmod 0600 /opt/litellm/config.yaml
systemctl restart litellm
sed -i "s|OPENAI_API_KEY=.*|OPENAI_API_KEY=${NEW_KEY}|" /etc/systemd/system/open-webui.service
systemctl daemon-reload && systemctl restart open-webui
USER_HOME=$(getent passwd "$KIT_PRIMARY_USER" | cut -d: -f6)
sed -i "s|\\"apiKey\\": \\".*\\"|\\"apiKey\\": \\"${NEW_KEY}\\"|g" "$USER_HOME/.continue/config.json" 2>/dev/null || true
CLINE_CFG="$USER_HOME/.config/Code/User/globalStorage/saoudrizwan.claude-dev/settings/alo-litellm.json"
sed -i "s|\\"openAiApiKey\\": \\".*\\"|\\"openAiApiKey\\": \\"${NEW_KEY}\\"|g" "$CLINE_CFG" 2>/dev/null || true
sed -i "s|^openai-api-key:.*|openai-api-key: ${NEW_KEY}|" "$USER_HOME/.aider/conf.d/alo.yml" 2>/dev/null || true
sed -i "s|^KIT_LITELLM_MASTER_KEY=.*|KIT_LITELLM_MASTER_KEY=${NEW_KEY}|" "$KIT_ROOT/config.env"
log "✓ key rotated across LiteLLM, Open-WebUI, Continue, Cline, Aider, config.env"
''')

(SCRIPTS / "ollama-add-model.sh").write_text(HEADER + '''require_root
MODEL="${1:-}"; LITELLM_NAME="${2:-$MODEL}"
[[ -n "$MODEL" ]] || die "usage: $0 <ollama-model> [litellm-model-name]"
log "pulling $MODEL"
ollama pull "$MODEL"
LITELLM_CFG=/opt/litellm/config.yaml
backup_file "$LITELLM_CFG"
if ! grep -q "model_name: ${LITELLM_NAME}$" "$LITELLM_CFG" 2>/dev/null; then
  python3 - "$LITELLM_CFG" "$LITELLM_NAME" "$MODEL" <<'PY'
import sys, yaml
cfg_path, name, model = sys.argv[1], sys.argv[2], sys.argv[3]
with open(cfg_path) as f: cfg = yaml.safe_load(f) or {}
cfg.setdefault('model_list', []).append({
    'model_name': name,
    'litellm_params': {'model': f'ollama/{model}', 'api_base': 'http://127.0.0.1:11434'}
})
with open(cfg_path, 'w') as f: yaml.safe_dump(cfg, f, sort_keys=False)
print(f"added {name} -> ollama/{model}")
PY
  chown "$KIT_PRIMARY_USER:$KIT_PRIMARY_USER" "$LITELLM_CFG"
  chmod 0600 "$LITELLM_CFG"
  systemctl restart litellm
  log "✓ $MODEL added to LiteLLM as '$LITELLM_NAME'"
else
  log "model '$LITELLM_NAME' already in LiteLLM config"
fi
''')

# Top-level scripts
(KIT / "setup.sh").write_text('''#!/usr/bin/env bash
set -Eeuo pipefail
KIT_ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$KIT_ROOT"
if [[ $EUID -ne 0 ]]; then echo "Run as root:  sudo $0 $*"; exit 1; fi
source "$KIT_ROOT/lib/common.sh"
if [[ "${1:-}" == "--reset" ]]; then reset_state; exit 0; fi

STAGES=("00-preflight" "01-security" "02-webapp" "03-databases" "04-ai-infra" "05-ai-tools" "06-ops" "07-filesync")
if [[ -n "${1:-}" ]]; then
  target="$1"; found=""
  for s in "${STAGES[@]}"; do
    if [[ "$s" == "$target" || "$s" == "0$target" ]]; then found="$s"; break; fi
  done
  [[ -z "$found" ]] && { echo "Unknown stage: $target"; exit 1; }
  STAGES=("$found")
fi

echo ""
echo "=================================================================="
echo "  alo-server-kit · 7-layer Ubuntu server setup"
echo "  Host: $KIT_HOSTNAME  User: $KIT_PRIMARY_USER  TZ: $KIT_TIMEZONE"
echo "=================================================================="
echo ""

declare -a RAN=(); declare -a SKIPPED=(); declare -a FAILED=()
for stage in "${STAGES[@]}"; do
  if state_done "$stage" && [[ "${#STAGES[@]}" -gt 1 ]]; then
    log "→ $stage already done, skipping (use ./setup.sh --reset to re-run)"
    SKIPPED+=("$stage"); continue
  fi
  log "============================================================"
  log "Stage: $stage"
  log "============================================================"
  if bash "$KIT_ROOT/stages/${stage}.sh"; then
    RAN+=("$stage")
  else
    err "Stage $stage FAILED"; FAILED+=("$stage")
    err "Run:  sudo ./setup.sh $stage"
    send_telegram "⚠️ *${KIT_HOSTNAME}* setup failed at stage *${stage}*"
    exit 1
  fi
done

log ""
log "============================================================"
log "SETUP SUMMARY"
log "============================================================"
for s in "${RAN[@]:-}"; do log "  ✓ ran    $s"; done
for s in "${SKIPPED[@]:-}"; do log "  → skipped $s"; done
if [[ ${#FAILED[@]} -eq 0 ]]; then
  log ""
  log "All requested stages completed successfully."
  log "Next steps:"
  log "  1. Verify SSH on port $KIT_SSH_PORT works: ssh -p $KIT_SSH_PORT $KIT_PRIMARY_USER@<host>"
  log "  2. Close the temporary port 22: sudo ./scripts/close-ssh-22.sh"
  log "  3. Run the audit: sudo ./verify.sh"
else
  err "Failed stages: ${FAILED[*]}"; exit 1
fi
''')

(KIT / "verify.sh").write_text('''#!/usr/bin/env bash
set -Eeuo pipefail
KIT_ROOT="$(cd "$(dirname "$0")" && pwd)"
source "$KIT_ROOT/lib/common.sh"
PASS=0; WARN=0; FAIL=0
ok()   { printf "  \\033[32m✓ %s\\033[0m\\n" "$1"; PASS=$((PASS+1)); }
warn() { printf "  \\033[33m⚠ %s\\033[0m\\n" "$1"; WARN=$((WARN+1)); }
fail() { printf "  \\033[31m✗ %s\\033[0m\\n" "$1"; FAIL=$((FAIL+1)); }
banner() { printf "\\n\\033[1;36m=== %s ===\\033[0m\\n" "$1"; }

banner "L1 — Security"
ss -tlnp | grep -q ":${KIT_SSH_PORT}\\b" && ok "SSH listening on port ${KIT_SSH_PORT}" || fail "SSH NOT listening on ${KIT_SSH_PORT}"
sshd -T 2>/dev/null | grep -qi '^permitrootlogin no' && ok "root login disabled" || fail "PermitRootLogin not 'no'"
sshd -T 2>/dev/null | grep -qi '^passwordauthentication no' && ok "password auth disabled" || fail "PasswordAuthentication still on"
ufw status | grep -qi 'Status: active' && ok "UFW active" || fail "UFW not active"
ufw status | grep -q '22/tcp' && warn "port 22 still open" || ok "port 22 closed"
ufw status | grep -q "${KIT_SSH_PORT}/tcp" && ok "port ${KIT_SSH_PORT} open" || fail "port ${KIT_SSH_PORT} not open"
ufw status | grep -q '80/tcp' && ok "port 80 open" || fail "port 80 not open"
ufw status | grep -q '443/tcp' && ok "port 443 open" || fail "port 443 not open"
systemctl is-active --quiet fail2ban && ok "fail2ban active" || fail "fail2ban not active"

banner "L2 — Web/App"
systemctl is-active --quiet nginx && ok "nginx active" || fail "nginx not active"
nginx -t 2>/dev/null | grep -q 'syntax is ok' && ok "nginx config OK" || fail "nginx config bad"
command -v node >/dev/null && ok "node: $(node -v 2>/dev/null)" || fail "node not installed"
command -v pm2 >/dev/null && ok "pm2 installed" || fail "pm2 not installed"
grep -q 'X-Frame-Options' /etc/nginx/snippets/alo-security.conf 2>/dev/null && ok "security headers present" || fail "security headers missing"
command -v certbot >/dev/null && ok "certbot installed" || fail "certbot missing"
[[ -f /usr/lib/python3/dist-packages/EXTERNALLY-MANAGED ]] && ok "python venv-only enforced" || warn "python not venv-only"

banner "L3 — Databases"
systemctl is-active --quiet postgresql && ok "postgresql active" || fail "postgresql not active"
sudo -u postgres psql -tAc "SELECT 1" >/dev/null 2>&1 && ok "postgres responds" || fail "postgres not responding"
grep -q 'scram-sha-256' "$(find /etc/postgresql -name pg_hba.conf | head -1)" 2>/dev/null && ok "pg_hba uses scram-sha-256" || warn "scram-sha-256 not in pg_hba.conf"
systemctl is-active --quiet mysql && ok "mysql active" || fail "mysql not active"
[[ -f /etc/cron.d/alo-db-backup ]] && ok "DB backup cron present" || fail "DB backup cron missing"
[[ -x /usr/local/sbin/alo-db-backup.sh ]] && ok "DB backup script executable" || fail "DB backup script missing"

banner "L4 — AI Infra"
systemctl is-active --quiet ollama && ok "ollama active" || fail "ollama not active"
curl -fsS http://127.0.0.1:11434/api/tags >/dev/null 2>&1 && ok "ollama API responds" || fail "ollama API down"
count=$(ollama list 2>/dev/null | tail -n +2 | wc -l)
[[ $count -ge 3 ]] && ok "$count Ollama models pulled" || warn "only $count Ollama models pulled"
systemctl show ollama 2>/dev/null | grep -q 'MemoryMax=' && ok "ollama MemoryMax set" || warn "ollama MemoryMax not set"
systemctl is-active --quiet litellm && ok "litellm active" || fail "litellm not active"
curl -fsS http://127.0.0.1:4000/health/liveness >/dev/null 2>&1 && ok "litellm health OK" || warn "litellm health endpoint down"
systemctl is-active --quiet open-webui && ok "open-webui active" || warn "open-webui not yet active"

banner "L5 — AI Tools"
command -v code >/dev/null && ok "VS Code installed" || warn "VS Code not installed"
command -v aider >/dev/null && ok "aider installed (pipx)" || warn "aider not installed"
USER_HOME=$(getent passwd "$KIT_PRIMARY_USER" | cut -d: -f6)
[[ -f "$USER_HOME/.continue/config.json" ]] && ok "Continue.dev config present" || warn "Continue.dev config missing"

banner "L6 — Ops / Monitoring"
systemctl is-active --quiet netdata && ok "netdata active" || warn "netdata not active"
[[ -f /etc/cron.d/alo-healthcheck ]] && ok "healthcheck cron present" || fail "healthcheck cron missing"
[[ -x /usr/local/sbin/alo-healthcheck.sh ]] && ok "healthcheck script present" || fail "healthcheck script missing"
[[ -x /usr/local/sbin/alo-deploy.sh ]] && ok "deploy script present" || warn "deploy script missing"

banner "L7 — File Sync"
systemctl is-active --quiet smbd && ok "smbd active" || warn "smbd not active"
systemctl is-active --quiet nmbd && ok "nmbd active" || warn "nmbd not active"
sudo -u "$KIT_PRIMARY_USER" systemctl --user is-active --quiet syncthing.service && ok "syncthing active" || warn "syncthing not active"
testparm -s 2>/dev/null | grep -q '\\[documents\\]' && ok "Samba [documents] share present" || fail "Samba [documents] missing"
testparm -s 2>/dev/null | grep -q '\\[backups\\]' && ok "Samba [backups] share present" || fail "Samba [backups] missing"

banner "SUMMARY"
printf "  Passed:    %3d\\n" "$PASS"
printf "  Warnings:  %3d\\n" "$WARN"
printf "  Failures:  %3d\\n" "$FAIL"
if [[ $FAIL -gt 0 ]]; then printf "\\n  ❌ %d checks failed.\\n" "$FAIL"; exit 1
elif [[ $WARN -gt 0 ]]; then printf "\\n  ⚠️  %d warnings — review but no blockers.\\n" "$WARN"; exit 0
else printf "\\n  ✅ All checks passed.\\n"; exit 0; fi
''')

(KIT / "status.sh").write_text('''#!/usr/bin/env bash
set -Eeuo pipefail
KIT_ROOT="$(cd "$(dirname "$0")" && pwd)"
source "$KIT_ROOT/lib/common.sh"
printf "\\n\\033[1;4m%s\\033[0m  (uptime: %s, load: %s)\\n" "$KIT_HOSTNAME" "$(uptime -p)" "$(awk '{print $1, $2, $3}' /proc/loadavg)"
free -h | awk 'NR==1 || NR==2 || NR==3'
echo ""
df -h / /home 2>/dev/null | head -3
echo ""
echo "── Services ──────────────────────────────"
for svc in ssh nginx postgresql mysql pm2-$KIT_PRIMARY_USER litellm ollama open-webui netdata smbd nmbd fail2ban; do
  state=$(systemctl is-active "$svc" 2>/dev/null || echo "n/a")
  printf "  %-30s %s\\n" "$svc" "$state"
done
echo ""
echo "── Listening ports ──────────────────────"
ss -tlnp | awk 'NR==1 || /:(22|80|443|11434|4000|3001|19999|5432|3306|8384|139|445)\\b/' | head -20
echo ""
echo "── Recent backups ───────────────────────"
ls -lht /var/backups/alo-db/daily/ 2>/dev/null | head -8 || echo "  (none)"
echo ""
echo "── Setup state ──────────────────────────"
ls -1 "$KIT_ROOT/run-state/"*.done 2>/dev/null | xargs -n1 basename 2>/dev/null || echo "  (no stages done)"
''')

(KIT / "backup.sh").write_text(HEADER + '''require_root
TS=$(date +%Y%m%d-%H%M%S)
SNAP_DIR="/var/backups/alo-files"
install -d -m 0750 "$SNAP_DIR"
log "running DB backup"
/usr/local/sbin/alo-db-backup.sh
log "snapshotting critical configs"
TARBALL="$SNAP_DIR/alo-configs-$TS.tar.gz"
tar -czf "$TARBALL" \\
  /etc/nginx /etc/postgresql /etc/mysql \\
  /etc/systemd/system/litellm.service /etc/systemd/system/open-webui.service \\
  /etc/systemd/system/pm2-$KIT_PRIMARY_USER.service /etc/samba/smb.conf \\
  /etc/fail2ban/jail.local /etc/sysctl.d/99-alo-security.conf \\
  /etc/cron.d/alo-* "$KIT_ROOT/config.env" 2>/dev/null || true
chmod 0600 "$TARBALL"; chown root:root "$TARBALL"
find "$SNAP_DIR" -type f -mtime +30 -delete
log "backup complete: $TARBALL"
''')

(KIT / "restore.sh").write_text(HEADER + '''require_root
MODE="${1:-}"; FILE="${2:-}"
[[ -n "$MODE" && -n "$FILE" ]] || { cat <<EOF
Usage:
  sudo $0 configs <configs-tarball>
  sudo $0 db <db-tarball>
EOF
exit 1; }
[[ -f "$FILE" ]] || die "file not found: $FILE"
case "$MODE" in
  configs)
    log "restoring configs from $FILE"
    tar -xzf "$FILE" -C /
    systemctl reload nginx || true
    systemctl reload postgresql || true
    systemctl reload mysql || true
    systemctl restart fail2ban
    log "configs restored"
    ;;
  db)
    log "restoring DB from $FILE"
    case "$FILE" in
      *pg-all-*) sudo -u postgres psql -tAc "SELECT 1" >/dev/null 2>&1 && gunzip -c "$FILE" | sudo -u postgres psql || die "postgres not accessible" ;;
      *mysql-all-*) gunzip -c "$FILE" | mysql ;;
      *) die "unrecognised DB backup name: $FILE" ;;
    esac
    log "DB restored"
    ;;
  *) die "unknown mode: $MODE (use 'configs' or 'db')" ;;
esac
''')

# Make everything executable
for f in list(STAGES.glob('*.sh')) + list(SCRIPTS.glob('*.sh')) + [KIT/'setup.sh', KIT/'verify.sh', KIT/'status.sh', KIT/'backup.sh', KIT/'restore.sh']:
    f.chmod(0o755)

print(f"✓ Wrote {len(list(STAGES.glob('*.sh')))} stage scripts + {len(list(SCRIPTS.glob('*.sh')))} helper scripts + 4 top-level scripts")
