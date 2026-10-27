# Unified Project Verification & Test Matrix (`docs/UNIFIED_PROJECT_TEST_MATRIX.md`)

- **Date**: `2026-10-27` (`Asia/Dhaka`, UTC+6)
- **Repository**: `aloeducation-org-crm/Hosting-Portal` (`arena/c2523ce5-hosting-portal`)
- **Status Taxonomy**: Strictly labeled `PASS`, `FAIL`, `BLOCKED`, `NOT RUN`, or `NOT APPLICABLE`. Zero unexecuted or blocked checks are claimed as `PASS`.

---

## 1. Automated Quality, Static Analysis, Build & Dependency Gates

| Gate ID | Category | Command / Verification Method | Baseline (Phase One) | Final (Phase Three) | Evidence |
|---|---|---|---|---|---|
| `Q-01` | Dependency Install & Prisma Client Generation | `npm install --no-fund` (`postinstall`: offline `prisma generate`) | **PASS** (`660` pkgs) | **PASS** (`649` pkgs) | Prisma Client `v6.19.3` generated cleanly in `407ms` |
| `Q-02` | ESLint Static Analysis | `npm run lint` (`eslint src/`) | **PASS** | **PASS** | `0` errors, `0` warnings across all `src/` files |
| `Q-03` | TypeScript Strict Typecheck | `npm run typecheck` (`tsc --noEmit`) | **PASS** | **PASS** | `0` TypeScript errors across `388` `src/` files and `16` `tests/` files |
| `Q-04` | Automated Vitest Test Suites | `npm test` (`vitest run` `v5.0.5`) | **PASS** (`14` suites, `117` tests) | **PASS** (`15` suites, `128` tests) | `15/15` suites, `128/128` tests passing (`4.66s`, `0` skipped, `0` failed) |
| `Q-05` | Production Next.js Build | `npm run build` (`next build` `16.4.3` Turbopack) | **PASS** (with `2` `TP1004` warnings) | **PASS** (`0` `TP1004` warnings) | `165/165` static routes generated; `.next/standalone/server.js` produced with `0` Turbopack dynamic-FS tracing warnings |
| `Q-06` | Dependency Vulnerability Audit | `npm audit --json` | **FAIL** (`7` vulns: `2` critical, `4` high, `1` moderate) | **PASS** (`0` vulnerabilities) | `{"info":0,"low":0,"moderate":0,"high":0,"critical":0,"total":0}` across `649` audited packages |
| `Q-07` | Shell & Privileged Helper Syntax | `bash -n` across all `.sh` & `alo-*` helper scripts | **FAIL** (`98` PASS / `9` FAIL) | **PASS** (`121` PASS / `0` FAIL) | `121/121` shell & helper scripts pass `bash -n` across `helpers/`, `server-helpers/`, `alo-hosting-portal/`, `alo-server-kit/`, `install-scripts/`, `scripts/` |
| `Q-08` | Repository Secret Scan | Regex scan across all working files (excl. `.git`, `node_modules`, `.next`, `docs`, `tests`) | **FAIL** (`SEC-01`, `SEC-02`) | **PASS** | `0` hardcoded credentials, API keys, or private keys in working tree |
| `Q-09` | SQLite Schema & Data Integrity | `@libsql/client` introspection vs `prisma/schema.prisma` (`79` models) + `PRAGMA integrity_check` | **FAIL** (`75/79` tables, `15` missing cols) | **PASS** (`79/79` tables, `0` missing cols) | `prismaModels: 79`, `sqliteTables: 79`, `missingTables: []`, `totalRows: 177`, `integrity_check: "ok"` |
| `Q-10` | Prisma Remote Binary Download (`npx prisma validate`) | `npx prisma validate` (default network engine download) | **BLOCKED** | **BLOCKED** | Sandbox network allowlist excludes `binaries.prisma.sh`; schema AST validated offline via `npm run db:generate` (`PASS`) and `npm run db:sync` (`PASS`) |
| `Q-11` | Docker Daemon Build / Compose Runtime | `docker build` / `docker compose up` | **BLOCKED** | **BLOCKED** | No Docker daemon inside sandbox; `Dockerfile`, `Dockerfile.node20`, `docker-compose*.yml`, and `alo-docker-helper` audited statically (`PASS`) |
| `Q-12` | Live Remote Host SSH / PM2 / Nginx / TLS (`hosting.alolabs.net`) | Remote host inspection | **BLOCKED** | **BLOCKED** | Sandbox network restricted to GitHub/npm/PyPI hosts; deployment & rollback runbook prepared in `docs/UNIFIED_PROJECT_DEPLOYMENT_AND_ROLLBACK.md` |

---

## 2. Vitest Automated Test Suite Breakdown (`15` Suites / `128` Tests)

