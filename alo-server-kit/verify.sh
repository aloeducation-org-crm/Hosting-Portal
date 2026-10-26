#!/usr/bin/env bash
set -Eeuo pipefail
KIT_ROOT="$(cd "$(dirname "$0")" && pwd)"
source "$KIT_ROOT/lib/common.sh"
PASS=0; WARN=0; FAIL=0
ok()   { printf "  \033[32m✓ %s\033[0m\n" "$1"; PASS=$((PASS+1)); }
warn() { printf "  \033[33m⚠ %s\033[0m\n" "$1"; WARN=$((WARN+1)); }
fail() { printf "  \033[31m✗ %s\033[0m\n" "$1"; FAIL=$((FAIL+1)); }
banner() { printf "\n\033[1;36m=== %s ===\033[0m\n" "$1"; }

banner "L1 — Security"
ss -tlnp | grep -q ":${KIT_SSH_PORT}\b" && ok "SSH listening on port ${KIT_SSH_PORT}" || fail "SSH NOT listening on ${KIT_SSH_PORT}"
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
testparm -s 2>/dev/null | grep -q '\[documents\]' && ok "Samba [documents] share present" || fail "Samba [documents] missing"
if testparm -s 2>/dev/null | grep -q '/var/backups/alo-db'; then
  fail "SECURITY: /var/backups/alo-db must NOT be exported over Samba"
else
  ok "DB backups isolated from Samba shares"
fi

banner "SUMMARY"
printf "  Passed:    %3d\n" "$PASS"
printf "  Warnings:  %3d\n" "$WARN"
printf "  Failures:  %3d\n" "$FAIL"
if [[ $FAIL -gt 0 ]]; then printf "\n  ❌ %d checks failed.\n" "$FAIL"; exit 1
elif [[ $WARN -gt 0 ]]; then printf "\n  ⚠️  %d warnings — review but no blockers.\n" "$WARN"; exit 0
else printf "\n  ✅ All checks passed.\n"; exit 0; fi
