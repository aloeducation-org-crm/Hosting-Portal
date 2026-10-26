# Unified Project Baseline Audit (`docs/UNIFIED_PROJECT_BASELINE_AUDIT.md`)

- **Audit Timestamp**: `2026-10-27` (`Asia/Dhaka`, UTC+6)
- **Audited GitHub Account**: `aloeducation-org-crm` (`User`; `0` accessible GitHub organizations)
- **Audited Repository**: `aloeducation-org-crm/Hosting-Portal` (`https://github.com/aloeducation-org-crm/Hosting-Portal`)
- **Base Commit (`main`)**: `3d94abea43e2dfc2f3b2b3b0cf10fdd11c3c50f7`
- **Active Working Branch**: `arena/c2523ce5-hosting-portal`
- **Audit Mode**: **100% Read-Only Phase One Baseline** — saved prior to any Phase Two code, configuration, dependency, schema, database, or script repairs. All secret values are redacted (`[REDACTED]`).

---

## 1. Scope & Counting Methodology

### 1.1 Accessible Repository Discovery
Queried live via `gh api user`, `gh api user/orgs`, `gh repo list aloeducation-org-crm --limit 100`, and `gh api user/repos?per_page=100`:

| Repository | Visibility | Default Branch | HEAD SHA | Open PRs | Merged PRs | Open Issues | Latest CI Run |
|---|---|---|---|---:|---:|---:|---|
| `aloeducation-org-crm/Hosting-Portal` | Public | `main` | `3d94abea43e2dfc2f3b2b3b0cf10fdd11c3c50f7` | `0` | `9` (`#1`–`#9`) | `0` | `40272424240` (`CI and production deploy` — `success`, `2026-10-26T05:05:50Z`) |

- **Inaccessible / External Hosts**: Live production server (`hosting.alolabs.net` / self-hosted runner host) is outside sandbox outbound network scope (`github.com`, `api.github.com`, `codeload.github.com`, `registry.npmjs.org`, `pypi.org`, `files.pythonhosted.org`). Live host SSH/PM2/Nginx inspection is explicitly marked `BLOCKED` (sandbox network boundary) and never counted as `PASS`.

### 1.2 Filesystem Counting Methodology
Walked `/home/user/Hosting-Portal` recursively via Python `os.walk` + `git ls-files`, excluding `.git/`, `node_modules/`, and `.next/` build caches:

| Metric | Baseline Count | Notes |
|---|---:|---|
| Total workspace files (excluding `.git`, `node_modules`, `.next`) | **899** | `889` Git-tracked + `10` untracked working-tree files from verified self-hosted AI agent module |
| Total workspace directories (excluding `.git`, `node_modules`, `.next`) | **461** | Across 15 top-level directories + repository root |
| Hidden directories | **1** | `.github` |
| Hidden files | **10** | `.dockerignore`, `.env.example`, `.gitignore`, `db/.gitkeep`, `alo-hosting-portal/.dockerignore`, `alo-hosting-portal/.env.example`, `alo-hosting-portal/db/.gitkeep`, `alo-hosting-portal/.gitignore`, `alo-hosting-portal/mini-services/.gitkeep`, `alo-server-kit/.gitignore` |
| Empty (`0`-byte) files | **5** | `db/.gitkeep`, `scripts/create-zip.sh`, `alo-hosting-portal/db/.gitkeep`, `alo-hosting-portal/mini-services/.gitkeep`, `alo-hosting-portal/scripts/create-zip.sh` |

### 1.3 Top-Level Directory Breakdown

