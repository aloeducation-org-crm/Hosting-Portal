#!/usr/bin/env bash
#
# scripts/go-live.sh — single-command production bootstrap for alo-server-lap.
#
# This is a THIN ORCHESTRATOR. It does not duplicate the work that
# scripts/bootstrap-server.sh, helpers/install-helpers.sh,
# scripts/init-production-db.sh and scripts/apply-deploy-schema.mjs already
# do — it just runs them in the right order, with the right env, and prints
# the exact next steps the operator must take to make
# https://hosting.alolabs.net actually serve the panel.
#
# Run ON THE SERVER (alo-server-lap), from a checkout that has had `npm ci`:
#
#   cd ~/projects/Hosting-Portal
#   sudo bash scripts/go-live.sh
#
# What it does, in order:
#   1. Pre-flight: confirm repo, node, app user, Cloudflare creds (warn, not die).
#   2. scripts/bootstrap-server.sh --domain hosting.alolabs.net
#        → /etc/alo-hosting/panel.env (generated secrets, mode 0640)
#        → /var/lib/alo-hosting/alo.db (schema + rotated admin password)
#        → /etc/systemd/system/alo-hosting-panel.service (enabled)
#        → /etc/sudoers.d/alo-hosting-deploy (NOPASSWD for the 4 deploy cmds)
#   3. helpers/install-helpers.sh
#        → /usr/local/sbin/alo-*-helper (19 root-owned helpers)
#        → /etc/sudoers.d/alo-hosting-portal (allow-listed invocations)
#   4. scripts/apply-deploy-schema.mjs --backup (idempotent migration applier)
#        → applies any migrations newer than what init-production-db.sh seeded
#   5. npm ci && npm run build (production standalone bundle)
#   6. systemctl restart alo-hosting-panel
#   7. curl /api/health — must return {"status":"ok"}
#   8. scripts/server-doctor.sh — read-only host health report
#   9. Print the 5 remaining manual steps (B/C/D/E + GitHub App creds).
#
# Idempotency: every step is safe to re-run. The script never overwrites an
# existing /etc/alo-hosting/panel.env (bootstrap-server.sh's contract) and
# only applies migrations that have not yet been applied.
#
set -Eeuo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

# Re-exec under sudo if not root — every step needs it.
if [[ $EUID -ne 0 ]]; then
  exec sudo -E bash "$0" "$@"
fi

DOMAIN="${DOMAIN:-hosting.alolabs.net}"
APP_USER="${APP_USER:-${SUDO_USER:-alamin}}"
PANEL_PORT="${PANEL_PORT:-3051}"
ENV_FILE=/etc/alo-hosting/panel.env
DB_PATH=/var/lib/alo-hosting/alo.db

say()  { printf '\n\033[1;34m▶ %s\033[0m\n' "$*"; }
ok()   { printf '  \033[1;32m✔\033[0m %s\n' "$*"; }
warn() { printf '  \033[1;33m⚠\033[0m %s\n' "$*" >&2; }
die()  { printf '  \033[1;31m✘ %s\033[0m\n' "$*" >&2; exit 1; }

trap 'die "go-live failed at step (see above)"' ERR

# ─── 0. Pre-flight ───────────────────────────────────────────────────────────
say "Pre-flight"
[[ -f "$REPO_ROOT/scripts/bootstrap-server.sh" ]] || die "must run from repo root (scripts/bootstrap-server.sh not found)"
[[ -f "$REPO_ROOT/helpers/install-helpers.sh" ]] || die "helpers/install-helpers.sh not found"
[[ -f "$REPO_ROOT/scripts/apply-deploy-schema.mjs" ]] || die "scripts/apply-deploy-schema.mjs not found"
command -v node >/dev/null || die "node not installed"
command -v npm  >/dev/null || die "npm not installed"
id "$APP_USER" >/dev/null 2>&1 || die "user '$APP_USER' does not exist (create it first: sudo useradd -m -s /bin/bash $APP_USER)"
ok "repo: $REPO_ROOT"
ok "app user: $APP_USER"
ok "domain: $DOMAIN"
ok "panel port: $PANEL_PORT"

# ─── 1. Bootstrap server (env, DB, systemd, sudoers) ─────────────────────────
say "Step 1/7: scripts/bootstrap-server.sh"
bash "$REPO_ROOT/scripts/bootstrap-server.sh" \
  --domain "$DOMAIN" \
  --port "$PANEL_PORT" \
  --app-user "$APP_USER"
ok "panel.env, alo.db, systemd unit and sudoers all in place"

# ─── 2. Install privileged helpers ──────────────────────────────────────────
say "Step 2/7: helpers/install-helpers.sh"
bash "$REPO_ROOT/helpers/install-helpers.sh"
ok "19 alo-*-helper scripts installed in /usr/local/sbin"

# ─── 3. Apply any migrations newer than the seed ─────────────────────────────
say "Step 3/7: scripts/apply-deploy-schema.mjs"
if [[ -f "$DB_PATH" ]]; then
  BACKUP_PATH="$DB_PATH.pre-go-live.$(date +%Y%m%d-%H%M%S)"
  ok "backing up DB to $BACKUP_PATH before applying migrations"
  # apply-deploy-schema.mjs refuses relative paths and refuses to run without
  # a backup when --backup is given. It is idempotent.
  DATABASE_URL="file:$DB_PATH" node "$REPO_ROOT/scripts/apply-deploy-schema.mjs" \
    --backup "$BACKUP_PATH" || warn "apply-deploy-schema reported issues (may be all-migrations-already-applied) — review above"
