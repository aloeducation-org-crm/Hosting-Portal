# Complete Repository Audit — ALO Hosting Portal

**Audit date:** 2026-11-09 (UTC)
**Branch:** `arena/6379732a-hosting-portal` at `8cf1b482f93beb10da8632e19c2249faac4ef12a`
**Scope:** every tracked file in the checkout (`git ls-files` = **1,262 files**), every folder, every config, dependency, route, page, component, DB object, script, env var, deployment artifact and document.
**Method:** real command execution + automated static scans (`/tmp/audit.py`, `/tmp/audit-data.json`), not inspection of previous audit documents.
**Status:** **PRE-FIX / BASELINE.** No code was changed to produce this report. A post-fix re-audit is required and will be published separately.

> **Honesty rule used throughout:** an item is only `PASS` when a command or a live HTTP response proved it. `BLOCKED` means the sandbox has no host, daemon, DNS, certificate or credentials to test it. `FAIL` means a command or scan produced a concrete defect. Source-code presence is never reported as "working".

---

## 0. Environment used for verification

| Fact | Value |
|---|---|
| Node / npm | `v22.22.3` / `10.9.8` |
| CPU / RAM | 2 cores / 3,939 MB (no swap) |
| `npm ci` | **PASS** — 648 packages installed, Prisma client generated (v6.19.3), exit 0 |
| Outbound network | npm registry, GitHub, PyPI only |
| Available host tooling | `python3`, `systemctl` (no systemd running), `bash`, `openssl`, `curl` |
| Absent tooling | `docker`, `pm2`, `nginx`, `caddy`, `certbot`, `ufw`, `sqlite3` |

Consequence: **Ubuntu/Caddy/Nginx/PM2/Docker/SSL/UFW operation cannot be verified in this environment.** They are audited as configuration/source only and reported honestly below.

---

## 1. Inventory

| Metric | Count | Evidence |
|---|---:|---|
| **Total tracked files** | **1,262** | `git ls-files | wc -l` |
| **Total folders** | **618** | recursive walk excluding `.git`, `node_modules`, `.next` |
| Total files including untracked generated output | 1,263 | + `tsconfig.tsbuildinfo` produced by `tsc` (gitignored) |
| Root-level files | 25 | `find . -maxdepth 1 -type f` |
| Files in canonical `src/` | 576 | recursive walk |
| Files in `tests/` | 63 | 61 Vitest suites + 1 helper + 1 fixture dir |
| Files in `docs/` | 81 | recursive walk |
| Files in `scripts/` | 58 | recursive walk |
| Files in `helpers/` | 24 | 19 extension-less privileged helpers + 5 installers/policy |
| Files in `prisma/` | 18 | schema, seed, 15 migrations + lock |
| Files in `deploy/` | 11 | nginx, cloudflared, sudoers, systemd, env template |
| Files in `alo-hosting-portal/` (**legacy duplicate app**) | **325** | recursive walk |
| Files in `alo-server-kit/` (server toolkit) | **47** | recursive walk |
| Files in `server-helpers/` (duplicate helpers) | 19 | recursive walk |
| Files in `server-config/` (duplicate configs) | 5 | recursive walk |
| Files in `install-scripts/` (duplicate installers) | 4 | recursive walk |
| Canonical API route handlers | **246** | `src/app/api/**/route.ts` |
| Canonical pages | **77** | `src/app/**/page.tsx` |
| Legacy API route handlers | 93 | `alo-hosting-portal/src/app/api/**/route.ts` |
| Legacy pages | 16 | `alo-hosting-portal/src/app/**/page.tsx` |
| Build output routes (static + dynamic) | 221 static pages generated, 246 ƒ handlers listed | `npm run build` |
| Prisma models (canonical) | **119** | `grep -c '^model ' prisma/schema.prisma` |
| Prisma models (legacy) | 55 | `alo-hosting-portal/prisma/schema.prisma`, provider **postgresql** (incompatible with canonical **sqlite**) |
| Migration files (canonical) | 15 SQL + `migration_lock.toml` | `prisma/migrations/*` |
| Migration files (legacy) | 2 SQL + lock | `alo-hosting-portal/prisma/migrations/*` |
| Tables in tracked `db/custom.db` | **91** | `@libsql/client` query on `sqlite_master` |
| Shell programs found | **106** | shebang/extension scan |
| Duplicate content groups | **181** | SHA-256 grouping |
| Redundant duplicate files | **203** | sum of `group size - 1` |

