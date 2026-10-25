#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════
# ALO Labs Hosting Control Panel - Ubuntu Server Provisioning Script
# ═══════════════════════════════════════════════════════════════════════════
# This script is idempotent — safe to run multiple times.
# Target: Ubuntu 22.04 LTS / 24.04 LTS
# Usage: sudo bash install-ubuntu-server.sh
# ═══════════════════════════════════════════════════════════════════════════

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

STEP=0
TOTAL_STEPS=14

log_step() {
  STEP=$((STEP + 1))
  echo -e "${BLUE}[${STEP}/${TOTAL_STEPS}]${NC}  $*"
}
log_ok()   { echo -e "  ${GREEN}✓${NC}  $*"; }
log_warn() { echo -e "  ${YELLOW}!${NC}  $*"; }
log_err()  { echo -e "  ${RED}✗${NC}  $*" >&2; }

log_step "Checking root privileges..."
if [[ "${EUID}" -ne 0 ]]; then
  log_err "This script must be run as root."
  exit 1
fi
log_ok "Running as root"

log_step "Detecting Ubuntu version..."
if [[ ! -f /etc/os-release ]]; then
  log_err "Cannot detect OS. /etc/os-release not found."
  exit 1
fi
source /etc/os-release
if [[ "${ID}" != "ubuntu" ]]; then
  log_err "This script is designed for Ubuntu. Detected: ${ID}"
  exit 1
fi
if [[ "${VERSION_ID}" != "22.04" && "${VERSION_ID}" != "24.04" ]]; then
  log_warn "Tested on Ubuntu 22.04/24.04. Detected: ${VERSION_ID}. Continuing..."
fi
log_ok "${PRETTY_NAME}"

log_step "Updating package index..."
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
log_ok "Package index updated"

log_step "Installing system dependencies..."
apt-get install -y -qq \
  curl wget gnupg2 apt-transport-https \
  software-properties-common \
  ca-certificates lsb-release \
  unzip jq htop tmux \
  ufw fail2ban \
  build-essential \
  openssl \
  dnsutils \
  socat \
  >/dev/null 2>&1
log_ok "System packages installed"

log_step "Installing Node.js 22.x..."
if command -v node &>/dev/null && node --version | grep -q 'v22'; then
  log_ok "Node.js $(node --version) already installed"
else
  # Remove any existing Node.js to avoid conflicts
  apt-get remove -y -qq nodejs npm 2>/dev/null || true
  
  # Use NodeSource APT repository (safer than curl|bash)
  apt-get install -y -qq ca-certificates curl gnupg >/dev/null 2>&1
  mkdir -p /etc/apt/keyrings
  curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
    | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg 2>/dev/null
  echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main" \
    > /etc/apt/sources.list.d/nodesource.list
  apt-get update -qq
  apt-get install -y -qq nodejs >/dev/null 2>&1
  log_ok "Node.js $(node --version) installed"
fi

log_step "Installing PM2 process manager..."
if ! command -v pm2 &>/dev/null; then
  npm install -g pm2 >/dev/null 2>&1
  log_ok "PM2 installed"
else
  log_ok "PM2 $(pm2 --version 2>/dev/null | head -1) already installed"
fi

log_step "Installing Caddy web server..."
if ! command -v caddy &>/dev/null; then
  apt install -y -qq debian-keyring debian-archive-keyring apt-transport-https curl >/dev/null 2>&1
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
    | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg 2>/dev/null
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
    | tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null
  apt-get update -qq
  apt-get install -y -qq caddy >/dev/null 2>&1
  log_ok "Caddy installed"
else
  log_ok "Caddy $(caddy version | head -1) already installed"
fi

# Configure Caddy to include site configs
mkdir -p /etc/caddy/sites
if ! grep -q 'import /etc/caddy/sites' /etc/caddy/Caddyfile 2>/dev/null; then
  echo 'import /etc/caddy/sites/*' >> /etc/caddy/Caddyfile
  systemctl reload caddy 2>/dev/null || systemctl restart caddy 2>/dev/null || true
fi
log_ok "Caddy configured with site imports"

log_step "Installing PHP 8.2 FPM..."
if ! command -v php8.2 &>/dev/null; then
  add-apt-repository -y -U ppa:ondrej/php >/dev/null 2>&1
  apt-get install -y -qq \
    php8.2-fpm \
    php8.2-cli \
    php8.2-common \
    php8.2-mysql \
    php8.2-pgsql \
    php8.2-mbstring \
    php8.2-xml \
    php8.2-curl \
    php8.2-zip \
    php8.2-gd \
    php8.2-intl \
    php8.2-opcache \
    php8.2-readline \
    >/dev/null 2>&1
  log_ok "PHP 8.2 FPM installed"
else
  log_ok "PHP 8.2 already installed"
fi

# Configure PHP-FPM for www-data
mkdir -p /run/php /var/log/php8.2-fpm
if [[ -f /etc/php/8.2/fpm/pool.d/www.conf ]]; then
  sed -i 's/;listen.mode = 0660/listen.mode = 0660/' /etc/php/8.2/fpm/pool.d/www.conf
  systemctl enable php8.2-fpm >/dev/null 2>&1
  systemctl restart php8.2-fpm >/dev/null 2>&1
