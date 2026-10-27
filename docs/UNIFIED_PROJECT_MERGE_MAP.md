# Unified Project Merge Map (`docs/UNIFIED_PROJECT_MERGE_MAP.md`)

- **Date**: `2026-10-27` (`Asia/Dhaka`)
- **Repository**: `aloeducation-org-crm/Hosting-Portal`
- **Canonical Application Root**: `/home/user/Hosting-Portal` (`src/`, `prisma/`, `helpers/`, `deploy/`, `alo-server-kit/`, `tests/`)

---

## 1. Consolidation Principles Applied

1. **Compare Before Touching**: Every divergent file across `src/`, `alo-hosting-portal/`, `helpers/`, `server-helpers/`, `deploy/`, `server-config/`, `install-scripts/`, `scripts/`, and `alo-server-kit/` was diffed and syntax/security-audited in Phase One before deciding canonical ownership.
2. **Preserve Working Routes, Data & Backward-Compatible Contracts**:
   - Preserve all existing UI pages, API endpoints, Prisma models (`79` models, `sqlite` provider), and prior verified self-hosted AI agent & rollback capabilities.
   - Preserve backward-compatible contracts (`resolveProviders({}) -> ['llm7']`, `redactProvider()` default `includeTopology = true`, `completeWithAI()` `result.usage = { promptTokens, completionTokens, totalTokens }`).
3. **Never Merge Vulnerable Legacy Code**: Legacy files containing unauthenticated `exec()` RCE or hardcoded secrets are remediated rather than blindly copied into canonical `src/`.

---

## 2. Sub-Project & Directory Merge Map

| Domain / Sub-Tree | Canonical Source of Truth | Overlapping / Duplicate Source(s) | Comparison Summary | Merge & Reconciliation Action |
|---|---|---|---|---|
| **Next.js Portal Application** | `src/` (`379` files at baseline) | `alo-hosting-portal/src/` (`227` files) | `160` files identical; `59` files strictly newer/hardened in root `src/`; `8` files exist only in `alo-hosting-portal/src/` | Keep root `src/` as canonical. Consolidate `/dashboard/webchat` (`src/app/dashboard/webchat/page.tsx`) into canonical `src/` with authenticated AI endpoint integration; remediate the unauthenticated RCE/stub routes inside `alo-hosting-portal/src/app/api/automation/{tool,cron}/route.ts` so no unsafe code remains in the repo. |
| **CI/CD Production Pipeline** | `.github/workflows/ci-cd.yml` | `alo-server-kit/configs/github-actions/deploy.yml` | `.github/workflows/ci-cd.yml` verified & built root, then ran `cd alo-hosting-portal 2>/dev/null \|\| true` during `deploy`, deploying the stale nested copy! | Remove `cd alo-hosting-portal` from `.github/workflows/ci-cd.yml` so CI deploys the canonical root release artifact / checkout (`$APP_DIR`), verifies schema migration/sync safely, restarts PM2/systemd cleanly, and checks `/api/health`. |
| **Prisma Schema & Local DB** | `prisma/schema.prisma` (`79` models, `sqlite`) | `alo-hosting-portal/prisma/schema.prisma` (`55` models), `db/custom.db` (`75` tables at baseline) | `0` models exist in `alo-hosting-portal` that are missing from root `prisma/schema.prisma`. Local `db/custom.db` lacked `4` tables and `15` columns, causing `503` on `/api/health`. | Keep `prisma/schema.prisma` (`sqlite`) canonical; add reproducible idempotent SQLite schema sync migration (`prisma/migrations/20261027000000_unified_schema_sync/migration.sql`) and apply non-destructively (`CREATE TABLE IF NOT EXISTS` / `ALTER TABLE ADD COLUMN`) to `db/custom.db` after backing up first. |
| **Privileged Host Helpers** | `helpers/` (`24` files) | `server-helpers/` (`19` files), `alo-hosting-portal/server-helpers/` (`19` files) | `16/19` helpers identical; `helpers/{alo-domain-helper,alo-firewall-helper,alo-ssh-helper}` are syntax-valid and security-hardened while `server-helpers/` & `alo-hosting-portal/server-helpers/` have `8` `bash -n` failures and missing `APP_HOME` checks. | Keep `helpers/` as canonical; synchronize the `19` `alo-*-helper` scripts into `server-helpers/` and `alo-hosting-portal/server-helpers/` so any installer/path referencing `server-helpers/` gets the exact hardened `bash -n`-verified implementation. |
| **Sudoers Policies** | `deploy/sudoers/alo-hosting-portal` & `deploy/sudoers/alo-hosting-deploy` | `helpers/sudoers-alo`, `server-config/alo-hosting-portal.sudoers`, `server-config/sudo-policy` | `helpers/sudoers-alo` lacked `provision-site.sh` & `ssl-lifecycle.sh`; `server-config/sudo-policy` had unsafe wildcard `systemctl * alo-site-*`. | Align `helpers/sudoers-alo`, `deploy/sudoers/alo-hosting-portal`, `server-config/alo-hosting-portal.sudoers`, and `server-config/sudo-policy` to strict helper-only `NOPASSWD` rules with `Defaults:alo-panel secure_path=...` and zero wildcard `systemctl` rules. |
| **Docker Runtime** | `Dockerfile` + `docker-compose.yml` | `Dockerfile.node20` + `docker-compose.node20.yml` | Byte-identical pairs, both missing `helpers/` and `prisma/schema.prisma` in the `runner` stage. | Update `Dockerfile` and `Dockerfile.node20` in lockstep to include read-only `helpers/` (`/usr/local/sbin` or `/app/helpers`) and `prisma/schema.prisma`, while keeping `docker-compose.yml` and `docker-compose.node20.yml` aligned and non-root (`1001:1001`). |
| **Ubuntu Server Kit & Installer Scripts** | `alo-server-kit/` (`47` files) + `deploy/` (`11` files) | `install-scripts/` (`4` files), `scripts/` (`40` files) | `alo-server-kit/scripts/auto-env-fixer.js` had hardcoded secrets and pointed to `alo-hosting-portal/`; `install-scripts/configure-email.sh:131` failed `bash -n`; `scripts/create-zip.sh` was `0` bytes. | Scrub all hardcoded credentials from `auto-env-fixer.js` (CSPRNG generation, `0600` perms, canonical root path, SQLite-safe default); fix `install-scripts/configure-email.sh` syntax; replace empty `create-zip.sh` files with safe, working `bash -n`-valid scripts. |
| **Test Suites** | `tests/` (`15` files) | `alo-hosting-portal/tests/` (`9` files) | Root `tests/` runs under Vitest (`117` tests). Legacy tests cover pure utility/constant/security behaviors not duplicated in root `tests/`. | Add consolidated canonical tests in `tests/` covering multi-tenant RBAC/IDOR isolation, missing UI/API contract routes, health/schema checks, SSRF protections, and security headers. |