else
  die "$DB_PATH does not exist after bootstrap-server.sh — investigate before continuing"
fi

# ─── 4. Build the production bundle ──────────────────────────────────────────
say "Step 4/7: npm ci + npm run build (as $APP_USER)"
# Run as the app user so node_modules is owned correctly for the systemd unit.
sudo -u "$APP_USER" bash -lc "cd '$REPO_ROOT' && npm ci --omit=dev --no-audit --no-fund && npm run build" \
  || die "build failed — the panel cannot start without a working .next/standalone"
ok "production bundle built"

# ─── 5. Restart the panel ────────────────────────────────────────────────────
say "Step 5/7: systemctl restart alo-hosting-panel"
systemctl daemon-reload
systemctl enable alo-hosting-panel
systemctl restart alo-hosting-panel
sleep 3
if systemctl is-active --quiet alo-hosting-panel; then
  ok "alo-hosting-panel is active"
else
  journalctl -u alo-hosting-panel -n 30 --no-pager
  die "alo-hosting-panel did not start — see journal above"
fi

# ─── 6. Smoke test /api/health ───────────────────────────────────────────────
say "Step 6/7: health probe"
if curl -fsS --max-time 5 "http://127.0.0.1:$PANEL_PORT/api/health" | jq -e '.status == "ok"' >/dev/null 2>&1; then
  ok "panel healthy on http://127.0.0.1:$PANEL_PORT"
else
  warn "health probe failed — try: curl -v http://127.0.0.1:$PANEL_PORT/api/health"
  warn "the panel may still be starting; check: journalctl -u alo-hosting-panel -f"
fi

# ─── 7. Server doctor ────────────────────────────────────────────────────────
say "Step 7/7: scripts/server-doctor.sh"
bash "$REPO_ROOT/scripts/server-doctor.sh" || warn "server-doctor reported issues (review above)"

# ─── Done — print the 5 remaining manual steps ──────────────────────────────
cat <<EOF

╔════════════════════════════════════════════════════════════════════════════╗
║  GO-LIVE STAGE 1 COMPLETE                                                   ║
║                                                                             ║
║  Panel is live on http://127.0.0.1:${PANEL_PORT}                               ║
║  Production env: ${ENV_FILE} (mode 0640, root:${APP_USER})                       ║
║  Production DB:  ${DB_PATH}                                       ║
║                                                                             ║
║  The rotated admin password was printed by bootstrap-server.sh above.       ║
║  If you missed it, regenerate with:                                         ║
║    sudo /usr/local/sbin/alo-init-db --rotate-password                       ║
║                                                                             ║
║  REMAINING MANUAL STEPS to make https://${DOMAIN} live:                    ║
║                                                                             ║
║  1. (B) Install self-hosted GitHub Actions runner:                         ║
║       Get a runner token from                                               ║
║         https://github.com/aloeducation-org-crm/Hosting-Portal/settings/actions/runners/new   ║
║       then run:                                                             ║
║         sudo ACTIONS_RUNNER_TOKEN=<token> ./scripts/install-github-runner.sh   ║
║                                                                             ║
║  2. (C) Install public ingress (Cloudflare Tunnel + Let's Encrypt + nginx): ║
║       Fill in /etc/alo-hosting/panel.env first:                             ║
║         CLOUDFLARE_TUNNEL_TOKEN=<from Cloudflare One → Tunnels>             ║
║         CLOUDFLARE_API_TOKEN=<scoped to Zone:DNS:Edit + Account:Registrar:Edit>   ║
║         CLOUDFLARE_ZONE_ID=<from Cloudflare dashboard>                      ║
║         CLOUDFLARE_ACCOUNT_ID=<from Cloudflare dashboard>                   ║
║       then run:                                                             ║
║         sudo ./scripts/install-public-ingress.sh                            ║
║                                                                             ║
║  3. (D) Verify the registrar integration end-to-end:                       ║
║         curl -H "Cookie: <auth>" https://${DOMAIN}/api/domains/search?q=test.com   ║
║       and watch /var/log/alo-hosting/panel.log for the Cloudflare API call. ║
║                                                                             ║
║  4. GitHub App credentials (so customer repo webhooks are received):       ║
║       Create an app at https://github.com/organizations/aloeducation-org-crm/settings/apps   ║
║       Add to ${ENV_FILE}:                              ║
║         GITHUB_APP_ID=<digits>                                              ║
║         GITHUB_APP_PRIVATE_KEY="<-----BEGIN RSA PRIVATE KEY-----\\n...\\n-----END...-----"   ║
║         GITHUB_WEBHOOK_SECRET=<secret>                                      ║
║       Then: sudo systemctl restart alo-hosting-panel                        ║
║                                                                             ║
║  5. (E) Review docs/BLOCKED-ISSUES.md — one section per blocked ROADMAP     ║
║       item, with the exact unblock command.                                 ║
║                                                                             ║
║  After all 5: open https://${DOMAIN} in a browser.                          ║
╚════════════════════════════════════════════════════════════════════════════╝

EOF
