# ALO Labs — Hosting Platform

A production web-hosting control panel: Next.js 16 App Router, React 19,
TypeScript, Tailwind 4, shadcn/ui, Prisma, RBAC, MFA, AI agents, CRM, billing,
monitoring, SSL lifecycle, site provisioning.

## AI: provider chain + automation server

- **Providers** (`src/lib/ai/providers.ts`): an ordered, OpenAI-compatible chain
  with failover, retries and a circuit breaker. A free anonymous backend (LLM7.io)
  works with no key; UnoRouter/Groq/OpenAI/self-hosted LiteLLM/Ollama are profiles
  you enable in `.env`. Configure with `AI_PROVIDER_ORDER`, then verify live with
  `GET /api/ai/status?probe=1` — configuration alone is never reported as health.
- **Automations** (`src/lib/ai/automation/`): validated DAGs that mix model calls
  with read-only hosting queries (`listSites`, `siteHealth`, `sslExpiring`),
  executed server-side with per-step logs, dry-run and persisted run history.
  UI at `/ai/automations`, API under `/api/ai/workflows`.
- **No demo answers.** The old `agents/:slug/run` behaviour that emitted canned
  text when no key was set is removed; without a reachable provider those routes
  return `503 AI_NOT_CONFIGURED`.

Read [AI-PROVIDER-INTEGRATION.md](AI-PROVIDER-INTEGRATION.md) (including the
honest table of which upstream projects are integrated and which are not) and
[docs/AI-AUTOMATION.md](docs/AI-AUTOMATION.md).

---

## ⚠️ Read this first: which directory is the app?

**The application is the repository root.** `package.json`, `next.config.ts`,
`prisma/schema.prisma` and `src/` at the top level are the app that CI builds,
tests and deploys.

```
Hosting-Portal/                  ← ✅ THE APP (name: alo-hosting-panel)
├── package.json                 build / start / db:* scripts
├── next.config.ts               output: "standalone"
├── prisma/schema.prisma         74 models, provider = sqlite (libSQL adapter)
├── prisma/seed.ts               roles, permissions, first users
├── db/custom.db                 seeded SQLite database (see security note)
├── src/                         323 files — app router, /login, /sites, /servers…
├── helpers/                     19 privileged shell helpers → /usr/local/sbin
├── deploy/                      systemd units, nginx + cloudflared templates, sudoers
├── scripts/                     deploy, doctor, db bootstrap, backup, rollback
├── .github/workflows/           ci-cd.yml (build) + deploy.yml (self-hosted)
│
├── alo-hosting-portal/          ← ❌ LEGACY SNAPSHOT — DO NOT DEPLOY
└── alo-server-kit/              ← ❌ separate server-provisioning toolkit
```

`alo-hosting-portal/` is an older 218-file snapshot of the same product that was
checked in as part of a delivery bundle. It has **55 Prisma models instead of
74**, an older RBAC enum, **no `/login`, `/register` or `/admin` routes**, and its
own lockfile. Deploying it produces a panel that builds and returns HTTP 200 on
`/` but cannot be logged into — every `/dashboard` route 307-redirects to a
`/login` that does not exist. It is kept only for reference and for
`scripts/package-production.sh`.

If you are about to `cd alo-hosting-portal`, stop. Run `bash scripts/server-doctor.sh`
instead — it detects this mistake.

---

## Database: SQLite (libSQL), not PostgreSQL

`prisma/schema.prisma` declares `provider = "sqlite"` with
`generator { engineType = "client" }`, `prisma/migrations/migration_lock.toml` is
locked to `sqlite`, and `src/lib/db.ts` attaches `@prisma/adapter-libsql`
whenever `DATABASE_URL` starts with `file:`.

A Prisma client generated for `sqlite` **cannot** open a `postgresql://` URL.
`.env.example` and `DEPLOY.md` previously advertised PostgreSQL 17; that is
aspirational and does not match the schema. Moving to PostgreSQL means changing
the provider, regenerating every migration and re-testing the 74 models — it is
a project, not a `sed`.

Two rules that follow from this:

1. **Use an absolute database path.** `file:./db/custom.db` is resolved relative
   to the *process working directory*, so it silently breaks when systemd, PM2 or
   a CI runner starts the server from anywhere else.
2. **Keep the live database outside the repository.** `db/custom.db` is tracked by
   git, so any `git checkout` / `git reset --hard` / fresh clone overwrites it.
   Production uses `/var/lib/alo-hosting/alo.db` (see below).