---

## 3. File-by-File Disposition for the 8 Divergent `alo-hosting-portal/src/` Files

| Legacy File (`alo-hosting-portal/src/...`) | Canonical Equivalent (`src/...`) | Action | Rationale |
|---|---|---|---|
| `app/dashboard/webchat/page.tsx` | `src/app/dashboard/webchat/page.tsx` *(added)* | **MERGE INTO CANONICAL `src/`** | Preserves the multi-agent WebChat UI (`Nova`, `Code`, `Website`, `Domain`) and wires it cleanly to canonical `/api/ai/{chat,code,website,domain-advisor}` endpoints. |
| `app/api/automation/tool/route.ts` | `src/app/api/operations/route.ts` + `src/lib/ai/automation/tools.ts` | **REMEDIATE IN PLACE (DO NOT COPY RCE)** | Legacy handler ran unauthenticated `child_process.exec`. Replace legacy handler with fail-closed `SUPER_ADMIN` / constant-time `INTERNAL_SECRET` check + `execFile` allowlist so no RCE exists anywhere in repo. |
| `app/api/automation/cron/route.ts` | `src/app/api/cron/route.ts` + `src/app/api/operations/worker/route.ts` | **REMEDIATE IN PLACE** | Remove hardcoded `'alo-cron-secret-2026'` fallback and require configured `CRON_SECRET` compared with `timingSafeEqual`. |
| `app/login/page.tsx` | `src/app/(auth)/login/page.tsx` | **KEEP CANONICAL** | Canonical `/login` includes MFA TOTP/backup-code challenge, OAuth provider buttons, Suspense, and callback URL sanitization. |
| `app/register/page.tsx` | `src/app/(auth)/register/page.tsx` | **KEEP CANONICAL** | Canonical `/register` includes password policy validation, OAuth signup, and plan query support. |
| `lib/automation/audit.ts` | `src/lib/audit.ts` | **KEEP CANONICAL** | Canonical `createAuditLog` matches the 79-model Prisma `AuditLog` schema. |
| `lib/deploy/detector.ts` | `src/lib/deploy/detect.ts` | **KEEP CANONICAL** | Canonical detector supports Next.js, Vite, Remix, Astro, Nuxt, SvelteKit, Node, Python, PHP, Go, Rust, Static, Docker with ambiguity detection and 11 unit tests. |
| `lib/deploy/orchestrator.ts` | `src/lib/deploy/engine.ts` + `service.ts` | **KEEP CANONICAL** | Canonical engine performs atomic release staging, health verification, automatic rollback on failed cutover, and zero shell string interpolation (9 E2E tests). |