| Path | File Count | Role & Baseline Classification |
|---|---:|---|
| `src/` | `379` | **Canonical** Next.js `16.4.3` App Router portal (`44` UI `page.tsx`, `169` API `route.ts`, `lib/`, `components/`, `middleware.ts`, `instrumentation.ts`) |
| `alo-hosting-portal/` | `313` | **Legacy / Split-Brain Nested Copy** (`227` `src/` files, `55`-model Prisma schema, `8` divergent `src/` files, `9` legacy tests, `7` syntax-broken helpers) |
| `alo-server-kit/` | `47` | **Canonical** 7-stage Ubuntu 22.04 server provisioning, LiteLLM/Ollama, backup/restore, and verification kit (`1` script contains hardcoded secrets — see `SEC-01`) |
| `scripts/` | `40` | Operational, bootstrap, DB-init, deployment, verification, and legacy ZIP/PDF packaging scripts (`1` empty `create-zip.sh`) |
| `helpers/` | `24` | **Canonical** hardened root-owned privileged bash helpers (`19` `alo-*-helper` + `provision-site.sh` + `ssl-lifecycle.sh` + installers + `sudoers-alo`) |
| `(root)` | `23` | `package.json`, `package-lock.json`, `next.config.ts`, `tsconfig.json`, `vitest.config.ts`, `Dockerfile`, `Dockerfile.node20`, `docker-compose.yml`, `docker-compose.node20.yml`, `Caddyfile`, `.env.example`, docs |
| `server-helpers/` | `19` | **Duplicate / Drifted** helper directory (`16` identical to `helpers/`, `3` outdated/broken including `bash -n` failure in `alo-domain-helper:95`) |
| `tests/` | `15` | **Canonical** Vitest test suite (`14` `.test.ts` suites + harness, `117` passing tests) |
| `deploy/` | `11` | **Canonical** production Nginx, Cloudflared, systemd, sudoers, and `.env.example` templates |
| `prisma/` | `7` | **Canonical** `79`-model SQLite `schema.prisma`, `seed.ts`, `migration_lock.toml`, and `4` SQL migrations |
| `docs/` | `6` | Platform architecture, Git autodeploy, host recovery, roadmap, and self-hosted AI agent runbooks |
| `server-config/` | `5` | **Overlapping / Legacy** systemd, reverse-proxy, and sudoers configs (`sudo-policy` has wildcard `systemctl` defect) |
| `install-scripts/` | `4` | Installer/update/rollback/email scripts (`configure-email.sh:131` fails `bash -n`) |
| `public/` | `3` | Brand assets (`logo.svg`, `alolabs-agentos-mark.png`, `robots.txt`) |
| `db/` | `2` | Local SQLite database `db/custom.db` (`75` tables — drifted from `79`-model schema) + `db/.gitkeep` |
| `.github/` | `1` | `.github/workflows/ci-cd.yml` (contains critical `cd alo-hosting-portal` split-brain bug — see `MERGE-01`) |

---

## 2. Sub-Project Overlap & Split-Brain Architecture Analysis

1. **`MERGE-01` (Critical — CI/CD Split-Brain Deployment)**:
   - `.github/workflows/ci-cd.yml` runs `verify` (`lint`, `typecheck`, `test`) and `build` against the **repository root** (`package-lock.json`, `src/`, `prisma/schema.prisma`), verifies `.next/standalone/server.js`, and uploads artifact `hosting-release-${{ github.sha }}`.
   - However, job `deploy` (lines `87–92`) downloads `.deploy-artifact`, **ignores it**, executes `cd alo-hosting-portal 2>/dev/null || true`, and builds/starts the outdated `alo-hosting-portal/` subdirectory (`227` source files, `55` Prisma models) instead of the canonical `379`-file root application.
