# Deployment runbook — ALO Hosting Portal

**Canonical application: the repository root.** There is exactly one
`package.json`, one `prisma/schema.prisma` (SQLite, 119 models), one `src/`
tree, one `helpers/` tree and one `deploy/` tree. The legacy snapshot,
duplicate helper/config/installer trees and duplicate Docker files were removed
on 2026-11-09; see [AUDIT-REPORT.md](AUDIT-REPORT.md).

> This document describes configuration that exists in the repository. Running
> it requires a real Ubuntu 22.04/24.04 host, DNS control, a certificate and an
> authorized operator. **None of the host-level operations below have been
> executed or verified inside the development sandbox.**

---

## 1. Choose a deployment shape

| Shape | Entry point | Use when |
| --- | --- | --- |
| **Ubuntu host (canonical)** | `sudo bash deploy/ubuntu-setup.sh --domain hosting.alolabs.net --apply` | Production single host behind nginx + Cloudflare Tunnel |
| Git-connected release | `.github/workflows/ci-cd.yml` (approved `workflow_dispatch` on `main`) | All subsequent production releases |
| Container (alternative) | `docker compose up -d --build` | Local/staging isolated runtime |

`deploy/ubuntu-setup.sh` is dry-run by default. It chains, in order:

1. `deploy/server-kit/setup.sh` — 8 idempotent Ubuntu stages (preflight,
   security/UFW/SSH, web app + Node + PM2, databases, AI infra, AI tools, ops,
   file sync). Requires `deploy/server-kit/config.env` (copy `config.env.example`,
   `chmod 0600`, replace every `CHANGE_ME` value; `lib/common.sh` refuses
   placeholder LiteLLM keys).
2. `scripts/bootstrap-server.sh --domain …` — `/etc/alo-hosting/panel.env`
   (generated secrets), `/var/lib/alo-hosting/alo.db`, the
   `alo-hosting-panel` systemd unit and `/etc/sudoers.d/alo-hosting-deploy`.
3. `helpers/install-helpers.sh` — installs the 19 root-owned `alo-*-helper`
   programs into `/usr/local/sbin` and the `alo-helpers` sudoers policy from
   `deploy/sudoers/alo-hosting-portal`.
4. `scripts/server-doctor.sh` — read-only verification of the result.

Use `--skip-host-stages` to re-bootstrap only the panel on an already
provisioned host. `--nginx` installs the TLS vhost (only after a certificate
exists). Never run the installer on an existing production host without a
maintenance window, a verified backup and a tested SSH session on the new port.

---

## 2. Environment

Copy [.env.example](.env.example) (or
[deploy/env/alo-hosting-panel.env.example](deploy/env/alo-hosting-panel.env.example))
to `/etc/alo-hosting/panel.env`, protect it `root:alo-panel 0640`, and fill in:

| Variable | Requirement |
| --- | --- |
| `DATABASE_URL` | absolute `file:/var/lib/alo-hosting/alo.db` |
| `NEXTAUTH_URL`, `NEXT_PUBLIC_APP_URL` | public HTTPS origin |
| `NEXTAUTH_SECRET`, `JWT_SECRET`, `APP_ENCRYPTION_KEY`, `INTERNAL_SECRET` | unique `openssl rand -hex 32` values; startup fails closed on placeholders |
| `CSRF_SECRET`, `CRON_SECRET`, `DEPLOY_WEBHOOK_SECRET`, `CRM_INTEGRATION_SIGNING_KEY` | unique `openssl rand -hex 32` values |
| `ALO_HELPER_DIR`, `ALO_SITES_DIR`, `ALO_BACKUP_DIR` | absolute host paths |
| `CLOUD_DATA_DIR`, `STORAGE_BUCKET_BASE` | absolute writable paths (required for a read-only container rootfs) |

`npm run config:validate` performs the read-only preflight. The full contract is
in [docs/UNIFIED_PROJECT_ENVIRONMENT_VARIABLES.md](docs/UNIFIED_PROJECT_ENVIRONMENT_VARIABLES.md)
and [docs/PRODUCTION-CONFIG-VALIDATION.md](docs/PRODUCTION-CONFIG-VALIDATION.md).

**Database provider:** SQLite via `@prisma/adapter-libsql`. A PostgreSQL URL is
not supported by this schema; switching providers is a migration project, not a
configuration flag. Apply additive migrations with:

```bash
DATABASE_URL="file:/var/lib/alo-hosting/alo.db" node scripts/apply-deploy-schema.mjs --check
DATABASE_URL="file:/var/lib/alo-hosting/alo.db" node scripts/apply-deploy-schema.mjs
```

`scripts/init-production-db.sh` bootstraps a fresh DB and writes a generated
super-admin password to `ADMIN_CREDENTIAL_FILE` (root-only `0600`). No default
password exists anywhere in the application.

---

## 3. Build and run

```bash
npm ci
npm run db:generate
npm run build
cp -r .next/static .next/standalone/.next/static
cp -r public .next/standalone/public
PORT=3051 HOSTNAME=127.0.0.1 node .next/standalone/server.js
```

