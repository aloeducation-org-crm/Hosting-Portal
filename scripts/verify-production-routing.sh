#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# verify-production-routing.sh — prove that the public domain reaches the
# correct service, and say so honestly.
#
# Every check below is either MEASURED on this host or reported as NOT
# VERIFIABLE. Nothing is inferred, and nothing is asserted without evidence:
# this repository previously carried a fabricated server inventory, so a check
# that cannot be performed must say so rather than print a comforting guess.
#
# Request path under test:
#
#   browser → Cloudflare edge → Cloudflare Tunnel (cloudflared)
#           → https://127.0.0.1:443 (nginx) → http://127.0.0.1:3051 (Next.js)
#
# Read-only. It sends GET/HEAD requests and reads local config. It never
# restarts anything, never writes a config file, and never prints a secret —
# the Cloudflare API token is used, never echoed, and the cloudflared config is
# read for one field only.
#
# Usage:
#   bash scripts/verify-production-routing.sh
#   bash scripts/verify-production-routing.sh --json
#   DOMAIN=hosting.alolabs.net APP_PORT=3051 bash scripts/verify-production-routing.sh
#
# Optional environment:
#   DOMAIN            apex domain (default hosting.alolabs.net)
#   APP_PORT          panel's loopback port (default 3051)
#   CF_API_TOKEN      Cloudflare API token with Zone:SSL and DNS read (optional)
#   CF_ZONE_ID        Cloudflare zone id (optional)
#   CF_ACCOUNT_ID     Cloudflare account id (optional; enables tunnel lookup)
#
# Exit codes:
#   0 = no FAIL findings   1 = at least one FAIL   2 = not run on a sane host
# NOT VERIFIABLE findings do not fail the run; they are reported as gaps.
# ─────────────────────────────────────────────────────────────────────────────
set -Eeuo pipefail

DOMAIN="${DOMAIN:-hosting.alolabs.net}"
WWW_HOST="www.${DOMAIN}"
APP_PORT="${APP_PORT:-3051}"
JSON_ONLY=0
[[ "${1:-}" == "--json" ]] && JSON_ONLY=1

RESULTS=()
FAIL_COUNT=0

json_escape() {
  printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' -e 's/[[:cntrl:]]//g'
}

record() {
  # record <name> <PASS|FAIL|WARN|NOT_VERIFIABLE> <detail>
  local name="$1" status="$2" detail="$3"
  RESULTS+=("$(printf '{"check":"%s","status":"%s","detail":"%s"}' \
    "$(json_escape "$name")" "$status" "$(json_escape "$detail")")")
  [[ "$status" == "FAIL" ]] && FAIL_COUNT=$((FAIL_COUNT + 1))
  if [[ "$JSON_ONLY" -eq 0 ]]; then
    printf '%-24s %-15s %s\n' "$name" "$status" "$detail"
  fi
}

have() { command -v "$1" >/dev/null 2>&1; }

# http_code for a URL. curl writes "000" itself when it never connected, so the
# fallback only has to cover the case where it produced no output at all —
# otherwise the two "000"s concatenate into a meaningless "000000".
code_of() {
  local code=""
  code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 15 "$@" 2>/dev/null)" || code=""
  printf '%s' "${code:-000}"
}

if ! have curl; then
  [[ "$JSON_ONLY" -eq 0 ]] && echo "curl is required to verify routing" >&2
  exit 2
fi

[[ "$JSON_ONLY" -eq 0 ]] && printf '\n=== %s routing verification (read-only) ===\n\n' "$DOMAIN"

# ── 1. The application itself, on the loopback port nginx proxies to ──────────
# This is the check that "looks fine" during the redirect-loop incident: the app
# answers 200 here while the public domain returns 530. Healthy here does NOT
# mean reachable publicly, which is why the public checks below are separate.
local_code="$(code_of "http://127.0.0.1:${APP_PORT}/api/health")"
if [[ "$local_code" == "200" ]]; then
  record "app_local_${APP_PORT}" PASS "http://127.0.0.1:${APP_PORT}/api/health -> 200"
else
  record "app_local_${APP_PORT}" FAIL "http://127.0.0.1:${APP_PORT}/api/health -> ${local_code} (expected 200)"
fi

# ── 2. nginx configuration validity and the site that claims the domain ──────
if have nginx; then
  if nginx_out="$(nginx -t 2>&1)"; then
    record "nginx_config_test" PASS "nginx -t reports the configuration is valid"
  elif sudo -n true 2>/dev/null && nginx_out="$(sudo -n nginx -t 2>&1)"; then
    record "nginx_config_test" PASS "nginx -t (via sudo) reports the configuration is valid"
  else
    record "nginx_config_test" FAIL "nginx -t failed: $(printf '%s' "$nginx_out" | tail -1 | cut -c1-160)"
  fi
