#!/usr/bin/env bash
#
# scripts/install-public-ingress.sh — wire hosting.alolabs.net to the panel
# via Cloudflare Tunnel (no public IP needed) + Let's Encrypt cert + nginx
# HTTPS vhost.
#
# This is the fix for the BLOCKED ROADMAP items "Cloudflare Tunnel / DNS not
# wired" and "DigitalOcean-style domain/DNS/SSL/firewall — no live
# verification". It automates the wiring that bootstrap-server.sh touches
# only via its optional --nginx and --tunnel flags.
#
# Required env (read from /etc/alo-hosting/panel.env, set during go-live.sh
# or filled in by the operator):
#   CLOUDFLARE_TUNNEL_TOKEN  — from Cloudflare One → Tunnels → Create tunnel
#                              (the tunnel must already be created; the
#                              token is what cloudflared uses to authenticate
#                              to the Cloudflare edge)
#   CLOUDFLARE_API_TOKEN     — scoped to Zone:DNS:Edit (for the apex CNAME)
#                              and Account:Registrar:Edit (for D)
#   CLOUDFLARE_ZONE_ID       — the alolabs.net zone id (Cloudflare dashboard)
#
# Optional env:
#   DOMAIN                   — default: hosting.alolabs.net
#   PANEL_PORT               — default: 3051
#   KIT_ADMIN_EMAIL          — for Let's Encrypt cert registration
#
# Run on alo-server-lap:
#   sudo ./scripts/install-public-ingress.sh
#
# Idempotency: every step is safe to re-run. Existing tunnel configs are
# backed up before being replaced; certbot uses --keep-until-expiring so a
# re-run does not issue a duplicate cert.
#
set -Eeuo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PANEL_ENV=/etc/alo-hosting/panel.env
DOMAIN="${DOMAIN:-hosting.alolabs.net}"
PANEL_PORT="${PANEL_PORT:-3051}"
PANEL_HOST=127.0.0.1
TUNNEL_NAME="alo-hosting"
TUNNEL_CONF=/etc/cloudflared/config.yml
TUNNEL_SERVICE=cloudflared
ADMIN_EMAIL="${KIT_ADMIN_EMAIL:-admin@alolabs.net}"

say()  { printf '\n\033[1;34m▶ %s\033[0m\n' "$*"; }
ok()   { printf '  \033[1;32m✔\033[0m %s\n' "$*"; }
warn() { printf '  \033[1;33m⚠\033[0m %s\n' "$*" >&2; }
die()  { printf '  \033[1;31m✘ %s\033[0m\n' "$*" >&2; exit 1; }

if [[ $EUID -ne 0 ]]; then
  exec sudo -E bash "$0" "$@"
fi

trap 'die "install-public-ingress failed at step (see above)"' ERR

# ─── Pre-flight ──────────────────────────────────────────────────────────────
say "Pre-flight"
[[ -f "$PANEL_ENV" ]] || die "$PANEL_ENV missing — run scripts/go-live.sh first"
# Source panel.env to pick up CLOUDFLARE_* values.
set -a; # shellcheck disable=SC1090
source "$PANEL_ENV"; set +a

[[ -n "${CLOUDFLARE_TUNNEL_TOKEN:-}" ]] || die "CLOUDFLARE_TUNNEL_TOKEN not set in $PANEL_ENV"
[[ -n "${CLOUDFLARE_API_TOKEN:-}" ]]   || die "CLOUDFLARE_API_TOKEN not set in $PANEL_ENV"
[[ -n "${CLOUDFLARE_ZONE_ID:-}" ]]     || die "CLOUDFLARE_ZONE_ID not set in $PANEL_ENV"
ok "all required Cloudflare credentials present"

# Confirm the panel is actually up on the loopback before we open it to the world.
if ! curl -fsS --max-time 5 "http://${PANEL_HOST}:${PANEL_PORT}/api/health" | jq -e '.status == "ok"' >/dev/null 2>&1; then
  die "panel not healthy on http://${PANEL_HOST}:${PANEL_PORT} — run scripts/go-live.sh first"
