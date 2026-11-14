#!/usr/bin/env bash
#
# scripts/install-github-runner.sh — register alo-server-lap as a self-hosted
# GitHub Actions runner for aloeducation-org-crm/Hosting-Portal.
#
# This is the fix for the BLOCKED ROADMAP item "Self-hosted GitHub Actions
# runner not registered": the deploy job that has been sitting in `queued`
# since 2026-10-27 11:09 UTC will finally pick up once this service is
# active.
#
# Required env:
#   ACTIONS_RUNNER_TOKEN — get it from repo Settings → Actions → Runners →
#                          New self-hosted runner. The token expires in ~1h.
#
# Optional env:
#   RUNNER_USER    — the Linux user the runner runs as (default: alamin)
#   RUNNER_LABELS  — extra labels, comma-separated (default: alo-server-lap)
#   RUNNER_VERSION — actions/runner release (default: 2.319.0, x64)
#
# Run on alo-server-lap:
#   sudo ACTIONS_RUNNER_TOKEN=xxxxxxx ./scripts/install-github-runner.sh
#
# Idempotency: if the runner is already installed and the service is running,
# this script prints the existing service name and exits 0. If the service
# exists but is not active, it is restarted. To re-register with a new token,
# pass --replace.
#
set -Eeuo pipefail

REPO="aloeducation-org-crm/Hosting-Portal"
RUNNER_USER="${RUNNER_USER:-${SUDO_USER:-alamin}}"
RUNNER_HOME="/home/${RUNNER_USER}/actions-runner"
RUNNER_LABELS="${RUNNER_LABELS:-self-hosted,linux,x64,alo-server-lap}"
RUNNER_VERSION="${RUNNER_VERSION:-2.319.0}"
ARCHIVE="actions-runner-linux-x64-${RUNNER_VERSION}.tar.gz"
ARCHIVE_SHA256="2f7d6dfb7a16d0674fef5be04c3c34b0cee52b5925864030d9a9f426c5b3e0c8"
# Service name follows the convention actions.runner.<owner-repo-slug>.<user>
SERVICE_NAME="actions.runner.${REPO//\//-}.${RUNNER_USER}"
TOKEN_FILE=/etc/alo-hosting/.runner-token
REPLACE=0

say()  { printf '\n\033[1;34m▶ %s\033[0m\n' "$*"; }
ok()   { printf '  \033[1;32m✔\033[0m %s\n' "$*"; }
warn() { printf '  \033[1;33m⚠\033[0m %s\n' "$*" >&2; }
die()  { printf '  \033[1;31m✘ %s\033[0m\n' "$*" >&2; exit 1; }

# Re-exec under sudo if not root.
if [[ $EUID -ne 0 ]]; then
  exec sudo -E bash "$0" "$@"
fi

while [[ $# -gt 0 ]]; do
  case "$1" in
    --replace) REPLACE=1; shift ;;
    -h|--help) sed -n '2,40p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) die "unknown argument: $1 (try --help)" ;;
  esac
done

# ─── Pre-flight ──────────────────────────────────────────────────────────────
[[ -n "${ACTIONS_RUNNER_TOKEN:-}" ]] || die "ACTIONS_RUNNER_TOKEN env var not set.
  Get it from: https://github.com/${REPO}/settings/actions/runners/new
  Then run:
    sudo ACTIONS_RUNNER_TOKEN=xxxxxxx ./scripts/install-github-runner.sh"

id "$RUNNER_USER" >/dev/null 2>&1 || die "user '$RUNNER_USER' does not exist"

# ─── Already installed? ──────────────────────────────────────────────────────
if systemctl list-unit-files 2>/dev/null | grep -q "${SERVICE_NAME}.service"; then
  if [[ "$REPLACE" -eq 0 ]]; then
    if systemctl is-active --quiet "$SERVICE_NAME"; then
      ok "runner already installed and active: $SERVICE_NAME"
      ok "nothing to do — visit https://github.com/${REPO}/settings/actions/runners"
      exit 0
    else
      warn "service exists but is not active — restarting"
      systemctl restart "$SERVICE_NAME"
      sleep 3
      systemctl is-active --quiet "$SERVICE_NAME" && ok "restarted" || die "could not restart"
      exit 0
    fi
  else
    say "removing existing runner (--replace)"
    OLD_TOKEN="$(cat "$TOKEN_FILE" 2>/dev/null || echo '')"
    if [[ -n "$OLD_TOKEN" ]]; then
      sudo -u "$RUNNER_USER" bash -lc "cd '$RUNNER_HOME' && ./config.sh remove --token '$OLD_TOKEN'" || warn "config.sh remove failed (will continue)"
    fi
    systemctl stop "$SERVICE_NAME" 2>/dev/null || true
    systemctl disable "$SERVICE_NAME" 2>/dev/null || true
    rm -f "/etc/systemd/system/${SERVICE_NAME}.service"
    systemctl daemon-reload
  fi
fi

# ─── 1. Install the runner package ───────────────────────────────────────────
say "Step 1/4: install actions/runner v${RUNNER_VERSION}"
install -d -m 0755 -o "$RUNNER_USER" -g "$RUNNER_USER" "$RUNNER_HOME"

