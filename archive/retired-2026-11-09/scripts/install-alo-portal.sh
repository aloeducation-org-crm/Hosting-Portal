#!/usr/bin/env bash
# ============================================================================
# ALO Labs Private Hosting Control Center — Production Installation Script
# ============================================================================
# Idempotent: safe to run multiple times on the same server.
# Target OS:   Ubuntu 22.04 LTS / 24.04 LTS
#
# Usage:
#   sudo bash install-alo-portal.sh
#   sudo bash install-alo-portal.sh 2>&1 | tee install.log
# ============================================================================

set -euo pipefail

# ── Colour helpers ──────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
MAGENTA='\033[0;35m'
BOLD='\033[1m'
NC='\033[0m' # No Colour

# ── Logging helpers ─────────────────────────────────────────────────────────
log_info()  { echo -e "${GREEN}[INFO]${NC}  $*"; }
log_warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
log_error() { echo -e "${RED}[ERROR]${NC} $*"; }
log_step()  { echo -e "\n${BLUE}${BOLD}━━━ $* ━━━${NC}"; }
log_skip()  { echo -e "${CYAN}[SKIP]${NC}  $*"; }
log_ok()    { echo -e "${GREEN}[OK]${NC}    $*"; }

# ── Tracking arrays ─────────────────────────────────────────────────────────
INSTALLED=()
ALREADY_PRESENT=()
SKIPPED=()

# ── Portal user (change if needed) ──────────────────────────────────────────
PORTAL_USER="portal-user"

# ============================================================================
# 0 — Pre-flight checks
# ============================================================================
preflight_checks() {
    log_step "STEP 0: Pre-flight Checks"

    # 0a. Verify running on Ubuntu
    log_info "Checking operating system..."
    if [[ ! -f /etc/os-release ]]; then
        log_error "/etc/os-release not found. This script requires Ubuntu 22.04 or 24.04."
        exit 1
    fi

    # shellcheck disable=SC1091
    source /etc/os-release

    if [[ "${ID:-}" != "ubuntu" ]]; then
        log_error "Detected OS: ${ID} ${VERSION_ID:-unknown}. This script ONLY supports Ubuntu."
        log_error "Please run this on Ubuntu 22.04 or 24.04 LTS."
        exit 1
    fi

    case "${VERSION_ID:-}" in
        22.04|24.04) log_ok "Ubuntu ${VERSION_ID} detected — supported." ;;
        *) log_warn "Ubuntu ${VERSION_ID} detected — not officially tested (22.04/24.04 expected)." ;;
    esac

    # 0b. Verify root / sudo
    log_info "Checking privileges..."
    if [[ "${EUID}" -ne 0 ]]; then
        if [[ -n "${SUDO_USER:-}" ]]; then
            log_ok "Running via sudo as ${SUDO_USER}."
        else
            log_error "This script must be run as root or with sudo."
            log_error "Re-run with:  sudo bash $0"
            exit 1
        fi
    else
        log_ok "Running as root (EUID=0)."
    fi
}

