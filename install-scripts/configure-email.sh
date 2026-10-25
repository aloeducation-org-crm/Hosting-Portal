#!/usr/bin/env bash
# ==========================================================================
# ALO Labs Hosting Portal - Email Infrastructure Configuration
# ==========================================================================
# Configures Postfix, Dovecot, OpenDKIM, and Rspamd for mail delivery.
# Can be run independently after the main install.sh.
#
# Usage: sudo bash configure-email.sh --domain example.com
#        sudo bash configure-email.sh --domain example.com --skip-dkim
# ==========================================================================

set -euo pipefail

# ─── Color output ──────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'
BOLD='\033[1m'

info()  { echo -e "${BLUE}[INFO]${NC}  $*"; }
ok()    { echo -e "${GREEN}[OK]${NC}    $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
error() { echo -e "${RED}[ERROR]${NC} $*"; }
step()  { echo -e "\n${CYAN}${BOLD}[$1]${NC} ${BOLD}$2${NC}"; }
fail()  { error "$*"; exit 1; }

# ─── Parse arguments ───────────────────────────────────────────────────
DOMAIN=""
SKIP_DKIM=false
SKIP_RSPAMD=false
TEST_SMTP=false

for arg in "$@"; do
  case "$arg" in
    --domain=*) DOMAIN="${arg#*=}" ;;
    --domain) shift; DOMAIN="${1:-}" ;;
    --skip-dkim) SKIP_DKIM=true ;;
    --skip-rspamd) SKIP_RSPAMD=true ;;
    --test-smtp) TEST_SMTP=true ;;
    --help)
      echo "Usage: sudo bash configure-email.sh --domain example.com [--skip-dkim] [--skip-rspamd] [--test-smtp]"
      exit 0
      ;;
  esac
done

if [[ -z "$DOMAIN" ]]; then
  fail "--domain is required. Example: --domain example.com"
fi

# Validate domain format
if [[ ! "$DOMAIN" =~ ^[a-zA-Z0-9][a-zA-Z0-9.-]+[a-zA-Z0-9]$ ]]; then
  fail "Invalid domain format: $DOMAIN"
fi

HOSTNAME_FQDN=$(hostname -f)
APP_USER="aloedu"
APP_GROUP="aloedu"
MAIL_DIR="/var/mail/vhosts"
DKIM_DIR="/etc/opendkim/keys/$DOMAIN"

# Verify running as root
if [[ $EUID -ne 0 ]]; then
  fail "This script must be run as root."
fi

echo -e "${BOLD}${CYAN}"
echo "  ╔═══════════════════════════════════════════════════╗"
echo "  ║     ALO Labs - Email Infrastructure Setup          ║"
echo "  ║     Domain: ${DOMAIN}"
echo "  ╚═══════════════════════════════════════════════════╝"
echo -e "${NC}"

# Check required packages
for CMD in postconf doveadm openssl; do
  if ! command -v "$CMD" &>/dev/null; then
    fail "$CMD not found. Run the main installer first."
  fi
done

# ========================================================================
# STEP 1: Configure Postfix for the domain
# ========================================================================
step "1/7" "Configuring Postfix for $DOMAIN"

# Backup current config
if [[ -f /etc/postfix/main.cf ]]; then
  cp /etc/postfix/main.cf "/etc/postfix/main.cf.bak.$(date +%Y%m%d%H%M%S)"
fi

# Set core Postfix parameters
postconf -e "myhostname = $HOSTNAME_FQDN"
postconf -e "mydomain = $DOMAIN"
postconf -e "myorigin = $DOMAIN"
postconf -e "mydestination = localhost"
postconf -e "mynetworks = 127.0.0.0/8 [::1]/128"
postconf -e "inet_interfaces = all"
postconf -e "inet_protocols = ipv4"
postconf -e "message_size_limit = 52428800"        # 50MB
postconf -e "mailbox_size_limit = 0"                # No limit
postconf -e "recipient_delimiter = +"

# Virtual mailbox configuration
postconf -e "virtual_mailbox_domains = /etc/postfix/virtual_mailbox_domains"
postconf -e "virtual_mailbox_maps = hash:/etc/postfix/virtual_mailbox_maps"
postconf -e "virtual_alias_maps = hash:/etc/postfix/virtual_aliases"
postconf -e "virtual_mailbox_base = $MAIL_DIR"
postconf -e "virtual_minimum_uid = 1000"
postconf -e "virtual_uid_maps = static:$APP_USER"
postconf -e "virtual_gid_maps = static:$APP_GROUP"