if [[ ! -x "$RUNNER_HOME/config.sh" ]]; then
  ok "downloading $ARCHIVE"
  curl -fsSL -o "/tmp/$ARCHIVE" "https://github.com/actions/runner/releases/download/v${RUNNER_VERSION}/$ARCHIVE"
  actual_sha="$(sha256sum "/tmp/$ARCHIVE" | awk '{print $1}')"
  [[ "$actual_sha" == "$ARCHIVE_SHA256" ]] \
    || die "sha256 mismatch on $ARCHIVE — got $actual_sha, expected $ARCHIVE_SHA256 (re-run with RUNNER_VERSION=<latest>)"
  ok "sha256 verified"
  sudo -u "$RUNNER_USER" tar xzf "/tmp/$ARCHIVE" -C "$RUNNER_HOME"
  rm -f "/tmp/$ARCHIVE"
  ok "extracted to $RUNNER_HOME"
else
  ok "config.sh already present — skipping download"
fi

# ─── 2. Persist the registration token (root-only, mode 0600) ────────────────
say "Step 2/4: persist registration token"
install -d -m 0750 /etc/alo-hosting
printf '%s' "$ACTIONS_RUNNER_TOKEN" > "$TOKEN_FILE"
chmod 0600 "$TOKEN_FILE"
chown root:root "$TOKEN_FILE"
ok "token written to $TOKEN_FILE (mode 0600, root:root) — used by --replace next time"

# ─── 3. Register the runner (unattended) ─────────────────────────────────────
say "Step 3/4: register with GitHub"
# config.sh refuses to run as root, so we drop to the app user.
sudo -u "$RUNNER_USER" bash -lc "cd '$RUNNER_HOME' && ./config.sh \
  --url https://github.com/${REPO} \
  --token '${ACTIONS_RUNNER_TOKEN}' \
  --name alo-server-lap \
  --labels '${RUNNER_LABELS}' \
  --unattended --replace" \
  || die "config.sh failed — the token may be expired (regenerate from the GitHub UI)"

ok "registered as 'alo-server-lap' with labels: ${RUNNER_LABELS}"

# ─── 4. Install + start the systemd service ──────────────────────────────────
say "Step 4/4: install + start systemd service"
# svc.sh installs the unit, but it invokes sudo internally and expects to be
# run as the app user with passwordless sudo for the install commands. We have
# that (alo-hosting-portal sudoers rules), but to be safe we wrap it.
sudo -u "$RUNNER_USER" bash -lc "cd '$RUNNER_HOME' && sudo ./svc.sh install ${RUNNER_USER}" \
  || die "svc.sh install failed — check sudoers for $RUNNER_USER"

systemctl daemon-reload
systemctl enable "$SERVICE_NAME"
systemctl restart "$SERVICE_NAME"
sleep 3

if systemctl is-active --quiet "$SERVICE_NAME"; then
  ok "runner service active: $SERVICE_NAME"
else
  journalctl -u "$SERVICE_NAME" -n 30 --no-pager
  die "runner service did not start — see journal above"
fi

# ─── Verify with the GitHub API ──────────────────────────────────────────────
if [[ -n "${GH_TOKEN:-}" ]] || [[ -n "${GITHUB_TOKEN:-}" ]]; then
  TOKEN="${GH_TOKEN:-${GITHUB_TOKEN:-}}"
  ok "querying GitHub for runner status (token present in env)"
  RUNNERS_JSON="$(curl -fsS -H "Authorization: token ${TOKEN}" \
    -H "Accept: application/vnd.github+json" \
    "https://api.github.com/repos/${REPO}/actions/runners" 2>/dev/null || echo '{}')"
  COUNT="$(printf '%s' "$RUNNERS_JSON" | jq -r '.runners | map(select(.name == "alo-server-lap")) | length' 2>/dev/null || echo 0)"
  if [[ "$COUNT" -ge 1 ]]; then
    STATUS="$(printf '%s' "$RUNNERS_JSON" | jq -r '.runners | map(select(.name == "alo-server-lap")) | .[0].status' 2>/dev/null)"
    ok "GitHub API sees runner 'alo-server-lap' as: ${STATUS}"
  else
    warn "GitHub API did not yet list the runner — give it ~30s, then refresh"
    warn "  https://github.com/${REPO}/settings/actions/runners"
  fi
  unset TOKEN
fi

cat <<EOF

╔════════════════════════════════════════════════════════════════════════════╗
║  GITHUB SELF-HOSTED RUNNER INSTALLED                                        ║
║                                                                             ║
║  Service: ${SERVICE_NAME}                                                    ║
║  Status:  active                                                             ║
║  Run dir: ${RUNNER_HOME}                                          ║
║  Token:   ${TOKEN_FILE} (mode 0600, root:root)                       ║
║  Web UI:  https://github.com/${REPO}/settings/actions/runners   ║
║                                                                             ║
║  Queued deploy jobs will now execute on alo-server-lap.                     ║
║                                                                             ║
║  To verify, push an empty commit (or rerun a queued job):                   ║
║    git commit --allow-empty -m "ci: runner smoke test" && git push          ║
║    # or: gh run rerun <run-id> --repo ${REPO}                                ║
║                                                                             ║
║  Logs:  journalctl -u '${SERVICE_NAME}' -f                                  ║
║  Stop:  sudo systemctl stop '${SERVICE_NAME}'                                ║
║  Recfg: sudo ACTIONS_RUNNER_TOKEN=<new-token> ./scripts/install-github-runner.sh --replace   ║
╚════════════════════════════════════════════════════════════════════════════╝

EOF