2. **`MERGE-02` (`alo-hosting-portal/src/` vs Canonical `src/`)**:
   - Out of `227` files in `alo-hosting-portal/src/`, `160` are byte-identical to root `src/`, `59` have newer security/feature upgrades in root `src/`, and `8` exist only in `alo-hosting-portal/src/`:
     - `app/dashboard/webchat/page.tsx` (`177` lines): Multi-agent webchat UI (`nova`, `code-assistant`, `website-builder`, `domain-advisor`) backed by canonical `/api/ai/{chat,code,website,domain-advisor}` routes — **candidate to consolidate into canonical `src/app/dashboard/webchat/page.tsx`**.
     - `app/api/automation/tool/route.ts` (`46` lines): **Critical unauthenticated `exec()` RCE** (`pm2 restart`, `/home/alamin/scripts/alo-backup.sh` with zero session/token check) — **must never be merged unauthenticated; must be remediated**.
     - `app/api/automation/cron/route.ts` (`18` lines): No-op fake-success stub returning hardcoded `tasksRun` with fallback secret `'alo-cron-secret-2026'` — **must be remediated**.
     - `app/login/page.tsx` & `app/register/page.tsx`: Superseded by canonical `src/app/(auth)/login/page.tsx` and `src/app/(auth)/register/page.tsx` (which support MFA challenge, OAuth providers, and Suspense).
     - `lib/deploy/detector.ts` & `lib/deploy/orchestrator.ts`: Superseded by canonical `src/lib/deploy/{detect,config,engine,service,github,boot,types}.ts` (shell-safe `execFile`, atomic symlink cutover, rollback, 37 tests).
     - `lib/automation/audit.ts`: Superseded by canonical `src/lib/audit.ts` (`createAuditLog`).
3. **`MERGE-03` (`helpers/` vs `server-helpers/` & `alo-hosting-portal/server-helpers/`)**:
   - `helpers/` (`24` files) passes `bash -n` `100%` (`23/23` scripts).
   - `server-helpers/` (`19` files) has `3` drifted scripts: `alo-domain-helper` fails `bash -n` at line `95`, `alo-firewall-helper` has corrupted double-quoting `""$1""`, and `alo-ssh-helper` lacks `APP_HOME` root-ownership/mode validation.
   - `alo-hosting-portal/server-helpers/` has `7` scripts failing `bash -n` with truncated EOF quotes and syntax errors.
4. **`MERGE-04` (Duplicate Docker & Sudoers Configs)**:
   - `Dockerfile` and `Dockerfile.node20` are byte-identical; `docker-compose.yml` and `docker-compose.node20.yml` are byte-identical. Neither Dockerfile copies `helpers/` or `prisma/schema.prisma` into the runtime image.
   - `server-config/sudo-policy` grants `aloedu ALL=(root) NOPASSWD: /usr/bin/systemctl restart alo-site-*`, where trailing `*` permits multi-argument unit injection, whereas `deploy/sudoers/alo-hosting-portal` and `helpers/sudoers-alo` enforce strict helper-only execution (`helpers/sudoers-alo` is missing `provision-site.sh` and `ssl-lifecycle.sh`).

---

## 3. Source Architecture, Frontend & Backend Route Inventory

### 3.1 Canonical Frontend Pages (`44` UI `page.tsx` routes)
- **Public & Marketing (`4`)**: `/`, `/login`, `/register`, `/verify-email`
  - **Broken UI Links (`FAIL`)**:
    - `UI-01`: `/pricing` linked from `src/components/alolabs/Header.tsx` and `HeroSection.tsx` -> `404` (no `src/app/pricing/page.tsx`).
    - `UI-02`: `/privacy` linked from `src/components/alolabs/CookieBanner.tsx` -> `404` (no `src/app/privacy/page.tsx`).
    - `UI-03`: `/terms` linked from `src/components/alolabs/AuthModal.tsx` -> `404` (no `src/app/terms/page.tsx`).
- **Authenticated Dashboard & Site Management (`36`)**: `/dashboard`, `/dashboard/{agents,agents/[slug],audit,billing,crm,domains,domains/[id],email,onboarding,plans,servers,settings,users,websites,websites/new,websites/[id]/edit}`, `/ai/{analytics,assistant,automations,builder,self-hosted}`, `/sites`, `/sites/new`, `/sites/[id]`, `/sites/[id]/{deployments,domains,env,logs,settings}`, `/deployments`, `/databases`, `/storage`, `/billing`, `/settings`, `/onboarding`.
- **Admin Route Group (`4`)**: `/audit`, `/plans`, `/servers`, `/users` (guarded by `ADMIN_UI_PREFIXES` in `src/middleware.ts`).
- **Missing Frontend-to-Backend API Contracts (`FAIL`)**:
  - `API-MISSING-01`: `src/components/platform/views/ApplicationsView.tsx:158` calls `GET /api/applications/${id}/logs` -> route missing (`404`).
  - `API-MISSING-02`: `src/app/dashboard/email/page.tsx:115` calls `DELETE /api/email/accounts/${id}` -> route missing (`404`).
  - `API-MISSING-03`: `src/components/platform/views/SSLView.tsx:246` calls `PUT /api/ssl/${cert.id}` -> route missing (`404`; only `PUT /api/ssl` with `domainId` existed).