# TLS configuration
cat > /etc/postfix/main.cf.d/tls.conf 2>/dev/null << TLS_EOF || {
  # If directory doesn't exist, append to main.cf
  grep -q "^smtpd_tls_cert_file" /etc/postfix/main.cf || cat >> /etc/postfix/main.cf << TLS_EOF
# ─── TLS Configuration (ALO Labs) ─────────────────────────────────
smtpd_tls_cert_file = /etc/ssl/certs/ssl-cert-snakeoil.pem
smtpd_tls_key_file = /etc/ssl/private/ssl-cert-snakeoil.key
smtpd_tls_security_level = may
smtpd_tls_loglevel = 1
smtpd_tls_received_header = yes
smtpd_tls_session_cache_timeout = 3600s
smtpd_tls_session_cache_database = btree:${data_directory}/smtpd_scache
smtp_tls_security_level = may
smtp_tls_loglevel = 1
smtp_tls_session_cache_database = btree:${data_directory}/smtp_scache
TLS_EOF
}

# Ensure domain is in virtual_mailbox_domains
if ! grep -q "^$DOMAIN" /etc/postfix/virtual_mailbox_domains 2>/dev/null; then
  echo "$DOMAIN" >> /etc/postfix/virtual_mailbox_domains
fi

# Rebuild hash files
postmap /etc/postfix/virtual_mailbox_domains 2>/dev/null || true
postmap /etc/postfix/virtual_mailbox_maps 2>/dev/null || true
postmap /etc/postfix/virtual_aliases 2>/dev/null || true

# Create mail directory for the domain
mkdir -p "$MAIL_DIR/$DOMAIN"
chown -R "$APP_USER:$APP_GROUP" "$MAIL_DIR/$DOMAIN"

# Create example aliases
if [[ ! -s /etc/postfix/virtual_aliases ]]; then
  cat > /etc/postfix/virtual_aliases << ALIASES_EOF
postmaster@$DOMAIN    root
abuse@$DOMAIN       root
root@$DOMAIN        postmaster
ALIASES_EOF
  postmap /etc/postfix/virtual_aliases
fi

# Add milter configuration for DKIM/SPF
if command -v opendkim-genkey &>/dev/null && [[ "$SKIP_DKIM" != "true" ]]; then
  grep -q "^milter_default_action" /etc/postfix/main.cf || cat >> /etc/postfix/main.cf << MILTER_EOF

# ─── Milter Configuration (ALO Labs) ───────────────────────────────
milter_default_action = accept
smtpd_milters = inet:127.0.0.1:8891
non_smtpd_milters = inet:127.0.0.1:8891
MILTER_EOF
fi

systemctl restart postfix 2>/dev/null || systemctl start postfix 2>/dev/null
ok "Postfix configured for $DOMAIN"

# ========================================================================
# STEP 2: Configure Dovecot
# ========================================================================
step "2/7" "Configuring Dovecot"

DOVECOT_DIR="/etc/dovecot"

# Backup
[[ -f "$DOVECOT_DIR/dovecot.conf" ]] && cp "$DOVECOT_DIR/dovecot.conf" "${DOVECOT_DIR}/dovecot.conf.bak.$(date +%Y%m%d%H%M%S)"
mkdir -p "$DOVECOT_DIR/conf.d"

# Main dovecot.conf
if [[ ! -f "$DOVECOT_DIR/dovecot.conf" ]] || ! grep -q "ALO Labs" "$DOVECOT_DIR/dovecot.conf" 2>/dev/null; then
  cat > "$DOVECOT_DIR/dovecot.conf" << DOVECOT_EOF
