# Recovering `hosting.alolabs.net` on `alo-server-lap`

Written 2026-10-25 against the state left by the deployment session recorded in
`alo-server-lap`'s shell history. Everything below was verified in a clean
checkout of this repository: the build, the standalone server, the login round
trip and the doctor output are real results, not guesses.

**Current status: the panel is down.** PM2 deleted the `alo-hosting` process,
nothing is listening on 3051, and even when it was up the public URL returned
HTTP 530.

---

## 0. What is actually broken

Five independent faults. Fixing any four of them still leaves the site down.

| # | Fault | Evidence from your session |
|---|---|---|
| 1 | **Wrong application deployed.** You built and ran `alo-hosting-portal/`, a legacy snapshot with 55 Prisma models and **no `/login` route**. The real app is the repository **root** (74 models, `/login`, `/register`, `/sites`, `/servers`, `/users`). | `ls -d alo-hosting-portal/src/app/(auth)/*` → nothing. Root has `src/app/(auth)/login`. Your build output listed 89 routes and no `/login`. |
| 2 | **Redirect loop through the tunnel.** `cloudflared` ingress is `http://localhost:80`; nginx (certbot) answers port 80 with `301 → https://hosting.alolabs.net`. Cloudflare re-enters the same tunnel → infinite loop → edge returns **530**. | `curl https://hosting.alolabs.net/` → `530` from your Mac, `301` from the server, while `curl http://127.0.0.1:3051/` → `200`. |
| 3 | **Database credentials no longer match.** You ran `ALTER ROLE alamin_app PASSWORD 'NEW_RANDOM'`; the `.env` rewrite failed (`FileNotFoundError: /home/alamin/projects/Hosting-Portal/.env` — wrong path). Postgres now expects `NEW_RANDOM`, `.env` still has `CHANGE_ME_AFTER_THIS_SESSION`. | `Error: P1000: Authentication failed … for alamin_app`. |
| 4 | **The committed seed database was 10 columns behind the schema** → every login 500s. Fixed in this branch (see §4). | Reproduced here: `prisma:error SQLITE_ERROR: no such column: operationJobId`, login → 500. After the fix → **200 with SUPER_ADMIN + 30 permissions**. |
| 5 | **PM2 lost its process list.** `pm2 startup` only *prints* a command; it was never run with sudo, so a daemon respawn/reboot leaves nothing managed. | `[PM2] Spawning PM2 daemon` then `[PM2][ERROR] Process or Namespace alo-hosting not found`, restart counter climbing to 49. |

Two more things that are not broken but will bite you:

- **Your server's working tree is dirty.** You edited `alo-hosting-portal/package.json`,
  `alo-hosting-portal/next.config.ts`, `alo-hosting-portal/prisma/schema.prisma`
  and deleted the tracked root `bun.lock`. Any deploy that runs
  `git reset --hard` silently reverts all of it — including the
  `provider = "postgresql"` edit that currently makes your database work.
- **Secrets were published.** `/etc/alo/secrets.env` was `cat`-ed to the
  terminal, the DB password and the runner registration token were pasted, and
  the Cloudflare origin certificate was echoed. See §7 — rotate all of it.

---

## 1. Get a working panel up (10 minutes, no CI needed)

Run these on the server. Blocks are copy-pasteable and use `set -euo pipefail`
so a failure stops instead of cascading.

### 1.0 …or do §1.2–§1.5 in one command

`scripts/bootstrap-server.sh` performs the server-side prerequisites required
by `.github/workflows/ci-cd.yml`, and it is safe to re-run:

```bash
cd ~/projects/Hosting-Portal
git pull && npm ci                       # it takes node modules from here
sudo bash scripts/bootstrap-server.sh --domain hosting.alolabs.net
```

It writes `/etc/alo-hosting/panel.env` (0640 `root:alamin`) with secrets
generated on the box, creates and schema-verifies `/var/lib/alo-hosting/alo.db`,
rotates the published `admin123` password (printed once — save it), installs
`alo-hosting-panel.service` with the absolute Node path it detected, installs
`/etc/sudoers.d/alo-hosting-deploy` after `visudo -cf`, and installs
`/usr/local/sbin/alo-init-db`. Add `--dry-run` first to see the plan.

Still manual, because they touch live traffic: §1.1 (resetting the dirty tree),
§2 (nginx + the Cloudflare Tunnel ingress). The script will do those too if you
ask: `--nginx` and `--tunnel <uuid>`.

After it finishes, push to `main` (or re-run the failed Deploy job) and the
workflow deploys. Read on only if you want to see what it did, or need to do a
step by hand.