### 3.2 Canonical Backend API Routes (`169` `route.ts` files)
- **Middleware Gate**: `src/middleware.ts` enforces NextAuth JWT authentication on all `/api/*` paths except `9` `PUBLIC_API_PATHS` (`/api/auth`, `/api/health`, `/api/pricing`, `/api/deploy/webhook`, `/api/internal/sites/ssl-status`, `/api/contact`, `/api/newsletter`, `/api/github/webhook`, `/api/github/callback`).
- **Handler-Level Auth**: `166/169` routes invoke explicit handler auth/signature verification (`requireSession`, `requireAdmin`, `requireSuperAdmin`, `requireRole`, `requirePermission`, `auth()`, HMAC-SHA256, or `timingSafeEqual` token); `3` read-only metadata routes (`/api`, `/api/ai/prompts`, `/api/domains/suggestions`) relied solely on middleware JWT.
- **Stub / Placeholder / Non-Configured Handlers Audited**:
  - `/api/domains/search`: Explicitly returns `501 REGISTRAR_NOT_CONFIGURED` rather than fabricating availability (honest fail-closed behavior — `PASS`).
  - `/api/settings` (`PUT`): Explicitly returns `501 RUNTIME_CONFIGURATION_MANAGED_BY_DEPLOYMENT` (`SUPER_ADMIN` gated — `PASS`).
  - `/api/domains/purchase` & `/api/orders`: Used `Math.random()` for order numbers (`ORD-...`) instead of CSPRNG `crypto.randomBytes`.

---

## 4. Database, Prisma Schema & Migration Audit

- **Configured Provider**: `sqlite` (`prisma/schema.prisma` + `prisma/migrations/migration_lock.toml` + `@prisma/adapter-libsql` in `src/lib/db.ts`).
- **Canonical Models**: `79` models in `prisma/schema.prisma`; `4` migration directories under `prisma/migrations/`.
- **Baseline Local SQLite (`db/custom.db`) Drift (`FAIL` — `DB-01`)**:
  - `db/custom.db` contains only `75` tables and is **missing `4` tables**: `hosting_sites` (`Site`), `git_connections` (`GitConnection`), `git_projects` (`GitProject`), and `webhook_deliveries` (`WebhookDelivery`).
  - `db/custom.db` is **missing `15` columns**:
    - `deployments` (`11` missing): `projectId`, `deliveryId`, `branch`, `commitMessage`, `commitAuthor`, `trigger`, `stage`, `failureStage`, `verifiedCommitSha`, `configSnapshot`, `durationMs`.
    - `servers` (`4` missing): `ipAddress`, `cpuUsage`, `memoryUsage`, `diskUsage`.
  - **Runtime Impact**: Live baseline `GET /api/health` returned **`HTTP 503 Service Unavailable`** (`databaseStatus: "disconnected"`, `schemaStatus: "unavailable"`), while erroneously wrapping the JSON body in `apiSuccess` (`"status": 200, "success": true` — `DB-02`).

---

## 5. Environment Variable & Configuration Audit (All Secrets Redacted)