### 1.1 Missing files / folders

| Item | Finding |
|---|---|
| Missing files referenced by canonical code | **0** — 0 unresolved relative/`@/` imports across all TS/TSX/JS/MJS files (root, legacy, scripts, tests) |
| Missing folders referenced by canonical code | **0** |
| Empty files | **3** — `db/.gitkeep`, `alo-hosting-portal/db/.gitkeep`, `alo-hosting-portal/mini-services/.gitkeep` (all intentional markers) |
| Empty non-`.gitkeep` files | **0** |
| Missing `.env` | Expected: secrets must not be committed; `.env.example` + `deploy/env/alo-hosting-panel.env.example` exist |
| Missing `deploy.yml` workflow | `README.md` claims `.github/workflows/ci-cd.yml` **+ `deploy.yml`**; only `ci-cd.yml` exists — **documentation/configuration mismatch** |
| Missing legacy-tree files | Not applicable — the legacy tree is a whole duplicate, not a missing dependency |

### 1.2 Placeholder / stub / TODO code

| Item | Finding |
|---|---|
| `TODO` / `FIXME` comments in source | **0** real comments; 2 assertions in tests (`/todo|tbd/i` guards), 1 legacy README feature list item (`Todo` task status) |
| Placeholder *implementations* | **1** — legacy `alo-hosting-portal/src/app/dashboard/billing/page.tsx` has 2 `alert('… coming soon')` handlers; legacy layout has 2 more `toast.info('… coming soon')` |
| Placeholder string literals in canonical code | `DRYRUN_DB_PASSWORD_PLACEHOLDER` in `scripts/deploy-alo-portal.sh` (intentional dry-run marker), `PLACEHOLDER_MARKERS` in `src/lib/config/production-config.ts` (secret rejection logic, intentional) |
| HTML `placeholder=` attributes | 430 lines — legitimate form UX, **not** placeholder implementations |
| Demo/fake data in canonical runtime | **0** detected; prior audits removed fake AI/metrics/domain responses |

---

## 2. Merge / consolidation findings ("all are the same project")

The checkout contains **three overlapping project trees** plus four duplicate configuration trees:

| Tree | What it is | Verdict |
|---|---|---|
| repository root (`src/`, `prisma/`, `package.json`, `helpers/`, `deploy/`, `scripts/`, `tests/`) | canonical Next.js 16 / SQLite app, built by CI | **KEEP as the single project** |
| `alo-hosting-portal/` (325 files) | older snapshot: separate `package.json`, `package-lock.json`, `bun.lock`, PostgreSQL Prisma schema with 55 models, own 93 API routes, 16 pages, own 10-file test suite, own DB, own Docker/Caddy/deploy files | **DUPLICATE / INCOMPATIBLE** — must be merged then removed |
| `alo-server-kit/` (47 files) | Ubuntu provisioning toolkit (stages, nginx/PM2/systemd templates, backup/restore, verify) — genuinely unique content | **MERGE into canonical `deploy/`** |
| `server-helpers/` (19), `alo-hosting-portal/server-helpers/` (19), `alo-hosting-portal/helpers/` (8) | byte-identical or drifted copies of canonical `helpers/` | **DUPLICATE** |
| `server-config/` (5), `deploy/sudoers/` (2), `helpers/sudoers-alo` | 4 byte-identical sudoers policies + 2 diverging systemd units | **DUPLICATE / DRIFT** |
| `install-scripts/` (4) | legacy `/opt/alo-hosting-portal` installers parallel to `scripts/install.sh`/`update.sh`/`rollback.sh` | **DUPLICATE** (one unique file: `configure-email.sh`, 22 KB, Postfix/Dovecot setup) |
| `Dockerfile` + `Dockerfile.node20`, `docker-compose.yml` + `docker-compose.node20.yml` | byte-identical pairs; canonical compose points at `Dockerfile.node20` | **DUPLICATE** |
| `SERVER-SPEC.md` + `docs/SERVER-SPEC.md` | byte-identical | **DUPLICATE** |
| `Caddyfile` (root) + `deploy/nginx/*` + `server-config/reverse-proxy.conf` | three reverse-proxy shapes | **unresolved canonical proxy** |

