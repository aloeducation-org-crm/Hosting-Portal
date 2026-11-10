# ALO Labs — Hosting Portal

One project, one application, one deployment path. Next.js 16 App Router, React 19,
TypeScript, Tailwind 4, shadcn/ui, Prisma 6 (SQLite via libSQL), RBAC, MFA, AI
agents, CRM, billing, monitoring, SSL lifecycle and site provisioning.

> This repository used to contain three overlapping copies of the same product.
> The duplicate legacy application, duplicate helper trees, duplicate Docker
> files and duplicate installers were **consolidated in the 2026-11-09
> unification**. Nothing was silently deleted: all 431 retired paths are
> preserved verbatim in [`archive/retired-2026-11-09/`](archive/retired-2026-11-09/MANIFEST.md),
> with a per-file map to the canonical replacement. Unique functionality was
> merged into the active tree (including the two legacy automation API routes,
> the file-fallback audit trail and the three drifted privileged helpers).
> See [`AUDIT-REPORT.md`](AUDIT-REPORT.md) (baseline),
> [`AUDIT-REPORT-FINAL.md`](AUDIT-REPORT-FINAL.md) (post-fix) and
> [`docs/UNIFIED_PROJECT_MERGE_MAP.md`](docs/UNIFIED_PROJECT_MERGE_MAP.md).

## What is where

```
Hosting-Portal/                         ← THE APP (name: alo-hosting-panel)
├── package.json / package-lock.json    single dependency set (Node >= 22, CI 22)
├── next.config.ts                      output: "standalone", security headers, redirects
├── src/                                576 files: app router, API, components, lib
│   ├── app/(auth)/                     /login, /register, /verify-email
│   ├── app/(dashboard)/                admin/dashboard route groups
│   ├── app/api/                        246 route handlers
│   └── proxy.ts                        auth, RBAC, CSRF and rate-limit edge gate
├── prisma/                             schema.prisma (119 models), seed.ts, 15 migrations
├── db/custom.db                        development fixture (119 tables, random credentials)
├── public/                             3 static assets
├── tests/                              61 Vitest suites + isolation harness
├── helpers/                            19 root-owned privileged helpers + installer
├── deploy/                             ALL deployment configuration
│   ├── ubuntu-setup.sh                 single Ubuntu provisioning entrypoint
│   ├── server-kit/                     8 staged Ubuntu provisioning scripts + configs
│   ├── systemd/ sudoers/ nginx/        service units, policies, vhost
│   ├── cloudflared/ env/               tunnel config, production env template
│   └── README-hosting-engine.md        Docker/standalone notes
├── scripts/                            deploy pipeline, DB, backup, doctor, verification
│   └── legacy/compat.sh                 dispatcher for the 25 retired one-off scripts
├── archive/retired-2026-11-09/         immutable verbatim snapshot of all 431 retired paths
├── Dockerfile / docker-compose.yml     single container shape
├── .github/workflows/ci-cd.yml         verify → build → preflight → approved deploy
└── docs/                               design + historical audit records
```

**The active tree has no second `package.json`, no second Prisma schema, no
second app tree.** `deploy/server-kit/demo-app/` is a deliberately tiny
standalone Next.js example used by the server-kit provisioning rehearsal, not a
copy of this portal. The `archive/` tree is a non-deployed historical snapshot,
excluded from build, CI shell gates and `audit:repo` invariants.

## Public site

The public site is a projects showcase, not a shop. Edit
`src/lib/marketing/projects.ts` to change `/`, `/projects`, project detail pages,
footer links and the sitemap. The retired storefront (`/pricing`, `/hosting/*`,
`/domains`, `/email`, `/ssl`) is kept in the tree but redirected in
`next.config.ts`; its catalogue and `GET /api/marketing/domain-check` (real RDAP)
remain available.

## AI

Providers (`src/lib/ai/providers.ts`) form an ordered OpenAI-compatible chain
with failover, bounded retries, SSRF/redirect guards and a circuit breaker.
`AI_PROVIDER_ORDER` selects profiles; verify live — configuration alone is never
reported as health — with authenticated `GET /api/ai/status?probe=1`. Without a
reachable provider, AI routes return `503 AI_NOT_CONFIGURED`; there are no demo
answers or fake quotas. See [AI-PROVIDER-INTEGRATION.md](AI-PROVIDER-INTEGRATION.md),
[docs/SELF-HOSTED-AI-AGENTS.md](docs/SELF-HOSTED-AI-AGENTS.md) and
[docs/AI-AUTOMATION.md](docs/AI-AUTOMATION.md).

## Local development

```bash
npm ci                       # Node >= 22
npm run db:generate          # Prisma client (engine downloads stubbed)
cp .env.example .env         # then fill in secrets; see docs/UNIFIED_PROJECT_ENVIRONMENT_VARIABLES.md
npm run dev                  # http://localhost:3101
```

`db/custom.db` is a **development fixture**, not a production database. It has
all 119 tables and three seeded users whose passwords are randomly generated at
seed time and never printed. To create a development login you control:

```bash
SEED_ADMIN_PASSWORD='choose-a-local-password' npm run db:seed
```