| File | Purpose | Baseline Findings |
|---|---|---|
| `src/lib/env.ts` | Zod-validated runtime config + production unsafe-secret fail-closed check | `isUnsafeDefaultSecret` checks `REPLACE_WITH_OPENSSL_RAND_HEX_32` case-sensitively, missing lowercase `replace-with-*` placeholders in `deploy/env/alo-hosting-panel.env.example` (`CFG-01`). |
| `.env.example` | Root operator template | Missing `JWT_SECRET`, which is mandatory in `src/lib/env.ts` when `NODE_ENV=production` (`CFG-02`). |
| `deploy/env/alo-hosting-panel.env.example` | Systemd/Docker panel env template | Missing `APP_ENCRYPTION_KEY` and `INTERNAL_SECRET`, causing `src/lib/env.ts` to exit `1` in production if copied verbatim (`CFG-03`). |
| `alo-server-kit/scripts/auto-env-fixer.js` | Legacy env generator | **CRITICAL (`SEC-01`)**: Contains hardcoded plaintext credentials (`PG_PASSWORD=[REDACTED]`, `MYSQL_PASSWORD=[REDACTED]`, `LITELLM_MASTER_KEY=[REDACTED]`, `CRON_SECRET=[REDACTED]`), writes to `alo-hosting-portal/.env` with default `0644` permissions, and emits a `postgresql://` `DATABASE_URL` incompatible with the SQLite Prisma schema. |

---

## 6. Security, RBAC, Tenant Isolation & Infrastructure Audit

### 6.1 Critical & High Findings
1. **`SEC-01` (Critical — Hardcoded Secrets in Tracked Script)**: `alo-server-kit/scripts/auto-env-fixer.js` lines `98–124` embed plaintext database passwords, LiteLLM master key, and cron secret.
2. **`SEC-02` (Critical — Unauthenticated `exec()` RCE in Nested Tree)**: `alo-hosting-portal/src/app/api/automation/tool/route.ts` executes shell commands via `child_process.exec` without authentication; `alo-hosting-portal/src/app/api/automation/cron/route.ts` uses hardcoded fallback secret `[REDACTED]`.
3. **`SEC-03` (Critical — Cross-Tenant IDOR Across Website, File, DNS, SSL, Log, Monitoring & Deployment Routes)**:
   In `prisma/seed.ts`, the `CLIENT` role holds `WEBSITE_READ`, `WEBSITE_UPDATE`, `WEBSITE_DEPLOY`, `WEBSITE_RESTART`, `SSL_MANAGE`, `BACKUP_CREATE`, `BACKUP_READ`, `BACKUP_RESTORE`, `FILE_MANAGE`, and `LOGS_READ`. Unlike `src/app/api/websites/[id]/route.ts` (which checks `website.ownerId !== user.id`), the following canonical routes omitted tenant ownership checks:
   - `src/app/api/network/dns/[id]/route.ts` (`PUT`, `DELETE`) — cross-tenant DNS modification/deletion.
   - `src/app/api/file-manager/route.ts` (`GET`, `POST`, `DELETE`) — cross-tenant file read/upload/rename/delete, **plus** `multipart/form-data` upload bypasses `sanitizePath(relativePath)` and leaks `/tmp/alo-upload-*` temp files (`SEC-04`).
   - `src/app/api/websites/[id]/env/route.ts` (`GET`, `PUT`) — cross-tenant `.env` read & overwrite/wipe.
   - `src/app/api/websites/[id]/backups/route.ts` (`GET`, `POST`) & `backups/[backupId]/restore/route.ts` (`POST`) — cross-tenant backup access & restore.
   - `src/app/api/websites/[id]/deploy/route.ts` (`POST`) & `restart/route.ts` (`POST`) — cross-tenant deploy & service restart.
   - `src/app/api/websites/[id]/suspend/route.ts` & `resume/route.ts` (`POST`) — cross-reseller website suspend/resume without ownership check.
   - `src/app/api/websites/[id]/ssl/route.ts` (`GET`, `POST`), `src/app/api/ssl/route.ts` (`GET`, `POST`, `PUT`, `DELETE`), & `src/app/api/ssl/renew/route.ts` (`POST`) — cross-tenant SSL listing, issuance, modification, renewal, and revocation.
   - `src/app/api/websites/[id]/logs/route.ts` (`GET`, plus unvalidated `lines` arg) & `src/app/api/logs/route.ts` (`GET`) — cross-tenant log disclosure.
   - `src/app/api/logs/center/route.ts` (`GET`) — `CLIENT` access to host-wide `journalctl`, PHP-FPM logs, global `AuditLog` entries, and unvalidated `domain` file path interpolation (`SEC-05`).
   - `src/app/api/deployments/[id]/route.ts` (`GET`) & `src/app/api/deploy/deployments/[id]/route.ts` (`GET` when `projectId === null`) — cross-tenant deployment & build log disclosure.
   - `src/app/api/monitoring/check/route.ts` (`POST`) — cross-tenant localhost port probing & `HealthCheck` overwrite.
   - `src/app/api/deploy/status/route.ts` (`GET`) & `src/app/api/servers/health/route.ts` (`GET`) — cross-tenant commit/path & internal/Tailscale server IP disclosure to `CLIENT` users.