**Legacy path-level comparison:** 93 legacy API routes → only **2** have no root counterpart (`api/automation/cron`, `api/automation/tool`; both are superseded by `src/app/api/cron` + `src/app/api/operations`). 16 legacy pages → only `login`/`register` have no root counterpart by that path (root uses route groups `src/app/(auth)/login` and `src/app/(auth)/register`). Only **7** of 227 legacy `src/` files are unique by path and all 7 have canonical equivalents. **0** legacy Prisma models are missing from the root schema.

**References that block a naive deletion:** 35 canonical files contain 91 lines pointing at `alo-hosting-portal/` or `alo-server-kit/`; `helpers/install-helpers.sh` and `scripts/install.sh` read `server-config/`; `tests/server-agent-deploy-ssl-dns.test.ts` reads `server-helpers/`; `tests/security-hardening-audit.test.ts` reads `alo-server-kit/`; `tests/deploy-pipeline.test.ts` and `.github/workflows/ci-cd.yml` assert the literal `find scripts helpers server-helpers …` command. All of these must be rewired in the merge.

**Duplicate code beyond whole trees:** 5 byte-identical 2-line wrappers under `src/app/(dashboard)/sites/[id]/{deployments,domains,env,logs,settings}/page.tsx`; 181 identical-content groups overall.

---

## 3. Dependencies, packages, configuration

| Check | Result | Evidence |
|---|---|---|
| `npm ci` | **PASS** (exit 0) | 648 packages, Prisma client generated |
| Missing relative imports | **0** | static resolver |
| Broken exports | **0** | `tsc --noEmit` exit 0 |
| Missing declared packages | **2 real** | `js-yaml` is imported by `tests/deploy-pipeline.test.ts` and `tests/release-activation.test.ts` but is only a transitive dependency (undeclared); `docx` is imported by `scripts/generate-dev-guide.js` and is **not installed at all** |
| Undeclared imports in legacy example | `socket.io`, `socket.io-client` in `alo-hosting-portal/examples/websocket/*` (legacy tree only) |
| `npm audit` | **FAIL — 8 moderate vulnerabilities** (0 high/critical) | `minimatch@10.2.6` inside `@typescript-eslint/typescript-estree` (GHSA-g3hv-75wg-m249, `>=7.0.0 <11.0.1`); propagates to 7 `@typescript-eslint/*` / `eslint-config-next@16.4.3` packages. `npm audit fix` would downgrade `eslint-config-next` to 15.x (unacceptable for Next 16) |
| Declared dependencies | 63 prod + 19 dev (root); legacy app has a second 62/14 dependency set | `package.json` |
| `.env.example` keys | 74 keys, **14 duplicated** (`LLM7_API_KEY`, `GROQ_API_KEY`, `AI_GATEWAY_URL`, `GLM_BASE_URL`, …) with **conflicting values** in 4 cases | audit scan |
| Env vars read by code | **102** distinct `process.env.X` names | static scan of all TS/JS/MJS |
| **Missing env documentation** | **85 used variables are undocumented** in `.env.example`, including security-critical `CRON_SECRET`, `CSRF_SECRET`, `DEPLOY_WEBHOOK_SECRET`, `CRM_INTEGRATION_SIGNING_KEY`, `CLOUDFLARE_API_TOKEN`, `CLOUD_DATA_DIR`, `ALLOW_PREVIEW_EMBED`, `CORS_ALLOWED_ORIGINS`, `E2E_DB` | static scan |
| Documented but unused (static scan) | 57 keys (many are read dynamically via `process.env[name]` / config validators — not a defect by itself) |
| Placeholder secret values in `.env.example` | 4 (`NEXTAUTH_SECRET`, `JWT_SECRET`, `APP_ENCRYPTION_KEY`, `INTERNAL_SECRET`) — intentional, and `src/lib/config/production-config.ts` refuses to start with them in production |
| Missing config files | `.env.example`, `next.config.ts`, `tsconfig.json`, `eslint.config.mjs`, `vitest.config.ts`, `postcss.config.mjs`, `tailwind.config.ts`, `components.json`, `.dockerignore`, `Dockerfile`, 2 compose files, `Caddyfile`, `deploy/**` all exist. **Missing:** a single canonical proxy declaration and a declared devDependency for `js-yaml` |