### 1.1 Pull this branch and reset the dirty tree

```bash
cd ~/projects/Hosting-Portal

# Save nothing — every local edit on this box was a workaround for the wrong
# app directory. Confirm first if you want to look:
git status --porcelain
git diff --stat

git fetch origin
git checkout arena/da021936-hosting-portal     # or: git checkout main, once merged
git reset --hard origin/arena/da021936-hosting-portal
git log --oneline -3

# Sanity: the canonical app must have a login route
test -f 'src/app/(auth)/login/page.tsx' && echo "✅ right directory (repo root)"
```

> Your `.env` files are gitignored and survive the reset. `bun.lock` comes back.

### 1.2 Install Node 20 system-wide

nvm's node is invisible to `sudo`, to systemd and to the Actions runner (their
`PATH` is the bare `secure_path`). That is why `pm2`/`npm` kept "not found"
inside scripts while working in your shell.

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
node -v          # v20.9+
sudo node -v     # must also print v20.9+  ← this is the check that matters
```

Keep nvm if you like it for interactive work; the system node is what services
will use.

### 1.3 Create the production env file

```bash
sudo install -d -m 0750 /etc/alo-hosting
sudo cp ~/projects/Hosting-Portal/.env.example /etc/alo-hosting/panel.env
sudo chown root:alamin /etc/alo-hosting/panel.env
sudo chmod 0640 /etc/alo-hosting/panel.env
sudo nano /etc/alo-hosting/panel.env
```

Set exactly these (values differ from the legacy `.env` you have been editing):

```ini
NODE_ENV=production
HOSTNAME=127.0.0.1
PORT=3051
APP_URL=https://hosting.alolabs.net
NEXTAUTH_URL=https://hosting.alolabs.net
NEXTAUTH_SECRET=<openssl rand -hex 32>          # NEW value, not the leaked one
JWT_SECRET=<openssl rand -hex 64>               # NEW value
APP_ENCRYPTION_KEY=<openssl rand -hex 32>       # NEW value
INTERNAL_SECRET=<openssl rand -hex 32>
DATABASE_URL="file:/var/lib/alo-hosting/alo.db" # absolute, outside the repo
REDIS_URL=redis://127.0.0.1:6379
```

`src/lib/env.ts` calls `process.exit(1)` in production if `NEXTAUTH_SECRET` or
`JWT_SECRET` is missing or still the dev default — that is the
`[SECURITY] FATAL: JWT_SECRET is using the default value` message that killed
your first build.

### 1.4 Create the database

```bash
cd ~/projects/Hosting-Portal
npm ci --no-audit --no-fund
sudo bash scripts/init-production-db.sh

# The deploy workflow calls this through a stable path (see §3):
sudo install -m 0755 scripts/init-production-db.sh /usr/local/sbin/alo-init-db
```

The script creates `/var/lib/alo-hosting/alo.db` from the (now schema-correct)
seed, verifies all 74 tables, **rotates the `admin@alolabs.net` password away
from the published `admin123`**, disables the two demo accounts, and prints the
new credentials once. Put them in a password manager immediately.

### 1.5 Build and install the service

```bash
cd ~/projects/Hosting-Portal
npm run build
test -f .next/standalone/server.js && echo "✅ standalone OK"

# Assemble the release layout the systemd unit and the deploy workflow expect
SHA=$(git rev-parse HEAD)
mkdir -p ~/alo-hosting/releases/$SHA ~/alo-hosting/logs
cp -a .next/standalone/. ~/alo-hosting/releases/$SHA/
mkdir -p ~/alo-hosting/releases/$SHA/.next
cp -a .next/static ~/alo-hosting/releases/$SHA/.next/static
cp -a public       ~/alo-hosting/releases/$SHA/public
cp -a prisma       ~/alo-hosting/releases/$SHA/prisma
ln -sfn ~/alo-hosting/releases/$SHA ~/alo-hosting/current

sudo cp deploy/systemd/alo-hosting-panel.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now alo-hosting-panel
sleep 4
systemctl status alo-hosting-panel --no-pager | head -6
curl -sS http://127.0.0.1:3051/api/health
```

Expect `"databaseStatus":"connected"` and `/login` → 200. **Stop the old PM2
process first** so two servers do not fight over 3051:

```bash
pm2 delete alo-hosting 2>/dev/null || true
pm2 save --force 2>/dev/null || true
```

---

## 2. Fix the public URL (the 530)

One line in the tunnel config. The tunnel must terminate on nginx's **TLS**
listener, otherwise nginx's `80 → 443` redirect loops back through Cloudflare.

```bash
TUNNEL_ID=7160647f-edfb-42c0-b98d-b760c30a0a61     # your existing alo-hosting tunnel
sed "s/<TUNNEL_UUID>/$TUNNEL_ID/g" \
  ~/projects/Hosting-Portal/deploy/cloudflared/config.yml > ~/.cloudflared/config.yml