# ALO Labs Hosting Portal - Dovecot Configuration
!include_try /usr/share/dovecot/protocols.d/*.protocol

protocols = imap lmtp sieve

# Listen on all interfaces
listen = *, ::

# Disable plaintext auth on unencrypted (except for localhost)
disable_plaintext_auth = no
auth_mechanisms = plain login

# Logging
log_path = /var/log/dovecot.log
info_log_path = /var/log/dovecot-info.log
debug_log_path = /var/log/dovecot-debug.log
auth_verbose = yes

# Include additional configs
!include conf.d/*.conf
DOVECOT_EOF
fi

# Mail configuration
mkdir -p "$DOVECOT_DIR/conf.d"
cat > "$DOVECOT_DIR/conf.d/10-mail.conf" << 'MAIL_CONF_EOF'
# ALO Labs - Mail Configuration
mail_location = maildir:/var/mail/vhosts/%d/%n/Maildir
mail_privileged_group = vmail
mail_access_groups = aloedu

namespace inbox {
  inbox = yes
  mailbox Drafts {
    auto = subscribe
    special_use = \Drafts
  }
  mailbox Junk {
    auto = subscribe
    special_use = \Junk
  }
  mailbox Trash {
    auto = subscribe
    special_use = \Trash
  }
  mailbox Sent {
    auto = subscribe
    special_use = \Sent
  }
  mailbox "Sent Messages" {
    special_use = \Sent
  }
}
MAIL_CONF_EOF

# Authentication configuration
cat > "$DOVECOT_DIR/conf.d/10-auth.conf" << 'AUTH_CONF_EOF'
# ALO Labs - Authentication Configuration
auth_mechanisms = plain login

# Password database using passwd-file with SHA512-CRYPT
passdb {
  driver = passwd-file
  args = scheme=SHA512-CRYPT /etc/dovecot/users
}

# User database - static mapping to aloedu user
userdb {
  driver = static
  args = uid=aloedu gid=aloedu home=/var/mail/vhosts/%d/%n
}

# Allow plaintext auth (TLS handles encryption)
disable_plaintext_auth = no
auth_verbose = yes
auth_debug = no
AUTH_CONF_EOF

# Master socket configuration for LMTP
cat > "$DOVECOT_DIR/conf.d/10-master.conf" << 'MASTER_CONF_EOF'
# ALO Labs - Master Socket Configuration
service imap-login {
  inet_listener imap {
    port = 143
  }
  inet_listener imaps {
    port = 993
    ssl = yes
  }
}

service lmtp {
  unix_listener /var/spool/postfix/private/dovecot-lmtp {
    mode = 0660
    group = postfix
    user = postfix
  }
}

service auth {
  unix_listener /var/spool/postfix/private/auth {
    mode = 0660
    user = postfix
    group = postfix
  }
}
MASTER_CONF_EOF

# SSL configuration
cat > "$DOVECOT_DIR/conf.d/10-ssl.conf" << 'SSL_CONF_EOF'
# ALO Labs - SSL Configuration
ssl = required
ssl_cert = </etc/ssl/certs/ssl-cert-snakeoil.pem
ssl_key = </etc/ssl/private/ssl-cert-snakeoil.key
ssl_dh = </usr/share/dovecot/dh.pem

# Prefer server ciphers for security
ssl_prefer_server_ciphers = yes
ssl_min_protocol = TLSv1.2
ssl_cipher_list = ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384
SSL_CONF_EOF

# Sieve configuration
mkdir -p "$DOVECOT_DIR/conf.d"
cat > "$DOVECOT_DIR/conf.d/90-sieve.conf" << 'SIEVE_CONF_EOF'
# ALO Labs - Sieve Configuration
plugin {
  sieve = /var/mail/vhosts/%d/%n/sieve
  sieve_dir = /var/mail/vhosts/%d/%n/.sieve
  sieve_global_dir = /etc/dovecot/sieve/global
  sieve_global_path = /etc/dovecot/sieve/default.sieve
}
SIEVE_CONF_EOF

# Create sieve directories
mkdir -p /etc/dovecot/sieve/global
chown -R "$APP_USER:$APP_GROUP" /etc/dovecot/sieve

# Create users file if not exists
touch /etc/dovecot/users
chown "$APP_USER:$APP_GROUP" /etc/dovecot/users
chmod 640 /etc/dovecot/users

# Create domain mail directory
mkdir -p "$MAIL_DIR/$DOMAIN"
chown -R "$APP_USER:$APP_GROUP" "$MAIL_DIR"

systemctl restart dovecot 2>/dev/null || systemctl start dovecot 2>/dev/null
ok "Dovecot configured"

# ========================================================================
# STEP 3: Configure OpenDKIM
# ========================================================================
if [[ "$SKIP_DKIM" == "true" ]]; then
  step "3/7" "OpenDKIM skipped (--skip-dkim)"
else
  step "3/7" "Configuring OpenDKIM for $DOMAIN"

  DKIM_SELECTOR="alohosting"

  # Create signing table and key table
  cat > /etc/opendkim/signingtable << SIGNING_EOF
*@$DOMAIN    $DKIM_SELECTOR._domainkey.$DOMAIN
SIGNING_EOF

  cat > /etc/opendkim/keytable << KEYTABLE_EOF
$DKIM_SELECTOR._domainkey.$DOMAIN    $DOMAIN:$DKIM_SELECTOR:$DKIM_DIR/$DKIM_SELECTOR.private
KEYTABLE_EOF

  # Trusted hosts
  cat > /etc/opendkim/trustedhosts << TRUSTED_EOF
127.0.0.1
localhost
$HOSTNAME_FQDN
TRUSTED_EOF

  # Generate DKIM keys
  mkdir -p "$DKIM_DIR"

  if [[ -f "$DKIM_DIR/$DKIM_SELECTOR.private" ]]; then
    warn "DKIM keys already exist for $DOMAIN, skipping generation"
  else
    opendkim-genkey \
      -s "$DKIM_SELECTOR" \
      -d "$DOMAIN" \
      -D "$DKIM_DIR" \
      --bits 2048

    chown -R opendkim:opendkim "$DKIM_DIR"
    chmod 600 "$DKIM_DIR/$DKIM_SELECTOR.private"
    chmod 644 "$DKIM_DIR/$DKIM_SELECTOR.txt"
    ok "DKIM keys generated (2048-bit RSA)"
  fi

  # Configure OpenDKIM
  cat > /etc/opendkim.conf << OPENDKIM_EOF
# ALO Labs - OpenDKIM Configuration
AutoRestart             Yes
AutoRestartRate         10/1h
Syslog                  yes
SyslogSuccess           yes
LogWhy                  yes

Canonicalization        relaxed/simple
Mode                    sv
SubDomains              no

OversignHeaders         From

# Key and signing tables
KeyTable                refile:/etc/opendkim/keytable
SigningTable            refile:/etc/opendkim/signingtable
ExternalIgnoreList      refile:/etc/opendkim/trustedhosts
InternalHosts           refile:/etc/opendkim/trustedhosts

# Socket
Socket                  inet:8891@127.0.0.1

# User
UserID                  opendkim

UMask                   007
PidFile                 /var/run/opendkim/opendkim.pid
OPENDKIM_EOF

  # Ensure socket directory exists
  mkdir -p /var/run/opendkim
  chown opendkim:opendkim /var/run/opendkim

  systemctl enable opendkim 2>/dev/null || true
  systemctl restart opendkim 2>/dev/null || systemctl start opendkim 2>/dev/null
  ok "OpenDKIM configured and started"
fi

# ========================================================================
# STEP 4: Configure Rspamd
# ========================================================================
if [[ "$SKIP_RSPAMD" == "true" ]]; then
  step "4/7" "Rspamd skipped (--skip-rspamd)"
else
  step "4/7" "Configuring Rspamd"

  RSPAMD_DIR="/etc/rspamd"
  RSPAMD_LOCAL_DIR="$RSPAMD_DIR/local.d"
  mkdir -p "$RSPAMD_LOCAL_DIR"

  # Basic worker configuration
  cat > "$RSPAMD_LOCAL_DIR/worker-normal.inc" << RSPAMD_WORKER_EOF
# ALO Labs - Rspamd Worker Configuration
bind_socket = "127.0.0.1:11333";
RSPAMD_WORKER_EOF

  # Controller configuration
  cat > "$RSPAMD_LOCAL_DIR/worker-controller.inc" << RSPAMD_CTRL_EOF
# ALO Labs - Rspamd Controller
bind_socket = "127.0.0.1:11334";
enable_webui = no;
RSPAMD_CTRL_EOF

  # DMARC configuration
  cat > "$RSPAMD_LOCAL_DIR/dmarc.conf" << DMARC_EOF
# ALO Labs - DMARC Configuration
domain = "$DOMAIN";
DMARC_EOF

  # Create DKIM signing settings for Rspamd
  mkdir -p "$RSPAMD_DIR/local.d/dkim_signing.conf"
  if [[ -d "$DKIM_DIR" ]]; then
    cat > "$RSPAMD_DIR/local.d/dkim_signing.conf" << RSPAMD_DKIM_EOF
# ALO Labs - DKIM Signing via Rspamd
path = "$DKIM_DIR/$DKIM_SELECTOR.private";
selector = "$DKIM_SELECTOR";
domain = "$DOMAIN";
RSPAMD_DKIM_EOF
  fi

  systemctl enable rspamd 2>/dev/null || true
  systemctl restart rspamd 2>/dev/null || systemctl start rspamd 2>/dev/null
  ok "Rspamd configured"
fi

# ========================================================================
# STEP 5: Postfix-Dovecot LMTP integration
# ========================================================================
step "5/7" "Configuring Postfix-LMTP delivery"

# Add LMTP delivery to Postfix if not already present
grep -q "^mailbox_transport" /etc/postfix/main.cf || cat >> /etc/postfix/main.cf << LMTP_EOF

# ─── LMTP Delivery (ALO Labs) ─────────────────────────────────────
mailbox_transport = lmtp:unix:private/dovecot-lmtp
smtputf8_enable = no
LMTP_EOF

# Dovecot LMTP auth for Postfix
grep -q "smtpd_sasl_type" /etc/postfix/main.cf || cat >> /etc/postfix/main.cf << SASL_EOF

# ─── SASL Authentication (ALO Labs) ────────────────────────────────
smtpd_sasl_type = dovecot
smtpd_sasl_path = private/auth
smtpd_sasl_auth_enable = yes
smtpd_sasl_security_options = noanonymous, noplaintext
smtpd_sasl_tls_security_options = noanonymous
smtpd_recipient_restrictions = permit_sasl_authenticated, permit_mynetworks, reject_unauth_destination
SASL_EOF

# Generate DH parameters for Dovecot if missing
if [[ ! -f /usr/share/dovecot/dh.pem ]]; then
  info "Generating DH parameters (this may take a minute)..."
  openssl dhparam -out /usr/share/dovecot/dh.pem 2048 2>/dev/null
  ok "DH parameters generated"
fi

systemctl restart postfix 2>/dev/null
systemctl restart dovecot 2>/dev/null
ok "LMTP delivery configured"

# ========================================================================
# STEP 6: Test SMTP
# ========================================================================
step "6/7" "Testing SMTP connectivity"

SMTP_OK=true

# Check Postfix is running
if systemctl is-active --quiet postfix 2>/dev/null; then
  ok "Postfix is active"
else
  error "Postfix is NOT active"
  SMTP_OK=false
fi

# Check SMTP port
if ss -tlnp 2>/dev/null | grep -q ":25 "; then
  ok "SMTP port 25 is listening"
else
  error "SMTP port 25 is NOT listening"
  SMTP_OK=false
fi

# Check submission port
if ss -tlnp 2>/dev/null | grep -q ":587 "; then
  ok "Submission port 587 is listening"
else
  warn "Submission port 587 is NOT listening (may need configuration)"
fi

# Test SMTP connection with telnet-like approach
if command -v swaks &>/dev/null && [[ "$TEST_SMTP" == "true" ]]; then
  info "Sending test email via swaks..."
  if swaks --to "postmaster@$DOMAIN" --from "noreply@$DOMAIN" --server localhost --port 25 2>&1 | tail -3; then
    ok "Test email sent successfully"
  else
    warn "Test email may have failed (check mail logs)"
  fi
elif [[ "$TEST_SMTP" == "true" ]]; then
  warn "swaks not installed. Install with: apt install swaks"
  warn "To test SMTP manually: telnet localhost 25"
fi

# ========================================================================
# STEP 7: Test IMAP and print DNS records
# ========================================================================
step "7/7" "Verifying IMAP and generating DNS records"

# Check Dovecot IMAP
if systemctl is-active --quiet dovecot 2>/dev/null; then
  ok "Dovecot is active"
else
  warn "Dovecot is NOT active"
fi

if ss -tlnp 2>/dev/null | grep -q ":993 "; then
  ok "IMAPS port 993 is listening"
else
  warn "IMAPS port 993 is NOT listening"
fi

if ss -tlnp 2>/dev/null | grep -q ":143 "; then
  ok "IMAP port 143 is listening"
else
  warn "IMAP port 143 is NOT listening"
fi

# ─── Print DNS records to add ─────────────────────────────────────────
echo -e "\n${BOLD}${CYAN}╔═══════════════════════════════════════════════════╗"
echo "  ║     DNS Records for $DOMAIN"
echo "  ║     Add these to your DNS provider                ║"
echo "  ╚═══════════════════════════════════════════════════╝${NC}\n"

SERVER_IP=$(curl -s ifconfig.me 2>/dev/null || curl -s icanhazip.com 2>/dev/null || echo "YOUR_SERVER_IP")

# MX Record
echo -e "  ${BOLD}MX Record${NC}"
echo -e "  Name:  ${CYAN}@$DOMAIN${NC}"
echo -e "  Value: ${CYAN}mail.$DOMAIN${NC}"
echo -e "  Priority: ${CYAN}10${NC}"
echo ""

# A Record for mail subdomain
echo -e "  ${BOLD}A Record (mail subdomain)${NC}"
echo -e "  Name:  ${CYAN}mail.$DOMAIN${NC}"
echo -e "  Value: ${CYAN}$SERVER_IP${NC}"
echo ""

# SPF Record
echo -e "  ${BOLD}SPF Record (TXT)${NC}"
echo -e "  Name:  ${CYAN}$DOMAIN${NC}"
echo -e "  Value: ${CYAN}\"v=spf1 ip4:$SERVER_IP a mx -all\"${NC}"
echo ""

# DKIM Record
if [[ "$SKIP_DKIM" != "true" && -f "$DKIM_DIR/$DKIM_SELECTOR.txt" ]]; then
  echo -e "  ${BOLD}DKIM Record (TXT)${NC}"
  echo -e "  Name:  ${CYAN}$DKIM_SELECTOR._domainkey.$DOMAIN${NC}"
  # Parse and display the DKIM record value
  DKIM_VALUE=$(cat "$DKIM_DIR/$DKIM_SELECTOR.txt" | grep -v '^;' | tr -d '\n' | sed 's/).*"/"/')
  if [[ -n "$DKIM_VALUE" ]]; then
    echo -e "  Value: ${CYAN}${DKIM_VALUE}${NC}"
  else
    echo -e "  Value: ${CYAN}(see $DKIM_DIR/$DKIM_SELECTOR.txt)${NC}"
  fi
  echo ""
fi

# DMARC Record
echo -e "  ${BOLD}DMARC Record (TXT)${NC}"
echo -e "  Name:  ${CYAN}_dmarc.$DOMAIN${NC}"
echo -e "  Value: ${CYAN}\"v=DMARC1; p=quarantine; rua=mailto:dmarc@$DOMAIN; pct=100\"${NC}"
echo ""

# Reverse DNS note
echo -e "  ${BOLD}Reverse DNS (PTR)${NC}"
echo -e "  Set your server's rDNS (PTR record) at your hosting provider to:"
echo -e "  ${CYAN}mail.$DOMAIN${NC}"
echo -e "  Current IP: ${CYAN}$SERVER_IP${NC}"
echo ""

# ─── Summary ─────────────────────────────────────────────────────────
echo -e "${BOLD}${CYAN}╔═══════════════════════════════════════════════════╗"
echo "  ║     Email Setup Complete                            ║"
echo "  ╚═══════════════════════════════════════════════════╝${NC}\n"

echo -e "  ${BOLD}Mail directory:${NC}  $MAIL_DIR/$DOMAIN"
echo -e "  ${BOLD}Postfix config:${NC} /etc/postfix/main.cf"
echo -e "  ${BOLD}Dovecot config:${NC} /etc/dovecot/dovecot.conf"
echo -e "  ${BOLD}User database:${NC}  /etc/dovecot/users"
echo -e "  ${BOLD}Virtual maps:${NC}   /etc/postfix/virtual_mailbox_maps"
echo ""
echo -e "  ${BOLD}To create a mailbox:${NC}"
echo -e "    1. Hash the password: ${CYAN}doveadm pw -s SHA512-CRYPT${NC}"
echo -e "    2. Add to /etc/dovecot/users:"
echo -e "       ${CYAN}user@$DOMAIN:{SHA512-CRYPT}hashed_password::/var/mail/vhosts/$DOMAIN/user${NC}"
echo -e "    3. Add to /etc/postfix/virtual_mailbox_maps:"
echo -e "       ${CYAN}user@$DOMAIN  $DOMAIN/user/Maildir/${NC}"
echo -e "    4. Rebuild: ${CYAN}postmap /etc/postfix/virtual_mailbox_maps${NC}"
echo -e "    5. Reload: ${CYAN}systemctl reload postfix dovecot${NC}"
echo ""

if [[ "$SMTP_OK" == "true" ]]; then
  echo -e "${GREEN}${BOLD}  ✓ Email infrastructure configured successfully!${NC}\n"
else
  echo -e "${YELLOW}${BOLD}  ! Email infrastructure configured with warnings.${NC}\n"
fi