---

## 4. APIs, pages, frontend/backend wiring

| Check | Result | Evidence |
|---|---|---|
| Missing APIs / backend routes | **0** | 198 frontend `/api/...` references; all resolve to an existing `route.ts` |
| Missing frontend pages | **0** | 77 pages exist; build generated 221 static pages and all 246 dynamic handlers |
| Broken internal links (markdown) | **1** | `docs/SELF-HOSTED-ACCEPTANCE-GATE.md` → `../MERGE-AND-RELEASE-STATUS-2026-11-02.md` (file is in `docs/`, so the relative target does not exist) |
| Broken images / public assets | **0** | all `/public` references resolve; `public/` contains 3 assets |
| Live HTTP probe (standalone server, port 3101) | **PASS** | `/` 200, `/login` 200, `/register` 200, `/projects` 200, `/api/health` 200 (`databaseStatus: connected`, `schemaStatus: current`), `/api/csrf` 200, `/api/ai/status` 401, `/api/dashboard/stats` 401, `/api/sites` 401, `/api/users` 401 |
| Security headers on live response | **PASS** | `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`, `HSTS`, `X-Permitted-Cross-Domain-Policies` all present; **no `Content-Security-Policy`** |
| Auth round-trip | **PASS but INSECURE** | `POST /api/auth/login` with `admin@alolabs.net` / `[redacted historical default]` returned 200 with a full SUPER_ADMIN permission set — the committed dev DB and the login page ship known credentials |

---

## 5. Database, models, migrations

| Check | Result | Evidence |
|---|---|---|
| `PRAGMA integrity_check` on `db/custom.db` | **PASS** (`ok`) | libSQL query |
| DB tables with no model | **0** | 91 tables, all mapped |
| **Missing DB tables** | **28** of 119 model tables are absent from the tracked dev DB (`cloud_*`, `service_credentials`, `ai_capability_requests`, …) | `prisma/schema.prisma` `@@map` names vs `sqlite_master` |
| Missing migrations | **0 files**; 15 additive migrations exist but **have not been applied to the tracked fixture DB** | migration inventory |
| Missing models | **0** | 119 canonical models cover all 55 legacy models |
| DB connection in app | **PASS** | `src/lib/db.ts` uses `@prisma/adapter-libsql` for `file:` URLs; live health probe returned `connected` |
| Production DB placement | Config exists (`file:/var/lib/alo-hosting/…`), script `scripts/init-production-db.sh` rotates the admin password | **BLOCKED** — no host to verify |
| Committed database risk | **FAIL (security)** | `db/custom.db` (2.0 MB) is tracked and contains 3 seeded users with published passwords; `prisma/seed.ts` prints those passwords to stdout; `scripts/e2e-smoke.mjs` hardcodes `[redacted historical default]` |

---

## 6. Authentication, authorization, validation, security