| Suite File | Tests | Scope Covered | Status |
|---|---:|---|---|
| `tests/phase2-security-and-routes.test.ts` | `11` | **New Phase Two Regression Suite**: `canAccessWebsite`/`assertWebsiteAccess` tenant isolation, constant-time `verifyInternalSecretValue` + placeholder rejection, `/api/operations/worker` & `/api/monitoring/collect` `401` guards, `/api/deploy/webhook` `503`/`401` fail-closed secret verification, cross-tenant DNS `403` vs owner `200`, `/api/logs/center` path-traversal `400` + host-log `403`, `/api/ssl/check` `127.0.0.1`/`localhost` SSRF `400`, `/api/ai/prompts` & `/api/domains/suggestions` `401`, `/api/applications/[id]/logs` + `/api/email/accounts/[id]` + `/api/ssl/[id]` auth/IDOR/owner flows, middleware security headers on `401`/`429`, and `/api/contact` `10 req/min` rate limit | **PASS** |
| `tests/ai-providers.test.ts` | `15` | Provider chain resolution (`resolveProviders({}) -> ['llm7']`), priority ordering, SSRF URL normalization, key handling | **PASS** |
| `tests/self-hosted-agents.test.ts` | `13` | 17-entry self-hosted AI agent catalog, license/commercial hosting guardrails (`Dify`, `Open WebUI`, `n8n`, `OpenHands`), hardware sizing (`2xA100 80GB` FP8 KV), loopback port isolation | **PASS** |
| `tests/ai-automation.test.ts` | `12` | AI workflow engine, tool registry execution, error boundaries, audit hooks | **PASS** |
| `tests/ai-security-and-routes.test.ts` | `11` | Cloud metadata SSRF block (`169.254.169.254`, `100.100.100.200`), internal topology redaction, log secret scrubbing, container flag/port/env security, tenant-scoped AI tools, agent API `401` gates | **PASS** |
| `tests/deploy-detect.test.ts` | `11` | Framework/runtime autodetection (Next.js, Vite, Astro, Remix, Node, Python, PHP, Static, Docker) & ambiguity flags | **PASS** |
| `tests/ai-client.test.ts` | `10` | `completeWithAI()` failover, circuit breaker, redirect blocking, timeout handling, strict `AIUsage` shape | **PASS** |
| `tests/deploy-config.test.ts` | `10` | Deployment command/env sanitization, shell-injection rejection, port/path bounds | **PASS** |
| `tests/deploy-e2e.test.ts` | `9` | Real Git clone -> detect -> build -> package -> atomic symlink cutover -> live HTTP commit verification -> failed-build preservation -> rollback | **PASS** |
| `tests/deploy-github-api.test.ts` | `7` | GitHub webhook `HMAC-SHA256` signature verification, replay/delivery deduplication, OAuth CSRF state checks | **PASS** |
| `tests/phase1-auth-rbac.test.ts` | `7` | Role hierarchy (`SUPER_ADMIN`..`VIEWER`), middleware route guards, AES-256-GCM encryption symmetry, sliding rate limiter | **PASS** |
| `tests/helpers.test.ts` | `5` | `callHelper()` allowlist enforcement, argument validation, non-shell `execFile` invocation | **PASS** |
| `tests/ai-extra-providers.test.ts` | `3` | Optional `openrouter`, `qwen`, and `glm` provider registration | **PASS** |
| `tests/ssh-key.test.ts` | `3` | OpenSSH public key format, fingerprint, and option-injection rejection | **PASS** |
| `tests/ai-provider.test.ts` | `1` | Default AI provider smoke contract | **PASS** |

---

## 3. Live Production Standalone Server HTTP Probes (`node .next/standalone/server.js`, Port `3599`)

Executed with `NODE_ENV=production`, ephemeral 256-bit CSPRNG secrets (`NEXTAUTH_SECRET`, `JWT_SECRET`, `APP_ENCRYPTION_KEY`, `INTERNAL_SECRET`, `DEPLOY_WEBHOOK_SECRET`), and `DATABASE_URL="file:/home/user/Hosting-Portal/db/custom.db"`:

| Probe Target | Method | Baseline Result | Phase Three Result | Security Headers (`nosniff`, `SAMEORIGIN`, `HSTS`) | `X-Powered-By` | Verdict |
|---|---|---|---|---|---|---|
| `/` (Landing Page) | `GET` | `200` (missing headers, `X-Powered-By: Next.js`) | **`HTTP 200`** | Present | Absent | **PASS** |
| `/pricing` | `GET` | `404 Not Found` (`UI-01`) | **`HTTP 200`** | Present | Absent | **PASS** |
| `/privacy` | `GET` | `404 Not Found` (`UI-02`) | **`HTTP 200`** | Present | Absent | **PASS** |
| `/terms` | `GET` | `404 Not Found` (`UI-03`) | **`HTTP 200`** | Present | Absent | **PASS** |
| `/api/health` | `GET` | `503` (`databaseStatus: "disconnected"`, `schemaStatus: "unavailable"`) | **`HTTP 200`** (`databaseStatus: "connected"`, `schemaStatus: "current"`) | Present | Absent | **PASS** |
| `/api/websites` (unauthenticated) | `GET` | `401` (missing security headers) | **`HTTP 401`** | Present | Absent | **PASS** |
| `/api/operations/worker` (unauthenticated) | `POST` | `401` (accepted `?secret=` query param & `===`) | **`HTTP 401`** | Present | Absent | **PASS** |
| `/api/deploy/webhook` (unauthenticated) | `POST` | `401` (`===` check) | **`HTTP 401`** | Present | Absent | **PASS** |
| `/api/ssl/check?domain=127.0.0.1` (unauthenticated) | `GET` | `401` (SSRF if authed) | **`HTTP 401`** (`400` if authed) | Present | Absent | **PASS** |
| `/dashboard` (unauthenticated UI guard) | `GET` | `307` (missing security headers) | **`HTTP 307` -> `/login?callbackUrl=%2Fdashboard`** | Present | Absent | **PASS** |
| Production startup with placeholder secrets | Process boot | `Exit 1` | **`Exit 1` (fail-closed)** | N/A | N/A | **PASS** |
