#!/usr/bin/env bash
set -Eeuo pipefail
KIT_ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$KIT_ROOT"
if [[ $EUID -ne 0 ]]; then echo "Run as root:  sudo $0 $*"; exit 1; fi
source "$KIT_ROOT/lib/common.sh"
if [[ "${1:-}" == "--reset" ]]; then reset_state; exit 0; fi

STAGES=("00-preflight" "01-security" "02-webapp" "03-databases" "04-ai-infra" "05-ai-tools" "06-ops" "07-filesync")
if [[ -n "${1:-}" ]]; then
  target="$1"; found=""
  for s in "${STAGES[@]}"; do
    if [[ "$s" == "$target" || "$s" == "0$target" ]]; then found="$s"; break; fi
  done
  [[ -z "$found" ]] && { echo "Unknown stage: $target"; exit 1; }
  STAGES=("$found")
fi

echo ""
echo "=================================================================="
echo "  alo-server-kit · 7-layer Ubuntu server setup"
echo "  Host: $KIT_HOSTNAME  User: $KIT_PRIMARY_USER  TZ: $KIT_TIMEZONE"
echo "=================================================================="
echo ""

declare -a RAN=(); declare -a SKIPPED=(); declare -a FAILED=()
for stage in "${STAGES[@]}"; do
  if state_done "$stage" && [[ "${#STAGES[@]}" -gt 1 ]]; then
    log "→ $stage already done, skipping (use ./setup.sh --reset to re-run)"
    SKIPPED+=("$stage"); continue
  fi
  log "============================================================"
  log "Stage: $stage"
  log "============================================================"
  if bash "$KIT_ROOT/stages/${stage}.sh"; then
    RAN+=("$stage")
  else
    err "Stage $stage FAILED"; FAILED+=("$stage")
    err "Run:  sudo ./setup.sh $stage"
    send_telegram "⚠️ *${KIT_HOSTNAME}* setup failed at stage *${stage}*"
    exit 1
  fi
done

log ""
log "============================================================"
log "SETUP SUMMARY"
log "============================================================"
for s in "${RAN[@]:-}"; do log "  ✓ ran    $s"; done
for s in "${SKIPPED[@]:-}"; do log "  → skipped $s"; done
if [[ ${#FAILED[@]} -eq 0 ]]; then
  log ""
  log "All requested stages completed successfully."
  log "Next steps:"
  log "  1. Verify SSH on port $KIT_SSH_PORT works: ssh -p $KIT_SSH_PORT $KIT_PRIMARY_USER@<host>"
  log "  2. Close the temporary port 22: sudo ./scripts/close-ssh-22.sh"
  log "  3. Run the audit: sudo ./verify.sh"
else
  err "Failed stages: ${FAILED[*]}"; exit 1
fi