else
  record "nginx_config_test" NOT_VERIFIABLE "nginx binary not present on this host"
fi

site_file=""
for candidate in "/etc/nginx/sites-available/${DOMAIN}" "/etc/nginx/conf.d/${DOMAIN}.conf"; do
  if [[ -r "$candidate" ]]; then site_file="$candidate"; break; fi
done
if [[ -n "$site_file" ]]; then
  if grep -qE "server_name[[:space:]].*${WWW_HOST}" "$site_file"; then
    record "nginx_www_server_name" PASS "$(basename "$site_file") handles ${WWW_HOST}"
  else
    record "nginx_www_server_name" FAIL "$(basename "$site_file") has no server_name for ${WWW_HOST}; www falls through to the default vhost"
  fi
else
  record "nginx_www_server_name" NOT_VERIFIABLE "no nginx site file found for ${DOMAIN} (looked in sites-available and conf.d)"
fi

# ── 3. cloudflared tunnel origin must be 443, never 80 ───────────────────────
# Terminating the tunnel on :80 is the documented cause of the 530 /
# ERR_TOO_MANY_REDIRECTS loop: nginx answers the tunnel's HTTP request with
# certbot's 301 to https, the browser re-enters the tunnel on :80, repeat.
tunnel_cfg=""
for candidate in "$HOME/.cloudflared/config.yml" "/etc/cloudflared/config.yml" "$HOME/.cloudflared/config.yaml"; do
  if [[ -r "$candidate" ]]; then tunnel_cfg="$candidate"; break; fi