| Area | Status | Evidence / gap |
|---|---|---|
| Authentication logic | **PRESENT + LIVE VERIFIED** | NextAuth JWT (`src/lib/nextauth.ts`), credentials login, MFA/TOTP (`/api/user/mfa/*`), session route, registration, verify-email, SSO route; login round-trip 200 |
| Authorization logic | **PRESENT** | `src/lib/auth.ts` RBAC, `src/middleware.ts` admin/API gating, tenant-scope helpers (`canAccessWebsite`, `assertWebsiteAccess`), `tests/phase1-auth-rbac.test.ts`, `tests/phase2-security-and-routes.test.ts`, `tests/security-hardening-audit.test.ts` |
| Validation | **PRESENT** | Zod schemas throughout; `src/lib/config/production-config.ts` placeholder rejection verified live (server refused to start with a placeholder key) |
| CSRF / rate limiting / SSRF guards | **PRESENT** | `src/lib/security/csrf.ts`, `src/middleware.ts` (3 bounded maps), `src/lib/security/url-guard.ts`, `/api/csrf`; 401/403/429 header propagation |
| **Security defects found** | **6** | (1) known super-admin password in tracked DB + seed + e2e script; (2) `/login` renders demo-account buttons with `[redacted historical default]`/`[redacted historical default]`/`[redacted historical default]` in the **production** bundle; (3) 8 moderate dependency advisories; (4) no CSP header; (5) legacy duplicate trees contain outdated/unsafe code that is still shipped in the repo (`alo-hosting-portal/src/app/api/automation/*`); (6) 4 diverging copies of the sudoers policy — drift risk for a privileged component |
| Privileged helper safety | Source uses `execFile` (no `exec()`/`eval()` in canonical `src/`), `bash -n` 106/106 PASS | **BLOCKED** — no Ubuntu host, no sudoers validation (`visudo` absent) |
| Secrets in git | `.env*` ignored; no live secret found in source; historical audit docs mention a rotated secret from commit `fa37b00` | rotation is an operator action, not verifiable here |

---

## 7. Deployment, Docker, Ubuntu, backup, monitoring, logging, SSL, production optimization