cat ~/.cloudflared/config.yml                        # verify: service: https://127.0.0.1:443
sudo systemctl restart cloudflared
sleep 5
cloudflared tunnel info alo-hosting | tail -3        # expect 2+ connectors
```

Then install the nginx site and the WebSocket map from the repo (yours was
hand-written and truncated by a pasted `echo`):

```bash
sudo cp ~/projects/Hosting-Portal/deploy/nginx/conf.d/websocket-upgrade.conf /etc/nginx/conf.d/
sudo cp ~/projects/Hosting-Portal/deploy/nginx/hosting.alolabs.net.conf \
        /etc/nginx/sites-available/hosting.alolabs.net
sudo ln -sfn /etc/nginx/sites-available/hosting.alolabs.net /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
sudo mkdir -p /var/www/certbot        # ACME challenge root for renewals
```

### 2.1 Make sure nothing else owns the hostname

This repository is also connected to a **Cloudflare Workers build** (account
`7164cebb…`, service `hosting-portal`). It reports **failure** on every push —
correctly, because a Next.js 16 app cannot be built as a Worker without
`@opennextjs/cloudflare`, and this repo has no `wrangler.toml`.

A failing build is harmless noise **unless that Worker is bound to
`hosting.alolabs.net`**. If it is, a Workers route/custom domain takes priority
over the tunnel CNAME, and the hostname serves the Worker's error instead of
your panel — which also produces edge 5xx while everything on the server looks
healthy. Your certbot run showed exactly that class of failure *before* the
tunnel route existed:

```
Detail: 2606:4700:3034::6815:223a: Invalid response from
        http://hosting.alolabs.net/.well-known/acme-challenge/…: 530
```

Check it once, in the dashboard:

1. **Workers & Pages → `hosting-portal` → Settings → Domains & Routes.** If
   `hosting.alolabs.net` (or `*.alolabs.net`) is listed, **remove it**. Then
   either disconnect the Worker from this repository, or delete the Worker if
   nothing uses it — otherwise every push keeps producing a red build.
2. **alolabs.net → DNS → Records.** There must be exactly **one** record for
   `hosting`: a CNAME to `7160647f-edfb-42c0-b98d-b760c30a0a61.cfargotunnel.com`,
   proxied. You hit `code: 1003 … An A, AAAA, or CNAME record with that host
   already exists` twice, which means an older record was in the way; the second
   `cloudflared tunnel route dns` succeeded, so confirm the stale one is gone.

`scripts/server-doctor.sh` verifies this from the response headers: nginx always
advertises `server: nginx/…`, a Worker does not. A missing or non-nginx `server`
header on `https://hosting.alolabs.net/` means something other than your nginx
answered.

**Cloudflare dashboard → alolabs.net → SSL/TLS → Overview: set the mode to
`Full`.** Not *Flexible* (it re-encrypts to port 80 and re-creates the loop),
not *Full (strict)* (it rejects the loopback SNI). Your certificate is already
issued and valid to **2027-01-23**, with `certbot.timer` active.

Verify from your Mac, not from the server:

```bash
curl -sSI https://hosting.alolabs.net/ | head -3          # HTTP/2 200
curl -sS  https://hosting.alolabs.net/api/health          # databaseStatus: connected
```

---

## 3. Turn on auto-deploy

The repository has one CI/deploy workflow: `.github/workflows/ci-cd.yml`. It
checks and builds the canonical repository root on GitHub-hosted runners, then
uses the production self-hosted runner (labels `self-hosted, linux, production`)
to atomically activate the artifact. The one-time bootstrap installs the
production env file, external SQLite DB, systemd unit and narrowly-scoped
sudoers rules. The runner must run as the same account that owns
`~/alo-hosting` (normally `alamin`).

After merging a change to `main`, the workflow creates
`/home/alamin/alo-hosting/releases/<sha>`, repoints `current`, restarts the
systemd service, verifies `/api/health` reports a connected/current database
and `/login` returns HTTP 200, and restores the previous release if either
probe fails. It refuses to deploy if the production env/DB prerequisites are
missing or inconsistent. There is no SSH action, PM2 restart or GitHub SSH key
secret in this path; the duplicate SSH-based workflow has been removed.

No repository SSH secrets are required. GitHub Actions must be enabled, and the
production runner must be online and carry the `production` label before a push
to `main` can deploy. A missing/incorrect runner label will leave the deploy job
queued rather than silently using a different host.

