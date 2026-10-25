#!/usr/bin/env bash
# Issue/renew a Let's Encrypt certificate using HTTP-01 webroot validation.
# Requires certbot, curl, openssl, Nginx, and a root-owned API hook token file.
set -Eeuo pipefail
umask 077
readonly CERTBOT_WEBROOT_BASE="${CERTBOT_WEBROOT_BASE:-/srv/alo-sites}"
readonly CERTBOT_LIVE_BASE="${CERTBOT_LIVE_BASE:-/etc/letsencrypt/live}"
readonly HOOK_TOKEN_FILE="${SSL_STATUS_HOOK_TOKEN_FILE:-/etc/alo-hosting/ssl-hook.token}"
readonly STATUS_API_URL="${SSL_STATUS_API_URL:-http://127.0.0.1:3051/api/internal/sites/ssl-status}"
log() { printf '[alo-ssl-lifecycle] %s %s\n' "$(date -u +%FT%TZ)" "$*" >&2; }
die() { local code="$1"; shift; log "ERROR: $*"; exit "$code"; }

[[ $EUID -eq 0 ]] || die 77 'must run as root'
[[ $# -eq 1 ]] || die 64 'usage: ssl-lifecycle.sh <domain>'
domain=${1,,}
[[ ${#domain} -le 253 && "$domain" =~ ^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)(\.([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?))*$ ]] || die 64 'invalid domain'
for bin in certbot curl openssl stat; do command -v "$bin" >/dev/null || die 69 "$bin is required"; done
webroot="$CERTBOT_WEBROOT_BASE/$domain/public"
[[ -d "$webroot" ]] || die 72 "site webroot not found: $webroot"
[[ -d /etc/letsencrypt && -w /etc/letsencrypt ]] || die 73 'Let’s Encrypt config path is missing or not writable'
[[ -f "$HOOK_TOKEN_FILE" && ! -L "$HOOK_TOKEN_FILE" ]] || die 73 'API hook token file missing or symlinked'
[[ "$(stat -c '%u' "$HOOK_TOKEN_FILE")" == 0 ]] || die 73 'hook token file must be owned by root'
[[ "$(stat -c '%a' "$HOOK_TOKEN_FILE")" == 600 || "$(stat -c '%a' "$HOOK_TOKEN_FILE")" == 400 ]] || die 73 'hook token file must have mode 0400 or 0600'
token=$(<"$HOOK_TOKEN_FILE")
[[ ${#token} -ge 32 && "$token" =~ ^[A-Za-z0-9_-]+$ ]] || die 73 'hook token must contain at least 32 URL-safe characters'

challenge="$webroot/.well-known/acme-challenge"
install -d -m 0755 "$challenge"
# Confirm the challenge path can be served through the active HTTP vhost.
probe="alo-ssl-check-$RANDOM-$$"
printf '%s' "$probe" >"$challenge/$probe"
trap 'rm -f -- "$challenge/$probe"' EXIT
response=$(curl --fail --silent --show-error --max-time 8 "http://$domain/.well-known/acme-challenge/$probe" 2>/dev/null) || die 69 'HTTP-01 challenge is not reachable; check DNS, port 80, and Nginx'
[[ "$response" == "$probe" ]] || die 69 'HTTP-01 challenge response did not match'
rm -f -- "$challenge/$probe"
trap - EXIT
log "HTTP-01 challenge path verified for $domain"

# certbot handles validation challenge retries/rate limits; deploy-hook only
# reports issuance after cert files are present and permission checks pass.
certbot certonly --webroot --webroot-path "$webroot" --domain "$domain" \
  --non-interactive --agree-tos --keep-until-expiring --register-unsafely-without-email \
  --preferred-challenges http
cert_dir="$CERTBOT_LIVE_BASE/$domain"
for file in cert.pem chain.pem fullchain.pem privkey.pem; do
  [[ -s "$cert_dir/$file" ]] || die 74 "certificate output missing: $cert_dir/$file"
done
[[ -r "$cert_dir/fullchain.pem" && -r "$cert_dir/privkey.pem" ]] || die 74 'certificate files are not readable by root'
key_mode=$(stat -c '%a' "$cert_dir/privkey.pem")
(( (8#$key_mode & 0077) == 0 )) || die 74 'private key permissions are too broad'
openssl x509 -in "$cert_dir/cert.pem" -noout -checkend 0 >/dev/null || die 74 'issued certificate is already expired or invalid'

payload=$(printf '{"domainName":"%s","sslStatus":"ACTIVE"}' "$domain")
curl_config=$(mktemp /run/alo-ssl-curl.XXXXXX)
chmod 0600 "$curl_config"
trap 'rm -f -- "$curl_config"' EXIT
printf 'header = "Authorization: Bearer %s"\n' "$token" >"$curl_config"
curl --fail --silent --show-error --max-time 10 --config "$curl_config" \
  -H 'Content-Type: application/json' --data "$payload" "$STATUS_API_URL" >/dev/null || die 69 'certificate issued, but database status hook failed'
rm -f -- "$curl_config"
trap - EXIT
log "SUCCESS domain=$domain sslStatus=ACTIVE cert=$cert_dir/fullchain.pem"
printf '{"success":true,"domain":"%s","sslStatus":"ACTIVE"}\n' "$domain"