| Item | Exists? | Verified? | Finding |
|---|---|---|---|
| Deployment files | YES — `.github/workflows/ci-cd.yml` (verify/build/preflight/deploy, digest-verified artifact, approval gate), `scripts/deploy-*.sh`, `DEPLOY.md`, `docs/DEPLOYMENT-AND-ROLLBACK.md` | Partial | CI YAML parses (`js-yaml` load in tests); `README.md` references a non-existent `deploy.yml` |
| Docker files | YES — `Dockerfile`, `Dockerfile.node20`, `docker-compose.yml`, `docker-compose.node20.yml`, `.dockerignore` | **BLOCKED** | No `docker` binary/daemon; files are byte-identical duplicates and canonical compose references the `.node20` file |
| Ubuntu scripts | YES — `helpers/install-ubuntu-server.sh`, `install-scripts/*.sh`, `scripts/bootstrap-server.sh`, `scripts/install-alo-portal.sh`, `scripts/deploy-alo-portal.sh`, `alo-server-kit/setup.sh` + 8 stages | Syntax only | `bash -n` **106/106 pass**; **5 different installers** target 3 different app directories (`/opt/application`, `/opt/alo-hosting-portal`, `/opt/alo-panel`) — no single canonical path |
| Backup system | YES — `scripts/backup.sh`, `scripts/db-backup.mjs`, `scripts/db-restore.mjs`, `scripts/restore.sh`, `helpers/alo-site-backup`, `helpers/alo-site-restore`, `alo-server-kit/backup.sh`/`restore.sh`, `/api/backups` | Tests only | `tests/backup-restore.test.ts` passes; **no host backup/restore rehearsal** |
| Monitoring | YES — `/api/health`, `/api/monitoring/{check,collect,metrics}`, `scripts/server-doctor.sh`, `scripts/healthcheck.sh`, `alo-server-kit/status.sh`/`verify.sh` | Partial | live `/api/health` 200; `server-doctor.sh` correctly reports 9 FAIL / 11 WARN because **no production host exists in this sandbox** (expected, not a code defect) |
| Logging | YES — `src/lib/logger.ts` (pino), audit-log routes/models, systemd journal units, nginx access/error logs | Partial | logs are structured; no long-running log pipeline to inspect |
| SSL configuration | YES — `deploy/nginx/hosting.alolabs.net.conf` (443 + Let's Encrypt paths + ACME challenge), `helpers/alo-ssl-helper`, `helpers/ssl-lifecycle.sh`, `/api/ssl/*` | **BLOCKED** | `certbot` absent, no certificate, no DNS; HSTS header verified live |
| PM2 / Caddy / Nginx | Config exists (`alo-server-kit/configs/pm2/ecosystem.config.cjs`, `Caddyfile`, `deploy/nginx/*`) | **BLOCKED** | all four binaries absent |
| Production optimizations | Partial | **2 real defects** | `npm run build` emits 2 Turbopack warnings: dynamic `path.resolve()` in `src/app/api/storage/buckets/route.ts:32` and `src/lib/cloud/foundation.ts:43` cause **the whole repository to be traced into `.next/standalone`** (nft.json lists the legacy app, lockfiles, docs, `.db` files). Also 1 deprecation warning for `src/middleware.ts` (Next 16 wants `src/proxy.ts`) |
| Documentation | YES — 81 docs + 6 root-level guides | Stale | `PRODUCTION-AUDIT-REPORT.md` (2026-10-25) claims "not LEVEL 1" while `docs/UNIFIED_PROJECT_FINAL_AUDIT.md` claims "0 vulnerabilities"; both contradict today's measurements. 1 broken relative link |

---

## 8. Error / defect register (measured, not assumed)

| Category | Result | Evidence |
|---|---|---|
| **Build errors** | **0 errors**, 2 warnings | `npm run build` exit 0, 221 static pages, 2 Turbopack tracing warnings, 1 middleware deprecation warning |
| **TypeScript errors** | **0** | `npm run typecheck` exit 0 (run alone with 2 GB heap; concurrent runs with build/tests were OOM-killed, exit 137 — a sandbox memory limit, not a code error) |
| **ESLint errors** | **0** | `npm run lint` exit 0 |
| **Runtime errors** | **0 in probe** | standalone server: 4 public pages + 6 API endpoints returned expected 200/401 |
| **Database errors** | **1** | 28 model tables missing from the tracked fixture DB (schema drift) |
| **API errors** | **0** | all 198 frontend API references resolve; protected endpoints correctly 401 |
| **Authentication errors** | **1 security** | known credentials work against the shipped DB |
| **Test / runtime suite errors** | **1** | `npm test`: **968/969 pass, 1 FAIL** — `tests/deploy-pipeline.test.ts > validates every shell program in CI` exceeds the default 5,000 ms Vitest timeout while running 40+ `bash -n` checks; also 1 config-loader warning (ESM-in-CJS `vitest.config.ts`) |
| **Deployment errors** | **0 in code**, host **BLOCKED** | CI YAML parses; no self-hosted runner, no host env file, no systemd unit installed here |
| **Docker errors** | **BLOCKED** | no daemon/binary; duplicate Dockerfile pairs are a config defect |
| **Ubuntu errors** | **BLOCKED** | no Ubuntu host; 5 competing installers are a config defect |
| **PM2 errors** | **BLOCKED** | PM2 absent; config exists |
| **Caddy/Nginx errors** | **BLOCKED** | binaries absent; config files parse by inspection; 1 unresolved canonical proxy choice |
| **Security issues** | **6** | listed in §6 + 8 npm advisories |
| **Performance issues** | **3** | whole-repo tracing (2 sources), in-memory rate-limit state (single-node only), 3.9 GB heap pressure when build/typecheck/tests run concurrently |
| **Memory leaks** | **0 detected** | no unbounded global growth in static review; rate-limit maps are capped at 10,000 entries; **no long-running soak test performed** → not fully verifiable |
| **Broken links** | **1** | `docs/SELF-HOSTED-ACCEPTANCE-GATE.md` |
| **Broken images** | **0** | asset scan |
| **Dead code / unused files** | **≥ 25** | one-off generator scripts in `scripts/` (`generate-*.py`, `create-zip.*`, `create-full-zip.py`, `fix-colors.py`, `gen.py`, `generate-dev-guide.js`, …) are referenced by nothing in CI, package scripts or tests; several need uninstalled Python/`docx` packages |
| **Duplicate code** | **181 groups / 203 redundant files** | SHA-256 grouping; 5 identical page wrappers; 4 identical sudoers files; 2 identical Docker pairs; 2 identical SERVER-SPEC files; 3 copies of 19 helpers |
| **Unused packages** | **0 confirmed / 3 unverified** | root `npm ls --depth=0` is clean; `pg` is declared only in the legacy app (unused in canonical SQLite app); `docx`/`z-ai-web-dev-sdk` appear in a generator script that cannot run |

---

## 9. Verification matrix (baseline)

| Command | Exit | Notes |
|---|---:|---|
| `npm ci` | 0 | 648 packages |
| `npm run lint` | 0 | 0 errors |
| `npm run typecheck` | 0 | 0 diagnostics |
| `npm run build` | 0 | 2 warnings |
| `npm test` | **1** | 968/969 pass, 1 timeout |
| `npm audit` | **1** | 8 moderate |
| `npm run config:validate` | 0 | correctly reports unset secrets in this sandbox |
| `bash -n` over 106 shell programs | 0 | 106/106 |
| static import resolution | 0 | 0 broken imports |
| live standalone HTTP probe | 0 | 10 endpoints |
| `scripts/server-doctor.sh` | 0 | 9 FAIL / 11 WARN — **no production host in sandbox** |
| Docker / PM2 / Nginx / Caddy / certbot / UFW | — | **NOT VERIFIABLE — binaries and host absent** |

---

## 10. Fix plan (ordered, all items must be re-verified)

1. **Merge the trees into one project:** retire `alo-hosting-portal/` (port nothing — all 7 path-unique files have canonical equivalents), move `alo-server-kit/` into `deploy/server-kit/`, delete `server-helpers/`, `server-config/`, `install-scripts/` after preserving the unique `configure-email.sh`, delete the `.node20` Docker duplicates and the duplicate `docs/SERVER-SPEC.md`, and rewire every reference (CI workflow, tests, installers, docs, `tsconfig.json`).
2. **Fix measured defects:** `js-yaml` devDependency, `npm audit` via a scoped `minimatch` override, `.env.example` duplicate/missing keys, 28-table schema drift, Vitest timeout + config-loader warning, 2 Turbopack tracing warnings, `proxy.ts` migration, broken doc link, stale docs/README claims.
3. **Fix security:** remove known credentials from the tracked DB + seed + login page + e2e smoke script; add a report-only CSP; consolidate sudoers to one policy.
4. **Consolidate deployment:** one canonical Ubuntu provisioning entrypoint, one proxy declaration, one backup/restore path, one packaging script; delete dead generator scripts.
5. **Re-audit:** re-run every command in §9, re-run the static scan, re-run the live HTTP probe, and publish `AUDIT-REPORT-FINAL.md` with before/after numbers. Items that remain `BLOCKED` will stay explicitly `NOT VERIFIED` and will **not** be marked complete.

---

## 11. What this audit cannot claim (and will not claim as complete)

Real Ubuntu 22.04/24.04 provisioning, `ufw`, `systemd` unit activation, PM2 process management, Nginx/Caddy runtime, Certbot issuance/renewal, Cloudflare Tunnel, DNS/registrar integration, Postfix/Dovecot mail, Docker image build/container run, self-hosted GitHub Actions runner, live external AI providers, multi-node rate limiting, and long-running memory/soak behaviour. None of these can be exercised from this sandbox; their configuration can be validated, but their **operation cannot be marked complete**.
