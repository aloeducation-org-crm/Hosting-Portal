#!/usr/bin/env bash
# Provision an Nginx reverse-proxy vhost safely. Install root-owned at
# /usr/local/sbin/provision-site.sh and invoke only through a constrained sudoers rule.
set -Eeuo pipefail
umask 027

readonly CONFIG_AVAILABLE="${NGINX_AVAILABLE_DIR:-/etc/nginx/sites-available}"
readonly CONFIG_ENABLED="${NGINX_ENABLED_DIR:-/etc/nginx/sites-enabled}"
readonly SITE_ROOT="${SITE_ROOT:-/srv/alo-sites}"
readonly LOG_TAG="alo-provision-site"

log() { printf '[%s] %s %s\n' "$LOG_TAG" "$(date -u +%FT%TZ)" "$*" >&2; }
die() { local code="$1"; shift; log "ERROR: $*"; exit "$code"; }

[[ $EUID -eq 0 ]] || die 77 'must run as root'
[[ $# -eq 2 ]] || die 64 'usage: provision-site.sh <domain> <target-port>'
domain=${1,,}
port=$2
[[ ${#domain} -le 253 && "$domain" =~ ^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)(\.([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?))*$ ]] || die 64 'invalid domain'
[[ "$port" =~ ^[0-9]{1,5}$ ]] && (( 10#$port >= 1024 && 10#$port <= 65535 )) || die 64 'port must be between 1024 and 65535'

command -v nginx >/dev/null || die 69 'nginx is not installed'
[[ -d "$CONFIG_AVAILABLE" && -d "$CONFIG_ENABLED" ]] || die 72 'nginx site directories do not exist'
site_root="$SITE_ROOT/$domain"
mkdir -p "$site_root/public"
chmod 0750 "$site_root" "$site_root/public"
config="$CONFIG_AVAILABLE/$domain.conf"
link="$CONFIG_ENABLED/$domain.conf"
tmp_config=$(mktemp "$CONFIG_AVAILABLE/.${domain}.XXXXXX")
tmp_link="$CONFIG_ENABLED/.${domain}.link.$$"
backup=""
cleanup() { rm -f -- "$tmp_config" "$tmp_link"; }
trap cleanup EXIT

cat >"$tmp_config" <<NGINX
# Managed by ALO Hosting Portal. Changes will be replaced by provisioning.
server {
    listen 80;
    listen [::]:80;
    server_name $domain;

    location ^~ /.well-known/acme-challenge/ {
        root $site_root/public;
        default_type text/plain;
        try_files \$uri =404;
    }

    location / {
        proxy_pass http://127.0.0.1:$port;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_connect_timeout 5s;
        proxy_read_timeout 60s;
    }
}
NGINX
chmod 0640 "$tmp_config"

# Preserve the old config/link so a bad candidate never takes down live traffic.
if [[ -e "$config" ]]; then backup=$(mktemp "$CONFIG_AVAILABLE/.${domain}.backup.XXXXXX"); cp -p -- "$config" "$backup"; fi
if [[ -L "$link" || -e "$link" ]]; then
  [[ -L "$link" && "$(readlink -f -- "$link")" == "$(readlink -f -- "$config" 2>/dev/null || true)" ]] || die 73 "refusing to replace an unmanaged enabled config: $link"
fi
mv -f -- "$tmp_config" "$config"
ln -s "$config" "$tmp_link"
mv -Tf -- "$tmp_link" "$link"
if ! nginx -t; then
  if [[ -n "$backup" ]]; then mv -f -- "$backup" "$config"; else rm -f -- "$config" "$link"; fi
  nginx -t >/dev/null 2>&1 || true
  die 78 'candidate config failed nginx -t; prior config restored'
fi
if ! systemctl reload nginx; then
  if [[ -n "$backup" ]]; then mv -f -- "$backup" "$config"; else rm -f -- "$config" "$link"; fi
  nginx -t >/dev/null 2>&1 && systemctl reload nginx >/dev/null 2>&1 || true
  die 1 'nginx reload failed; attempted to restore previous config'
fi
[[ -z "$backup" ]] || rm -f -- "$backup"
log "SUCCESS domain=$domain upstream=127.0.0.1:$port vhost=$config"
printf '{"success":true,"domain":"%s","port":%s}\n' "$domain" "$port"