### 🔴 The committed database contains a known super-admin password

`db/custom.db` ships with three seeded users whose passwords are in
`prisma/seed.ts` in plain text:

| email | role | password |
|---|---|---|
| `admin@alolabs.net` | `SUPER_ADMIN` | `admin123` |
| `reseller@alolabs.net` | `RESELLER` | `reseller123` |
| `client@alolabs.net` | `CLIENT` | `client123` |

Never expose that file as a production database. `scripts/init-production-db.sh`
copies it to the live path **and** replaces the admin password with a random one
in the same step.

---

## Local development

```bash
npm ci                 # Node >= 20.9
npm run db:generate    # prisma generate with engine downloads stubbed
cp .env.example .env   # then edit secrets
npm run dev            # http://localhost:3101
```

Login with the seeded super-admin above (development only).

## Build & run (production shape)

```bash
npm run build                                   # → .next/standalone/server.js
cp -r .next/static .next/standalone/.next/static
cp -r public .next/standalone/public
PORT=3051 HOSTNAME=127.0.0.1 node .next/standalone/server.js
```

`output: "standalone"` and `next start` are mutually exclusive — Next prints
`"next start" does not work with "output: standalone"` and the standalone server
is the supported entrypoint. `npm start` already points at it.

## Git-connected automatic deployment

`POST /api/github/webhook` receives signed GitHub push events and drives a real
pipeline: exact-SHA checkout → framework detection → isolated build/test →
immutable release → HTTP health **and** release-marker verification → automatic
rollback on failure. The dashboard page is `/deployments` (nav: **Deployments**).

```bash
DATABASE_URL="file:/var/lib/alo-hosting/alo.db" node scripts/apply-deploy-schema.mjs
npx vitest run tests/deploy-e2e.test.ts
node scripts/verify-deploy-http.mjs        # against a running panel
```

Setup, GitHub App/OAuth credentials, API map, security model and honest
limitations: **[docs/GIT-AUTODEPLOY.md](docs/GIT-AUTODEPLOY.md)**. Roadmap
status for all ten platform capabilities: [docs/ROADMAP-STATUS.md](docs/ROADMAP-STATUS.md).

## Deploying

Canonical production path (systemd + nginx + Cloudflare Tunnel), all templates in
`deploy/`:

```bash
bash scripts/server-doctor.sh          # audit the whole chain first
sudo bash scripts/init-production-db.sh
sudo cp deploy/systemd/alo-hosting-panel.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now alo-hosting-panel
```

Push to `main` and `.github/workflows/deploy.yml` builds on the self-hosted
runner, assembles an immutable release directory, swaps a symlink, restarts the
service, health-checks `/api/health` and rolls back automatically on failure.

Full procedure, request path and troubleshooting: `DEPLOY.md` and
`docs/RECOVERY-hosting.alolabs.net.md`.

## Repository scripts

| Script | Purpose |
|---|---|
| `scripts/server-doctor.sh` | Non-destructive audit of app → nginx → tunnel → DNS → cert → DB |
| `scripts/init-production-db.sh` | One-time DB bootstrap outside the repo + admin password rotation |
| `scripts/deploy-alo-portal.sh` | Full 7-phase bare-metal provisioning (`/opt/alo-hosting-portal`, Caddy) |
| `scripts/healthcheck.sh` | Liveness/readiness probe used by CI and the deploy workflow |
| `scripts/backup.sh` / `scripts/restore.sh` / `scripts/rollback.sh` | Data and release rollback |

## CI

`.github/workflows/ci-cd.yml` runs lint, typecheck, tests and a production build
on every push/PR and asserts `.next/standalone/server.js` exists. It never sets
`NODE_ENV=production` (that makes `npm ci` skip devDependencies and breaks lint).

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 16, React 19, TypeScript, Tailwind 4, shadcn/ui, Framer Motion |
| Backend | Next.js route handlers + server actions, Node.js 20 LTS |
| Database | SQLite via libSQL driver adapter, Prisma 6.19 (`engineType = "client"`) |
| Auth | NextAuth 4, JWT, RBAC (7 roles / 30 permissions), bcrypt, MFA (TOTP) |
| Cache | Redis (ioredis, optional) |
| Logging | Pino |
| Edge | nginx + Let's Encrypt behind a Cloudflare Tunnel (or Caddy) |
| Process | systemd unit (PM2 works but loses state across daemon restarts) |

## Licence

MIT.
