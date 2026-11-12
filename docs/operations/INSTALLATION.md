# Installation Runbook

> Every command here exists in `package.json`, `deploy/` or the workflow file.
> Steps that CI proves are marked **[CI]**. Steps that only the source supports
> are marked **[source]** — do not assume they work because they are documented.

## 1. Requirements

| Requirement | Value | Source |
|---|---|---|
| Node.js | `>=22` (`engines`); 22.22.3 used in this pass | `package.json` |
| Package manager | npm (lockfile committed) | `package-lock.json` |
| OS (bare metal) | Ubuntu (setup script targets it) | `deploy/ubuntu-setup.sh` |
| Kernel (build isolation) | user namespaces available for `bwrap`/`unshare` | `src/lib/deploy/sandbox.ts` |
| Disk | site files under `/srv/alo-sites`, backups under `/var/backups/alo-sites` | systemd units |
| Docker (optional) | for container deploys and the Compose path | `docker-compose.yml` |

## 2. Configuration

```bash
cp .env.example .env      # 178 documented variables
```

Rules that the repository enforces:

- **`DATABASE_URL` is mandatory in production.** The app calls
  `process.exit(1)` rather than falling back to the fixture database **[source]**,
  proven by `tests/health-reporting.test.ts`.
- **`DEPLOY_BUILD_ISOLATION=required`** in production. A host without a namespace
  tool then refuses to build instead of building unisolated **[source]**.
- **`NEXTAUTH_SECRET` / `JWT_SECRET`** must be set. Tests that drive the real
  middleware set them explicitly.
- **`TRUSTED_PROXY_COUNT`** defaults to `0`, meaning forwarding headers are
  ignored. Set it to the exact number of proxies in front of the panel, or rate
  limiting will key on the proxy address.
- Never commit `.env`. `.env.example` holds placeholders only.

Validate configuration:

```bash
npm run config:validate
```

## 3. Install and verify **[CI]**

```bash
npm ci --no-audit --no-fund
npm run verify        # lint → typecheck → test → build → build:worker → audit:repo
```

`npm run verify` is the same gate CI runs. Current result: 74 files / 1174 tests,
build succeeds, worker bundle succeeds, `audit:repo` 17/17.

## 4. Database

```bash
npm run db:sync       # apply schema
npx prisma db seed    # 30 permissions, 7 roles, baseline data
```

The checked-in `db/custom.db` is a **fixture**, not a production database.
Production must set its own `DATABASE_URL`.

Migrate with the shipped applier, which distinguishes additive from rebuild
migrations and holds a lock:

```bash
node scripts/apply-deploy-schema.mjs --check     # dry run; reports what would change
node scripts/apply-deploy-schema.mjs --verify    # re-checks postconditions, applies nothing
```

(`npm run db:migrate` is `prisma migrate deploy` and takes no such flags — use the
applier script directly when you want a dry run.)

Never run a rebuild-class migration against production without a verified backup.

## 5. Bare-metal install **[source]**

```bash
sudo deploy/ubuntu-setup.sh              # users, dirs, packages
sudo helpers/install-helpers.sh          # root-owned helpers + sudoers
sudo cp deploy/systemd/alo-hosting-panel.service /etc/systemd/system/
sudo cp deploy/systemd/alo-automation-worker.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now alo-hosting-panel alo-automation-worker
```

Set `DEPLOY_INLINE_WORKER=false` in the panel environment so builds are claimed by
the supervised worker rather than by request processes.

Verify:

```bash
systemctl status alo-hosting-panel alo-automation-worker
curl -fsS http://127.0.0.1:3000/api/health | jq .
journalctl -u alo-hosting-panel -n 50 --no-pager
```

`/api/health` returns `503` with a reason of `DATABASE_UNREACHABLE`,
`SCHEMA_MISSING`, `SCHEMA_OUT_OF_DATE` or `QUERY_FAILED` when unhealthy. A `200`
means the probe reached the database **and** the schema matched.

## 6. Docker install **[source, not executed here]**

```bash
docker compose up -d db-init
docker compose up -d alo-hosting-panel automation-worker
```

`db-init` applies the schema, fixes volume ownership to UID 1001 and creates one
`SUPER_ADMIN` with a random 32-character password written mode 0600 to
`/var/lib/alo-hosting/admin-credentials`. Retrieve it, move it to a password
manager, then delete the file:

```bash
docker compose run --rm --no-deps --entrypoint cat db-init /var/lib/alo-hosting/admin-credentials
```

There is no default password.

The image was **not built** in the environment that produced this document (no
Docker daemon). Treat the Compose path as unverified until someone builds it.

## 7. Reverse proxy and TLS

- nginx: `deploy/nginx/hosting.alolabs.net.conf` plus `conf.d/`
- Caddy paths are writable by the units (`/etc/caddy`)
- Cloudflare tunnel config: `deploy/cloudflared/config.yml`

TLS issuance through the product is **PARTIAL**: the helper exists, the
orchestrated certificate worker returns `NOT_IMPLEMENTED` rather than claiming
issuance. Configure certificates at the proxy for now.

## 8. Server agent

```bash
sudo cp deploy/systemd/alo-server-hosting.service /etc/systemd/system/
# set the panel URL (https required in production) and the enrollment token
sudo systemctl enable --now alo-server-hosting
```

Agent auth is HMAC over `timestamp.nonce.sha256(body)` with a 5-minute skew and
single-use nonces. Plain-HTTP panel URLs are refused.

## 9. Post-install checklist

| Check | Command | Expected |
|---|---|---|
| Health | `curl -fsS :3000/api/health` | `200`, reason `OK` |
| Worker alive | `systemctl is-active alo-automation-worker` | `active` |
| Worker heartbeat | `stat /run/alo-hosting/automation-worker.json` | fresh mtime |
| Login works | browser | session cookie is `Secure` in production |
| Build isolation available | `command -v bwrap` or `unshare -Ur true` | one succeeds |
| Fixture DB not in use | `grep DATABASE_URL .env` | a real path, not `db/custom.db` |