---

## 4. Database: what is true

`prisma/schema.prisma` is `provider = "sqlite"` with `engineType = "client"`,
`prisma/migrations/migration_lock.toml` is locked to `sqlite`, and
`src/lib/db.ts` attaches `@prisma/adapter-libsql` for any `file:` URL.
**A Prisma client generated for sqlite cannot open a `postgresql://` URL** — so
the PostgreSQL 14 cluster, the `alamin_app` role and the `alo_hosting` database
you created are not used by the canonical app. The tables in it came from the
*legacy* 55-model schema and do not match the root app either.

Three rules:

1. **Absolute path.** `file:./db/custom.db` resolves against the process working
   directory — verified: from `/tmp` it fails with
   `ConnectionFailed("Unable to open connection to local database ./db/custom.db")`.
   Both `file:/abs/path` and `file:///abs/path` work.
2. **Outside the repository.** `db/custom.db` is tracked by git, so a checkout
   replaces production data with the committed snapshot. Live data goes in
   `/var/lib/alo-hosting/alo.db`.
3. **Reconcile the schema.** The committed seed was missing
   `audit_logs.operationJobId` and 9 `operation_jobs` columns, so
   `db.auditLog.create()` threw `SQLITE_ERROR: no such column: operationJobId`
   and **every login returned 500**. This branch rebuilds those two tables to
   match the schema; `scripts/server-doctor.sh` now detects the condition on any
   database, and the fix for a drifted live database is:

   ```bash
   cd ~/projects/Hosting-Portal
   DATABASE_URL="file:/var/lib/alo-hosting/alo.db" npx prisma db push
   ```

Leave PostgreSQL installed if other projects use it. Otherwise
`sudo systemctl disable --now postgresql` — the panel does not need it, and
`scripts/server-doctor.sh` will flag it if it is ever bound to a public
interface.

---

## 5. Retire the legacy deployment

```bash
cd ~/projects/Hosting-Portal

# The legacy clone has hand-edited package.json / next.config.ts / schema.prisma.
# §1.1's git reset --hard already reverted them. Confirm:
git status --porcelain            # should be empty apart from untracked .env files

# Its .env is no longer read by anything; keep it for reference, but do not
# let it confuse the next person:
mv alo-hosting-portal/.env alo-hosting-portal/.env.legacy-disabled
chmod 600 alo-hosting-portal/.env.legacy-disabled

# PM2 must not resurrect the legacy process on boot:
pm2 delete all 2>/dev/null || true
pm2 save --force
```

Do not `cd alo-hosting-portal` again. `bash scripts/server-doctor.sh` fails
loudly if you do.

---

## 6. Verify

```bash
cd ~/projects/Hosting-Portal
bash scripts/server-doctor.sh --domain hosting.alolabs.net --port 3051
```

Target: **0 FAIL**. The doctor checks all 11 layers — canonical directory,
working tree, node visible to sudo, systemd unit, socket binding, provider vs
`DATABASE_URL` scheme, absolute path, outside-repo, schema drift, secret
strength and file mode, `/`, `/login`, `/register`, `/api/health`, nginx config
and proxy target, certificate and renewal timer, tunnel ingress (it explicitly
detects the `http://localhost:80` loop), DNS, public reachability, firewall and
publicly-bound services, and the runner service.

Then, from your Mac:

```bash
curl -sSI https://hosting.alolabs.net/login | head -3     # 200
open https://hosting.alolabs.net/login                     # log in with the rotated admin password
```

---

## 7. Rotate everything that was published

These values appeared in terminal output, in this chat, and in
`/etc/alo/secrets.env`. Treat all of them as compromised.