done
if [[ -n "$tunnel_cfg" ]]; then
  origin="$(grep -A3 -E "hostname:[[:space:]]*${DOMAIN}" "$tunnel_cfg" 2>/dev/null | grep -E "service:" | head -1 | sed -E 's/.*service:[[:space:]]*//' | tr -d '\r')"
  if [[ -z "$origin" ]]; then
    record "tunnel_origin" NOT_VERIFIABLE "${tunnel_cfg} exists but declares no ingress for ${DOMAIN}"
  elif [[ "$origin" =~ ^https://127\.0\.0\.1:443 ]] || [[ "$origin" =~ ^https://localhost:443 ]]; then
    record "tunnel_origin" PASS "tunnel for ${DOMAIN} terminates on ${origin}"
  elif [[ "$origin" =~ :80([^0-9]|$) ]]; then
    record "tunnel_origin" FAIL "tunnel for ${DOMAIN} terminates on ${origin}; nginx 301s port 80 to https, which loops until Cloudflare returns 530"
  else
    record "tunnel_origin" WARN "tunnel for ${DOMAIN} terminates on ${origin} (expected https://127.0.0.1:443)"
  fi
else
  record "tunnel_origin" NOT_VERIFIABLE "no cloudflared config found on this host"
fi

# ── 4. Public HTTP on the apex must redirect to HTTPS ────────────────────────
apex_http="$(code_of "http://${DOMAIN}/")"
apex_http_loc="$(curl -sSI --max-time 15 "http://${DOMAIN}/" 2>/dev/null | tr -d '\r' | awk 'tolower($1)=="location:"{print $2; exit}' || true)"
if [[ "$apex_http" == "301" || "$apex_http" == "308" ]]; then
  record "http_redirects_to_https" PASS "http://${DOMAIN}/ -> ${apex_http} ${apex_http_loc:-<no Location header>}"
else
  record "http_redirects_to_https" FAIL "http://${DOMAIN}/ -> ${apex_http} (expected 301/308 to https)"
fi

# ── 5. Public HTTPS on the apex must serve the app ───────────────────────────
apex_https="$(code_of "https://${DOMAIN}/")"
if [[ "$apex_https" == "200" ]]; then
  record "https_apex_serves_app" PASS "https://${DOMAIN}/ -> 200"
else
  record "https_apex_serves_app" FAIL "https://${DOMAIN}/ -> ${apex_https} (expected 200)"
fi

# ── 6. Redirect-loop detection ───────────────────────────────────────────────
# curl exits 47 when it exhausts --max-redirs, which is exactly what the
# 530/ERR_TOO_MANY_REDIRECTS incident looks like from the edge.
set +e
curl -sS -o /dev/null --max-time 20 -L --max-redirs 5 "https://${DOMAIN}/" 2>/dev/null
loop_rc=$?
set -e
if [[ "$loop_rc" -eq 47 ]]; then
  record "no_redirect_loop" FAIL "following https://${DOMAIN}/ exceeded 5 redirects (curl exit 47) — this is the redirect loop"
elif [[ "$loop_rc" -eq 0 ]]; then
  record "no_redirect_loop" PASS "https://${DOMAIN}/ settles without exceeding 5 redirects"
else
  record "no_redirect_loop" FAIL "curl exited ${loop_rc} while following https://${DOMAIN}/"
fi

# ── 7. www host: canonical redirect to the apex ──────────────────────────────
if getent hosts "$WWW_HOST" >/dev/null 2>&1 || nslookup "$WWW_HOST" >/dev/null 2>&1; then
  www_code="$(code_of "https://${WWW_HOST}/")"
  www_loc="$(curl -sSI --max-time 15 "https://${WWW_HOST}/" 2>/dev/null | tr -d '\r' | awk 'tolower($1)=="location:"{print $2; exit}' || true)"
  if [[ "$www_code" == "301" || "$www_code" == "308" ]] && [[ "$www_loc" == *"${DOMAIN}"* ]]; then
    record "www_redirects_to_apex" PASS "https://${WWW_HOST}/ -> ${www_code} ${www_loc}"
  elif [[ "$www_code" == "200" ]]; then
    record "www_redirects_to_apex" WARN "https://${WWW_HOST}/ -> 200 serving content directly; both apex and www answer, so the canonical host is ambiguous"
  else
    record "www_redirects_to_apex" FAIL "https://${WWW_HOST}/ -> ${www_code} ${www_loc:-<no Location>} (expected 301/308 to https://${DOMAIN}/)"
  fi
else
  record "www_redirects_to_apex" NOT_VERIFIABLE "${WWW_HOST} does not resolve from this host; no DNS record is configured"
fi

# ── 8. The health endpoint actually speaks for the app ───────────────────────
health_body="$(curl -sS --max-time 15 "https://${DOMAIN}/api/health" 2>/dev/null || true)"
if printf '%s' "$health_body" | grep -q '"status"'; then
  health_status="$(printf '%s' "$health_body" | sed -n 's/.*"status"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)"
  if [[ "$health_status" == "ok" || "$health_status" == "healthy" ]]; then
    record "public_health_endpoint" PASS "https://${DOMAIN}/api/health -> status ${health_status}"
  else
    record "public_health_endpoint" FAIL "https://${DOMAIN}/api/health -> status '${health_status}' (expected ok/healthy)"
  fi
else
  record "public_health_endpoint" FAIL "https://${DOMAIN}/api/health returned no parseable status field"
fi

# ── 9. A second public API endpoint, to prove routing not just the homepage ───
csrf_code="$(code_of "https://${DOMAIN}/api/csrf")"
if [[ "$csrf_code" == "200" || "$csrf_code" == "204" ]]; then
  record "public_api_endpoint" PASS "https://${DOMAIN}/api/csrf -> ${csrf_code}"
else
  record "public_api_endpoint" FAIL "https://${DOMAIN}/api/csrf -> ${csrf_code} (expected 200/204)"
fi

# ── 10. TLS certificate identity and remaining lifetime ──────────────────────
if have openssl; then
  cert_text="$(printf 'Q' | openssl s_client -connect "${DOMAIN}:443" -servername "$DOMAIN" 2>/dev/null | openssl x509 -noout -subject -issuer -dates 2>/dev/null || true)"
  if [[ -n "$cert_text" ]]; then
    not_after="$(printf '%s\n' "$cert_text" | awk -F= '/notAfter/{print $2; exit}')"
    issuer="$(printf '%s\n' "$cert_text" | sed -n 's/^issuer=//p' | head -1 | sed -E 's/.*O *= *([^,\/]+).*/\1/' | tr -d ' ')"
    subject="$(printf '%s\n' "$cert_text" | sed -n 's/^subject=//p' | head -1 | sed -E 's/.*CN *= *([^,]+).*/\1/' | tr -d ' ')"
    if [[ -n "$not_after" ]]; then
      days_left=$(( ( $(date -u -d "$not_after" +%s) - $(date -u +%s) ) / 86400 ))
      if [[ "$days_left" -lt 0 ]]; then
        record "tls_certificate" FAIL "certificate for ${subject:-unknown} expired ${days_left} days ago"
      elif [[ "$days_left" -lt 21 ]]; then
        record "tls_certificate" WARN "certificate for ${subject:-unknown} expires in ${days_left} days (${not_after})"
      else
        record "tls_certificate" PASS "certificate for ${subject:-unknown} issued by ${issuer:-unknown}, ${days_left} days remaining"
      fi
    else
      record "tls_certificate" NOT_VERIFIABLE "certificate presented but no notAfter could be parsed"
    fi
    # The cert must cover www, or the www redirect is unreachable in a browser.
    sans="$(printf 'Q' | openssl s_client -connect "${DOMAIN}:443" -servername "$DOMAIN" 2>/dev/null | openssl x509 -noout -text 2>/dev/null | grep -A1 "Subject Alternative Name" | tail -1 || true)"
    if printf '%s' "$sans" | grep -q "${WWW_HOST}"; then
      record "tls_covers_www" PASS "certificate SAN list includes ${WWW_HOST}"
    else
      record "tls_covers_www" WARN "certificate SAN list does not include ${WWW_HOST}; browsers will warn on https://${WWW_HOST} before any redirect runs"
    fi
  else
    record "tls_certificate" NOT_VERIFIABLE "no certificate could be read from ${DOMAIN}:443"
  fi
else
  record "tls_certificate" NOT_VERIFIABLE "openssl not installed on this host"
fi

# ── 11. Cloudflare SSL/TLS mode (needs an API token; otherwise a gap) ────────
# Flexible is the setting that re-creates the loop: Cloudflare speaks HTTPS to
# the browser but HTTP to the origin, so nginx's 301 to https never terminates.
if [[ -n "${CF_API_TOKEN:-}" && -n "${CF_ZONE_ID:-}" ]]; then
  cf_json="$(curl -sS --max-time 15 -H "Authorization: Bearer ${CF_API_TOKEN}" \
    "https://api.cloudflare.com/client/v4/zones/${CF_ZONE_ID}/settings/ssl" 2>/dev/null || true)"
  cf_mode="$(printf '%s' "$cf_json" | sed -n 's/.*"value"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)"
  if [[ -z "$cf_mode" ]]; then
    record "cloudflare_ssl_mode" NOT_VERIFIABLE "Cloudflare API returned no ssl setting (check token scope Zone.Settings:Read)"
  elif [[ "$cf_mode" == "full" ]]; then
    record "cloudflare_ssl_mode" PASS "Cloudflare SSL/TLS mode is '${cf_mode}'"
  elif [[ "$cf_mode" == "flexible" ]]; then
    record "cloudflare_ssl_mode" FAIL "Cloudflare SSL/TLS mode is 'flexible'; Cloudflare talks HTTP to the origin and nginx 301s back to https, producing the redirect loop. Set the mode to Full."
  else
    record "cloudflare_ssl_mode" WARN "Cloudflare SSL/TLS mode is '${cf_mode}' (recommended: full)"
  fi
else
  record "cloudflare_ssl_mode" NOT_VERIFIABLE "set CF_API_TOKEN and CF_ZONE_ID to verify the Cloudflare SSL/TLS mode; 'flexible' is the known cause of the 530 loop"
fi

# ── 12. DNS resolution for both names ────────────────────────────────────────
if have getent; then
  apex_ip="$(getent hosts "$DOMAIN" 2>/dev/null | awk '{print $1; exit}' || true)"
  [[ -n "$apex_ip" ]] \
    && record "dns_apex" PASS "${DOMAIN} resolves to ${apex_ip}" \
    || record "dns_apex" FAIL "${DOMAIN} does not resolve from this host"
else
  record "dns_apex" NOT_VERIFIABLE "getent not available"
fi

# ── Summary ──────────────────────────────────────────────────────────────────
if [[ "$JSON_ONLY" -eq 1 ]]; then
  printf '{"domain":"%s","appPort":%s,"failures":%d,"checks":[' \
    "$(json_escape "$DOMAIN")" "$APP_PORT" "$FAIL_COUNT"
  first=1
  for r in "${RESULTS[@]}"; do
    [[ $first -eq 1 ]] && first=0 || printf ','
    printf '%s' "$r"
  done
  printf ']}\n'
else
  printf '\n=== %d check(s), %d failure(s) ===\n' "${#RESULTS[@]}" "$FAIL_COUNT"
  printf 'NOT VERIFIABLE rows are genuine gaps, not passes: they need credentials or\n'
  printf 'a host this script cannot see. Do not read them as healthy.\n\n'
fi

[[ "$FAIL_COUNT" -eq 0 ]] && exit 0 || exit 1
