# Unified ALO Labs roadmap — honest status (2026-10-26)

Status meanings: **PASS** = implemented and verified with recorded evidence;
**PARTIAL** = works in part, missing pieces listed; **BLOCKED** = credential,
permission, dependency or external service unavailable; **NOT TESTED** = no
verification performed.

Evidence for the deployment column: `npm test` (83+ tests including
`tests/deploy-e2e.test.ts`), `node scripts/verify-deploy-http.mjs` (25 HTTP
checks, 0 failed), `docs/GIT-AUTODEPLOY.md`.

| Platform capability | Status | What exists now | What is still missing |
|---|---|---|---|
| Hostwares-style AI deployment | **PARTIAL** | Git-connected projects, isolated `mkdtemp()` builds, exact-SHA releases, real framework detection, deployment queue, static service manager, startup restore, AI provider chain (incl. OpenRouter/Qwen adapters) | Ollama self-hosting on the deploy host, AI-authored config proposals, mutating AI tools (intentionally not enabled) |
| Cloudways-style monitoring | **PARTIAL** | `/api/health` now returns 200 on the migrated DB; HTTP health + release-marker verification per deploy; deployment logs/history; existing monitoring/alert routes retained | Real resource graphs wired to the new release ports, alert delivery with a real provider, tunnel status probe |
| Mozello-style AI website builder | **PARTIAL** | Existing `/ai/builder`, prompt/website AI routes and workflow engine | Live provider call unverified here; editable preview → approval → publish lifecycle not end-to-end verified |
| Kinsta-style recovery | **PASS for deploys / PARTIAL overall** | Atomic symlink swap, automatic restore on failed verification, manual approval-gated rollback, verified backup of the previous release directory | Verified full-system backups/restore drills, approval UI for self-healing actions beyond rollback |
| Vercel-style deployment | **PASS (staging)** | GitHub App/OAuth integration code, signed webhook + dedup, framework detection, pinned commits, logs, rollback, two automatic pushes verified over HTTP | Real GitHub App installation/OAuth credentials → live GitHub push not verified; PR preview deployments are recorded and ignored, not built |
| Railway-style sandbox (`agents.alolabs.net`) | **BLOCKED** | AI workflow engine, tool allowlist and run history exist in this repo | The separate `agents.alolabs.net` host/application was not available in this checkout; no SSH/DNS/process access |
| DigitalOcean-style management | **PARTIAL** | Existing domain, DNS, storage, firewall, application APIs and helpers; new projects get a domain record and a bound port | No live DNS/SSL/firewall verification; no credentials for Cloudflare/registrar; DNS records were NOT changed |
| Wix-style security | **PASS for the new surface** | HMAC signature + timing-safe compare, delivery dedup, command allowlist, RBAC + project ownership, audit logs, secret redaction, rate limiting, same-origin CORS, httpOnly state cookie | Full CSRF token on every mutation (NextAuth session + same-origin check is used), complete route-by-route penetration test |
| Bluehost-style marketing AI (`marketing.alolabs.net`) | **BLOCKED** | Existing CRM/email-campaign models and APIs | Separate `marketing.alolabs.net` app not present in this checkout; no campaign publishing integration |
| GCP-inspired scaling | **PARTIAL** | Multiple projects each with its own port, release root and immutable releases (two projects verified live simultaneously); queue serializes per project | No container orchestration, no autoscaling, no hardware-capacity planner; single-host process-local lock only |

## Update 2026-10-27 — unified platform layer (orchestrator, agents, topology)

Branch `arena/b2ec9268-hosting-portal`. Full plan and stage sequence:
`docs/HYBRID-INFRASTRUCTURE-PLAN.md`.