| Secret | Rotate with |
|---|---|
| `PG_APP_PASSWORD` / `alamin_app` | `sudo -u postgres psql -c "ALTER ROLE alamin_app PASSWORD '$(openssl rand -hex 24)';"` — or drop the role entirely (§4) |
| `NEXTAUTH_SECRET`, `JWT_SECRET` | new `openssl rand -hex 64` in `/etc/alo-hosting/panel.env`, then `sudo systemctl restart alo-hosting-panel`. Invalidates every existing session — that is the point |
| `APP_ENCRYPTION_KEY` | ⚠️ Rotating this makes data already encrypted with the old key unreadable. Nothing is encrypted yet on a fresh database, so rotate **now**, before real data exists |
| `LITELLM_MASTER_KEY`, `LITELLM_PG_PASSWORD`, `WEBUI_SECRET_KEY` | regenerate in `/etc/alo/secrets.env`; restart LiteLLM / Open WebUI |
| `SAMBA_PASSWORD`, `HTPASSWD_PASSWORD` | `smbpasswd -a <user>` / `htpasswd -B` |
| GitHub **runner registration token** (`BXVOJQN6…`) | expired by now (1 h TTL), but remove the runner and re-register if you want certainty: Settings → Actions → Runners |
| GitHub **deploy key** `alo-server-deploy` | the public key is not secret; the private key never left the server. Revoke at Settings → Deploy keys only if you suspect the host was compromised |
| Cloudflare **origin certificate** (pasted into the terminal) | it was truncated and never installed — nginx uses the Let's Encrypt cert. Delete `/etc/nginx/ssl/alolabs.net.pem`; it is an incomplete file that nginx is not reading |
| `admin@alolabs.net` password | done by `scripts/init-production-db.sh` |
| Shell history | `history -c && history -w`, and clear `~/.bash_history` of the `cat /etc/alo/secrets.env` output |

Also: `/etc/alo/secrets.env` was created `root:alamin 0600` — with group
`alamin` and mode 600 the group bit is meaningless, but confirm
`sudo stat -c '%a %U:%G' /etc/alo/secrets.env` says `600 root:root` or
`640 root:alamin`.

---

## 8. Posture notes

- **UFW is active with 22/80/443 only.** That is correct for a tunnel-fronted
  panel. Consequence: Postfix (25), Dovecot (110/143/993/995) and pure-ftpd (21)
  you installed are **unreachable from the internet**. Either that is what you
  want (then bind them to `127.0.0.1` / Tailscale and stop publishing them on
  `0.0.0.0`), or you need explicit `ufw allow` rules plus TLS, DKIM, SPF, DMARC
  and rDNS before a residential line will deliver mail anywhere. The panel's
  email features call the helper layer — they do not require you to run your own
  MTA.
- **SSH on 22 is open to the internet** while `alo-server-kit` intends 2244 +
  Tailscale-only. You already reach the box over Tailscale (`100.94.234.101`).
  Consider `alo-server-kit/stages/01-security.sh` or at minimum
  `sudo ufw delete allow 22/tcp && sudo ufw allow from 100.64.0.0/10 to any port 22`.
  Do **not** run the kit's `close-ssh-22.sh` without a working Tailscale session
  open in a second terminal — the box has already dropped off Tailscale twice
  during this session (`offline, last seen 5h ago`), and that is how you get
  locked out of a laptop behind NAT.
- **Disk**: 14 GB used of 98 GB. Each standalone release is ~174 MB (143 MB of
  it traced `node_modules`); the deploy workflow keeps the last 5 and prunes the
  rest.
- **`alo-server-lap` is a laptop on WiFi** (`wlp0s20f3`, 192.168.0.197). It
  sleeps, it roams, and it has already vanished from the tailnet for hours.
  Disable suspend (`sudo systemctl mask sleep.target suspend.target`) and treat
  the Cloudflare Tunnel as the only ingress — it survives NAT and IP changes,
  which is exactly why it is the right choice here.

---

## 9. If it breaks again

```bash
bash scripts/server-doctor.sh                      # what is wrong, in order
sudo journalctl -u alo-hosting-panel -n 80 --no-pager
sudo journalctl -u cloudflared -n 40 --no-pager
sudo tail -40 /var/log/nginx/hosting-error.log
cd ~/alo-hosting/releases && ls -1dt */ | head -3  # roll back by hand:
ln -sfn ~/alo-hosting/releases/<previous-sha> ~/alo-hosting/current && sudo systemctl restart alo-hosting-panel
```

Symptom → cause cheatsheet:

| Symptom | Cause |
|---|---|
| `530` / `ERR_TOO_MANY_REDIRECTS` publicly, `200` locally | tunnel ingress on port 80 (§2) |
| `/login` → 404 | running the legacy `alo-hosting-portal` snapshot (§1.1) |
| login → 500, log says `no such column` | database behind the schema (§4.3) |
| build dies at *Collecting page data* with `[SECURITY] FATAL` | dev-default `JWT_SECRET` / `NEXTAUTH_SECRET` (§1.3) |
| `Cannot find module .next/standalone/server.js` | `outputFileTracingRoot` not pinned, or `npm start` used with `next start` |
| `npm: command not found` under sudo / CI | nvm node not in `secure_path` (§1.2) |
| PM2 says *Process or Namespace not found* | PM2 daemon respawned; use systemd (§1.5) |
| `P1000 Authentication failed` | Postgres password ≠ `DATABASE_URL` — and you should be on SQLite anyway (§4) |