4. **`SEC-06` (High — Open Localhost Port Proxy SSRF in `Caddyfile`)**: `Caddyfile` lines `19–30` proxy any request with `?XTransformPort=<port>` directly to `localhost:<port>`.
5. **`SEC-07` (High — Authenticated SSRF in `/api/ssl/check`)**: `checkLiveSsl(domain)` connects to arbitrary unvalidated hosts/IPs (including `127.0.0.1`, RFC1918, `169.254.169.254`, `localhost`) with `rejectUnauthorized: false`.

### 6.2 Medium Findings
6. **`SEC-08` (Medium — Secret Comparison, Query-String Secret Leak & Key Domain Mixing)**:
   - `src/app/api/operations/worker/route.ts` accepts `?secret=` in URL query parameters (logged by proxies) and compares `INTERNAL_SECRET` with `===`; `deploy/webhook/route.ts` and `monitoring/collect/route.ts` also use `===`/`!==` instead of `timingSafeEqual` and accept default `INTERNAL_SECRET` in non-production.
   - `src/app/api/security/encrypt/route.ts` derives its AES-256-GCM key from `env.JWT_SECRET` instead of `env.APP_ENCRYPTION_KEY`.
7. **`SEC-09` (Medium — Middleware Rate-Limit Gaps, Security Headers & `X-Powered-By`)**:
   - `src/middleware.ts` exempts `/api/auth/*` (except `/api/auth/login`), `/api/contact`, and `/api/newsletter` from rate limiting; omits security headers on `/`, `/login`, `/register`, `/verify-email` and on middleware JSON error responses (`401`/`403`/`429`/`503`); omits `X-Frame-Options`; `next.config.ts` emits `X-Powered-By: Next.js`.
8. **`SEC-10` (Medium — Shell Syntax Failures & Wildcard Sudoers)**:
   - `9` shell scripts fail `bash -n` (`server-helpers/alo-domain-helper`, `install-scripts/configure-email.sh`, and `7` scripts in `alo-hosting-portal/server-helpers/`).
   - `server-config/sudo-policy` contains unsafe trailing-wildcard `systemctl * alo-site-*` rules.
9. **`SEC-11` (Dependency Advisories — `npm audit`)**:
   - `7` advisories (`2 critical` in devDependency `vitest@3.2.7` / `tinypool`, `4 high` in `zod@4.3.6` and devDependency `prisma@6.19.3` / `@prisma/config` / `deepmerge-ts`, `1 moderate` in `@vitest/mocker`).

---

## 7. External Integrations, AI Providers & Self-Hosted Agent Catalog Audit

