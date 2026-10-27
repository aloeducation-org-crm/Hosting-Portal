# Unified Project Deployment & Rollback Runbook (`docs/UNIFIED_PROJECT_DEPLOYMENT_AND_ROLLBACK.md`)

- **Date**: `2026-10-27` (`Asia/Dhaka`, UTC+6)
- **Canonical Application Root**: `/home/user/Hosting-Portal` (deployed on Ubuntu 22.04/24.04 LTS to `/opt/alo-hosting`)
- **Service Identity**: `alo-hosting-portal` (PM2 / systemd unit binding `127.0.0.1:3101` behind Nginx/Caddy/Cloudflared)

---

## 1. Pre-Deployment Checklist (Ubuntu 22.04/24.04 Host)

1. **Runtime & System Prerequisites**:
   - Node.js `>=20.9.0` (`v20.x` or `v22.x` LTS), `npm`, `sqlite3`, `openssl`, `git`, `curl`, `pm2` (or systemd unit `deploy/systemd/alo-hosting-panel.service`), and Nginx/Caddy reverse proxy.
2. **Environment File (`/etc/alo-hosting-panel/alo-hosting-panel.env` or `/opt/alo-hosting/.env`)**:
   - Copy `deploy/env/alo-hosting-panel.env.example`, set ownership `root:alo-panel` and permissions `0640` (or `alo-panel:alo-panel` `0600`), and populate unique `openssl rand -hex 32` values for `NEXTAUTH_SECRET`, `JWT_SECRET`, `APP_ENCRYPTION_KEY`, `INTERNAL_SECRET`, and `DEPLOY_WEBHOOK_SECRET`.
   - Set an **absolute** SQLite URL: `DATABASE_URL="file:/var/lib/alo-hosting-panel/custom.db"`.
   - Rotate any credentials on hosts that previously ran legacy `alo-server-kit/scripts/auto-env-fixer.js` (`SEC-01`).
3. **Privileged Helpers & Sudoers Installation**:
   - Back up any existing helpers to `/var/backups/alo/` (`install -d -m 0700 -o root -g root /var/backups/alo`), copying `/usr/local/sbin/alo-docker-helper` to `/var/backups/alo/alo-docker-helper.bak` if present.
   - Install `helpers/alo-*-helper`, `helpers/provision-site.sh`, and `helpers/ssl-lifecycle.sh` to `/usr/local/sbin/` with `chown root:root` and `chmod 0750`, verify every helper with `bash -n`, and install `deploy/sudoers/alo-hosting-portal` to `/etc/sudoers.d/alo-hosting-portal` (`chmod 0440`, validated via `visudo -cf`).

---

## 2. Standard Canonical Deployment Procedure

```bash
set -euo pipefail
APP_DIR="/opt/alo-hosting"
BACKUP_DIR="/var/backups/alo/$(date -u +%Y%m%dT%H%M%SZ)"
sudo install -d -m 0700 -o root -g root "$BACKUP_DIR"

# 1. Back up current release metadata, SQLite DB (consistent online backup), and alo-docker-helper
if [ -f /var/lib/alo-hosting-panel/custom.db ]; then
  sqlite3 /var/lib/alo-hosting-panel/custom.db ".backup '$BACKUP_DIR/custom.db.bak'"
fi
if [ -f /usr/local/sbin/alo-docker-helper ]; then
  sudo cp -p /usr/local/sbin/alo-docker-helper /var/backups/alo/alo-docker-helper.bak
  sudo chown root:root /var/backups/alo/alo-docker-helper.bak
  sudo chmod 0750 /var/backups/alo/alo-docker-helper.bak
fi
git -C "$APP_DIR" rev-parse HEAD > "$BACKUP_DIR/previous_commit.txt"

# 2. Build & verify canonical root application
cd "$APP_DIR"
npm ci --no-audit --no-fund
npm run lint
npm run typecheck
npm test
npm run build

# 3. Stage static assets for Next.js standalone server
cp -r public .next/standalone/public
mkdir -p .next/standalone/.next
cp -r .next/static .next/standalone/.next/static

# 4. Apply non-destructive idempotent schema sync against SQLite DB
npm run db:sync

# 5. Reload PM2 cleanly and verify live health + auth gates
pm2 reload alo-hosting-portal --update-env
curl -fsS http://127.0.0.1:3101/api/health | grep -q '"databaseStatus":"connected"'
```

---

## 3. Mandatory Rollback Procedures

### 3.1 Application Rollback Procedure
Execute the following 7 steps in exact order if a deployment exhibits regressions, health-check failures, or authorization anomalies:

1. **Identify the last known-good commit and build artifact**:
   - Read `/var/backups/alo/<timestamp>/previous_commit.txt` (or CI release artifact `hosting-release-<sha>`) and confirm the target commit SHA and standalone build artifact integrity before changing live files.