fi
log_ok "PHP-FPM configured"

log_step "Installing MariaDB..."
if ! command -v mysql &>/dev/null; then
  # Install MariaDB without interactive prompts
  export DEBIAN_FRONTEND=noninteractive
  apt-get install -y -qq mariadb-server >/dev/null 2>&1
  # Secure installation (non-interactive) — use socket auth for root (no password)
  mysql -e "ALTER USER 'root'@'localhost' IDENTIFIED VIA unix_socket OR mysql_native_password USING PASSWORD(''); FLUSH PRIVILEGES;" 2>/dev/null || true
  systemctl enable mariadb >/dev/null 2>&1
  systemctl start mariadb 2>/dev/null || true
  log_ok "MariaDB installed"
else
  log_ok "MariaDB already installed"
fi

log_step "Installing Certbot (Let's Encrypt)..."
if ! command -v certbot &>/dev/null; then
  apt-get install -y -qq certbot >/dev/null 2>&1
  log_ok "Certbot installed"
else
  log_ok "Certbot already installed"
fi

log_step "Creating system directories..."
mkdir -p /var/www/sites
mkdir -p /var/log/caddy
mkdir -p /var/log/php8.2-fpm
mkdir -p /etc/caddy/sites
mkdir -p /var/backups/alo/sites
chown -R www-data:www-data /var/www/sites 2>/dev/null || true
chmod 755 /var/www/sites
log_ok "Directories created"

log_step "Configuring UFW firewall (basic rules)..."
if ufw status | grep -q "inactive" 2>/dev/null; then
  ufw --force enable
fi
# Ensure essential ports are allowed
ufw allow 22/tcp    >/dev/null 2>&1 || true  # SSH
ufw allow 80/tcp    >/dev/null 2>&1 || true  # HTTP
ufw allow 443/tcp   >/dev/null 2>&1 || true  # HTTPS
ufw allow 3101/tcp  >/dev/null 2>&1 || true  # Panel (direct access)
log_ok "Firewall configured (SSH, HTTP, HTTPS, Panel port)"

log_step "Installing ALO helper scripts..."
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ -f "${SCRIPT_DIR}/install-helpers.sh" ]]; then
  bash "${SCRIPT_DIR}/install-helpers.sh"
  log_ok "Helper scripts installed"
else
  log_warn "install-helpers.sh not found at ${SCRIPT_DIR}"
  log_warn "Run it manually after copying helpers/ directory"
fi

log_step "Verifying installation..."
ERRORS=0
CHECKS=(
  "node:/usr/bin/node:Node.js"
  "pm2:/usr/bin/pm2:PM2"
  "caddy:/usr/bin/caddy:Caddy"
  "php8.2:/usr/sbin/php-fpm8.2:PHP-FPM 8.2"
  "mysql:/usr/bin/mysql:MariaDB"
  "certbot:/usr/bin/certbot:Certbot"
  "ufw:/usr/sbin/ufw:UFW"
)

for check in "${CHECKS[@]}"; do
  IFS=':' read -r cmd path label <<< "${check}"
  if [[ -x "${path}" ]]; then
    log_ok "${label} installed"
  else
    log_warn "${label} not found at ${path}"
  fi
done

echo ""
echo -e "${GREEN}═══════════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}  ALO Labs Server Provisioning Complete${NC}"
echo -e "${GREEN}═══════════════════════════════════════════════════════════════${NC}"
echo ""
echo "  Installed services:"
echo "    Node.js   $(node --version 2>/dev/null || echo 'N/A')"
echo "    PM2       $(pm2 --version 2>/dev/null | head -1 || echo 'N/A')"
echo "    Caddy     $(caddy version 2>/dev/null | head -1 || echo 'N/A')"
echo "    PHP-FPM   $(php8.2 -v 2>/dev/null | head -1 || echo 'N/A')"
echo "    MariaDB   $(mysql --version 2>/dev/null || echo 'N/A')"
echo "    Certbot   $(certbot --version 2>/dev/null || echo 'N/A')"
echo ""
echo "  Firewall:  $(ufw status 2>/dev/null | head -1 || echo 'N/A')"
echo ""
echo "  Next steps:"
echo "    1. Deploy the panel:  cp -r <panel-build> /opt/alo-panel/"
echo "    2. Install deps:       cd /opt/alo-panel && npm ci --production"
echo "    3. Run DB migration:  npx prisma db push"
echo "    4. Start with PM2:    pm2 start npm --name alo-panel -- run start"
echo "    5. Save PM2 config:   pm2 save"
echo "    6. Set up Caddy proxy:"
echo "       echo 'alo-panel.example.com {" >> /etc/caddy/sites/panel.Caddyfile"
echo "       echo '    reverse_proxy 127.0.0.1:3000' >> /etc/caddy/sites/panel.Caddyfile"
echo "       echo '}' >> /etc/caddy/sites/panel.Caddyfile"
echo "       systemctl reload caddy"
echo ""
echo -e "${GREEN}═══════════════════════════════════════════════════════════════${NC}