- **Cloud & Local AI Provider Chain (`src/lib/ai/providers.ts`, `src/lib/ai/client.ts`)**: `10` OpenAI-compatible providers (`unorouter`, `llm7`, `groq`, `gateway`, `ollama`, `localai`, plus opt-in `openrouter`, `qwen`, `glm`, `openai`) with SSRF validation on custom base URLs, `AbortSignal` timeouts, circuit breaker, non-blocking startup when unconfigured, and backward-compatible `resolveProviders({}) -> ['llm7']` (`PASS`).
- **Self-Hosted AI Agent Catalog (`src/lib/ai/self-hosted-agents.ts`)**: `17` audited entries cross-verified against upstream `LICENSE` files and GitHub releases (`2026-10-26`), blocking multi-tenant license traps (`Dify` Clause 1a, `Open WebUI` Clause 4 >50 users branding restriction, `n8n` Sustainable Use License, Docker-socket privilege escalation in `OpenHands`, unmaintained `SuperAGI`), enforcing `127.0.0.1` loopback binding, `--cap-drop=ALL`, `--security-opt=no-new-privileges:true`, `--pids-limit`, `--memory`, `--cpus`, and isolated Docker bridge `alo-ai-net` (`PASS`).
- **Build Tracing Warning (`BUILD-01`)**: `src/lib/deploy/service.ts:20,129` triggers `2` Turbopack dynamic-filesystem project-tracing warnings during `npm run build`, inflating `.next/standalone`.

---

## 8. Baseline Quality & Runtime Verification Matrix

| Check | Command / Target | Baseline Status | Baseline Evidence |
|---|---|---|---|
| Dependency install | `npm ci --no-audit` | **PASS** | `660` packages installed cleanly; Prisma Client `v6.19.3` generated |
| ESLint | `npm run lint` | **PASS** | `0` errors, `0` warnings across `src/` |
| TypeScript | `npm run typecheck` | **PASS** | `tsc --noEmit` exited `0` |
| Unit / Integration / E2E tests | `npm test` | **PASS** | `14/14` suites, `117/117` tests passing (`5.70s`) |
| Production build | `npm run build` | **PASS** (with warnings) | `161` static/dynamic routes compiled; `2` Turbopack dynamic-fs warnings (`src/lib/deploy/service.ts:20,129`) + `1` Next.js `middleware` deprecation notice |
| Prisma schema engine binary (`prisma validate`) | `npx prisma validate` | **BLOCKED** | Sandbox blocks outbound TLS to `binaries.prisma.sh` (`schema-engine` download); schema validated via `@prisma/client` generator + `@prisma/adapter-libsql` |
| Local SQLite schema sync (`db/custom.db`) | Python SQLite vs `prisma/schema.prisma` | **FAIL** | `db/custom.db` has `75/79` tables; missing `4` tables and `15` columns |
| Production secret fail-closed startup | `PORT=3499 npm run start` (default secrets) | **PASS** | Refused startup in production mode when `NEXTAUTH_SECRET`, `JWT_SECRET`, `APP_ENCRYPTION_KEY`, `INTERNAL_SECRET` used defaults |
| Runtime HTTP health (`GET /api/health`) | `curl -i http://127.0.0.1:3499/api/health` | **FAIL** | Returned `HTTP 503` (`databaseStatus: "disconnected"`, `schemaStatus: "unavailable"`) due to `db/custom.db` schema drift + `apiSuccess` envelope bug |
| Runtime HTTP home (`GET /`) & auth gate (`GET /api/websites`) | `curl -i http://127.0.0.1:3499/` & `/api/websites` | **PASS** (functional) / **FAIL** (headers) | `/` returned `200 OK` (`124,305` bytes), `/api/websites` returned `401 Unauthorized`, but both lacked security headers and `/` exposed `X-Powered-By: Next.js` |
| Shell script syntax (`bash -n`) | `bash -n` across `107` shell scripts/helpers | **FAIL** | `98` `PASS`, `9` `FAIL` (`server-helpers/alo-domain-helper`, `install-scripts/configure-email.sh`, `7` in `alo-hosting-portal/server-helpers/`) |
| Dependency vulnerability scan | `npm audit --json` | **FAIL** | `7` vulnerabilities (`2` critical, `4` high, `1` moderate) |
| Docker daemon build/run inside sandbox | `docker info` / `docker compose config` | **BLOCKED** | Docker daemon not running inside sandbox container; Dockerfiles & Compose manifests audited statically |
| Live remote host (`hosting.alolabs.net`) SSH / PM2 / Nginx | Remote production host | **BLOCKED** | Sandbox network restricted to allowlisted package/GitHub hosts |