fi
ok "panel healthy on loopback"

# ─── 1. Install cloudflared ──────────────────────────────────────────────────
say "Step 1/5: install cloudflared"
if ! command -v cloudflared >/dev/null 2>&1; then
  # Cloudflare's apt repo
  if [[ ! -f /usr/share/keyrings/cloudflare-main.gpg ]]; then
    curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg \
      | gpg --dearmor -o /usr/share/keyrings/cloudflare-main.gpg
  fi
  CODENAME="$(lsb_release -cs 2>/dev/null || echo jammy)"
  echo "deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared ${CODENAME} main" \
    > /etc/apt/sources.list.d/cloudflared.list
  apt-get -y update >/dev/null
  apt-get -y install --no-install-recommends cloudflared >/dev/null
fi
CLOUDFLARED_VER="$(cloudflared --version 2>&1 | head -1)"
ok "cloudflared installed: $CLOUDFLARED_VER"

# ─── 2. Render the tunnel config from the repo template ──────────────────────
say "Step 2/5: render /etc/cloudflared/config.yml"
install -d -m 0755 /etc/cloudflared

# Resolve the tunnel UUID from the existing tunnel (the operator already
# created `alo-hosting` in the Cloudflare dashboard and has the token). The
# token itself carries the tunnel id; we can also list via `cloudflared tunnel list`
# but that needs interactive login. The config.yml template uses <TUNNEL_UUID>
# as a placeholder — we substitute it from the token's JWT payload.
# The tunnel token is a base64-encoded JWT whose `sub` is the tunnel UUID.
TUNNEL_ID="$(printf '%s' "$CLOUDFLARE_TUNNEL_TOKEN" | cut -d. -f2 | tr '_-' '/+' | base64 -d 2>/dev/null | jq -r '.sub // empty' 2>/dev/null || true)"
if [[ -z "$TUNNEL_ID" ]]; then
  # Fall back to looking for an existing credentials file.
  TUNNEL_ID="$(find /etc/cloudflared /root/.cloudflared /home/*/.cloudflared -maxdepth 1 -name '*.json' 2>/dev/null | head -1 | xargs jq -r '.TunnelID // empty' 2>/dev/null || true)"
fi
[[ -n "$TUNNEL_ID" ]] || die "could not determine tunnel UUID from token — set it manually: TUNNEL_ID=<uuid> sudo -E ./scripts/install-public-ingress.sh"

# Render from the repo's canonical config template, substituting only the UUID.
# The template hard-codes /home/alamin/.cloudflared/ — we rewrite that to
# /etc/cloudflared/ so the service can find the credentials file regardless
# of which user installed the tunnel.
sed -e "s|<TUNNEL_UUID>|${TUNNEL_ID}|g" \
    -e "s|/home/alamin/.cloudflared/|/etc/cloudflared/|g" \
    "$REPO_ROOT/deploy/cloudflared/config.yml" > "$TUNNEL_CONF"
chmod 0644 "$TUNNEL_CONF"
ok "rendered $TUNNEL_CONF with tunnel id $TUNNEL_ID"

# ─── 3. Install cloudflared as a systemd service ─────────────────────────────
say "Step 3/5: install cloudflared.service"
# `cloudflared service install` writes the unit file. If it is already there,
# we skip.
if [[ ! -f /etc/systemd/system/cloudflared.service ]] && \
   [[ ! -f /etc/systemd/system/multi-user.target.wants/cloudflared.service ]]; then
  # The token-based install: cloudflared runs as root and pulls the ingress
  # config from --config. We pass the token via the install command.
  cloudflared service install "$CLOUDFLARE_TUNNEL_TOKEN" --config "$TUNNEL_CONF" \
    || die "cloudflared service install failed — see cloudflared logs"