| Capability | Status | Evidence |
|---|---|---|
| Durable job orchestrator (persistent rows, leases, idempotency, backoff, dead-letter, approval gates, audit) | **PASS (code + tests, not deployed)** | `tests/orchestrator.test.ts` — 32 tests |
| 10 specialized workers (repo discovery → backup/restore) | **PASS (code + tests)** | worker-catalogue cases in `tests/orchestrator.test.ts`; `BUILD_TEST` drives a real deployment end to end |
| Secure server agent (enrollment tokens, HMAC + replay window, allowlist, redaction, SSRF guard) | **PASS (code + tests, no host enrolled)** | `tests/server-agent.test.ts` — 37 tests |
| Human approval gate for agent tasks (PRIVILEGED/DESTRUCTIVE unclaimable until approved) | **PASS (code + tests)** | `approveAgentTask` / `rejectAgentTask`, `POST /api/agents/tasks/{id}/approve` |
| Database placement, replication and capacity audit | **PASS (logic + tests, hosts not measured)** | `tests/db-audit.test.ts` — 40 tests; `scripts/audit-database.mjs` |
| `/infrastructure` topology dashboard (live vs stale vs *not measured*) | **PASS (code + typecheck, no live agents)** | `src/app/api/infrastructure/topology/route.ts`, `src/components/infrastructure/UnifiedInfrastructure.tsx` |
| Hybrid infrastructure on Office A / Office B (replica, CI, staging, offsite backup) | **NOT STARTED** | requires Stage 0–3 of the plan on real hosts |
| Load test at 500 concurrent users, failover drill, offsite restore drill | **NOT TESTED** | no hardware purchase authorised until these exist |

Whole-suite result after this work: `npx tsc --noEmit` clean, `npx vitest run`
→ **22 files, 278 tests passed, 0 failed** (169 pre-existing tests unchanged).

Two schema migrations were added and verified against a copy of `db/custom.db`:
`20261027090000_unified_orchestrator_agents` (additive, 58 statements) and
`20261027093000_operation_jobs_platform_scope` (table rebuild making
`operation_jobs.websiteId` nullable, then rebuilding `audit_logs` to restore its
foreign-key text). `scripts/apply-deploy-schema.mjs` is idempotent and skips a
rebuild migration once its post-condition holds. **Neither migration has been
applied to any production database.**

Test hygiene fix: five pre-existing test files imported `@/lib/db` statically and
were writing into the tracked development database. They now import
`tests/helpers/isolated-db.ts` first, which points `DATABASE_URL` at a throwaway
copy, so `db/custom.db` is byte-identical after a full run.

## Update 2026-10-27 (later) — Gate A review and Gate B remediation

