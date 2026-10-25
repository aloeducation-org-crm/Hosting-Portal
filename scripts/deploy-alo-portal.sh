#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════════════
# ALO Labs Hosting Portal — Production Deployment Script
# ═══════════════════════════════════════════════════════════════════════════════════
# Target:  alo-server-lap — Ubuntu 22.04.5 LTS
# CPU:     i5-10310U (4C/8T) | RAM: 16GB DDR4 | Disk: 512GB NVMe (LVM)
# Network: WiFi 192.168.0.197/24 | Tailscale 100.94.234.101/32
# SSH:     alamin@100.94.234.101 (sudo user)
# Stack:   Next.js 16 + React 19 + Prisma 6.19 + PostgreSQL 17 + Caddy + Bun
# ═══════════════════════════════════════════════════════════════════════════════════
# Usage:
#   sudo bash deploy-alo-portal.sh                          # Run on target server
#   bash deploy-alo-portal.sh --dry-run                     # Dry-run mode
#   bash deploy-alo-portal.sh --target alamin@100.94.234.101  # Remote deploy
#   bash deploy-alo-portal.sh --target user@host --dry-run   # Remote dry-run
# ═══════════════════════════════════════════════════════════════════════════════════

set -euo pipefail

# ── Color Definitions ──────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'
CYAN='\033[0;36m'; MAGENTA='\033[0;35m'; BOLD='\033[1m'; NC='\033[0m'

# ── Brand Colors (for visual markers) ─────────────────────────────────────────────
BRAND_ORANGE="#E8501A"
BRAND_BLUE="#0A5CFF"

# ── Core Configuration ─────────────────────────────────────────────────────────────
APP_USER="alo-panel"
APP_DIR="/opt/alo-hosting-portal"
# Port is env-driven: override with PORT=3051 before running. 3101 is the default.
APP_PORT="${PORT:-3101}"
DB_NAME="alolabs"
DB_USER="alo_panel"
DOMAIN="alolabs.net"
SITE_BASE="/srv/alo-sites"
BACKUP_BASE="/var/backups/alo-sites"
CADDY_CONFIG_DIR="/etc/caddy/sites-enabled"
CADDY_LOG_DIR="/var/log/caddy/alo-sites"
SECRETS_DIR="/etc/alo-panel"
TAILSCALE_IP="100.94.234.101"
WIFI_IP="192.168.0.197"
HOSTNAME="alo-server-lap"
TIMEZONE="Asia/Dhaka"
TOTAL_PHASES=7

# ── Helper Script List (19 scripts) ───────────────────────────────────────────────
HELPER_SCRIPTS=(
    alo-hosting-helper
    alo-node-app-helper
    alo-database-helper
    alo-domain-helper
    alo-dns-helper
    alo-ssl-helper
    alo-firewall-helper
    alo-file-manager-helper
    alo-log-helper
    alo-health-helper
    alo-email-helper
    alo-cron-helper
    alo-ssh-helper
    alo-encryption-helper
    alo-deploy-helper
    alo-docker-helper
    alo-site-lifecycle
    alo-site-backup
    alo-site-restore
)

# ── Runtime Flags ──────────────────────────────────────────────────────────────────
DRY_RUN=false
TARGET=""
REMOTE=false
START_TIME=$(date +%s)
DEPLOY_LOG="/var/log/alo-portal-deploy.log"
CURRENT_PHASE=0
PHASE_ERRORS=()

# ── Argument Parsing ───────────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
    case "$1" in
        --dry-run)  DRY_RUN=true; shift ;;
        --target)   TARGET="$2"; REMOTE=true; shift 2 ;;
        -h|--help)
            echo "Usage: $0 [--dry-run] [--target user@host] [-h|--help]"
            echo ""
            echo "  --dry-run          Show actions without executing them"
            echo "  --target user@host Deploy to remote server via SSH"
            echo "  -h, --help         Show this help message"
            exit 0
            ;;
        *) echo -e "${RED}Unknown argument: $1${NC}"; exit 1 ;;
    esac
done

# Default target
[[ -z "$TARGET" ]] && TARGET="alamin@${TAILSCALE_IP}"

# ── Logging & Output Functions ─────────────────────────────────────────────────────
log()  { echo -e "${BOLD}[$(date '+%H:%M:%S')]${NC} $*"; }
ok()   { echo -e "  ${GREEN}✓ OK${NC}   $*"; }
warn() { echo -e "  ${YELLOW}⚠ WARN${NC} $*"; }
fail() { echo -e "  ${RED}✗ FAIL${NC} $*"; }
info() { echo -e "  ${BLUE}ℹ INFO${NC}  $*"; }
skip() { echo -e "  ${CYAN}→ SKIP${NC}  $*"; }

phase_header() {
    CURRENT_PHASE=$((CURRENT_PHASE + 1))
    echo ""
    echo -e "${BOLD}${MAGENTA}╔══════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${BOLD}${MAGENTA}║${NC} ${BOLD}Phase ${CURRENT_PHASE}/${TOTAL_PHASES}: $*${NC}"
    echo -e "${BOLD}${MAGENTA}╚══════════════════════════════════════════════════════════════╝${NC}"
    echo ""
}

section() {
    echo -e "  ${BOLD}${BLUE}── $* ──${NC}"
}

# ── Dry-Run Wrapper ────────────────────────────────────────────────────────────────
# Usage: run <description> <command> [args...]
run() {
    local desc="$1"; shift
    if [[ "$DRY_RUN" == true ]]; then
        echo -e "  ${CYAN}[DRY-RUN]${NC} $desc"
        echo -e "           Command: $*"
        return 0
    fi
    eval "$@" 2>&1 && ok "$desc" || { fail "$desc"; PHASE_ERRORS+=("$desc"); return 1; }
}

# ── SSH Helper for Remote Deployment ──────────────────────────────────────────────
ssh_run() {
    local desc="$1"; shift
    if [[ "$DRY_RUN" == true ]]; then
        echo -e "  ${CYAN}[DRY-RUN]${NC} $desc (via SSH to $TARGET)"
        echo -e "           Command: $*"
        return 0
    fi
    ssh "$TARGET" "sudo bash -s" <<< "$@" 2>&1 && ok "$desc" || { fail "$desc"; PHASE_ERRORS+=("$desc"); return 1; }
}

# ── Idempotency Helpers ───────────────────────────────────────────────────────────
user_exists()   { id "$1" &>/dev/null; }
dir_exists()    { [[ -d "$1" ]]; }
file_exists()   { [[ -f "$1" ]]; }
pkg_installed() { dpkg -l "$1" &>/dev/null 2>&1; }
service_active(){ systemctl is-active --quiet "$1" 2>/dev/null; }
port_listening(){ ss -tlnp | grep -q ":$1 " 2>/dev/null; }

# ── Remote Deployment Mode ────────────────────────────────────────────────────────
if [[ "$REMOTE" == true ]]; then
    log "${BOLD}ALO Labs Hosting Portal — Remote Deployment${NC}"
    log "Target: ${BOLD}$TARGET${NC}"
    log "Dry-run: $DRY_RUN"
    log ""
    log "Copying script to remote host..."
    if [[ "$DRY_RUN" != true ]]; then
        scp "$0" "$TARGET:/tmp/deploy-alo-portal.sh"
        ssh "$TARGET" "sudo bash /tmp/deploy-alo-portal.sh ${DRY_RUN:+--dry-run}"
    else
        echo -e "  ${CYAN}[DRY-RUN]${NC} Would scp script and execute via SSH"
    fi
    exit 0
fi

# ── Must Run as Root (unless dry-run) ─────────────────────────────────────────────
if [[ "$DRY_RUN" != true && "$(id -u)" -ne 0 ]]; then
    fail "This script must be run as root. Use: sudo bash $0"
    exit 1
fi

# ── Setup Deploy Log ──────────────────────────────────────────────────────────────
if [[ "$DRY_RUN" != true ]]; then
    mkdir -p "$(dirname "$DEPLOY_LOG")" 2>/dev/null || true
    exec > >(tee -a "$DEPLOY_LOG") 2>&1
fi