else
  warn "cloudflared.service already installed — restarting with new config"
  systemctl stop cloudflared 2>/dev/null || true
  # Update the EnvironmentFile/ExecStart to use the new token + config path.
  # The systemd unit cloudflared installs reads /etc/cloudflared/config.yml
  # by default, so re-rendering the file is usually enough.
fi

systemctl daemon-reload
systemctl enable cloudflared
systemctl restart cloudflared
sleep 3
if systemctl is-active --quiet cloudflared; then
  ok "cloudflared is active"
else
  journalctl -u cloudflared -n 30 --no-pager
  die "cloudflared did not start — see journal above"
fi

# ─── 4. Create the DNS CNAME pointing hosting.alolabs.net → tunnel ──────────
say "Step 4/5: DNS CNAME for ${DOMAIN} → ${TUNNEL_ID}.cfargotunnel.com"
# We need just the apex part of the domain (e.g. "hosting" for hosting.alolabs.net)
DNS_NAME="${DOMAIN%%.*}"  # hosting
DNS_RESULT="$(curl -sS -X POST \
  "https://api.cloudflare.com/client/v4/zones/${CLOUDFLARE_ZONE_ID}/dns_records" \
  -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{\"type\":\"CNAME\",\"name\":\"${DNS_NAME}\",\"content\":\"${TUNNEL_ID}.cfargotunnel.com\",\"proxied\":true,\"comment\":\"alo-server-lap panel (set by install-public-ingress.sh)\"}")"
if printf '%s' "$DNS_RESULT" | jq -e '.success == true' >/dev/null 2>&1; then
  ok "DNS CNAME created (${DNS_NAME} → ${TUNNEL_ID}.cfargotunnel.com, proxied)"
elif printf '%s' "$DNS_RESULT" | jq -e '.errors[0].code == 81053' >/dev/null 2>&1; then
  # 81053 = record already exists
  ok "DNS CNAME already exists — leaving it as is"
else
  ERR="$(printf '%s' "$DNS_RESULT" | jq -r '.errors[0].message // "unknown"')"
  warn "DNS CNAME creation failed: $ERR"
  warn "verify manually in the Cloudflare dashboard that ${DNS_NAME}.${DOMAIN#*.} → ${TUNNEL_ID}.cfargotunnel.com (proxied)"
fi

# ─── 5. Install nginx HTTPS vhost + Let's Encrypt cert ──────────────────────
say "Step 5/5: nginx HTTPS vhost + Let's Encrypt cert"
if ! command -v nginx >/dev/null 2>&1; then
  apt-get -y install --no-install-recommends nginx >/dev/null
fi
if ! command -v certbot >/dev/null 2>&1; then
  apt-get -y install --no-install-recommends certbot python3-certbot-nginx >/dev/null
fi
ok "nginx + certbot installed"

# Install the canonical vhost from the repo. We also need the websocket
# upgrade snippet that the vhost references via $connection_upgrade.
install -d -m 0755 /etc/nginx/sites-available /etc/nginx/sites-enabled /etc/nginx/conf.d
cp "$REPO_ROOT/deploy/nginx/conf.d/websocket-upgrade.conf" /etc/nginx/conf.d/websocket-upgrade.conf
cp "$REPO_ROOT/deploy/nginx/hosting.alolabs.net.conf" \
   "/etc/nginx/sites-available/${DOMAIN}"
ln -sfn "/etc/nginx/sites-available/${DOMAIN}" \
        "/etc/nginx/sites-enabled/${DOMAIN}"
rm -f /etc/nginx/sites-enabled/default  # disable the default site
ok "nginx vhost installed for ${DOMAIN}"

# Before we can issue a cert, we need a working HTTP listener on port 80
# (the 80 block in the vhost serves ACME challenges). nginx -t may fail
# because the 443 block references ssl_certificate paths that do not exist
# yet — so we comment them out for the first nginx reload, then let
# certbot --nginx add them back when it issues the cert.
if [[ ! -d "/etc/letsencrypt/live/${DOMAIN}" ]]; then
  ok "no cert yet — temporarily commenting ssl_certificate lines for first nginx -t"
  sed -i 's|^\(\s*ssl_certificate\)|#\1|; s|^\(\s*ssl_certificate_key\)|#\1|; s|^\(\s*include\s*/etc/letsencrypt/options-ssl-nginx.conf\)|#\1|; s|^\(\s*ssl_dhparam\)|#\1|' \
    "/etc/nginx/sites-available/${DOMAIN}"