PR #13 was **merged to `main` on 2026-10-27 11:06 UTC** (`3dd3986`), which
triggered production workflow run
[`40493667038`](https://github.com/aloeducation-org-crm/Hosting-Portal/actions/runs/40493667038).
Its `verify` and `build` jobs passed; its **deploy job has been `queued` since
11:09 UTC and no self-hosted runner has picked it up**, so production has not
been modified. That queued job carries the *old* workflow (a run always uses the
workflow from its own commit), which applies migrations with no backup, no
transaction, no lock and the table rebuild enabled by default. It should be
cancelled or superseded by someone with runner access. Details and the exact
administrator actions: `docs/DEPLOYMENT-AND-ROLLBACK.md` §1.

Gate B fixes, on `arena/b2ec9268-hosting-portal` (commits `b715531`, `2e1e128`,
`ebf37f5`, `994d737`):

| Finding | Status | Evidence |
|---|---|---|
| A.2 rebuild migration ran by default, unbacked, unverified | **VERIFIED FIXED (code + tests)** | `tests/migration-safety.test.ts` (27); rebuilds opt-in, transactional, backup-verified, locked, fail-closed target |
| A.3 agent nonce not single-use → replayable signed request | **VERIFIED FIXED (code + tests)** | `agent_nonces` unique index; `tests/server-agent.test.ts` (37 → 46) |
| Phase 2 agent approvals never expired | **VERIFIED FIXED (code + tests)** | `approvedAt` + `AGENT_APPROVAL_TTL_MS`; sweep audits `AGENT_TASK_APPROVAL_EXPIRED` |
| A.4 Origin-less mutations bypassed CSRF; no token | **VERIFIED FIXED (code + tests)** | `src/lib/security/csrf.ts` (Web Crypto), `CsrfGuard`, `tests/csrf.test.ts` (24) |
| A.4 enroll rate limit trusted spoofable `x-forwarded-for` | **VERIFIED FIXED** | keyed on `x-real-ip`, matching the middleware policy |
| A.5 artifact uploaded but unused; no deployed-SHA check; no rollback; no single flight | **IMPLEMENTED, TESTING REQUIRED** | `scripts/deploy-release.sh`, `scripts/deploy-preflight.sh`, `src/lib/deploy/preflight.ts`, release identity in `/api/health`; `tests/deploy-pipeline.test.ts` (27). Never executed on a real host. |
| A.1 no production approval gate | **BLOCKED — APPROVAL REQUIRED** | deploy job now declares `environment: production`, but the environment has `protection_rules: []` and configuring reviewers returns **403** for this token |
| Branch protection on `main` | **UNVERIFIED** | `GET /branches/main/protection` → 403; `GET /rulesets` → `[]` |
| Secret scanning / dependency alerts | **UNVERIFIED** | 403 / 404 for this token. `npm ci` reported 0 vulnerabilities locally. |
| Migration header falsely claimed a transaction | **VERIFIED FIXED** | comment corrected; the runner now actually provides it |
| CSRF module imported `node:crypto` into the Edge middleware | **VERIFIED FIXED** | caught by `npm run build` ("Ecmascript file had an error"); rewritten on Web Crypto |
| Phases 8/9/10 (AI memory, Bangla voice, CRM/telephony) | **NOT IMPLEMENTED** | designs in `docs/AI-MEMORY-ARCHITECTURE.md`, `docs/MULTILINGUAL-VOICE-EVALUATION.md`; no voice or memory code exists |
| Phase 11 webhook → orchestrator | **NOT IMPLEMENTED (deferred by instruction)** | webhook still uses the legacy queue; the orchestrator worker drains both, so no duplicate execution |

Suite after Gate B: `npx tsc --noEmit` clean, `npm run lint` clean,
`npm run build` succeeds (2 pre-existing Turbopack tracing warnings),
`npx vitest run` → **25 files, 365 tests passed, 0 failed**, and `db/custom.db`
byte-identical afterwards.

Full readiness assessment, blocker list and authorization checklists:
`docs/PRODUCTION-READINESS-REPORT.md`.

## Domain / service inventory (verification limits)

`hosting.alolabs.net`, `panel.alolabs.net`, `agents.alolabs.net` and
`marketing.alolabs.net` are referenced by `DEPLOY.md`,
`docs/RECOVERY-hosting.alolabs.net.md` and `.env.example`. **No DNS, nginx,
Caddy, Cloudflare Tunnel, PM2 or systemd state was available from this
sandbox.** Nothing was changed for those hosts; no reverse-proxy config,
certificate or running application was touched. Verifying they still work
requires running `bash scripts/server-doctor.sh` on `alo-server-lap`.

The live preview in this session is the sandbox's `*.e2b.app` proxy of the
standalone Next.js server on port 3101 plus the deployed static releases on
ports 4100/4101 — it is **not** a public production deployment of
`hosting.alolabs.net`.

## Exact remaining manual setup

```bash
# 1. On the server, after pulling this branch:
cd ~/projects/Hosting-Portal
npm ci
sudo bash scripts/backup.sh /opt/backups
DATABASE_URL="file:/var/lib/alo-hosting/alo.db" node scripts/apply-deploy-schema.mjs
npm run db:generate && npm run build

# 2. Add GitHub App or OAuth credentials to /etc/alo-hosting/panel.env
#    (GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY, GITHUB_WEBHOOK_SECRET ...)
#    and restart: sudo systemctl restart alo-hosting-panel

# 3. Point the GitHub webhook at https://hosting.alolabs.net/api/github/webhook
#    (or click Connect GitHub + import in /deployments to create the hook).

# 4. Verify with the existing infrastructure and the new HTTP harness:
bash scripts/server-doctor.sh
set -a; . /etc/alo-hosting/panel.env; set +a
node scripts/verify-deploy-http.mjs
```

`scripts/verify-deploy-http.mjs` needs `PANEL_PASSWORD`,
`GITHUB_WEBHOOK_SECRET`, `LOCAL_SOURCE` (a real git repo with 2 commits) and
`SOURCE_PORT`. It performs a real login, import, signed webhooks, deploy,
rollback and redeploy, and prints only status codes, ids and commit SHAs.