2. **Restore the previous application release via the established deployment procedure**:
   - Restore the verified standalone artifact (including `.next/standalone`, `.next/static`, and `public`) or check out the known-good commit in `/opt/alo-hosting` and rebuild cleanly (`npm ci && npm run build`).
3. **Restore `/var/backups/alo/alo-docker-helper.bak` to `/usr/local/sbin/alo-docker-helper` after ownership & permission verification**:
   - Before copying, verify `/var/backups/alo/` and `/var/backups/alo/alo-docker-helper.bak` are owned by `root:root` and not group/world-writable (`stat -c '%U:%G %a' /var/backups/alo/alo-docker-helper.bak` must be `root:root 750` or `700`). Only after verification, restore via `sudo install -o root -g root -m 0750 /var/backups/alo/alo-docker-helper.bak /usr/local/sbin/alo-docker-helper`.
4. **Validate restored helper syntax and permissions**:
   - Run `sudo bash -n /usr/local/sbin/alo-docker-helper` and confirm `root:root` `0750` permissions plus `sudo visudo -cf /etc/sudoers.d/alo-hosting-portal`.
5. **Reload the portal in the configured PM2 environment**:
   - Run `pm2 reload alo-hosting-portal` under the configured service user and PM2 home environment.
6. **Verify PM2 health, `/api/health`, authentication, tenant isolation, and critical workflows**:
   - Confirm `pm2 status alo-hosting-portal` reports `online` with `0` crash loops; verify `GET http://127.0.0.1:3101/api/health` returns `HTTP 200` (`databaseStatus: "connected"`, `schemaStatus: "current"`), unauthenticated `GET /api/websites` returns `HTTP 401`,security headers are present, and authenticated tenant workflows operate without cross-tenant access.
7. **Review logs for errors or secret leaks**:
   - Inspect `pm2 logs alo-hosting-portal --lines 200 --nostream` and reverse-proxy error logs to confirm zero unhandled exceptions and zero leaked credentials, tokens, or connection strings.

### 3.2 Database Rollback Procedure & Compatibility Caveats
- **Schema Compatibility Caveat**: The absence of a destructive Prisma migration in a given release does **not** automatically guarantee backward/forward compatibility across SQLite and PostgreSQL deployments or across future schema evolutions. Additive tables/columns (`hosting_sites`, `git_connections`, `git_projects`, `webhook_deliveries`, `deployments.*`, `servers.*`) must still be treated as stateful changes.
- **Mandatory Safeguards**:
  1. Always capture a verified consistent backup (`sqlite3 custom.db ".backup ..."` for SQLite; `pg_dump --format=custom` if PostgreSQL is ever adopted in a future architecture) **before** applying schema updates.
  2. Rehearse schema changes and rollback restoration against a staging copy of production data prior to production cutover.
  3. Validate post-restore referential and structural integrity (`PRAGMA integrity_check;` and `PRAGMA foreign_key_check;` on SQLite) before routing live traffic.
  4. **Account for post-cutover writes**: Restoring a pre-deploy database snapshot discards transactions written after cutover (orders, invoices, deployments, DNS/SSL mutations, audit logs). Freeze writes or export delta records (`deployments`, `orders`, `invoices`, `audit_logs` created after cutover timestamp) before restoring a snapshot, and follow the documented cutover/reconciliation plan.

### 3.3 Self-Hosted AI Agent Container Rollback Procedure
When rolling back or removing a self-hosted AI agent container (`alo-<slug>`, e.g., `alo-langflow`, `alo-localai`, `alo-ollama`, `alo-qdrant`):

1. **Rehearse in non-production first**: Validate container teardown, volume backup, and data recovery in a non-production environment before executing destructive cleanup on a production host.
2. **Back up the persistent volume before cleanup or redeployment**:
   - Archive `alo-agent-<name>` (e.g., `sudo tar -C /var/lib/docker/volumes/alo-agent-<name>/_data -czf /var/backups/alo/alo-agent-<name>-$(date -u +%Y%m%dT%H%M%SZ).tar.gz .` with `0600` permissions) and verify archive readability (`tar -tzf`) before removing or redeploying the container.
3. **Stop and remove the agent container**:
   - Use **Uninstall** in `/ai/self-hosted` or invoke `sudo /usr/local/sbin/alo-docker-helper remove-force <name>` if supported by the currently installed helper version; if the installed helper predates `remove-force`, fall back to `sudo /usr/local/sbin/alo-docker-helper stop <name>` followed by `sudo /usr/local/sbin/alo-docker-helper remove <name>`.
4. **Confirm container removal & verify volume integrity**:
   - Verify via `sudo /usr/local/sbin/alo-docker-helper status <name>` (or `docker ps -a --filter name=^/alo-<name>$`) that the container is completely removed and its loopback port (`127.0.0.1:<port>`) is closed, while confirming `docker volume inspect alo-agent-<name>` remains intact until retention sign-off.
