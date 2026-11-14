# PM2 production runbook — hosting.alolabs.net on alo-server-lap

**Status:** the files this runbook uses were built and exercised in a sandbox
on 2026-11-14 (build, backup, start, health check, static asset check, with a
stand-in for `pm2`). **Nothing here has been run on 103.231.239.79**, and
`prisma db push` could not be run in the sandbox at all (the Prisma schema
engine could not be downloaded there). The server facts below are as reported
by the operator, not measured.

This is the layout the server actually runs today. It is a different shape from
the systemd / `/opt/alo-hosting` / Cloudflare Tunnel / port 3051 layout described
in `docs/DEPLOYMENT-AND-ROLLBACK.md`. See [§7](#7-how-this-relates-to-the-rest-of-the-repository).

## 1. Facts

| | |
|---|---|
| Server | alo-server-lap, 103.231.239.79, SSH port 22000 |
| URL | https://hosting.alolabs.net |
| Checkout | `/home/alamin/Hosting-Portal` |
| Process manager | PM2, user `alamin` — never root |
| PM2 app | `alo-hosting-panel` on `127.0.0.1:3000` |
| Environment | `/etc/alo-hosting/panel.env` |
| Database | SQLite, `file:/var/lib/alo-hosting/production.db` (not PostgreSQL) |
| TLS | Cloudflare Origin certificate, `/etc/nginx/ssl/alolabs.net.{pem,key}` |
| Reported versions | Ubuntu 22.04, Node 22, nginx 1.18, PM2 7 |

Do not touch the other PM2 apps on the host: `marketingos` (3055),
`alaminn-info` (3056), `alolabs-main` (3011), `alo-learning-journey-prod`
(3061), `english-alolabs` (3060), `panel-friendconnect` (3054). The commands
below only ever name `alo-hosting-panel`, `alo-deploy-worker` and
`alo-automation-worker`. Never run `pm2 delete all`, `pm2 kill` or
`pm2 restart all`.

## 2. Files in this repository

| File | Purpose |
|---|---|
| `scripts/deploy-pm2.sh` | Preflight, backup, schema, build, static copy, PM2 reload, health check |
| `deploy/pm2/ecosystem.config.cjs` | PM2 apps; reads `panel.env` itself |
| `deploy/pm2/panel-env.cjs` | Parser for `panel.env` (tested in `tests/pm2-profile.test.ts`) |
| `deploy/nginx/hosting.alolabs.net.pm2-origin-cert.conf` | nginx site for this layout |

## 3. Routine deploy

```bash
su - alamin -c "cd /home/alamin/Hosting-Portal && bash scripts/deploy-pm2.sh"
```

To see whether the host is ready without changing anything:

```bash
su - alamin -c "cd /home/alamin/Hosting-Portal && bash scripts/deploy-pm2.sh --check"
```

What the script does, in order, and where it stops:

1. Refuses to run as root. Checks `panel.env` is readable, the four secrets are
   present and at least 32 characters, `DATABASE_URL` is an absolute `file:` URL
   outside the checkout, and `alamin` can write the database and its directory.
2. Moves `.env`, `.env.production`, `.env.local`, `.env.production.local` in the
   checkout to `*.placeholder`.
3. `git fetch` + fast-forward to `origin/main` (`--no-pull` skips; refuses if
   tracked files have local changes).
4. `npm ci --include=dev`.
5. Takes a verified SQLite snapshot (`scripts/db-backup.mjs`: `VACUUM INTO`,
   integrity check, checksum) into `~/storage/backups/hosting-predeploy/`.
   If the backup fails, nothing further happens.
6. `prisma db push --skip-generate` (`--skip-schema` skips). It is run **without**
   `--accept-data-loss`: if a schema change would drop data, Prisma stops and the
   running application is not restarted.
7. `npm run build` and `npm run build:worker`, with `panel.env` in the
   environment.
8. Copies `.next/static` **and** `public` into `.next/standalone`.
9. `pm2 startOrReload deploy/pm2/ecosystem.config.cjs --update-env`, `pm2 save`.
10. Waits up to 60 s for `http://127.0.0.1:3000/api/health` to return 200, then
    requests one real `/_next/static/chunks/*.js` file. Either failing makes the
    script exit non-zero and print the last panel log lines.

**Known limit — not zero-downtime.** The build rewrites `.next` in place while
the old process is still serving from it. For the length of the build some
static assets can return 404. If the build itself fails, the old process keeps
running but its files are gone: fix the build and re-run. There is no automatic
code rollback in this layout; roll back with
`git checkout <previous-sha> && bash scripts/deploy-pm2.sh --no-pull`.
A schema change is not undone by that; restore the pre-deploy snapshot with
`scripts/db-restore.mjs` if it must be.

## 4. First-time setup on the host

Run as root unless the command says otherwise. Start every root session with
`set +H`: bash history expansion otherwise mangles strings containing `!`
(`!aNULL`, `!pathname`). Use quoted heredocs (`<<'EOF'`) for the same reason.

```bash
set +H

# 4.1 Audit — read-only
uname -a; free -h; df -h /; nproc
node -v; npm -v; nginx -v; su - alamin -c "pm2 -v"
ss -tlnp | grep -E ':(3000|80|443)\b'      # 3000 must be free or be alo-hosting-panel

# 4.2 Checkout (as alamin)
su - alamin -c "cd /home/alamin && git clone https://github.com/aloeducation-org-crm/Hosting-Portal.git"

# 4.3 Environment and database
test -r /etc/alo-hosting/panel.env && grep -c '=' /etc/alo-hosting/panel.env
ls -lh /var/lib/alo-hosting/production.db
su - alamin -c "cd /home/alamin/Hosting-Portal && bash scripts/deploy-pm2.sh --check"

# 4.4 Build and start (as alamin)
su - alamin -c "cd /home/alamin/Hosting-Portal && bash scripts/deploy-pm2.sh"

# 4.5 nginx
cp /home/alamin/Hosting-Portal/deploy/nginx/hosting.alolabs.net.pm2-origin-cert.conf \
   /etc/nginx/sites-available/hosting.alolabs.net
ln -sfn /etc/nginx/sites-available/hosting.alolabs.net /etc/nginx/sites-enabled/hosting.alolabs.net
grep -rn "hosting.alolabs.net" /etc/nginx/sites-enabled/ /etc/nginx/conf.d/   # must appear in ONE file only
nginx -t && systemctl reload nginx

# 4.6 Survive a reboot (prints one command to run as root; run it once)
su - alamin -c "pm2 startup systemd -u alamin --hp /home/alamin"
```

### Settings `panel.env` must contain for this layout

| Key | Value | Why |
|---|---|---|
| `DATABASE_URL` | `file:/var/lib/alo-hosting/production.db` | The script refuses a relative path or a path inside the checkout. |
| `NEXTAUTH_URL` | `https://hosting.alolabs.net` | |
| `TRUSTED_PROXY_COUNT` | `2` | Cloudflare + nginx. With the default `0` the rate limiter in `src/proxy.ts` ignores `X-Forwarded-For` and cannot tell visitors apart (see `src/lib/security/client-identity.ts`). |
| `NEXTAUTH_SECRET`, `JWT_SECRET`, `APP_ENCRYPTION_KEY`, `INTERNAL_SECRET` | real random values | `src/lib/env.ts` exits at startup if any is a known placeholder. |

`PORT` and `HOSTNAME` in `panel.env` are ignored for the panel: the ecosystem
file always sets `PORT=3000` (or `PANEL_PORT`) and `HOSTNAME=127.0.0.1`, because
that is where nginx proxies. The repository's env templates carry `PORT=3051`,
and letting that value win would produce a 502.

## 5. Things that went wrong before, and what guards against each now

| # | Problem | Guard |
|---|---|---|
| 1 | Next.js 16 uses `src/proxy.ts`. Adding `src/middleware.ts` fails the build ("Both middleware and proxy detected"). | `deploy-pm2.sh` refuses to run if `src/middleware.ts` exists. |
| 2 | PM2 7 silently ignores `env_file`. | `ecosystem.config.cjs` parses `panel.env` itself. |
| 3 | Placeholder secrets in a checkout `.env` made the app exit at startup. | The script moves `.env*` aside **before** the build (Next.js also copies them into the standalone output) and deletes any copy in `.next/standalone`. |
| 4 | Standalone output has no `.next/static` → all JS/CSS 404. | The script copies `.next/static` and `public`, removing the targets first so a re-run cannot create `static/static`, then requests a real chunk. |
| 5 | nginx `alias` into `/home/alamin` → 403 (www-data cannot read it). | The nginx file proxies everything; a test forbids `alias`/`root`. |
| 6 | Cloudflare "Flexible" + `return 301 https://` on port 80 → redirect loop. | Port 80 proxies. See §6 for the better fix. |
| 7 | `prisma db push` had no `DATABASE_URL`. | The script reads it from `panel.env` and passes it explicitly. |
| 8 | Bash history expansion on `!`. | `set +H` in the script and in §4. |
| 9 | Deployments queued in the panel were never processed when `DEPLOY_INLINE_WORKER=false` and no worker ran. | The ecosystem file starts `alo-deploy-worker` and `alo-automation-worker` when their bundles exist, and turns the in-process worker off so nothing is processed twice. |

## 6. Cloudflare, TLS and security

- **DNS:** `hosting.alolabs.net` → A → `103.231.239.79`, proxied.
- **SSL mode: set "Full (strict)".** The Origin certificate is already installed,
  so there is no reason to stay on "Flexible", where the Cloudflare → server hop
  is plain HTTP. Verify the certificate first:
  `openssl x509 -in /etc/nginx/ssl/alolabs.net.pem -noout -dates -subject`.
  After the switch, port 80 is off the request path and its block may become a
  redirect.
- **Cache rules:** `/_next/static/*` → cache, long TTL. `/api/*` → bypass.
- **Open risk — the origin is reachable directly.** UFW allows 80/443 from
  anywhere, so a client can skip Cloudflare, connect to the IP, and send its own
  `X-Forwarded-For`. With `TRUSTED_PROXY_COUNT=2` the application would believe
  it. Restrict 80/443 to [Cloudflare's address ranges](https://www.cloudflare.com/ips/)
  in UFW, or enable Authenticated Origin Pulls. Not done by anything in this
  repository.
- **Application layer** (`src/proxy.ts`): session and role checks, CSRF check on
  authenticated browser mutations, exact-origin CORS, per-client rate limits,
  security headers. No nginx rate limiting is configured.
- **Privileged helpers:** `deploy/sudoers/*` grant the helper commands to the
  `alo-panel` account. Under this layout the panel runs as `alamin`, so panel
  features that call those helpers through `sudo` will be refused unless an
  equivalent, reviewed sudoers entry exists for `alamin`. Not verified on the
  host.

## 7. How this relates to the rest of the repository

The repository documents and tests another production shape: releases under
`/opt/alo-hosting`, systemd units, port 3051, and a GitHub Actions deploy job
that runs on a self-hosted runner only after a manual, approved dispatch
(`.github/workflows/ci-cd.yml`, `scripts/deploy-release.sh`).

That pipeline does **not** know about this layout. In its "inline" mode
`deploy-release.sh` restarts PM2 apps named `alo-hosting-portal`, `alo-hosting`
or `alo-dashboard` on port 3051, and if none exists it starts a new
`alo-hosting-portal`. On this server that would start a **second** panel
process against the same database next to `alo-hosting-panel`. Until the two are
reconciled:

- deploy this server with `scripts/deploy-pm2.sh` only;
- do not dispatch the workflow's production release against this host.

The runbook's "Phase 18" idea of a second workflow that SSHes in and runs
`git pull` was deliberately not added: it would bypass the approval, digest and
rollback guards the existing workflow enforces, and it would put an SSH key that
can reach production into repository secrets. Choosing one deployment shape is
an owner decision.

## 8. Checks after a deploy

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://hosting.alolabs.net/             # 200
curl -s -o /dev/null -w '%{http_code}\n' https://hosting.alolabs.net/api/health   # 200
curl -s https://hosting.alolabs.net/api/health                                     # commit and status
curl -sI -H 'Accept-Encoding: gzip' https://hosting.alolabs.net/ | grep -i content-encoding
su - alamin -c "pm2 list"       # the three alo-* apps online; the six other apps untouched
```

Operations already on the host and outside this repository (check they still
exist; they were not verified from here):

```bash
ufw status                                   # 80, 443, 22000
fail2ban-client status
crontab -u alamin -l                         # daily backup, pm2 and server health checks
grep -n 'production.db' /home/alamin/scripts/alo-backup.sh
su - alamin -c "pm2 list" | grep logrotate
```

The nightly backup must not be a plain `cp` of the live database: a copy taken
during a write can be corrupt. Use the same tool the deploy uses:

```bash
node /home/alamin/Hosting-Portal/scripts/db-backup.mjs \
  --env-file /etc/alo-hosting/panel.env --out /home/alamin/storage/backups/daily
```

## 9. If the panel is down

```bash
set +H
su - alamin -c "pm2 logs alo-hosting-panel --lines 80 --nostream"
su - alamin -c "cd /home/alamin/Hosting-Portal && bash scripts/deploy-pm2.sh --no-pull --skip-schema"
```

| Log line or symptom | Cause |
|---|---|
| `[SECURITY] FATAL: … placeholder value` | A placeholder secret is reaching the process: check `panel.env` and that no `.env*` exists in the checkout or in `.next/standalone`. |
| `Invalid environment variables` | A required key is missing from `panel.env`. |
| 502 from nginx | Panel not listening on 3000: `ss -tlnp \| grep :3000`. |
| Page loads without styling, JS 404 | Static copy missing: re-run the script. |
| `ERR_TOO_MANY_REDIRECTS` | Something redirects on port 80 while Cloudflare is "Flexible": see §6. |