# ============================================================================
# 1 — Update apt & install core packages
# ============================================================================
install_core_packages() {
    log_step "STEP 1: Core Packages (apt update + essentials)"

    local core_pkgs=(
        curl
        wget
        gnupg2
        ca-certificates
        lsb-release
        ufw
        unzip
        git
        build-essential
    )

    # Check which are already installed
    local missing_pkgs=()
    for pkg in "${core_pkgs[@]}"; do
        if dpkg -s "$pkg" &>/dev/null; then
            ALREADY_PRESENT+=("$pkg")
            log_skip "$pkg is already installed."
        else
            missing_pkgs+=("$pkg")
        fi
    done

    if [[ ${#missing_pkgs[@]} -eq 0 ]]; then
        log_ok "All core packages are already present."
        return 0
    fi

    log_info "Updating apt cache..."
    apt-get update -qq

    log_info "Installing missing packages: ${missing_pkgs[*]}"
    DEBIAN_FRONTEND=noninteractive apt-get install -y -qq "${missing_pkgs[@]}"

    for pkg in "${missing_pkgs[@]}"; do
        INSTALLED+=("$pkg")
        log_ok "Installed $pkg."
    done
}

# ============================================================================
# 2 — Node.js 20 via NodeSource
# ============================================================================
install_nodejs() {
    log_step "STEP 2: Node.js 20 (NodeSource)"

    local target_major=20

    # Check if Node.js is installed and matches version
    if command -v node &>/dev/null; then
        local installed_version
        installed_version=$(node --version 2>/dev/null | sed 's/^v//')
        local installed_major installed_minor
        installed_major=${installed_version%%.*}
        installed_minor=${installed_version#*.}
        installed_minor=${installed_minor%%.*}
        installed_minor=$((10#${installed_minor:-0}))
        if [[ "$installed_major" == "$target_major" ]] && (( installed_minor >= 9 )); then
            ALREADY_PRESENT+=("nodejs v$(node --version)")
            log_skip "Node.js $(node --version) is already installed (major matches v${target_major})."
            return 0
        else
            log_warn "Node.js $(node --version) found but we need v${target_major}. Reinstalling..."
        fi
    fi

    log_info "Adding NodeSource repository for Node.js ${target_major}..."
    # Clean up old NodeSource sources if they exist (idempotent)
    rm -f /etc/apt/sources.list.d/nodesource.list
    rm -f /etc/apt/keyrings/nodesource.gpg

    local NODESOURCE_KEY="https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key"
    mkdir -p /etc/apt/keyrings
    curl -fsSL "$NODESOURCE_KEY" | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg 2>/dev/null
    chmod 644 /etc/apt/keyrings/nodesource.gpg

    echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_${target_major}.x nodistro main" \
        > /etc/apt/sources.list.d/nodesource.list

    log_info "Updating apt and installing nodejs..."
    apt-get update -qq
    DEBIAN_FRONTEND=noninteractive apt-get install -y -qq nodejs

    INSTALLED+=("nodejs v$(node --version)")
    log_ok "Installed Node.js $(node --version)."
}

# ============================================================================
# 3 — PM2 (global via npm)
# ============================================================================
install_pm2() {
    log_step "STEP 3: PM2 (global process manager)"

    if command -v pm2 &>/dev/null; then
        ALREADY_PRESENT+=("pm2 v$(pm2 --version 2>/dev/null)")
        log_skip "PM2 $(pm2 --version 2>/dev/null) is already installed."
        return 0
    fi

    log_info "Installing PM2 globally via npm..."
    npm install -g pm2

    INSTALLED+=("pm2 v$(pm2 --version)")
    log_ok "Installed PM2 $(pm2 --version)."
}

# ============================================================================
# 4 — Caddy web server
# ============================================================================
install_caddy() {
    log_step "STEP 4: Caddy Web Server"

    if command -v caddy &>/dev/null; then
        ALREADY_PRESENT+=("caddy v$(caddy version 2>/dev/null | head -1)")
        log_skip "Caddy $(caddy version 2>/dev/null | head -1) is already installed."
    else
        log_info "Adding Caddy official apt repository..."

        # Ensure keyrings directory exists
        mkdir -p /etc/apt/keyrings

        # Add Caddy GPG key (idempotent)
        curl -fsSL 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
            | gpg --dearmor -o /etc/apt/keyrings/caddy-stable-archive-keyring.gpg 2>/dev/null
        chmod 644 /etc/apt/keyrings/caddy-stable-archive-keyring.gpg

        # Determine architecture and add repo
        local arch dpkg_arch
        dpkg_arch=$(dpkg --print-architecture)
        curl -fsSL "https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt" \
            | sed "s/deb \[arch=amd64\]/deb [arch=${dpkg_arch}]/" \
            | sed "s/deb \[arch=arm64\]/deb [arch=${dpkg_arch}]/" \
            > /etc/apt/sources.list.d/caddy-stable.list
        chmod 644 /etc/apt/sources.list.d/caddy-stable.list

        log_info "Installing Caddy..."
        apt-get update -qq
        DEBIAN_FRONTEND=noninteractive apt-get install -y -qq caddy

        INSTALLED+=("caddy v$(caddy version 2>/dev/null | head -1)")
        log_ok "Installed Caddy $(caddy version 2>/dev/null | head -1)."
    fi

    # Configure Caddy directory structure (always runs, idempotent)
    log_info "Configuring Caddy sites-enabled directory..."
    mkdir -p /etc/caddy/sites-enabled

    # Write main Caddyfile that imports sites-enabled/*.conf
    if [[ ! -f /etc/caddy/Caddyfile ]] || ! rg -q 'sites-enabled' /etc/caddy/Caddyfile 2>/dev/null; then
        cat > /etc/caddy/Caddyfile << 'CADDYFILE'
# ALO Labs Hosting Portal — Main Caddyfile
# Site-specific configurations are in /etc/caddy/sites-enabled/*.conf

import /etc/caddy/sites-enabled/*.conf
CADDYFILE
        log_ok "Created /etc/caddy/Caddyfile with import directive."
        INSTALLED+=("/etc/caddy/Caddyfile")
    else
        log_skip "/etc/caddy/Caddyfile already configured with sites-enabled import."
        ALREADY_PRESENT+=("/etc/caddy/Caddyfile")
    fi
}

# ============================================================================
# 5 — MariaDB
# ============================================================================
install_mariadb() {
    log_step "STEP 5: MariaDB Server"

    if command -v mysql &>/dev/null && dpkg -s mariadb-server &>/dev/null; then
        ALREADY_PRESENT+=("mariadb-server")
        log_skip "MariaDB is already installed."
    else
        log_info "Installing MariaDB server..."
        DEBIAN_FRONTEND=noninteractive apt-get install -y -qq mariadb-server
        INSTALLED+=("mariadb-server")
        log_ok "Installed MariaDB server."
    fi

    # Ensure MariaDB service is running
    if ! systemctl is-active --quiet mariadb 2>/dev/null && ! systemctl is-active --quiet mysql 2>/dev/null; then
        log_info "Starting MariaDB service..."
        systemctl start mariadb 2>/dev/null || systemctl start mysql 2>/dev/null
        systemctl enable mariadb 2>/dev/null || systemctl enable mysql 2>/dev/null
        log_ok "MariaDB service started and enabled."
    else
        log_ok "MariaDB service is already running."
    fi

    # Run mysql_secure_installation non-interactively (idempotent-safe)
    # We set root password to empty, remove anonymous users, disallow remote root, remove test db, flush privs
    log_info "Running mysql_secure_installation (non-interactive)..."
    mysql -u root <<'SECURE_SQL'
-- Set root to use unix_socket auth (default on Ubuntu) — no password needed
DELETE FROM mysql.user WHERE User='';
DELETE FROM mysql.db WHERE Db='test' OR Db='test\_%';
FLUSH PRIVILEGES;
SECURE_SQL
    log_ok "MariaDB secured."
}

# ============================================================================
# 6 — PostgreSQL
# ============================================================================
install_postgresql() {
    log_step "STEP 6: PostgreSQL"

    if command -v psql &>/dev/null && dpkg -s postgresql &>/dev/null; then
        ALREADY_PRESENT+=("postgresql")
        log_skip "PostgreSQL is already installed."
        return 0
    fi

    log_info "Installing PostgreSQL..."
    DEBIAN_FRONTEND=noninteractive apt-get install -y -qq postgresql postgresql-contrib

    # Ensure service is running
    systemctl start postgresql
    systemctl enable postgresql

    INSTALLED+=("postgresql")
    log_ok "Installed and started PostgreSQL."
}

# ============================================================================
# 7 — PHP 8.2 FPM
# ============================================================================
install_php() {
    log_step "STEP 7: PHP 8.2 FPM"

    if command -v php8.2 &>/dev/null; then
        ALREADY_PRESENT+=("php8.2-fpm")
        log_skip "PHP 8.2 is already installed."
        return 0
    fi

    log_info "Adding ondrej/php PPA..."
    # Ensure add-apt-repository is available
    if ! command -v add-apt-repository &>/dev/null; then
        DEBIAN_FRONTEND=noninteractive apt-get install -y -qq software-properties-common
    fi

    # Add PPA (idempotent — add-apt-repository won't duplicate)
    add-apt-repository -y ppa:ondrej/php 2>/dev/null || true
    apt-get update -qq

    log_info "Installing PHP 8.2 FPM and extensions..."
    DEBIAN_FRONTEND=noninteractive apt-get install -y -qq \
        php8.2-fpm \
        php8.2-mysql \
        php8.2-pgsql \
        php8.2-mbstring \
        php8.2-xml \
        php8.2-curl

    # Ensure service is running
    systemctl start php8.2-fpm
    systemctl enable php8.2-fpm

    INSTALLED+=("php8.2-fpm")
    log_ok "Installed PHP 8.2 FPM with extensions."
}

# ============================================================================
# 8 — Docker
# ============================================================================
install_docker() {
    log_step "STEP 8: Docker Engine"

    if command -v docker &>/dev/null; then
        ALREADY_PRESENT+=("docker $(docker --version 2>/dev/null)")
        log_skip "Docker $(docker --version 2>/dev/null) is already installed."
        return 0
    fi

    log_info "Adding Docker official GPG key and repository..."
    mkdir -p /etc/apt/keyrings

    curl -fsSL 'https://download.docker.com/linux/ubuntu/gpg' \
        | gpg --dearmor -o /etc/apt/keyrings/docker.gpg 2>/dev/null
    chmod 644 /etc/apt/keyrings/docker.gpg

    local arch codename
    arch=$(dpkg --print-architecture)
    codename=$(lsb_release -sc)
    echo "deb [arch=${arch} signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu ${codename} stable" \
        > /etc/apt/sources.list.d/docker.list
    chmod 644 /etc/apt/sources.list.d/docker.list

    log_info "Installing Docker CE..."
    apt-get update -qq
    DEBIAN_FRONTEND=noninteractive apt-get install -y -qq \
        docker-ce \
        docker-ce-cli \
        containerd.io

    # Enable and start Docker
    systemctl start docker
    systemctl enable docker
    systemctl start containerd
    systemctl enable containerd

    INSTALLED+=("docker $(docker --version)")
    log_ok "Installed Docker $(docker --version)."
}

# ============================================================================
# 9 — Postfix (Mail Server — Internet Site)
# ============================================================================
install_postfix() {
    log_step "STEP 9: Postfix (MTA)"

    if dpkg -s postfix &>/dev/null; then
        ALREADY_PRESENT+=("postfix")
        log_skip "Postfix is already installed."
        return 0
    fi

    log_info "Pre-configuring Postfix for non-interactive install..."
    # Set Postfix to 'Internet Site' mode with no local mail name
    debconf-set-selections <<EOF
postfix postfix/main_mailer_type select Internet Site
postfix postfix/mailname string $(hostname -f 2>/dev/null || echo "localhost")
postfix postfix/destinations string localhost.localdomain, localhost
EOF

    log_info "Installing Postfix..."
    DEBIAN_FRONTEND=noninteractive apt-get install -y -qq postfix

    systemctl start postfix
    systemctl enable postfix

    INSTALLED+=("postfix")
    log_ok "Installed and started Postfix."
}

# ============================================================================
# 10 — Dovecot (IMAP/LMTP)
# ============================================================================
install_dovecot() {
    log_step "STEP 10: Dovecot (IMAP/LMTP Server)"

    if command -v dovecot &>/dev/null; then
        ALREADY_PRESENT+=("dovecot")
        log_skip "Dovecot is already installed."
        return 0
    fi

    log_info "Installing Dovecot..."
    DEBIAN_FRONTEND=noninteractive apt-get install -y -qq \
        dovecot-core \
        dovecot-imapd \
        dovecot-lmtpd \
        dovecot-mysql

    systemctl start dovecot
    systemctl enable dovecot

    INSTALLED+=("dovecot")
    log_ok "Installed and started Dovecot."
}

# ============================================================================
# 11 — OpenDKIM
# ============================================================================
install_opendkim() {
    log_step "STEP 11: OpenDKIM (DKIM Signing)"

    if command -v opendkim &>/dev/null; then
        ALREADY_PRESENT+=("opendkim")
        log_skip "OpenDKIM is already installed."
        return 0
    fi

    log_info "Installing OpenDKIM..."
    DEBIAN_FRONTEND=noninteractive apt-get install -y -qq \
        opendkim \
        opendkim-tools

    systemctl start opendkim
    systemctl enable opendkim

    INSTALLED+=("opendkim")
    log_ok "Installed and started OpenDKIM."
}

# ============================================================================
# 12 — acme.sh (Let's Encrypt SSL client)
# ============================================================================
install_acme_sh() {
    log_step "STEP 12: acme.sh (SSL Certificate Client)"

    local acme_path="${HOME}/.acme.sh/acme.sh"
    # Also check /root and common user locations
    if [[ -x "${acme_path}" ]]; then
        ALREADY_PRESENT+=("acme.sh")
        log_skip "acme.sh is already installed at ${acme_path}."
        return 0
    fi

    # Check if installed system-wide or for another user
    if command -v acme.sh &>/dev/null; then
        ALREADY_PRESENT+=("acme.sh")
        log_skip "acme.sh found in PATH."
        return 0
    fi

    log_info "Installing acme.sh..."
    curl -fsSL https://get.acme.sh | sh -s email=admin@$(hostname -f 2>/dev/null || echo "localhost")

    # Source the acme.sh function
    if [[ -f "${HOME}/.acme.sh/acme.sh" ]]; then
        chmod +x "${HOME}/.acme.sh/acme.sh"
        INSTALLED+=("acme.sh")
        log_ok "Installed acme.sh."
    else
        log_warn "acme.sh script was downloaded but not found at expected location."
    fi
}

# ============================================================================
# 13 — Create site base directory /srv/alo-sites
# ============================================================================
create_site_directory() {
    log_step "STEP 13: Site Base Directory (/srv/alo-sites)"

    if [[ -d /srv/alo-sites ]]; then
        ALREADY_PRESENT+=("/srv/alo-sites")
        log_skip "/srv/alo-sites already exists."
    else
        mkdir -p /srv/alo-sites
        log_ok "Created /srv/alo-sites."
        INSTALLED+=("/srv/alo-sites")
    fi

    # Ensure permissions are correct regardless
    chmod 755 /srv/alo-sites
    chown root:root /srv/alo-sites
    log_ok "Set permissions on /srv/alo-sites (755 root:root)."
}

# ============================================================================
# 14 — Create backup directory /var/backups/alo-sites
# ============================================================================
create_backup_directory() {
    log_step "STEP 14: Backup Directory (/var/backups/alo-sites)"

    if [[ -d /var/backups/alo-sites ]]; then
        ALREADY_PRESENT+=("/var/backups/alo-sites")
        log_skip "/var/backups/alo-sites already exists."
    else
        mkdir -p /var/backups/alo-sites
        log_ok "Created /var/backups/alo-sites."
        INSTALLED+=("/var/backups/alo-sites")
    fi

    # Ensure permissions
    chmod 755 /var/backups/alo-sites
    chown root:root /var/backups/alo-sites
    log_ok "Set permissions on /var/backups/alo-sites (755 root:root)."
}

# ============================================================================
# 15 — Copy helper scripts to /usr/local/sbin/
# ============================================================================
install_helper_scripts() {
    log_step "STEP 15: Helper Scripts → /usr/local/sbin/"

    # The helpers directory is relative to this script's location
    local script_dir
    script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    local helpers_source="${script_dir}/../helpers"

    # Fallback: check common locations if the relative path doesn't exist
    if [[ ! -d "$helpers_source" ]]; then
        # Try the CWD or well-known paths
        for candidate in "./helpers" "../helpers" "/tmp/alo-helpers" "/opt/alo-portal/helpers"; do
            if [[ -d "$candidate" ]]; then
                helpers_source="$candidate"
                break
            fi
        done
    fi

    if [[ ! -d "$helpers_source" ]]; then
        log_warn "Helpers directory not found (looked in ${helpers_source})."
        log_warn "Skipping helper script installation."
        log_warn "You can manually copy alo-*-helper scripts to /usr/local/sbin/ later."
        SKIPPED+=("helper-scripts")
        return 0
    fi

    local count=0
    local updated=0
    for helper in "${helpers_source}"'/alo-*-helper'; do
        # Handle glob with no matches
        [[ -e "$helper" ]] || continue

        local basename
        basename=$(basename "$helper")
        local dest="/usr/local/sbin/${basename}"

        if [[ -f "$dest" ]]; then
            # Check if the file is different
            if ! diff -q "$helper" "$dest" &>/dev/null; then
                cp -f "$helper" "$dest"
                chmod +x "$dest"
                log_info "Updated ${basename}."
                ((updated++))
            else
                log_skip "${basename} is already up to date."
            fi
        else
            cp "$helper" "$dest"
            chmod +x "$dest"
            log_ok "Installed ${basename}."
            ((count++))
        fi
    done

    # Also copy non-helper scripts like alo-site-lifecycle, alo-site-backup, alo-site-restore
    for script_name in alo-site-lifecycle alo-site-backup alo-site-restore; do
        local src="${helpers_source}/${script_name}"
        local dest="/usr/local/sbin/${script_name}"
        if [[ -f "$src" ]]; then
            if [[ -f "$dest" ]]; then
                if ! diff -q "$src" "$dest" &>/dev/null; then
                    cp -f "$src" "$dest"
                    chmod +x "$dest"
                    log_info "Updated ${script_name}."
                    ((updated++))
                else
                    log_skip "${script_name} is already up to date."
                fi
            else
                cp "$src" "$dest"
                chmod +x "$dest"
                log_ok "Installed ${script_name}."
                ((count++))
            fi
        fi
    done

    if [[ $count -gt 0 ]]; then
        INSTALLED+=("${count} helper scripts")
    fi
    if [[ $updated -gt 0 ]]; then
        log_info "Updated ${updated} helper scripts."
    fi
}

# ============================================================================
# 16 — Sudoers file for portal user
# ============================================================================
configure_sudoers() {
    log_step "STEP 16: Sudoers Policy (/etc/sudoers.d/alo-portal)"

    local sudoers_file="/etc/sudoers.d/alo-portal"

    # Collect all helper script paths
    local helpers_list=(
        /usr/local/sbin/alo-hosting-helper
        /usr/local/sbin/alo-site-lifecycle
        /usr/local/sbin/alo-site-backup
        /usr/local/sbin/alo-site-restore
        /usr/local/sbin/alo-database-helper
        /usr/local/sbin/alo-domain-helper
        /usr/local/sbin/alo-node-app-helper
        /usr/local/sbin/alo-file-manager-helper
        /usr/local/sbin/alo-health-helper
        /usr/local/sbin/alo-email-helper
        /usr/local/sbin/alo-log-helper
        /usr/local/sbin/alo-cron-helper
        /usr/local/sbin/alo-firewall-helper
        /usr/local/sbin/alo-ssl-helper
        /usr/local/sbin/alo-ssh-helper
    )

    # Build the sudoers content
    {
        echo "# ALO Labs Hosting Portal — Sudoers Policy"
        echo "# Installed to: ${sudoers_file}"
        echo "# Permissions:  0440 (root:root)"
        echo "# This file is managed by install-alo-portal.sh — do not edit manually."
        echo "#"
        echo "# Allow ${PORTAL_USER} to run ONLY the specific helper scripts with NOPASSWD"

        for helper in "${helpers_list[@]}"; do
            echo "${PORTAL_USER} ALL=(root) NOPASSWD: ${helper}"
        done
    } > "${sudoers_file}.tmp"

    # Validate syntax before installing
    if visudo -cf "${sudoers_file}.tmp" &>/dev/null; then
        if [[ -f "$sudoers_file" ]]; then
            if diff -q "${sudoers_file}.tmp" "$sudoers_file" &>/dev/null; then
                rm -f "${sudoers_file}.tmp"
                ALREADY_PRESENT+=("/etc/sudoers.d/alo-portal")
                log_skip "Sudoers file is already up to date."
                return 0
            fi
        fi
        mv -f "${sudoers_file}.tmp" "$sudoers_file"
        chmod 0440 "$sudoers_file"
        INSTALLED+=("/etc/sudoers.d/alo-portal")
        log_ok "Installed sudoers policy for ${PORTAL_USER}."
    else
        rm -f "${sudoers_file}.tmp"
        log_error "Sudoers syntax validation failed. Skipping sudoers install."
        log_error "Review the helper commands in the script and fix any issues."
    fi
}

# ============================================================================
# 17 — Configure UFW Firewall
# ============================================================================
configure_ufw() {
    log_step "STEP 17: UFW Firewall Rules"

    if ! command -v ufw &>/dev/null; then
        log_error "UFW is not installed. Cannot configure firewall."
        return 1
    fi

    local rules_added=false

    # Define rules: port proto description
    local -a firewall_rules=(
        "22:tcp:SSH"
        "80:tcp:HTTP"
        "443:tcp:HTTPS"
        "3000:tcp:App-Port-3000"
        "3101:tcp:App-Port-3101"
    )

    for rule_entry in "${firewall_rules[@]}"; do
        IFS=':' read -r port proto desc <<< "$rule_entry"

        # Check if rule already exists
        if ufw status | grep -qE "${port}/${proto}" 2>/dev/null; then
            log_skip "UFW rule for ${port}/${proto} (${desc}) already exists."
        else
            ufw allow "${port}/${proto}" comment "ALO Portal - ${desc}" 2>/dev/null
            log_ok "Added UFW rule: ${port}/${proto} (${desc})."
            rules_added=true
        fi
    done

    if [[ "$rules_added" == true ]]; then
        INSTALLED+=("UFW rules")
    else
        ALREADY_PRESENT+=("UFW rules")
        log_skip "All UFW rules already configured."
    fi

    # Note: We do NOT enable UFW here for safety — the admin should do that
    log_warn "UFW rules have been added but UFW is NOT enabled."
    log_warn "Enable manually when ready:  ufw enable"
}

# ============================================================================
# 18 — Create vmail user/group for email
# ============================================================================
create_vmail_user() {
    log_step "STEP 18: vmail User/Group (UID/GID 5000)"

    local vmail_uid=5000
    local vmail_gid=5000
    local vmail_home="/var/vmail"

    # Check if group exists
    if getent group vmail &>/dev/null; then
        local existing_gid
        existing_gid=$(getent group vmail | cut -d: -f3)
        if [[ "$existing_gid" == "$vmail_gid" ]]; then
            log_skip "vmail group already exists with correct GID ${vmail_gid}."
        else
            log_warn "vmail group exists with GID ${existing_gid} (expected ${vmail_gid}). Skipping."
        fi
    else
        groupadd -g "$vmail_gid" vmail
        log_ok "Created vmail group (GID ${vmail_gid})."
        INSTALLED+=("vmail group")
    fi

    # Check if user exists
    if id vmail &>/dev/null; then
        local existing_uid
        existing_uid=$(id -u vmail)
        if [[ "$existing_uid" == "$vmail_uid" ]]; then
            log_skip "vmail user already exists with correct UID ${vmail_uid}."
        else
            log_warn "vmail user exists with UID ${existing_uid} (expected ${vmail_uid}). Skipping."
        fi
    else
        useradd -u "$vmail_uid" -g "$vmail_gid" -s /usr/sbin/nologin -d "$vmail_home" -m vmail
        log_ok "Created vmail user (UID ${vmail_uid}, home: ${vmail_home})."
        INSTALLED+=("vmail user")
    fi

    # Ensure vmail home directory exists with correct permissions
    mkdir -p "$vmail_home"
    chown vmail:vmail "$vmail_home"
    chmod 750 "$vmail_home"
    log_ok "Ensured ${vmail_home} exists (750 vmail:vmail)."
}

# ============================================================================
# Summary & Next Steps
# ============================================================================
print_summary() {
    log_step "INSTALLATION SUMMARY"
    echo -e ""
    echo -e "${BOLD}OS:${NC}          Ubuntu ${VERSION_ID:-unknown} ($(uname -m))"
    echo -e "${BOLD}Timestamp:${NC}   $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
    echo -e ""

    # Installed items
    if [[ ${#INSTALLED[@]} -gt 0 ]]; then
        echo -e "${GREEN}${BOLD}✓ Newly Installed:${NC}"
        for item in "${INSTALLED[@]}"; do
            echo -e "  ${GREEN}+${NC} ${item}"
        done
        echo -e ""
    fi

    # Already present items
    if [[ ${#ALREADY_PRESENT[@]} -gt 0 ]]; then
        echo -e "${CYAN}${BOLD}● Already Present:${NC}"
        for item in "${ALREADY_PRESENT[@]}"; do
            echo -e "  ${CYAN}•${NC} ${item}"
        done
        echo -e ""
    fi

    # Skipped items
    if [[ ${#SKIPPED[@]} -gt 0 ]]; then
        echo -e "${YELLOW}${BOLD}⊘ Skipped:${NC}"
        for item in "${SKIPPED[@]}"; do
            echo -e "  ${YELLOW}!${NC} ${item}"
        done
        echo -e ""
    fi

    # Service status
    echo -e "${BOLD}Service Status:${NC}"
    local -a services=(
        caddy:"Caddy"
        mariadb:"MariaDB"
        mysql:"MariaDB"
        postgresql:"PostgreSQL"
        php8.2-fpm:"PHP 8.2 FPM"
        docker:"Docker"
        containerd:"Containerd"
        postfix:"Postfix"
        dovecot:"Dovecot"
        opendkim:"OpenDKIM"
    )

    for svc_entry in "${services[@]}"; do
        IFS=':' read -r svc_name svc_label <<< "$svc_entry"
        if systemctl is-active --quiet "$svc_name" 2>/dev/null; then
            echo -e "  ${GREEN}●${NC} ${svc_label} — running"
        elif systemctl is-enabled --quiet "$svc_name" 2>/dev/null; then
            echo -e "  ${YELLOW}○${NC} ${svc_label} — enabled but not running"
        elif command -v "$svc_name" &>/dev/null || dpkg -s "$svc_name" &>/dev/null 2>/dev/null; then
            echo -e "  ${RED}○${NC} ${svc_label} — installed but not active"
        fi
    done
    echo -e ""
}

print_next_steps() {
    log_step "NEXT STEPS"
    echo -e ""
    echo -e "${BOLD}1. Deploy the ALO Portal application:${NC}"
    echo -e "   cp -r /path/to/alo-portal-project /srv/alo-sites/portal"
    echo -e "   cd /srv/alo-sites/portal"
    echo -e ""
    echo -e "${BOLD}2. Install dependencies:${NC}"
    echo -e "   npm ci"
    echo -e ""
    echo -e "${BOLD}3. Set up the database:${NC}"
    echo -e "   npx prisma db push"
    echo -e "   npx prisma generate"
    echo -e ""
    echo -e "${BOLD}4. Build and start with PM2:${NC}"
    echo -e "   npm run build"
    echo -e "   pm2 start npm --name \"alo-portal\" -- start"
    echo -e "   pm2 save"
    echo -e "   pm2 startup"
    echo -e ""
    echo -e "${BOLD}5. Configure Caddy reverse proxy:${NC}"
    echo -e "   # Create /etc/caddy/sites-enabled/portal.conf with your domain"
    echo -e "   caddy validate --config /etc/caddy/Caddyfile"
    echo -e "   systemctl reload caddy"
    echo -e ""
    echo -e "${BOLD}6. Create the portal system user (if not exists):${NC}"
    echo -e "   useradd -m -s /bin/bash ${PORTAL_USER}"
    echo -e "   usermod -aG docker ${PORTAL_USER}"
    echo -e ""
    echo -e "${BOLD}7. Enable UFW firewall (when ready):${NC}"
    echo -e "   ufw enable"
    echo -e "   ufw status verbose"
    echo -e ""
    echo -e "${BOLD}8. Configure email (Postfix/Dovecot/OpenDKIM):${NC}"
    echo -e "   Edit /etc/postfix/main.cf for your domain"
    echo -e "   Edit /etc/dovecot/conf.d/*.conf for mailboxes"
    echo -e "   Configure DKIM keys with opendkim"
    echo -e ""
    echo -e "${MAGENTA}${BOLD}═══════════════════════════════════════════════════════════════${NC}"
    echo -e "${MAGENTA}${BOLD}  ALO Labs Private Hosting Control Center — Installation Complete  ${NC}"
    echo -e "${MAGENTA}${BOLD}═══════════════════════════════════════════════════════════════${NC}"
    echo -e ""
}

# ============================================================================
# Main execution
# ============================================================================
main() {
    echo -e ""
    echo -e "${MAGENTA}${BOLD}╔═══════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${MAGENTA}${BOLD}║  ALO Labs — Private Hosting Control Center Installer         ║${NC}"
    echo -e "${MAGENTA}${BOLD}║  Idempotent Production Setup for Ubuntu 22.04 / 24.04        ║${NC}"
    echo -e "${MAGENTA}${BOLD}╚═══════════════════════════════════════════════════════════════╝${NC}"
    echo -e ""

    # Source os-release globally for VERSION_ID in summary
    # shellcheck disable=SC1091
    source /etc/os-release 2>/dev/null || true

    preflight_checks
    install_core_packages
    install_nodejs
    install_pm2
    install_caddy
    install_mariadb
    install_postgresql
    install_php
    install_docker
    install_postfix
    install_dovecot
    install_opendkim
    install_acme_sh
    create_site_directory
    create_backup_directory
    install_helper_scripts
    configure_sudoers
    configure_ufw
    create_vmail_user

    print_summary
    print_next_steps
}

# Run main with all arguments
main "$@"