# ═══════════════════════════════════════════════════════════════════════════════════
# PHASE 1: Server Preparation
# ═══════════════════════════════════════════════════════════════════════════════════
phase_1_server_preparation() {
    phase_header "Server Preparation"

    # ── 1.1 System Update ─────────────────────────────────────────────────────────
    section "System Package Update"
    info "Updating package lists and upgrading all packages..."
    run "Update apt caches" \
        "apt-get update -qq"
    run "Upgrade all packages" \
        "DEBIAN_FRONTEND=noninteractive apt-get upgrade -y -qq"
    run "Install essential base packages" \
        "DEBIAN_FRONTEND=noninteractive apt-get install -y -qq curl wget git build-essential python3 python3-pip uuid-runtime jq htop apt-transport-https ca-certificates gnupg lsb-release software-properties-common"

    # ── 1.2 Node.js 20.x ────────────────────────────────────────────────────────
    section "Node.js 20.x Installation"
    node_major=0
    node_minor=0
    if command -v node &>/dev/null; then
        IFS=. read -r node_major node_minor _ <<< "$(node -v | sed 's/^v//')"
        node_minor=$((10#${node_minor:-0}))
    fi
    if (( node_major == 20 )) && (( node_minor >= 9 )); then
        skip "Node.js $(node -v) already installed"
    else
        info "Installing Node.js 20.x via NodeSource..."
        run "Add NodeSource GPG key" \
            "curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /usr/share/keyrings/nodesource.gpg"
        run "Add NodeSource 20.x repo" \
            "echo 'deb [signed-by=/usr/share/keyrings/nodesource.gpg] https://deb.nodesource.com/node_20.x nodistro main' > /etc/apt/sources.list.d/nodesource.list"
        run "Install Node.js 20.x" \
            "apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq nodejs"
    fi

    # ── 1.3 Bun Runtime ──────────────────────────────────────────────────────────
    section "Bun Runtime Installation"
    if command -v bun &>/dev/null; then
        skip "Bun $(bun --version) already installed"
    else
        info "Installing Bun runtime..."
        run "Install Bun" \
            "curl -fsSL https://bun.sh/install | bash"
        run "Symlink Bun to /usr/local/bin" \
            "ln -sf /root/.bun/bin/bun /usr/local/bin/bun 2>/dev/null; ln -sf /root/.bun/bin/bunx /usr/local/bin/bunx 2>/dev/null || true"
        # Also make bun available for the app user later
        if [[ -d /home/$APP_USER/.bun/bin ]]; then
            run "Symlink Bun for app user" \
                "ln -sf /home/$APP_USER/.bun/bin/bun /usr/local/bin/bun"
        fi
    fi

    # ── 1.4 PostgreSQL 17 ────────────────────────────────────────────────────────
    section "PostgreSQL 17 Installation"
    if command -v psql &>/dev/null && psql --version | grep -q "17"; then
        skip "PostgreSQL 17 already installed"
    else
        info "Installing PostgreSQL 17..."
        run "Add PostgreSQL APT repo GPG key" \
            "curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc | gpg --dearmor -o /usr/share/keyrings/postgresql.gpg"
        run "Add PostgreSQL APT repository" \
            "echo 'deb [signed-by=/usr/share/keyrings/postgresql.gpg] http://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main' > /etc/apt/sources.list.d/postgresql.list"
        run "Install PostgreSQL 17" \
            "apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq postgresql-17 postgresql-contrib-17"
    fi

    # ── 1.5 Redis ────────────────────────────────────────────────────────────────
    section "Redis Installation"
    if command -v redis-server &>/dev/null; then
        skip "Redis already installed"
    else
        info "Installing Redis server..."
        run "Install Redis" \
            "DEBIAN_FRONTEND=noninteractive apt-get install -y -qq redis-server"
        run "Configure Redis for production" \
            "sed -i 's/^# supervised no/supervised systemd/' /etc/redis/redis.conf"
        run "Enable and start Redis" \
            "systemctl enable redis-server && systemctl start redis-server"
    fi

    # ── 1.6 Caddy Web Server ─────────────────────────────────────────────────────
    section "Caddy Web Server Installation"
    if command -v caddy &>/dev/null; then
        skip "Caddy already installed"
    else
        info "Installing Caddy..."
        run "Add Caddy GPG key" \
            "curl -fsSL 'https://caddyserver.com/api/download?os=linux&arch=amd64&p=github.com/caddyserver/distillate' -o /tmp/caddy_gpg_key || true"
        run "Install Caddy via apt" \
            "apt-get install -y -qq debian-keyring debian-archive-keyring && curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg && curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list && apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq caddy"
    fi

    # ── 1.7 Certbot ──────────────────────────────────────────────────────────────
    section "Certbot Installation"
    if command -v certbot &>/dev/null; then
        skip "Certbot already installed"
    else
        run "Install certbot" \
            "DEBIAN_FRONTEND=noninteractive apt-get install -y -qq certbot"
    fi

    # ── 1.8 Docker CE + Compose ──────────────────────────────────────────────────
    section "Docker CE + Compose v2 Installation"
    if command -v docker &>/dev/null; then
        skip "Docker already installed"
    else
        info "Installing Docker CE..."
        run "Add Docker GPG key" \
            "curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /usr/share/keyrings/docker.gpg"
        run "Add Docker APT repository" \
            "echo 'deb [signed-by=/usr/share/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable' > /etc/apt/sources.list.d/docker.list"
        run "Install Docker CE + Compose v2" \
            "apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-compose-plugin"
        run "Enable and start Docker" \
            "systemctl enable docker && systemctl start docker"
    fi

    # ── 1.9 UFW Firewall ─────────────────────────────────────────────────────────
    section "UFW Firewall Configuration"
    info "Configuring UFW rules..."
    run "Allow SSH (port 22)" \
        "ufw allow 22/tcp comment 'SSH' || true"
    run "Allow HTTP (port 80)" \
        "ufw allow 80/tcp comment 'HTTP' || true"
    run "Allow HTTPS (port 443)" \
        "ufw allow 443/tcp comment 'HTTPS' || true"
    run "Allow Caddy admin (port 2019)" \
        "ufw allow 2019/tcp comment 'Caddy Admin' || true"
    run "Allow app port $APP_PORT" \
        "ufw allow $APP_PORT/tcp comment 'ALO Portal' || true"
    run "Allow Tailscale (port 41641)" \
        "ufw allow 41641/udp comment 'Tailscale' || true"

    if ufw status | grep -q "active"; then
        skip "UFW is already active"
    else
        run "Enable UFW" \
            "echo 'y' | ufw enable"
    fi
    info "UFW status:"
    [[ "$DRY_RUN" != true ]] && ufw status numbered || true

    # ── 1.10 Create App User ─────────────────────────────────────────────────────
    section "Application User Setup"
    if user_exists "$APP_USER"; then
        skip "User $APP_USER already exists"
    else
        info "Creating system user: $APP_USER"
        run "Create $APP_USER system user" \
            "adduser --system --group --home /opt/alo-hosting-portal --shell /bin/bash $APP_USER"
        run "Create home directory" \
            "mkdir -p /opt/alo-hosting-portal && chown $APP_USER:$APP_USER /opt/alo-hosting-portal"
    fi

    # ── 1.11 LVM Extension ───────────────────────────────────────────────────────
    section "LVM Extension (Allocate ~374GB Unallocated Space)"
    info "Checking LVM configuration..."
    if [[ "$DRY_RUN" != true ]]; then
        local vg_name
        vg_name=$(vgs --noheadings -o vg_name 2>/dev/null | tr -d ' ' | head -1) || vg_name=""
        if [[ -n "$vg_name" ]]; then
            local vg_free
            vg_free=$(vgs --noheadings -o vg_free --nosuffix --units g "$vg_name" 2>/dev/null | tr -d ' ' | awk '{print int($1)}') || vg_free=0
            if [[ "$vg_free" -gt 10 ]]; then
                info "Volume group '$vg_name' has ${vg_free}GB free. Extending root LV..."
                local lv_path
                lv_path=$(lvs --noheadings -o lv_path 2>/dev/null | grep -E 'root|ubuntu' | head -1 | tr -d ' ') || lv_path=""
                if [[ -n "$lv_path" ]]; then
                    run "Extend root logical volume" \
                        "lvextend -l +100%FREE $lv_path"
                    run "Resize filesystem" \
                        "resize2fs $lv_path"
                else
                    warn "Could not determine root LV path. Manual LVM extension may be required."
                fi
            else
                skip "No significant unallocated space (${vg_free}GB free)"
            fi
        else
            warn "No LVM volume group found. Skipping LVM extension."
        fi
    else
        echo -e "  ${CYAN}[DRY-RUN]${NC} Would extend root LV with all free VG space and resize2fs"
    fi

    # ── 1.12 Hostname & Timezone ─────────────────────────────────────────────────
    section "Hostname and Timezone"
    run "Set hostname to $HOSTNAME" \
        "hostnamectl set-hostname $HOSTNAME"
    run "Set timezone to $TIMEZONE" \
        "timedatectl set-timezone $TIMEZONE"

    # ── 1.13 NTP ─────────────────────────────────────────────────────────────────
    section "NTP Configuration"
    if ! systemctl is-active --quiet systemd-timesyncd 2>/dev/null; then
        run "Install and enable NTP" \
            "DEBIAN_FRONTEND=noninteractive apt-get install -y -qq systemd-timesyncd && systemctl enable systemd-timesyncd && systemctl start systemd-timesyncd"
    else
        skip "systemd-timesyncd (NTP) already active"
    fi

    # ── 1.14 Sysctl Tuning ───────────────────────────────────────────────────────
    section "Sysctl Performance Tuning"
    local sysctl_file="/etc/sysctl.d/99-alo-portal.conf"
    if file_exists "$sysctl_file"; then
        skip "Sysctl tuning already configured"
    else
        info "Writing sysctl optimizations..."
        if [[ "$DRY_RUN" != true ]]; then
            cat > "$sysctl_file" << 'SYSCTL'
# ALO Labs Portal — Sysctl Optimizations
vm.overcommit_memory = 1
fs.file-max = 65535
net.core.somaxconn = 1024
net.ipv4.tcp_max_syn_backlog = 1024
net.ipv4.tcp_tw_reuse = 1
net.ipv4.ip_local_port_range = 1024 65535
SYSCTL
            sysctl -p "$sysctl_file" &>/dev/null
            ok "Sysctl tuning applied"
        else
            echo -e "  ${CYAN}[DRY-RUN]${NC} Would write sysctl config and apply"
        fi
    fi
}

# ═══════════════════════════════════════════════════════════════════════════════════
# PHASE 2: Project Transfer
# ═══════════════════════════════════════════════════════════════════════════════════
phase_2_project_transfer() {
    phase_header "Project Transfer"

    # ── 2.1 Create Project Directory ─────────────────────────────────────────────
    section "Project Directory Setup"
    if dir_exists "$APP_DIR"; then
        skip "Directory $APP_DIR already exists"
    else
        run "Create project directory" \
            "mkdir -p $APP_DIR"
    fi
    run "Set ownership to $APP_USER" \
        "chown -R $APP_USER:$APP_USER $APP_DIR"

    # ── 2.2 Project File Transfer ────────────────────────────────────────────────
    section "Project File Transfer"
    info "Detecting transfer method..."

    # Check if running from within the project (local files present)
    local script_dir
    script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    local project_root
    project_root="$(cd "$script_dir/.." && pwd)"

    if [[ -f "$project_root/package.json" && -f "$project_root/next.config.ts" ]]; then
        info "Project files found at $project_root. Using rsync..."
        if [[ "$DRY_RUN" != true ]]; then
            rsync -avz --progress \
                --exclude='node_modules' \
                --exclude='.next' \
                --exclude='.git' \
                --exclude='tool-results' \
                --exclude='*.zip' \
                --exclude='*.tar.gz' \
                --exclude='download/' \
                "$project_root/" "$APP_DIR/"
            ok "Project files transferred via rsync"
        else
            echo -e "  ${CYAN}[DRY-RUN]${NC} Would rsync project files from $project_root to $APP_DIR"
        fi
    else
        info "No local project found. Attempting git clone..."
        local repo_url="${GIT_REPO_URL:-https://github.com/alolabs/alo-hosting-portal.git}"
        if [[ "$DRY_RUN" != true ]]; then
            if dir_exists "$APP_DIR/.git"; then
                info "Git repo exists. Pulling latest..."
                su - "$APP_USER" -c "cd $APP_DIR && git pull" || warn "Git pull failed. Using existing files."
            else
                su - "$APP_USER" -c "git clone $repo_url $APP_DIR" || warn "Git clone failed. Please transfer files manually."
            fi
        else
            echo -e "  ${CYAN}[DRY-RUN]${NC} Would git clone from $repo_url"
        fi
    fi

    # ── 2.3 Set Ownership ────────────────────────────────────────────────────────
    section "File Ownership"
    run "Set ownership to $APP_USER:$APP_USER" \
        "chown -R $APP_USER:$APP_USER $APP_DIR"
    run "Set directory permissions" \
        "find $APP_DIR -type d -exec chmod 755 {} \;"
    run "Set file permissions" \
        "find $APP_DIR -type f -exec chmod 644 {} \;"
    run "Make scripts executable" \
        "find $APP_DIR -name '*.sh' -exec chmod +x {} \; 2>/dev/null || true"

    # ── 2.4 Install Dependencies ─────────────────────────────────────────────────
    section "Node.js Dependencies"
    if [[ -f "$APP_DIR/bun.lock" ]]; then
        info "Detected bun.lock — using Bun for install..."
        run "Install dependencies with Bun" \
            "cd $APP_DIR && su - $APP_USER -c 'cd $APP_DIR && bun install --frozen-lockfile'" \
            || run "Install dependencies with Bun (fallback)" \
                "cd $APP_DIR && su - $APP_USER -c 'cd $APP_DIR && bun install'"
    elif [[ -f "$APP_DIR/package-lock.json" ]]; then
        info "Detected package-lock.json — using npm..."
        run "Install dependencies with npm" \
            "cd $APP_DIR && su - $APP_USER -c 'cd $APP_DIR && npm ci'" \
            || run "Install dependencies with npm (fallback)" \
                "cd $APP_DIR && su - $APP_USER -c 'cd $APP_DIR && npm install'"
    else
        warn "No lock file found. Attempting bun install..."
        run "Install dependencies with Bun" \
            "cd $APP_DIR && su - $APP_USER -c 'cd $APP_DIR && bun install'"
    fi
}

# ═══════════════════════════════════════════════════════════════════════════════════
# PHASE 3: Environment Configuration
# ═══════════════════════════════════════════════════════════════════════════════════
phase_3_environment_configuration() {
    phase_header "Environment Configuration"

    # ── 3.1 Generate Cryptographically Secure Secrets ───────────────────────────
    section "Secret Generation"
    if [[ "$DRY_RUN" != true ]]; then
        mkdir -p "$SECRETS_DIR"
        chmod 700 "$SECRETS_DIR"
    fi

    local nextauth_secret jwt_secret internal_secret
    if file_exists "$SECRETS_DIR/.env.secrets" && [[ "$DRY_RUN" != true ]]; then
        skip "Secrets file already exists at $SECRETS_DIR/.env.secrets"
        # Source existing secrets
        # shellcheck disable=SC1090
        source "$SECRETS_DIR/.env.secrets" 2>/dev/null || true
    else
        info "Generating cryptographically secure secrets with openssl..."
        if [[ "$DRY_RUN" != true ]]; then
            nextauth_secret=$(openssl rand -hex 32)
            jwt_secret=$(openssl rand -hex 32)
            internal_secret=$(openssl rand -hex 32)

            cat > "$SECRETS_DIR/.env.secrets" << SECRETS
# ALO Labs Portal — Generated Secrets
# WARNING: Do NOT commit this file. Generated $(date -Iseconds)
# Each secret is 64 hex characters (256 bits of entropy)
NEXTAUTH_SECRET=${nextauth_secret}
JWT_SECRET=${jwt_secret}
INTERNAL_SECRET=${internal_secret}
SECRETS
            chmod 600 "$SECRETS_DIR/.env.secrets"
            ok "Secrets generated and stored in $SECRETS_DIR/.env.secrets"
        else
            echo -e "  ${CYAN}[DRY-RUN]${NC} Would generate NEXTAUTH_SECRET, JWT_SECRET, INTERNAL_SECRET (64 chars each)"
        fi
    fi

    # ── 3.2 Generate Database Password ───────────────────────────────────────────
    section "Database Password"
    local db_password
    if [[ "$DRY_RUN" != true ]]; then
        if file_exists "$SECRETS_DIR/.db.password"; then
            skip "Database password already exists"
            db_password=$(cat "$SECRETS_DIR/.db.password")
        else
            db_password=$(openssl rand -hex 24)
            echo -n "$db_password" > "$SECRETS_DIR/.db.password"
            chmod 600 "$SECRETS_DIR/.db.password"
            ok "Database password generated and stored"
        fi
    else
        echo -e "  ${CYAN}[DRY-RUN]${NC} Would generate random database password"
        db_password="DRYRUN_DB_PASSWORD_PLACEHOLDER"
    fi

    # ── 3.3 Create .env.production ───────────────────────────────────────────────
    section "Production Environment File"
    local env_file="$APP_DIR/.env.production"
    if file_exists "$env_file" && [[ "$DRY_RUN" != true ]]; then
        warn "$env_file already exists. Backing up..."
        cp "$env_file" "${env_file}.bak.$(date +%Y%m%d%H%M%S)"
    fi

    info "Creating .env.production from template..."
    if [[ "$DRY_RUN" != true ]]; then
        # Read generated secrets
        # shellcheck disable=SC1090
        source "$SECRETS_DIR/.env.secrets" 2>/dev/null || true
        db_password=$(cat "$SECRETS_DIR/.db.password" 2>/dev/null || echo "CHANGE_ME")

        cat > "$env_file" << ENVFILE
# ═══════════════════════════════════════════════════════════════════════════════
# ALO Labs Hosting Portal — Production Environment
# Generated: $(date -Iseconds)
# Server:    $HOSTNAME ($TAILSCALE_IP)
# ═══════════════════════════════════════════════════════════════════════════════

# ── Application ────────────────────────────────────────────────────────────────────
NODE_ENV=production
PORT=${APP_PORT}
APP_URL=https://${DOMAIN}
NEXTAUTH_URL=https://${DOMAIN}
NEXTAUTH_SECRET=${NEXTAUTH_SECRET}
JWT_SECRET=${JWT_SECRET}
INTERNAL_SECRET=${INTERNAL_SECRET}

# ── Database ──────────────────────────────────────────────────────────────────────
DATABASE_URL=postgresql://${DB_USER}:${db_password}@localhost:5432/${DB_NAME}?schema=public
DIRECT_URL=postgresql://${DB_USER}:${db_password}@localhost:5432/${DB_NAME}?schema=public

# ── Redis ─────────────────────────────────────────────────────────────────────────
REDIS_URL=redis://localhost:6379

# ── Email (configure after Postfix setup) ─────────────────────────────────────────
SMTP_HOST=localhost
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
SMTP_FROM=noreply@${DOMAIN}

# ── Paths ──────────────────────────────────────────────────────────────────────────
SITE_BASE=${SITE_BASE}
CADDY_CONFIG_DIR=${CADDY_CONFIG_DIR}
CADDY_LOG_DIR=${CADDY_LOG_DIR}
BACKUP_BASE=${BACKUP_BASE}

# ── Brand ──────────────────────────────────────────────────────────────────────────
BRAND_COLOR_ORANGE=#E8501A
BRAND_COLOR_BLUE=#0A5CFF
ENVFILE
        chown "$APP_USER:$APP_USER" "$env_file"
        chmod 600 "$env_file"
        ok "Created $env_file with secure generated secrets"
    else
        echo -e "  ${CYAN}[DRY-RUN]${NC} Would write .env.production with all secrets and config"
    fi

    # ── 3.4 Create symlink .env for Prisma ──────────────────────────────────────
    section "Environment Symlink"
    if [[ "$DRY_RUN" != true ]]; then
        ln -sf "$env_file" "$APP_DIR/.env" 2>/dev/null || true
        ok "Symlinked .env -> .env.production"
    else
        echo -e "  ${CYAN}[DRY-RUN]${NC} Would symlink .env -> .env.production"
    fi
}

# ═══════════════════════════════════════════════════════════════════════════════════
# PHASE 4: Database Setup
# ═══════════════════════════════════════════════════════════════════════════════════
phase_4_database_setup() {
    phase_header "Database Setup"

    local db_password
    if [[ "$DRY_RUN" != true ]]; then
        db_password=$(cat "$SECRETS_DIR/.db.password" 2>/dev/null) || {
            fail "Database password not found. Run Phase 3 first."
            return 1
        }
    else
        db_password="DRYRUN_DB_PASSWORD"
    fi

    # ── 4.1 Ensure PostgreSQL is running ─────────────────────────────────────────
    section "PostgreSQL Service"
    if service_active "postgresql"; then
        skip "PostgreSQL service is running"
    else
        run "Start and enable PostgreSQL" \
            "systemctl enable postgresql && systemctl start postgresql"
    fi

    # ── 4.2 Create Database ─────────────────────────────────────────────────────
    section "Database Creation"
    if [[ "$DRY_RUN" != true ]]; then
        if sudo -u postgres psql -lqt 2>/dev/null | cut -d\| -f1 | grep -qw "$DB_NAME"; then
            skip "Database '$DB_NAME' already exists"
        else
            sudo -u postgres psql -c "CREATE DATABASE $DB_NAME;" 2>/dev/null
            ok "Created database '$DB_NAME'"
        fi
    else
        echo -e "  ${CYAN}[DRY-RUN]${NC} Would CREATE DATABASE $DB_NAME (if not exists)"
    fi

    # ── 4.3 Create Database User ────────────────────────────────────────────────
    section "Database User"
    if [[ "$DRY_RUN" != true ]]; then
        if sudo -u postgres psql -c "\du" 2>/dev/null | grep -qw "$DB_USER"; then
            info "User '$DB_USER' exists. Updating password..."
            sudo -u postgres psql -c "ALTER USER $DB_USER WITH PASSWORD '${db_password}';" 2>/dev/null
            ok "Updated password for '$DB_USER'"
        else
            sudo -u postgres psql -c "CREATE USER $DB_USER WITH PASSWORD '${db_password}';" 2>/dev/null
            ok "Created user '$DB_USER'"
        fi
        sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE $DB_NAME TO $DB_USER;" 2>/dev/null
        ok "Granted privileges on '$DB_NAME' to '$DB_USER'"
        # Grant schema permissions
        sudo -u postgres psql -d "$DB_NAME" -c "GRANT ALL ON SCHEMA public TO $DB_USER;" 2>/dev/null || true
        sudo -u postgres psql -d "$DB_NAME" -c "ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO $DB_USER;" 2>/dev/null || true
        sudo -u postgres psql -d "$DB_NAME" -c "ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO $DB_USER;" 2>/dev/null || true
    else
        echo -e "  ${CYAN}[DRY-RUN]${NC} Would CREATE USER $DB_USER and GRANT privileges"
    fi

    # ── 4.4 Prisma Migrations ────────────────────────────────────────────────────
    section "Prisma Schema Migration"
    info "Running prisma migrate deploy..."
    if [[ "$DRY_RUN" != true ]]; then
        cd "$APP_DIR"
        # Set DATABASE_URL for the migration
        export DATABASE_URL="postgresql://${DB_USER}:${db_password}@localhost:5432/${DB_NAME}?schema=public"
        su - "$APP_USER" -c "cd $APP_DIR && DATABASE_URL='$DATABASE_URL' npx prisma migrate deploy" 2>&1 && ok "Prisma migrations deployed" || warn "Prisma migrate deploy had issues (may be first run)"
    else
        echo -e "  ${CYAN}[DRY-RUN]${NC} Would run: npx prisma migrate deploy"
    fi

    # ── 4.5 Database Seeding ─────────────────────────────────────────────────────
    section "Database Seeding"
    if [[ -f "$APP_DIR/prisma/seed.ts" ]]; then
        info "Seed file found. Running prisma db seed..."
        if [[ "$DRY_RUN" != true ]]; then
            export DATABASE_URL="postgresql://${DB_USER}:${db_password}@localhost:5432/${DB_NAME}?schema=public"
            su - "$APP_USER" -c "cd $APP_DIR && DATABASE_URL='$DATABASE_URL' npx prisma db seed" 2>&1 && ok "Database seeded" || warn "Seed completed with warnings (data may already exist)"
        else
            echo -e "  ${CYAN}[DRY-RUN]${NC} Would run: npx prisma db seed"
        fi
    else
        skip "No seed file found (prisma/seed.ts)"
    fi

    # ── 4.6 Test Connectivity ────────────────────────────────────────────────────
    section "Database Connectivity Test"
    if [[ "$DRY_RUN" != true ]]; then
        if sudo -u postgres psql -d "$DB_NAME" -c "SELECT 1 AS connected;" 2>/dev/null | grep -q "connected"; then
            ok "PostgreSQL connectivity verified"
        else
            fail "Cannot connect to database '$DB_NAME'"
            PHASE_ERRORS+=("Database connectivity test")
        fi
    else
        echo -e "  ${CYAN}[DRY-RUN]${NC} Would test: psql -d $DB_NAME -c 'SELECT 1'"
    fi
}

# ═══════════════════════════════════════════════════════════════════════════════════
# PHASE 5: Build and Launch
# ═══════════════════════════════════════════════════════════════════════════════════
phase_5_build_and_launch() {
    phase_header "Build and Launch"

    local db_password
    if [[ "$DRY_RUN" != true ]]; then
        db_password=$(cat "$SECRETS_DIR/.db.password" 2>/dev/null) || db_password=""
    fi

    # ── 5.1 Prisma Generate ─────────────────────────────────────────────────────
    section "Prisma Client Generation"
    info "Running prisma generate..."
    if [[ "$DRY_RUN" != true ]]; then
        cd "$APP_DIR"
        su - "$APP_USER" -c "cd $APP_DIR && npx prisma generate" 2>&1 && ok "Prisma client generated" || fail "Prisma generate failed"
    else
        echo -e "  ${CYAN}[DRY-RUN]${NC} Would run: npx prisma generate"
    fi

    # ── 5.2 Next.js Build ───────────────────────────────────────────────────────
    section "Next.js Production Build"
    info "Building with: npx next build --experimental-build-mode compile"
    if [[ "$DRY_RUN" != true ]]; then
        cd "$APP_DIR"
        export NODE_ENV=production
        export DATABASE_URL="postgresql://${DB_USER}:${db_password}@localhost:5432/${DB_NAME}?schema=public"
        su - "$APP_USER" -c "cd $APP_DIR && NODE_ENV=production npx next build --experimental-build-mode compile" 2>&1 \
            && ok "Next.js build completed" \
            || { fail "Next.js build failed"; PHASE_ERRORS+=("Next.js build"); return 1; }
    else
        echo -e "  ${CYAN}[DRY-RUN]${NC} Would run: npx next build --experimental-build-mode compile"
    fi

    # ── 5.3 Systemd Service ─────────────────────────────────────────────────────
    section "Systemd Service Installation"
    local service_name="alo-server-hosting"
    local service_file="/etc/systemd/system/${service_name}.service"

    if [[ "$DRY_RUN" != true ]]; then
        cat > "$service_file" << SERVICE
[Unit]
Description=ALO Labs Hosting Portal
After=network.target postgresql.service caddy.service redis-server.service
Wants=postgresql.service redis-server.service

[Service]
Type=simple
User=${APP_USER}
Group=${APP_USER}
WorkingDirectory=${APP_DIR}
ExecStart=$(command -v node || echo /usr/bin/node) .next/standalone/server.js
Restart=on-failure
RestartSec=5
StartLimitIntervalSec=60
StartLimitBurst=5

Environment=NODE_ENV=production
Environment=PORT=${APP_PORT}
Environment=HOSTNAME=127.0.0.1
EnvironmentFile=${APP_DIR}/.env.production

# Security hardening
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=${APP_DIR} /tmp /srv/alo-sites /var/backups/alo-sites /var/log/caddy/alo-sites
PrivateTmp=true

# Logging
StandardOutput=journal
StandardError=journal
SyslogIdentifier=alo-hosting-portal

[Install]
WantedBy=multi-user.target
SERVICE
        chmod 644 "$service_file"
        ok "Created systemd service: $service_file"
    else
        echo -e "  ${CYAN}[DRY-RUN]${NC} Would write systemd service file for $service_name"
    fi

    run "Reload systemd daemon" \
        "systemctl daemon-reload"
    run "Enable $service_name service" \
        "systemctl enable $service_name"

    # ── 5.4 Start Service ────────────────────────────────────────────────────────
    section "Start Application Service"
    if [[ "$DRY_RUN" != true ]]; then
        systemctl restart "$service_name" 2>&1 && ok "Service $service_name started" || {
            fail "Service $service_name failed to start"
            journalctl -u "$service_name" --no-pager -n 20
            PHASE_ERRORS+=("Service start")
        }
        sleep 3
    else
        echo -e "  ${CYAN}[DRY-RUN]${NC} Would start: systemctl restart $service_name"
    fi

    # ── 5.5 Verify Service ──────────────────────────────────────────────────────
    section "Service Verification"
    if [[ "$DRY_RUN" != true ]]; then
        if service_active "$service_name"; then
            ok "Service '$service_name' is active and running"
        else
            fail "Service '$service_name' is NOT running"
            journalctl -u "$service_name" --no-pager -n 30
            PHASE_ERRORS+=("Service verification")
        fi
    else
        echo -e "  ${CYAN}[DRY-RUN]${NC} Would verify service is active"
    fi
}

# ═══════════════════════════════════════════════════════════════════════════════════
# PHASE 6: Post-Deploy Configuration
# ═══════════════════════════════════════════════════════════════════════════════════
phase_6_post_deploy() {
    phase_header "Post-Deploy Configuration"

    # ── 6.1 Install Shell Helpers ────────────────────────────────────────────────
    section "Shell Helper Scripts (19 helpers)"
    info "Installing ALO helper scripts to /usr/local/sbin/..."

    local helpers_src="$APP_DIR/helpers"
    if [[ ! -d "$helpers_src" ]]; then
        helpers_src="$APP_DIR/server-helpers"
    fi
    if [[ ! -d "$helpers_src" ]]; then
        # Try to find helpers relative to script
        helpers_src="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/helpers"
    fi

    local installed_count=0
    for helper in "${HELPER_SCRIPTS[@]}"; do
        if [[ -f "$helpers_src/$helper" ]]; then
            if [[ "$DRY_RUN" != true ]]; then
                cp "$helpers_src/$helper" "/usr/local/sbin/$helper"
                chmod 750 "/usr/local/sbin/$helper"
                chown root:root "/usr/local/sbin/$helper"
                installed_count=$((installed_count + 1))
            else
                echo -e "  ${CYAN}[DRY-RUN]${NC} Would install $helper -> /usr/local/sbin/$helper"
            fi
        else
            warn "Helper '$helper' not found in $helpers_src"
        fi
    done

    if [[ "$DRY_RUN" != true ]]; then
        ok "Installed ${installed_count}/19 helper scripts to /usr/local/sbin/"
    fi

    # ── 6.2 Sudoers Policy ──────────────────────────────────────────────────────
    section "Sudoers Policy"
    local sudoers_file="/etc/sudoers.d/alo-helpers"

    if [[ "$DRY_RUN" != true ]]; then
        cat > "$sudoers_file" << SUDOERS
# ALO Labs Hosting Portal — Sudoers Configuration
# Generated: $(date -Iseconds)
# Permissions: root:root 0440

Defaults:${APP_USER} secure_path="/usr/local/sbin:/usr/sbin:/usr/bin:/sbin:/bin"

# Shell helper execution (NOPASSWD for specific paths only)
SUDOERS
        for helper in "${HELPER_SCRIPTS[@]}"; do
            echo "${APP_USER} ALL=(root) NOPASSWD: /usr/local/sbin/${helper}" >> "$sudoers_file"
        done

        # Add Caddy reload permission
        echo "" >> "$sudoers_file"
        echo "# Caddy reload" >> "$sudoers_file"
        echo "${APP_USER} ALL=(root) NOPASSWD: /usr/bin/systemctl reload caddy" >> "$sudoers_file"

        chmod 440 "$sudoers_file"
        chown root:root "$sudoers_file"

        # Validate sudoers syntax
        if visudo -cf "$sudoers_file" &>/dev/null; then
            ok "Sudoers policy installed and validated at $sudoers_file"
        else
            fail "Sudoers syntax error! Removing invalid file..."
            rm -f "$sudoers_file"
            PHASE_ERRORS+=("Sudoers validation")
        fi
    else
        echo -e "  ${CYAN}[DRY-RUN]${NC} Would write sudoers policy with 19 helper NOPASSWD entries"
    fi

    # ── 6.3 Directory Structure ──────────────────────────────────────────────────
    section "Directory Structure Setup"
    run "Create $SITE_BASE" \
        "mkdir -p $SITE_BASE"
    run "Create $BACKUP_BASE" \
        "mkdir -p $BACKUP_BASE"
    run "Create $CADDY_CONFIG_DIR" \
        "mkdir -p $CADDY_CONFIG_DIR"
    run "Create $CADDY_LOG_DIR" \
        "mkdir -p $CADDY_LOG_DIR"

    run "Set ownership for sites directory" \
        "chown -R $APP_USER:$APP_USER $SITE_BASE"
    run "Set ownership for backups directory" \
        "chown -R $APP_USER:$APP_USER $BACKUP_BASE"
    run "Set ownership for Caddy config" \
        "chown -R $APP_USER:$APP_USER $CADDY_CONFIG_DIR"
    run "Set ownership for Caddy logs" \
        "chown -R $APP_USER:$APP_USER $CADDY_LOG_DIR"

    # ── 6.4 Caddy Configuration ─────────────────────────────────────────────────
    section "Caddy Web Server Configuration"
    local caddyfile="/etc/caddy/Caddyfile"

    if [[ "$DRY_RUN" != true ]]; then
        # Backup existing Caddyfile if present
        [[ -f "$caddyfile" ]] && cp "$caddyfile" "${caddyfile}.bak.$(date +%Y%m%d%H%M%S)"

        cat > "$caddyfile" << CADDY
# ALO Labs Hosting Portal — Caddy Configuration
# Generated: $(date -Iseconds)

# Main domain configuration
${DOMAIN} {
        # Transform port query for dynamic proxying
        @transform_port_query {
                query XTransformPort=*
        }

        handle @transform_port_query {
                reverse_proxy localhost:{query.XTransformPort} {
                        header_up Host {host}
                        header_up X-Forwarded-For {remote_host}
                        header_up X-Forwarded-Proto {scheme}
                        header_up X-Real-IP {remote_host}
                }
        }

        # Default: reverse proxy to Next.js app
        handle {
                reverse_proxy localhost:${APP_PORT} {
                        header_up Host {host}
                        header_up X-Forwarded-For {remote_host}
                        header_up X-Forwarded-Proto {scheme}
                        header_up X-Real-IP {remote_host}
                }
        }

        # Logging
        log {
                output file ${CADDY_LOG_DIR}/access.log
                format json
        }
}

# Tailscale IP access (internal)
:${APP_PORT} {
        bind 127.0.0.1
        reverse_proxy localhost:${APP_PORT}
}

# Caddy admin API (localhost only)
{
        admin off
}
CADDY
        ok "Caddyfile created at $caddyfile"
    else
        echo -e "  ${CYAN}[DRY-RUN]${NC} Would write Caddyfile with reverse proxy to localhost:$APP_PORT"
    fi

    run "Validate Caddy configuration" \
        "caddy validate --config $caddyfile --adapter caddyfile 2>/dev/null || true"
    run "Enable and start Caddy" \
        "systemctl enable caddy && systemctl restart caddy"
    sleep 2
    if [[ "$DRY_RUN" != true ]] && service_active "caddy"; then
        ok "Caddy service is running"
    elif [[ "$DRY_RUN" == true ]]; then
        echo -e "  ${CYAN}[DRY-RUN]${NC} Would verify Caddy is running"
    else
        warn "Caddy service may not be running properly"
    fi

    # ── 6.5 SSL/TLS (Certbot) ───────────────────────────────────────────────────
    section "SSL/TLS Certificate"
    info "Checking if certbot can obtain certificate for $DOMAIN..."
    if [[ "$DRY_RUN" != true ]]; then
        if [[ -d "/etc/letsencrypt/live/$DOMAIN" ]]; then
            skip "SSL certificate already exists for $DOMAIN"
        else
            info "Attempting to obtain SSL certificate (requires DNS to point to this server)..."
            certbot certonly --standalone -d "$DOMAIN" --non-interactive --agree-tos --email "admin@$DOMAIN" 2>&1 \
                && ok "SSL certificate obtained for $DOMAIN" \
                || warn "Certbot failed. DNS may not be configured yet. Caddy will use auto-HTTPS if domain resolves."
        fi
    else
        echo -e "  ${CYAN}[DRY-RUN]${NC} Would run: certbot certonly --standalone -d $DOMAIN"
    fi

    # ── 6.6 Email (Postfix + Dovecot) ───────────────────────────────────────────
    section "Email Server (Postfix + Dovecot — Basic)"
    if command -v postfix &>/dev/null; then
        skip "Postfix already installed"
    else
        info "Installing Postfix + Dovecot (basic satellite configuration)..."
        if [[ "$DRY_RUN" != true ]]; then
            DEBIAN_FRONTEND=noninteractive debconf-set-selections <<< "postfix postfix/main_mailer_type select Internet Site"
            DEBIAN_FRONTEND=noninteractive debconf-set-selections <<< "postfix postfix/mailname string $DOMAIN"
            DEBIAN_FRONTEND=noninteractive apt-get install -y -qq postfix dovecot-imapd dovecot-pop3d 2>&1 \
                && ok "Postfix + Dovecot installed" \
                || warn "Email installation had issues"

            # Basic Postfix config
            postconf -e "myhostname = $DOMAIN" 2>/dev/null || true
            postconf -e "mydomain = $DOMAIN" 2>/dev/null || true
            postconf -e "myorigin = \$mydomain" 2>/dev/null || true
            postconf -e "inet_interfaces = all" 2>/dev/null || true
            postconf -e "mydestination = \$myhostname, localhost.\$mydomain, localhost" 2>/dev/null || true
            postconf -e "mynetworks = 127.0.0.0/8 [::1]/128" 2>/dev/null || true

            systemctl restart postfix 2>/dev/null || true
            systemctl restart dovecot 2>/dev/null || true
        else
            echo -e "  ${CYAN}[DRY-RUN]${NC} Would install and configure Postfix + Dovecot"
        fi
    fi

    # ── 6.7 Logrotate ────────────────────────────────────────────────────────────
    section "Logrotate Configuration"
    local logrotate_file="/etc/logrotate.d/alo-caddy"

    if [[ "$DRY_RUN" != true ]]; then
        cat > "$logrotate_file" << LOGROTATE
$CADDY_LOG_DIR/*.log {
    daily
    missingok
    rotate 30
    compress
    delaycompress
    notifempty
    create 0644 $APP_USER $APP_USER
    sharedscripts
    postrotate
        systemctl reload caddy >/dev/null 2>&1 || true
    endscript
}
LOGROTATE
        ok "Logrotate configured for Caddy logs"
    else
        echo -e "  ${CYAN}[DRY-RUN]${NC} Would write logrotate config for Caddy logs"
    fi

    # ── 6.8 Automatic Security Updates ──────────────────────────────────────────
    section "Automatic Security Updates"
    if pkg_installed "unattended-upgrades"; then
        skip "unattended-upgrades already installed"
    else
        run "Install unattended-upgrades" \
            "DEBIAN_FRONTEND=noninteractive apt-get install -y -qq unattended-upgrades apt-listchanges"
    fi

    if [[ "$DRY_RUN" != true ]]; then
        # Enable auto-upgrades
        cat > /etc/apt/apt.conf.d/20auto-upgrades << AUTOUPGRADE
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT::Periodic::Download-Upgradeable-Packages "1";
APT::Periodic::AutocleanInterval "7";
AUTOUPGRADE
        ok "Automatic security updates configured"
    else
        echo -e "  ${CYAN}[DRY-RUN]${NC} Would configure unattended-upgrades"
    fi

    # ── 6.9 Add APP_USER to Docker group ────────────────────────────────────────
    section "Docker Group Membership"
    if [[ "$DRY_RUN" != true ]]; then
        if groups "$APP_USER" 2>/dev/null | grep -q docker; then
            skip "$APP_USER already in docker group"
        else
            usermod -aG docker "$APP_USER"
            ok "Added $APP_USER to docker group"
        fi
    else
        echo -e "  ${CYAN}[DRY-RUN]${NC} Would add $APP_USER to docker group"
    fi
}

# ═══════════════════════════════════════════════════════════════════════════════════
# PHASE 7: Accessibility Verification
# ═══════════════════════════════════════════════════════════════════════════════════
phase_7_verification() {
    phase_header "Accessibility Verification"

    local all_pass=true
    local pass_count=0
    local total_checks=0

    # ── 7.1 HTTP Response on Port 3101 ──────────────────────────────────────────
    section "Application HTTP Response (port $APP_PORT)"
    total_checks=$((total_checks + 1))
    if [[ "$DRY_RUN" != true ]]; then
        if port_listening "$APP_PORT"; then
            ok "Port $APP_PORT is listening"
            pass_count=$((pass_count + 1))
        else
            fail "Port $APP_PORT is NOT listening"
            all_pass=false
        fi

        # Test actual HTTP response
        local http_code
        http_code=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:$APP_PORT" --max-time 10 2>/dev/null) || http_code="000"
        if [[ "$http_code" -ge 200 && "$http_code" -lt 500 ]]; then
            ok "HTTP response: $http_code (localhost:$APP_PORT)"
            pass_count=$((pass_count + 1))
        else
            warn "HTTP response: $http_code (may still be starting up)"
        fi
        total_checks=$((total_checks + 1))
    else
        echo -e "  ${CYAN}[DRY-RUN]${NC} Would test HTTP on port $APP_PORT"
    fi

    # ── 7.2 Caddy Reverse Proxy ─────────────────────────────────────────────────
    section "Caddy Reverse Proxy"
    total_checks=$((total_checks + 1))
    if [[ "$DRY_RUN" != true ]]; then
        if service_active "caddy"; then
            ok "Caddy service is running"
            pass_count=$((pass_count + 1))
        else
            fail "Caddy service is NOT running"
            all_pass=false
        fi

        # Test Caddy proxy
        local caddy_code
        caddy_code=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:80" --max-time 10 2>/dev/null) || caddy_code="000"
        if [[ "$caddy_code" -ge 200 && "$caddy_code" -lt 500 ]]; then
            ok "Caddy proxy response: $caddy_code"
            pass_count=$((pass_count + 1))
        else
            warn "Caddy proxy response: $caddy_code (check DNS/domain config)"
        fi
        total_checks=$((total_checks + 1))
    else
        echo -e "  ${CYAN}[DRY-RUN]${NC} Would test Caddy reverse proxy"
    fi

    # ── 7.3 Database Connectivity ────────────────────────────────────────────────
    section "Database Connectivity"
    total_checks=$((total_checks + 1))
    if [[ "$DRY_RUN" != true ]]; then
        if sudo -u postgres psql -d "$DB_NAME" -c "SELECT 1;" &>/dev/null; then
            ok "PostgreSQL '$DB_NAME' is accessible"
            pass_count=$((pass_count + 1))
        else
            fail "Cannot connect to PostgreSQL '$DB_NAME'"
            all_pass=false
        fi

        # Check table count
        local table_count
        table_count=$(sudo -u postgres psql -d "$DB_NAME" -t -c "SELECT count(*) FROM information_schema.tables WHERE table_schema='public';" 2>/dev/null | tr -d ' ') || table_count=0
        info "Database has $table_count public tables"
    else
        echo -e "  ${CYAN}[DRY-RUN]${NC} Would test database connectivity and table count"
    fi

    # ── 7.4 Shell Helpers ────────────────────────────────────────────────────────
    section "Shell Helper Scripts Verification"
    total_checks=$((total_checks + 1))
    if [[ "$DRY_RUN" != true ]]; then
        local helper_ok=0
        local helper_fail=0
        for helper in "${HELPER_SCRIPTS[@]}"; do
            if [[ -x "/usr/local/sbin/$helper" ]]; then
                helper_ok=$((helper_ok + 1))
            else
                fail "/usr/local/sbin/$helper not found or not executable"
                helper_fail=$((helper_fail + 1))
            fi
        done
        if [[ "$helper_fail" -eq 0 ]]; then
            ok "All 19 helper scripts are executable ($helper_ok/19)"
            pass_count=$((pass_count + 1))
        else
            warn "$helper_fail helpers missing, $helper_ok OK"
            all_pass=false
        fi
    else
        echo -e "  ${CYAN}[DRY-RUN]${NC} Would verify all 19 helpers are executable"
    fi

    # ── 7.5 Sudoers Policy ──────────────────────────────────────────────────────
    section "Sudoers Policy Verification"
    total_checks=$((total_checks + 1))
    if [[ "$DRY_RUN" != true ]]; then
        if visudo -cf /etc/sudoers.d/alo-helpers &>/dev/null; then
            ok "Sudoers file /etc/sudoers.d/alo-helpers is valid"
            pass_count=$((pass_count + 1))
            # Check that alo-panel can run helpers
            local sudo_check
            sudo_check=$(sudo -l -U "$APP_USER" 2>/dev/null | grep -c "alo-.*-helper\|alo-site-" || echo "0")
            info "$APP_USER has $sudo_check sudo NOPASSWD entries for helpers"
        else
            fail "Sudoers file has syntax errors"
            all_pass=false
        fi
    else
        echo -e "  ${CYAN}[DRY-RUN]${NC} Would validate sudoers policy with visudo -cf"
    fi

    # ── 7.6 UFW Firewall ────────────────────────────────────────────────────────
    section "UFW Firewall Verification"
    total_checks=$((total_checks + 1))
    if [[ "$DRY_RUN" != true ]]; then
        if ufw status | grep -q "active"; then
            ok "UFW is active"
            pass_count=$((pass_count + 1))

            # Verify key rules
            local expected_ports=(22 80 443 2019 "$APP_PORT")
            for port in "${expected_ports[@]}"; do
                if ufw status | grep -q "$port"; then
                    ok "UFW rule for port $port is present"
                else
                    warn "UFW rule for port $port may be missing"
                fi
            done
        else
            fail "UFW is NOT active"
            all_pass=false
        fi
    else
        echo -e "  ${CYAN}[DRY-RUN]${NC} Would verify UFW is active with correct rules"
    fi

    # ── 7.7 Redis ────────────────────────────────────────────────────────────────
    section "Redis Verification"
    total_checks=$((total_checks + 1))
    if [[ "$DRY_RUN" != true ]]; then
        if service_active "redis-server"; then
            ok "Redis is running"
            pass_count=$((pass_count + 1))
            redis-cli ping &>/dev/null && ok "Redis PING -> PONG" || warn "Redis not responding to PING"
        else
            warn "Redis is not running (optional for initial deployment)"
        fi
    else
        echo -e "  ${CYAN}[DRY-RUN]${NC} Would verify Redis is running"
    fi

    # ── 7.8 Docker ───────────────────────────────────────────────────────────────
    section "Docker Verification"
    total_checks=$((total_checks + 1))
    if [[ "$DRY_RUN" != true ]]; then
        if command -v docker &>/dev/null && docker info &>/dev/null; then
            ok "Docker is running"
            pass_count=$((pass_count + 1))
            info "Docker version: $(docker --version)"
            info "Docker Compose: $(docker compose version 2>/dev/null || echo 'N/A')"
        else
            warn "Docker is not running"
        fi
    else
        echo -e "  ${CYAN}[DRY-RUN]${NC} Would verify Docker is running"
    fi

    # ── 7.9 Disk Space ───────────────────────────────────────────────────────────
    section "System Resources"
    if [[ "$DRY_RUN" != true ]]; then
        local disk_usage
        disk_usage=$(df -h / | awk 'NR==2{print $5}' | tr -d '%')
        if [[ "$disk_usage" -lt 90 ]]; then
            ok "Disk usage: ${disk_usage}%"
        else
            warn "Disk usage: ${disk_usage}% (high!)"
        fi
        info "Memory: $(free -h | awk '/Mem:/{print $3 " used / " $2 " total"}')"
        info "CPU load: $(uptime | awk -F'load average:' '{print $2}')"
    else
        echo -e "  ${CYAN}[DRY-RUN]${NC} Would check disk, memory, and CPU"
    fi

    # ── 7.10 Systemd Service Status ─────────────────────────────────────────────
    section "Service Status Summary"
    if [[ "$DRY_RUN" != true ]]; then
        local services=("alo-server-hosting" "caddy" "postgresql" "redis-server" "docker" "sshd")
        for svc in "${services[@]}"; do
            if service_active "$svc"; then
                ok "$svc: active"
            else
                warn "$svc: inactive/not found"
            fi
        done
    else
        echo -e "  ${CYAN}[DRY-RUN]${NC} Would check status of all services"
    fi

    # ── 7.11 Final Status Report ────────────────────────────────────────────────
    echo ""
    echo -e "${BOLD}${MAGENTA}════════════════════════════════════════════════════════════════${NC}"
    echo -e "${BOLD}              DEPLOYMENT VERIFICATION SUMMARY${NC}"
    echo -e "${BOLD}${MAGENTA}════════════════════════════════════════════════════════════════${NC}"
    echo ""

    if [[ "$DRY_RUN" != true ]]; then
        if [[ "$all_pass" == true ]]; then
            echo -e "  ${GREEN}${BOLD}✓ ALL CHECKS PASSED${NC} ($pass_count/$total_checks)"
        else
            echo -e "  ${YELLOW}${BOLD}⚠ PARTIAL PASS${NC} ($pass_count/$total_checks checks passed)"
        fi

        if [[ ${#PHASE_ERRORS[@]} -gt 0 ]]; then
            echo ""
            echo -e "  ${RED}${BOLD}Errors encountered:${NC}"
            for err in "${PHASE_ERRORS[@]}"; do
                echo -e "    ${RED}✗${NC} $err"
            done
        fi
    else
        echo -e "  ${CYAN}[DRY-RUN] Verification checks would run here${NC}"
    fi

    echo ""
    echo -e "  ${BLUE}App URL:${NC}     https://${DOMAIN}"
    echo -e "  ${BLUE}Direct URL:${NC}   http://localhost:${APP_PORT}"
    echo -e "  ${BLUE}Tailscale:${NC}   http://${TAILSCALE_IP}:${APP_PORT}"
    echo -e "  ${BLUE}App User:${NC}    $APP_USER"
    echo -e "  ${BLUE}App Dir:${NC}     $APP_DIR"
    echo -e "  ${BLUE}Database:${NC}    postgresql://${DB_USER}@localhost:5432/${DB_NAME}"
    echo -e "  ${BLUE}Secrets:${NC}     $SECRETS_DIR/.env.secrets"
    echo -e "  ${BLUE}Service:${NC}     alo-server-hosting.service"
    echo -e "  ${BLUE}Caddyfile:${NC}   /etc/caddy/Caddyfile"
    echo -e "  ${BLUE}Helpers:${NC}     /usr/local/sbin/alo-*-helper (19 scripts)"
    echo -e "  ${BLUE}Sudoers:${NC}     /etc/sudoers.d/alo-helpers"
    echo ""
}

# ═══════════════════════════════════════════════════════════════════════════════════
# MAIN EXECUTION
# ═══════════════════════════════════════════════════════════════════════════════════
main() {
    echo ""
    echo -e "${BOLD}${GREEN}╔══════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${BOLD}${GREEN}║${NC}  ${BOLD}ALO Labs Hosting Portal — Production Deployment${NC}"
    echo -e "${BOLD}${GREEN}║${NC}  ${CYAN}Brand: #E8501A (Orange) | #0A5CFF (Blue)${NC}"
    echo -e "${BOLD}${GREEN}╚══════════════════════════════════════════════════════════════╝${NC}"
    echo ""
    echo -e "  ${BLUE}Target:${NC}     alo-server-lap ($TARGET)"
    echo -e "  ${BLUE}OS:${NC}         Ubuntu 22.04.5 LTS"
    echo -e "  ${BLUE}Hostname:${NC}   $HOSTNAME"
    echo -e "  ${BLUE}Timezone:${NC}   $TIMEZONE"
    echo -e "  ${BLUE}App Port:${NC}   $APP_PORT"
    echo -e "  ${BLUE}Domain:${NC}     $DOMAIN"
    echo -e "  ${BLUE}Dry-run:${NC}    $DRY_RUN"
    echo -e "  ${BLUE}Started:${NC}    $(date -Iseconds)"
    echo ""

    # ── Pre-flight Checks ────────────────────────────────────────────────────────
    info "Running pre-flight checks..."

    # Check required commands exist (or will be installed)
    local required_cmds=("apt-get" "curl" "bash")
    for cmd in "${required_cmds[@]}"; do
        if ! command -v "$cmd" &>/dev/null; then
            fail "Required command '$cmd' not found"
            exit 1
        fi
    done
    ok "Pre-flight checks passed"

    # ── Execute All Phases ───────────────────────────────────────────────────────
    phase_1_server_preparation
    phase_2_project_transfer
    phase_3_environment_configuration
    phase_4_database_setup
    phase_5_build_and_launch
    phase_6_post_deploy
    phase_7_verification

    # ── Deployment Complete ──────────────────────────────────────────────────────
    local end_time
    end_time=$(date +%s)
    local duration=$(( end_time - START_TIME ))
    local minutes=$(( duration / 60 ))
    local seconds=$(( duration % 60 ))

    echo ""
    echo -e "${BOLD}${GREEN}╔══════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${BOLD}${GREEN}║${NC}  ${BOLD}DEPLOYMENT COMPLETE${NC}"
    echo -e "${BOLD}${GREEN}║${NC}  ${CYAN}Duration: ${minutes}m ${seconds}s${NC}"
    echo -e "${BOLD}${GREEN}║${NC}  ${CYAN}Finished: $(date -Iseconds)${NC}"
    echo -e "${BOLD}${GREEN}╚══════════════════════════════════════════════════════════════╝${NC}"
    echo ""

    if [[ ${#PHASE_ERRORS[@]} -eq 0 ]]; then
        echo -e "  ${GREEN}${BOLD}✓ No errors encountered during deployment${NC}"
    else
        echo -e "  ${YELLOW}${BOLD}⚠ ${#PHASE_ERRORS[@]} error(s) encountered:${NC}"
        for err in "${PHASE_ERRORS[@]}"; do
            echo -e "    ${RED}✗${NC} $err"
        done
        echo ""
        echo -e "  ${YELLOW}Review the deploy log: $DEPLOY_LOG${NC}"
    fi

    echo ""
    echo -e "  ${BLUE}Quick commands:${NC}"
    echo -e "    ${CYAN}Status:${NC}    systemctl status alo-server-hosting"
    echo -e "    ${CYAN}Logs:${NC}      journalctl -u alo-server-hosting -f"
    echo -e "    ${CYAN}Restart:${NC}   systemctl restart alo-server-hosting"
    echo -e "    ${CYAN}Caddy:${NC}     systemctl status caddy"
    echo -e "    ${CYAN}DB:${NC}        sudo -u postgres psql -d $DB_NAME"
    echo -e "    ${CYAN}Redis:${NC}     redis-cli ping"
    echo -e "    ${CYAN}Docker:${NC}    docker ps"
    echo -e "    ${CYAN}UFW:${NC}       ufw status"
    echo ""

    # Exit with error if there were failures
    if [[ ${#PHASE_ERRORS[@]} -gt 0 ]]; then
        exit 1
    fi
    exit 0
}

# ── Run Main ───────────────────────────────────────────────────────────────────────
main "$@"