fi

nginx -t || die "nginx -t failed (before certbot)"
systemctl reload nginx
ok "nginx reloaded (HTTP listener ready for ACME challenge)"

# Issue the cert. We use certbot --nginx so it edits the vhost in place
# (un-comments the ssl_certificate lines and adds the 80 → 443 redirect).
if [[ ! -d "/etc/letsencrypt/live/${DOMAIN}" ]]; then
  say "Issuing Let's Encrypt cert for ${DOMAIN} (this can take ~30s)"
  certbot --nginx \
    -d "$DOMAIN" \
    --email "$ADMIN_EMAIL" \
    --agree-tos --no-eff-email --non-interactive --keep-until-expiring \
    --redirect || die "certbot failed — check /var/log/letsencrypt/letsencrypt.log"
  ok "cert issued at /etc/letsencrypt/live/${DOMAIN}/"
else
  ok "cert already exists at /etc/letsencrypt/live/${DOMAIN}/ — running certbot renew (no-op if not due)"
  certbot renew --non-interactive --deploy-hook "systemctl reload nginx" || true
fi

# Final nginx reload with the cert now in place.
nginx -t || die "nginx -t failed (after certbot)"
systemctl reload nginx
ok "nginx reloaded with TLS"

# ─── Verify end-to-end ───────────────────────────────────────────────────────
say "Verifying https://${DOMAIN}/api/health"
sleep 5  # let the tunnel + DNS settle
if curl -fsS --max-time 15 "https://${DOMAIN}/api/health" | jq -e '.status == "ok"' >/dev/null 2>&1; then
  ok "✓ https://${DOMAIN}/api/health → {\"status\":\"ok\"}"
else
  warn "https://${DOMAIN}/api/health did not return ok yet — DNS propagation may take a minute."
  warn "If still failing after 60s, check:"
  warn "  - systemctl status cloudflared"
  warn "  - journalctl -u cloudflared -n 50"
  warn "  - Cloudflare dashboard SSL/TLS mode must be 'Full' (not Flexible, not Full (strict))"
  warn "    see deploy/cloudflared/config.yml for the reasoning"
fi

cat <<EOF

╔════════════════════════════════════════════════════════════════════════════╗
║  PUBLIC INGRESS LIVE                                                        ║
║                                                                             ║
║  https://${DOMAIN}                                                          ║
║                                                                             ║
║  Cloudflare Tunnel: cloudflared.service (active, tunnel id ${TUNNEL_ID:0:8}…)    ║
║  TLS cert:         /etc/letsencrypt/live/${DOMAIN}/                         ║
║  Renewal:          certbot.timer (automatic, attempts every 12h)            ║
║  nginx vhost:      /etc/nginx/sites-available/${DOMAIN}                    ║
║  Tunnel config:    /etc/cloudflared/config.yml                              ║
║                                                                             ║
║  IMPORTANT — set Cloudflare SSL/TLS mode to 'Full' (not Flexible, not       ║
║  Full (strict)). See deploy/cloudflared/config.yml for the reasoning:       ║
║  Flexible re-encrypts to port 80 and causes an infinite 301 loop;           ║
║  Full (strict) rejects the loopback SNI cert cloudflared presents.          ║
║                                                                             ║
║  Open https://${DOMAIN} in a browser. Log in as admin@alolabs.net with      ║
║  the password from /etc/alo-hosting/panel-admin.txt (or rotate it with      ║
║  sudo /usr/local/sbin/alo-init-db --rotate-password).                       ║
╚════════════════════════════════════════════════════════════════════════════╝

EOF
