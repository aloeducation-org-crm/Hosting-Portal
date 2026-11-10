#!/usr/bin/env bash
set -Eeuo pipefail
source "$(dirname "$0")/../lib/common.sh"
require_root
STAGE="03-databases"; log "▶ $STAGE starting"
BACKUP_ROOT="/var/backups/alo-db"
install -d -m 0700 -o root -g root "$BACKUP_ROOT"/{daily,weekly,monthly}
install -d -m 0700 -o root -g root /root/.alo-secrets

log "install PostgreSQL ${KIT_PG_VERSION}"
ensure_pkg postgresql-${KIT_PG_VERSION} postgresql-contrib-${KIT_PG_VERSION}
PG_HBA=$(find /etc/postgresql -name pg_hba.conf 2>/dev/null | head -1)
PG_CONF=$(find /etc/postgresql -name postgresql.conf 2>/dev/null | head -1)
backup_file "$PG_HBA"; backup_file "$PG_CONF"
sed -i 's/^#\?password_encryption.*/password_encryption = scram-sha-256/' "$PG_CONF"
cat > "$PG_HBA" <<EOF
# TYPE  DATABASE        USER            ADDRESS                 METHOD
local   all             postgres                                peer
local   all             all                                     scram-sha-256
host    all             all             127.0.0.1/32            scram-sha-256
host    all             all             ::1/128                 scram-sha-256
host    all             all             0.0.0.0/0               reject
EOF
sed -i "s|^#\?listen_addresses.*|listen_addresses = '127.0.0.1'|" "$PG_CONF"
systemctl enable --now postgresql
systemctl reload postgresql

# Idempotent credential preservation: re-use existing password if already generated
PGPW=""
if [[ -f /root/.alo-secrets/postgres-app.txt ]]; then
  PGPW=$(awk -F= '/^PGPASSWORD=/{print $2}' /root/.alo-secrets/postgres-app.txt | head -1)
fi
if [[ -z "$PGPW" ]]; then
  PGPW=$(openssl rand -base64 24 | tr -d '/+=' | head -c 28)
fi

sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='${KIT_PG_APP_USER}'" | grep -q 1 || \
  sudo -u postgres psql -c "CREATE ROLE ${KIT_PG_APP_USER} LOGIN PASSWORD '${PGPW}';"
sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='${KIT_PG_APP_DB}'" | grep -q 1 || \
  sudo -u postgres psql -c "CREATE DATABASE ${KIT_PG_APP_DB} OWNER ${KIT_PG_APP_USER};"
sudo -u postgres psql -c "ALTER ROLE ${KIT_PG_APP_USER} PASSWORD '${PGPW}';" >/dev/null

write_file /root/.alo-secrets/postgres-app.txt root:root 0600 <<EOF
# PostgreSQL app credentials
PGUSER=${KIT_PG_APP_USER}
PGPASSWORD=${PGPW}
PGDATABASE=${KIT_PG_APP_DB}
PGHOST=127.0.0.1
PGPORT=5432
EOF
log "PG app creds preserved/saved in /root/.alo-secrets/postgres-app.txt"

log "install MySQL 8"
if ! pkg_installed mysql-server; then
  DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends mysql-server >/dev/null
fi
MYSQL_CNF=/etc/mysql/mysql.conf.d/mysqld.cnf
backup_file "$MYSQL_CNF"
sed -i 's/^#\?bind-address.*/bind-address = 127.0.0.1/' "$MYSQL_CNF"
grep -q '^bind-address' "$MYSQL_CNF" || echo 'bind-address = 127.0.0.1' >> "$MYSQL_CNF"
systemctl enable --now mysql

mysql <<'SQL' || true
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

MYPW=""
if [[ -f /root/.alo-secrets/mysql-app.txt ]]; then
  MYPW=$(awk -F= '/^MYSQL_PASSWORD=/{print $2}' /root/.alo-secrets/mysql-app.txt | head -1)
fi
if [[ -z "$MYPW" ]]; then
  # Ensure mixed case + digit + symbol so MEDIUM validate_password passes deterministically
  MYPW="Alo_$(openssl rand -hex 10)#9"
fi

mysql -e "CREATE DATABASE IF NOT EXISTS ${KIT_MYSQL_APP_DB} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
mysql -e "CREATE USER IF NOT EXISTS '${KIT_MYSQL_APP_USER}'@'127.0.0.1' IDENTIFIED BY '${MYPW}';" || true
mysql -e "CREATE USER IF NOT EXISTS '${KIT_MYSQL_APP_USER}'@'localhost' IDENTIFIED BY '${MYPW}';" || true
mysql -e "ALTER USER '${KIT_MYSQL_APP_USER}'@'127.0.0.1' IDENTIFIED BY '${MYPW}';"
mysql -e "ALTER USER '${KIT_MYSQL_APP_USER}'@'localhost' IDENTIFIED BY '${MYPW}';"
mysql -e "GRANT ALL PRIVILEGES ON ${KIT_MYSQL_APP_DB}.* TO '${KIT_MYSQL_APP_USER}'@'127.0.0.1';"
mysql -e "GRANT ALL PRIVILEGES ON ${KIT_MYSQL_APP_DB}.* TO '${KIT_MYSQL_APP_USER}'@'localhost'; FLUSH PRIVILEGES;"

write_file /root/.alo-secrets/mysql-app.txt root:root 0600 <<EOF
# MySQL app credentials
MYSQL_USER=${KIT_MYSQL_APP_USER}
MYSQL_PASSWORD=${MYPW}
MYSQL_DATABASE=${KIT_MYSQL_APP_DB}
MYSQL_HOST=127.0.0.1
MYSQL_PORT=3306
EOF

log "installing db backup + rotation (0600 root-only archives)"
install -d -m 0755 /usr/local/sbin
cat >/usr/local/sbin/alo-db-backup.sh <<'EOF'
#!/usr/bin/env bash
set -Eeuo pipefail
umask 0077
BACKUP_ROOT=/var/backups/alo-db
TS=$(date +%Y%m%d-%H%M%S)
install -d -m 0700 "$BACKUP_ROOT/daily" "$BACKUP_ROOT/weekly" "$BACKUP_ROOT/monthly"
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
chmod 0750 /usr/local/sbin/alo-db-backup.sh
write_file /etc/cron.d/alo-db-backup root:root 0644 <<'EOF'
30 2 * * * root /usr/local/sbin/alo-db-backup.sh >> /var/log/alo-db-backup.log 2>&1
EOF
systemctl reload cron || true

mark_done "$STAGE"; log "✓ $STAGE complete"
