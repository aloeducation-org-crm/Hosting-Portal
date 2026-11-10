#!/usr/bin/env bash
set -Eeuo pipefail
KIT_ROOT="$(cd "$(dirname "$0")" && pwd)"
source "$KIT_ROOT/lib/common.sh"
printf "\n\033[1;4m%s\033[0m  (uptime: %s, load: %s)\n" "$KIT_HOSTNAME" "$(uptime -p)" "$(awk '{print $1, $2, $3}' /proc/loadavg)"
free -h | awk 'NR==1 || NR==2 || NR==3'
echo ""
df -h / /home 2>/dev/null | head -3
echo ""
echo "── Services ──────────────────────────────"
for svc in ssh nginx postgresql mysql pm2-$KIT_PRIMARY_USER litellm ollama open-webui netdata smbd nmbd fail2ban; do
  state=$(systemctl is-active "$svc" 2>/dev/null || echo "n/a")
  printf "  %-30s %s\n" "$svc" "$state"
done
echo ""
echo "── Listening ports ──────────────────────"
ss -tlnp | awk 'NR==1 || /:(22|80|443|11434|4000|3001|19999|5432|3306|8384|139|445)\b/' | head -20
echo ""
echo "── Recent backups ───────────────────────"
ls -lht /var/backups/alo-db/daily/ 2>/dev/null | head -8 || echo "  (none)"
echo ""
echo "── Setup state ──────────────────────────"
ls -1 "$KIT_ROOT/run-state/"*.done 2>/dev/null | xargs -n1 basename 2>/dev/null || echo "  (no stages done)"