The login page ships **no demo credentials**. Production credentials are created
by `scripts/init-production-db.sh`, which writes the generated admin password to
a root-only `0600` file (`ADMIN_CREDENTIAL_FILE`) and never prints it.

## Database

`prisma/schema.prisma` uses `provider = "sqlite"` with `engineType = "client"`;
`src/lib/db.ts` attaches `@prisma/adapter-libsql` for `file:` URLs. A client
generated for SQLite cannot open a `postgresql://` URL.

1. **Use an absolute path.** `file:./db/custom.db` resolves from the process
   working directory and breaks under systemd, PM2 or CI.
2. **Keep the live DB outside the checkout.** Production uses
   `/var/lib/alo-hosting/alo.db`.
3. Migrations are applied additively by
   `DATABASE_URL="file:/var/lib/alo-hosting/alo.db" node scripts/apply-deploy-schema.mjs`.
   It refuses relative paths and requires explicit `--allow-rebuild --backup …`
   for table-rebuild migrations.

## Build & run (production shape)

```bash
npm run build
cp -r .next/static .next/standalone/.next/static
cp -r public .next/standalone/public
PORT=3051 HOSTNAME=127.0.0.1 node .next/standalone/server.js
```

`output: "standalone"` and `next start` are mutually exclusive; `npm start`
already points at the standalone server. Turbopack file-tracing is scoped so the
standalone output does not include the whole checkout.

## Verification

```bash
npm run verify          # lint + typecheck + tests + production build
npm run audit:repo      # 16 repository invariants (single tree, imports, env, DB parity…)
npm run config:validate # production env/secret/DB preflight (read-only)
npm audit               # dependency advisories
bash scripts/server-doctor.sh
node scripts/e2e-smoke.mjs http://127.0.0.1:3051   # needs PANEL_PASSWORD
```

`npm test` runs 61 Vitest suites. Tests that touch the database use
`tests/helpers/isolated-db.ts`, which copies the fixture to a temp directory, so
the tracked database is never mutated by a test run.

## Deployment

| Path | Purpose |
| --- | --- |
| `deploy/ubuntu-setup.sh` | **canonical** Ubuntu 22.04/24.04 provisioning (dry-run by default, `--apply` to change the host) |
| `scripts/bootstrap-server.sh` | panel env, SQLite DB, systemd unit, deploy sudoers |
| `helpers/install-helpers.sh` | root-owned allowlisted privileged helpers |
| `.github/workflows/ci-cd.yml` | verified build artifact, read-only preflight, approval-gated production activation with rollback |
| `Dockerfile` + `docker-compose.yml` | alternative container shape (loopback 8080, non-root, read-only rootfs) |
| `deploy/nginx/hosting.alolabs.net.conf` | canonical TLS vhost behind Cloudflare Tunnel |
| `Caddyfile` | development/single-site reverse proxy only |
| `scripts/backup.sh`, `scripts/db-backup.mjs`, `scripts/restore.sh`, `scripts/rollback.sh` | backups, restore and release rollback |
| `scripts/deploy-new-site.sh` | per-site provisioning |
| `scripts/server-doctor.sh` | read-only host health report |

Full runbook: [DEPLOY.md](DEPLOY.md) and
[docs/DEPLOYMENT-AND-ROLLBACK.md](docs/DEPLOYMENT-AND-ROLLBACK.md).
Git-connected auto-deploy: [docs/GIT-AUTODEPLOY.md](docs/GIT-AUTODEPLOY.md).
Roadmap honesty: [docs/ROADMAP-STATUS.md](docs/ROADMAP-STATUS.md).

## Security notes

- Production startup fails closed on missing/placeholder `NEXTAUTH_SECRET`,
  `JWT_SECRET`, `APP_ENCRYPTION_KEY` and `INTERNAL_SECRET`.
- `src/proxy.ts` enforces authentication, RBAC, CSRF (double-submit cookie),
  strict auth/AI rate limits and security headers on error responses.
- `next.config.ts` sets `X-Content-Type-Options`, `X-Frame-Options`,
  `Referrer-Policy`, `Permissions-Policy`, HSTS, an enforced minimal CSP and a
  report-only broader CSP.
- Helpers run through `execFile` with exact allowlisted sudoers rules; no
  `exec()`/`eval()` in canonical `src/`.
- No credentials, live `.env` or production database are committed. Historical
  published seed passwords are retained **only** inside
  `scripts/init-production-db.sh` so legacy databases can be detected and
  rotated.

## Honest status

Verified locally: install, lint, typecheck, tests, production build, 16-point
repository audit, dependency audit, static import/link/env parity, Prisma/SQLite
parity and a live standalone HTTP probe.

**Not verifiable from a source checkout:** real Ubuntu provisioning, UFW,
systemd/PM2 activation, nginx/Caddy runtime, Certbot issuance and renewal,
Cloudflare Tunnel, DNS/registrar and mail delivery, Docker daemon builds, the
self-hosted GitHub Actions runner and live external AI providers. Those are
configuration-complete but **operationally unverified**; see the "Not verified"
section of [AUDIT-REPORT-FINAL.md](AUDIT-REPORT-FINAL.md).