`next.config.ts` uses `output: "standalone"`; `next start` is not supported.
The systemd unit `deploy/systemd/alo-hosting-panel.service` launches the
standalone server on loopback `3051` with `EnvironmentFile=/etc/alo-hosting/panel.env`.
`scripts/resolve-start-entry.mjs` resolves the exact entrypoint used by the
release pipeline; never publish a shell pipeline as a PM2 start command.

---

## 4. Reverse proxy, TLS and tunnel

- Canonical production proxy: `deploy/nginx/hosting.alolabs.net.conf` (ACME
  challenge on 80, 301 to 443, TLS vhost proxying to `127.0.0.1:3051`, 50 MB
  body limit, WebSocket upgrade, security headers).
- Certificates: `sudo certbot --nginx -d hosting.alolabs.net`; the config already
  references `/etc/letsencrypt/live/hosting.alolabs.net/*`. Renewal is handled by
  certbot's timer, with `/api/ssl/*` and `helpers/ssl-lifecycle.sh` for inventory
  and application-level checks.
- Cloudflare Tunnel: `deploy/cloudflared/config.yml` must terminate on
  `https://127.0.0.1:443`; pointing it at port 80 creates a redirect loop.
- `Caddyfile` is a development/single-site reverse proxy on port 81, not the
  production shape.

Validate on the host with `nginx -t`, `sudo visudo -cf /etc/sudoers.d/…` and
`bash scripts/server-doctor.sh`.

---

## 5. Git-connected releases

`POST /api/github/webhook` receives signed push events and drives exact-SHA
checkout → framework detection → isolated build/test → immutable release →
HTTP health and release-marker verification → automatic rollback on failure.
The dashboard page is `/deployments`.

Production activation is **not** automatic on a push to `main`: it requires an
explicit approved `workflow_dispatch` with `release_approval=APPROVED` and a
`release_ticket`. The workflow verifies the artifact digest, re-checks the head
of `main` after acquiring the deploy slot, refuses stale/backwards releases
unless an attributed rollback is authorized, and restores on failure.

```bash
DATABASE_URL="file:/var/lib/alo-hosting/alo.db" node scripts/apply-deploy-schema.mjs
npx vitest run tests/deploy-e2e.test.ts
node scripts/verify-deploy-http.mjs        # against a running panel
```

See [docs/GIT-AUTODEPLOY.md](docs/GIT-AUTODEPLOY.md) and
[docs/DEPLOYMENT-AND-ROLLBACK.md](docs/DEPLOYMENT-AND-ROLLBACK.md).

---

## 6. Container shape (alternative)

```bash
docker compose up -d --build
curl -s http://127.0.0.1:8080/api/health
```

`Dockerfile` builds on Node 22 Alpine, runs as UID 1001 with a read-only rootfs,
drops all capabilities, limits memory/PIDs and exposes a Node-based healthcheck.
`docker-compose.yml` initialises the SQLite volume with `prisma db push` and
`scripts/bootstrap-super-admin.ts` before starting the panel. No Docker daemon
is available in the development sandbox, so this shape is **configuration-only,
not runtime-verified** here.

---

## 7. Backups, monitoring, logging

| Concern | Implementation |
| --- | --- |
| DB backup / restore | `scripts/db-backup.mjs`, `scripts/db-restore.mjs`, `scripts/backup.sh`, `scripts/restore.sh` |
| Server-kit configs | `deploy/server-kit/backup.sh`, `deploy/server-kit/restore.sh` |
| Site backup / restore | `helpers/alo-site-backup`, `helpers/alo-site-restore`, `/api/backups` |
| Release rollback | `scripts/rollback.sh`, `scripts/deploy-release.sh` (automatic on failed verification) |
| Health / metrics | `/api/health`, `/api/monitoring/{check,collect,metrics}`, `scripts/healthcheck.sh`, `scripts/server-doctor.sh` |
| Logs | pino structured logs (`src/lib/logger.ts`), `/api/logs`, audit-log models/routes, systemd journal, nginx access/error logs |
| Ubuntu audit | `deploy/server-kit/verify.sh`, `deploy/server-kit/status.sh` |

Rehearse backup → restore and release → rollback in staging before production
cutover. `tests/backup-restore.test.ts` covers the local logic only.

---

## 8. Post-deploy verification (operator checklist)

```bash
npm run verify                 # on CI, before any release
npm run audit:repo
npm run config:validate
bash scripts/server-doctor.sh
curl -fsS https://hosting.alolabs.net/api/health
node scripts/e2e-smoke.mjs https://hosting.alolabs.net   # PANEL_PASSWORD required
```

Then confirm: HSTS + CSP headers present, `/login` returns 200, an
unauthenticated `/api/sites` returns 401, a real login returns a session,
`/deployments` reports the running commit, and backups contain a restorable
SQLite file (`PRAGMA integrity_check` = `ok`).

---

## 9. Explicitly not verified here

Ubuntu package installation, UFW rules, SSH port migration, systemd/PM2 process
supervision, nginx/Caddy runtime, Certbot issuance/renewal, Cloudflare Tunnel,
DNS/registrar changes, Postfix/Dovecot mail, Docker image builds, the
self-hosted GitHub Actions runner, live external AI providers and long-running
memory/soak behaviour. Their configuration is present and syntax-checked; their
operation must be proven on a disposable staging host by an authorized operator.
