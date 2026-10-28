# ALO Hosting AI — Control Plane Phase 0 Discovery Audit

**Date:** 2026-10-29
**Branch:** `arena/26b3f390-hosting-portal`
**HEAD at audit:** `2846adb` (restored App Center + Software Factory work on top of `88fb789`)
**Method:** every status below is backed by (a) commands run in this workspace with their output,
(b) an existing test file, (c) an existing prior audit document, or (d) an explicit
"not verifiable with current access" label. No status is inferred from a page rendering or from a
model/API route merely existing.

---

## 0. Access reality (applies to the whole document)

This workspace is a sandboxed checkout of the repository. It has:

- **No SSH access, no credentials, no network path to Server A (office laptop), Server B (office
  desktop), Server C (Hostinger) or Server D (cPanel shared).**
- GitHub access (authenticated as `aloeducation-org-crm`) for repository/PR/CI evidence only.
- Local execution: Node 22, npm, SQLite (`db/custom.db`), full test suite and build.

Therefore: **all host-level items (agent enrollment on real hosts, live DNS changes, SSL issuance
against a live CA, cPanel API calls, backup/restore drills on real disks, failover) are classified
`Not verifiable with current access`** — they must be implemented and unit/integration-tested here,
with live verification explicitly reported as blocked, never simulated.

---

## 1. Reused prior audit artifacts (not re-derived)

| Document | What it establishes |
|---|---|
| `docs/ROADMAP-STATUS.md` | Honest per-capability PASS/PARTIAL/BLOCKED table for the AI-deploy, monitoring, recovery, marketing and scaling surfaces; orchestrator/agent/topology stage results |
| `docs/PRODUCTION-READINESS-REPORT.md` | Whole-gate evidence (lint/tsc/vitest/build), release-path blocker (GitHub admin setting), "NOT production-ready" recommendation |
| `docs/HYBRID-INFRASTRUCTURE-PLAN.md` | Three-host plan, `dataState` honesty model (live/stale/unavailable/revoked), DB placement audit |
| `docs/SERVER-SPEC.md`, `docs/AGENT-SECURITY.md` | Server specification and agent trust-boundary design |
| `docs/DEPLOYMENT-AND-ROLLBACK.md`, `docs/GIT-AUTODEPLOY.md` | Release path, atomic symlink swap, rollback, CI/CD |
| `docs/UNIFIED_PROJECT_FINAL_AUDIT.md` and siblings | Prior ecosystem/test-matrix audits |
| `docs/PRODUCTION-DEPLOYMENT-AUDIT-2026-10-27.md`, `docs/RECOVERY-hosting.alolabs.net.md` | Production deployment + recovery evidence |

## 2. Baseline gate re-run (this workspace, 2026-10-29)

```
npm ci            → 648 packages, 0 vulnerabilities, Prisma client generated
npm run lint      → exit 0, 0 problems
npm run typecheck → exit 0
npm run test      → 29 files, 432/432 tests passed, 0 failed
db/custom.db      → byte-identical after the run (isolated-db harness)
```

`npm run build` re-run separately (`.next` had been wiped by a workspace re-clone; build is
required before typecheck when route directories change, and before standalone preview).

---

## 3. §2 Mandatory audit — classification of all 24 components

Legend: **VW** implemented and verified working · **INC** implemented but incomplete ·
**BRO** implemented but broken · **MISS** missing · **DUP** duplicated · **DEP** deprecated ·
**UNSAFE** unsafe as-is · **NVV** not verifiable with current access.

### 3.1 Repository & workflow

| # | Component | Status | Evidence (code path / test / doc) |
|---|---|---|---|
| 1 | GitHub repository structure | **VW** | Single repo `aloeducation-org-crm/Hosting-Portal`; this checkout mirrors `main` + arena branches; docs/ and tests/ inventories below |
| 2 | Main branch & feature branches | **VW** | `main` (merge #15 = `88fb789`); arena branches per PR history; work happens only on `arena/26b3f390-hosting-portal` |
| 3 | Existing PRs & workflow status | **INC** | PRs #11–#15 merged; CI `CI and production deploy` green on PR branches, **but the two most recent `main` merge runs (`40662370310` for #15, `40515206388` for #14) completed as `cancelled` — production deploy on main did not finish**. Needs Phase 9 investigation; do not claim production deploys succeeded |
| 4 | Next.js pages & layouts | **VW** | Next.js 16 App Router, React 19, TS strict; ~130 `page.tsx` under `src/app` (public + `(dashboard)` + `dashboard/`) |
| 5 | Dashboard modules | **INC** | Working: Sites, Deployments, Domains, Databases, Storage, Email, CRM, Billing, Servers, Infrastructure, Audit, App Center, Industries/Services (nav in `src/components/dashboard/DashboardShell.tsx`). **Missing pages required by §19:** `/backups`, `/monitoring`, `/ssl`, `/github`, `/projects`, `/documents`, `/security` (find returned NONE for all) |
| 6 | API routes | **VW** | ~200 route files under `src/app/api` covering servers, agents, orchestrator, deploy, github, domains, network/dns, ssl, databases, storage, email, backups, monitoring, alerts, security, platform, infrastructure |
| 7 | Prisma schema & migrations | **VW** | 90 models; 10 migration dirs; hand-written additive migrations registered in `scripts/apply-deploy-schema.mjs` (idempotent, skip-if-exists); `tests/migration-safety.test.ts` + `tests/db-audit.test.ts` |

### 3.2 Auth, servers, runtimes

| # | Component | Status | Evidence |
|---|---|---|---|
| 8 | Authentication & authorization | **VW** | NextAuth + login/MFA routes (`src/app/api/auth/*`, `api/user/mfa/*`), `src/lib/auth.ts` (`requireSession`, `requireSuperAdmin`, `canAccessWebsite`), middleware allowlists; tests `phase1-auth-rbac.test.ts`, `phase2-security-and-routes.test.ts`, `csrf.test.ts` |
| 9 | Server management code | **INC / NVV** | `src/app/api/servers` (+ `discover`, `health`, `provision`, `reconcile`), `Server`/`ServerMetric`/`ServerPort` models, `AdminServersManager.tsx`. **No server has been enrolled in this environment; topology honestly renders `unavailable` = "not measured"** (`api/infrastructure/topology`, `dataState` model). Real A/B/C/D registration = Phase 2, blocked on hosts |
| 10 | Docker configuration | **INC** | `DockerContainer` model, `src/lib/containers/security.ts`, compose references across docs/deploy. **No container lifecycle management (run/stop/logs) exists in the agent allowlist** — §7 container runtime is Phase 4 work |
| 11 | PM2 / systemd configuration | **VW (as legacy), INC (per §7)** | `scripts/alolabs.service`, `scripts/bootstrap-server.sh` (systemd unit + sudoers, idempotent), deploy engine supports `serviceManager: pm2 \| systemd` (`src/lib/deploy/service.ts`). PM2 works for existing apps; **container-based runtime with restart policies/health checks/limits (§7) not implemented — new deployments still use pm2/systemd**. Rule in force: do not remove PM2 from existing applications |
| 12 | DNS integrations | **INC** | `DnsRecord` model + `api/network/dns` CRUD (validated types A/AAAA/CNAME/MX/TXT/NS/SRV/CAA) + `src/lib/cloudflare.ts` adapter that honestly returns `simulated:true` when unconfigured. **No provider-independent authoritative engine (PowerDNS), no registrar API, no zone validation/SOA/DNSSEC/propagation inspection — Phase 5** |
| 13 | Domain management | **INC** | `api/domains` (+ `search`, `purchase`, `mine`, `suggestions`), `Domain` model, ownership checks in `network/dns`. Live registrar/purchase path **NVV** (no registrar credentials in this environment) |
| 14 | Storage integrations | **INC / MISS** | `src/lib/storage.ts` = single local `uploads/` dir with MIME allowlist, size cap, path-traversal guard; `StorageBucket` model + `api/storage/buckets`; `api/file-manager` CRUD. **No logical pools (STUDENT/PARTNER/EMPLOYEE/COMPANY/PROJECT/BACKUP), no quotas, no versioning, no integrity hashes — Phase 3/6** |
| 15 | GitHub integrations | **INC / NVV** | `api/github` (connect/callback/repos/status/webhook/disconnect), HMAC-signed webhook + replay window (`src/lib/deploy/signature.ts`, `webhook.ts`), token encryption (`deploy/github.ts` uses `@/lib/encryption`). Prior audit: **live GitHub App credentials not configured → live push unverified**; webhook dedup + pipeline verified by tests |
| 16 | Deployment engine | **VW (staging)** | `src/lib/deploy/*` (detect, queue, engine, release-identity, rollback via atomic symlink swap, redact), `api/deploy/projects*`, `api/deployments`, `websites/[id]/deploy|rollback` paths; tests `deploy-e2e.test.ts`, `deploy-pipeline.test.ts`, `deploy-github-api.test.ts`, `deploy-detect/config/start-command` + `verify-deploy-http.mjs` (25 HTTP checks). Health verification is real HTTP, not process-start |
| 17 | Email integrations | **INC** | `EmailAccount` model, `api/email/accounts` (create/quota/disable) executing `alo-email-helper` (`src/lib/helpers.ts`) against Dovecot on the panel host; `api/email/dns-records`, `send`, `verify`. **No cPanel/WHM API adapter for Server D (grep: 0 hits) — Phase 5; MX/SPF/DKIM/DMARC preservation is an explicit do-not-touch rule** |
| 18 | AI agents & model router | **VW** | `src/lib/ai/providers.ts` chain (incl. self-hosted/free-tier adapters), `api/ai/*` (operator, deploy-assistant, domain-advisor, workflows, models, status), `AiAgent`/`AiWorkflow`/`TokenUsage` models; tests `ai-provider(s)`, `ai-client`, `ai-security-and-routes`, `ai-automation`. Policy: paid models only activate when keys are explicitly configured; **no paid call is made from this environment** |
| 19 | Background workers & queues | **VW** | Durable `OperationJob` orchestrator (`src/lib/orchestrator/orchestrator.ts`) with leases, idempotency keys, backoff, dead-letter, approval gates, audit; 10 workers (`workers.ts`, contracts in `contracts.ts` with LOCAL/AGENT/EXTERNAL execution modes); `api/orchestrator/*`, `api/operations/worker`; tests `orchestrator.test.ts` (32), `operations` coverage in phase2 tests. **Process-local: restart recovery is via DB rows, single-host lease** |
| 20 | Backup & restore | **INC / NVV** | `Backup`/`BackupManifest`/`RestoreJob` models, `api/backups`, `websites/[id]/backups(+restore)`, `scripts/backup.sh`/`restore.sh`, agent allowlist `backup.database`/`backup.verify`. **No Restic/encrypted-offsite engine, no scheduled retention execution, no restore drill ever performed — Phase 6; live drill blocked** |
| 21 | Monitoring & alerting | **INC / NVV** | `api/monitoring/check|collect|metrics`, `ServerMetric`/`ResourceMetric`/`HealthCheck` models, `AlertRule`/`Alert` + `api/alerts(+rules)`, topology `dataState` honesty. **Real host metrics only arrive from an enrolled agent (none here); no alert delivery provider (email/webhook) wired — roadmap already says so. No `/monitoring` dashboard page (§19)** |
| 22 | Security policies | **INC** | RBAC + tenant checks, MFA + backup codes, rate limiting (`src/lib/rate-limit.ts`), CSRF (`src/lib/security/csrf.ts`), audit logs (`src/lib/audit.ts`), secret redaction (`deploy/redact.ts`), SSRF guard (`security/url-guard.ts`), CIS baseline doc, agent HMAC + nonces (`AgentNonce`, replay tests in `server-agent.test.ts` 37 tests), lockout/sessions/ssh-keys/firewall APIs. **Gaps: no route-level penetration test; malware scanning absent; see 23–24** |
| 23 | Deployment secrets configuration | **UNSAFE → fix in Phase 1** | `src/lib/encryption.ts` provides AES-256-GCM and is used by deploy GitHub tokens, agent credentials, webhook secrets — **but `api/platform/secrets` stores `Secret.value` in PLAINTEXT (`db.secret.create({ … value … })`) and only masks it on read.** Phase 1 will encrypt at rest with legacy-read fallback, keeping all existing rows readable |
| 24 | Production infrastructure documentation | **VW** | See §1 table; `PRODUCTION-READINESS-REPORT.md` correctly concludes NOT production-ready (release-path admin setting + no drills) |

---

## 4. §25 acceptance criteria — honest pre-check

| # | Criterion | Status now | Note |
|---|---|---|---|
| 1 | Existing dashboard extended, not replaced | **PASS** | All work extends existing shell/routes |
| 2 | Server A/B agents register & report real data | **BLOCKED** | Code + tests exist (`server-agent.test.ts` 37, `self-hosted-agents.test.ts`); **no host access from this sandbox** |
| 3 | Server C/D connected via provider integrations | **MISS → Phase 2/5** | No Hostinger API adapter; no cPanel/WHM adapter (0 hits) |
| 4 | Dashboard shows real hardware/storage inventory | **INC** | Topology + inventory code exists with `dataState` honesty; requires enrolled agents |
| 5 | GitHub project deploy without per-project SSH | **PASS (staging)** | `deploy-e2e.test.ts` + HTTP verification; live GitHub App creds blocked (prior audit) |
| 6 | Domain via authorized DNS workflow | **INC** | CRUD + ownership workflow exists; authoritative/provider execution Phase 5 |
| 7 | HTTPS provisioned and verified | **NVV** | `api/ssl` (+check/renew/expiring) exist; no live CA run from sandbox |
| 8 | Database created with isolated credentials | **INC** | `DatabaseInstance`/`DatabaseCredential` models + `api/databases`; least-privilege-per-app execution flow needs Phase 4 verification |
| 9 | Files securely uploaded/downloaded | **PASS (local)** | `storage.ts` traversal/MIME/size guards; pools/quotas pending |
| 10 | Student/partner/employee document access isolated | **MISS → Phase 3/6** | No document categories or pools exist |
| 11 | Existing cPanel email remains functional | **NVV (do-not-touch)** | No code path touches Server D email; adapter is additive-only |
| 12 | Backups created and restored in a test env | **INC → Phase 6** | Restore API + scripts exist; **no drill performed** |
| 13 | Monitoring reports actual health | **INC** | Real only with an agent; never fabricates (renders "not measured") |
| 14 | Failed deployments roll back | **PASS** | Atomic swap + restore-on-failed-verification, tested in `deploy-e2e.test.ts` |
| 15 | Agent disconnection & recovery handled | **PASS (logic)** | Heartbeat window → `stale`/`revoked` states, nonce replay protection; no live host to observe |
| 16 | Failover enabled only after validation | **NOT IMPLEMENTED (correctly)** | No automatic failover exists; Phase 7 gated behind drills |
| 17 | AI operations constrained by policy | **PASS (code)** | Allowlist + risk levels + approval gates + contracts.ts rule; AI cannot bypass deterministic enforcement (tested) |
| 18 | Existing applications and data intact | **PASS** | 432/432 tests, `db/custom.db` byte-identical, additive-only migrations |
| 19 | No paid AI inference | **PASS here** | No provider keys in this environment; adapters only run when explicitly configured |
| 20 | Normal dashboard ops need no manual SSH | **PARTIAL** | Deploy/domain/DNS/storage/email CRUD flows exist; gaps = pools, cPanel, authoritative DNS, runtime choice |

---

## 5. Gap list mapped to implementation phases (§23)

**Phase 1 — Core control plane** (verifiable here)
- G1 **Encrypt `Secret` values at rest** (§20) with backward-compatible read of legacy plaintext + tests.
- G2 Verify with evidence that auth, server registry, agent gateway, job queue, secrets, audit each have passing tests; wire any missing admin surface (secrets UI masking already exists).
- G3 Desired-state record check: confirm a project resource carries desired config and the orchestrator reconciles/retries idempotently; add the missing declarative fields only if not present (investigate `GitProject`/`deploy/projects` first — do not duplicate).

**Phase 2 — Server agents & provider adapters**
- G4 Agent inventory capability gap: allowlist has `metrics.collect`, `disk.usage`, `service.status`, `process.list`, `health.probe`, `backup.database`, `backup.verify`, `db.replication-status` — **missing §5 items: hardware/OS inventory detail, mount points, container status, system service inventory, log streaming**. Add typed allowlist entries + tests (no shell strings).
- G5 One-time **agent bootstrap installer** (§6: OS/arch/resource detection, occupied ports, dry-run, no-overwrite contract) — `scripts/bootstrap-server.sh` only bootstraps the panel, not an agent on A/B. New additive script + tests of its decision output where testable.
- G6 **Hostinger (Server C) adapter interface** + **cPanel/WHM (Server D) adapter interface** — implemented as typed adapters that report the missing credential as an explicit blocker (honest states, no simulated success).

**Phase 3 — Infrastructure management**
- G7 Dashboard pages required by §19 that don't exist: `/monitoring`, `/backups` (and later `/ssl`, `/github`, `/projects`, `/documents`, `/security`).
- G8 Storage pools (§12) with capacity/quota metadata — logical pools table + API + admin surface; **no disk formatting, no mounting, no touching populated dirs**.

**Phase 4 — Hosting automation**
- G9 Container runtime option (§7) behind the existing deploy engine (`serviceManager: container`) — keep pm2/systemd for existing apps.
- G10 Reverse-proxy controller evaluation: `CaddySite` model exists — document/verify actual behavior; Traefik only as config generator (NVV live).
- G11 Database provisioning: verify per-app isolated credentials flow end-to-end (create → least-privilege → rotate → health) — `api/databases` hardening if the flow only writes rows.

**Phase 5 — Domain & email automation**
- G12 Provider-independent DNS modes (§8): local zone store is the source of truth; add `DnsProvider` interface with `cloudflare` (existing), `registrar` and `powerdns` adapters (blocked on creds), zone validation + change history + rollback planning.
- G13 cPanel email adapter (§14) for Server D — additive; never modify MX; never log passwords.

**Phase 6 — Storage & recovery**
- G14 Document categories (student/partner/employee/company) with tenant+role isolation and audit trail (§13), integrated with existing CRM identities — no duplicate identity models.
- G15 Backup engine upgrade: encrypted offsite-compatible format (Restic-compatible interface, blocked on repository host), retention jobs, **restore verification job** (`restore-test`) + recorded drill report against the local environment.

**Phase 7 — High availability**
- G16 Manual/gated failover workflow + runbook; automatic failover **stays disabled** until real drills (blocked on hosts). Capacity-aware replication policies (ReplicationStatus model exists) get policy fields, not fake lag numbers.

**Phase 8 — AI operations**
- G17 Verify `ai/operator` + deploy-assistant route every proposed mutating action through orchestrator approval gates; audit-trail tests for recommendation→approval→execution; local/free-tier only.

**Phase 9 — Production readiness**
- G18 Full gate (lint→typecheck→test→build) + live preview E2E + investigation of cancelled main CI runs + final report separating completed/blocked.

---

## 6. Precise blockers & approvals required

| Blocker | Needed for | Approval/access required |
|---|---|---|
| No SSH/network to Server A & B | Agent enrollment, inventory, backups, drills | User to run the bootstrap script on each host (one-time enrollment) |
| No Hostinger account API access | Server C provider adapter live calls | API token + confirmation plan type (shared vs cloud vs VPS) |
| No cPanel/WHM URL+token | Server D email adapter live calls | cPanel API token + host URL; **do not modify MX/mailboxes** |
| No registrar/DNS provider credentials | Domain purchase + NS changes | Explicit approval; **never migrate authoritative DNS automatically** |
| No GitHub App credentials (prior audit) | Live push deployments | GitHub App install by org admin |
| No live CA/rate-limit context for SSL | Real certificate issuance | Verification run from the production host |
| Main-branch CI runs `40662370310`/`40515206388` cancelled | Production deploy claim | Admin review of workflow cancellation cause |

---

## 7. Decisions in force for implementation

1. **Additive only**: new tables/columns via registered hand-written migrations; `db/custom.db` never mutated by tests (isolated-db first import).
2. **Honest states everywhere**: `simulated`/`blocked`/`not measured` flags in API responses; never a fake 0, never a fake success.
3. **No new competing systems**: everything lands behind existing patterns — `requireSession`/`requireSuperAdmin`, `apiSuccess/apiError`, `src/lib/audit.ts` domain tags, orchestrator `contracts.ts` workers, middleware prefix allowlists.
4. **Existing branding stays** (ALO Labs), existing routes/behavior preserved, PM2 kept for existing apps.
5. Gate order per change: lint → typecheck → (build first if routes changed) → test → build.

## 8. Phase execution status (Phases 0–9) — §26 report

Recorded 2026-10-29 on branch `arena/26b3f390-hosting-portal`. Every line here was executed and gated in this workspace; nothing is claimed from intent.

### Completed

| Phase | Deliverable | Evidence (commit / gate) |
|---|---|---|
| 0 | Full 24-component audit, §25 pre-check, gap→phase map, §7 decisions | `647b09e` (this document) |
| 1 | `src/lib/secret-store.ts` (env/JSON/file/inline readers, redaction), platform secrets + webhook hardening, `tests/control-plane-secrets` 11/11 | `357cb99` |
| 2 | Server agent: 14-command allowlist parity (panel+agent), inventory `collect`/`log.tail` with jail, heartbeat inventory mirror (`server_agents`), `tests/server-agent-inventory` 17/17 | `a1b8019` |
| 2 | Provider adapters: Hostinger + cPanel (real URL/port bugs fixed), tri-state verify with redaction, `tests/provider-adapters` 18/18 | `f6a2964` |
| 2 | One-time bootstrap installer: dry-run byte-zero writes, exit-code contract, `tests/agent-bootstrap` 6/6 | `4bd113f` |
| 3 | Storage pools + documents (6 pools, role matrix, path jail, quota/MIME/sha256/versions/audits), `tests/storage-pools` 21/21, 91-table schema applied | `fc0bea4` |
| 3/19 | `/dashboard/monitoring` (live system metrics, "not measured" honesty) + `/dashboard/backups` (real backup rows) + nav, `tests/dashboard-pages` 4/4 | `7776cf0` |
| 4 | Database provisioning verified helper-gated: honest 500 with no row/no credentials/no success audit when `alo-database-helper` is absent; authorization + validation tests, 5/5 | `8528f41` |
| 5 | Provider-independent DNS: mode layer (local/cloudflare/powerdns/registrar) with publish-before-persist gate, blocked-mode refusal naming exact missing dependency, `/api/network/dns/status`, honest banner + DNS-tab repairs in NetworkView, `tests/dns-provider` 10/10 | `ac35e5d` |
| 5 | cPanel email integration (mailbox listing adapter); no deploy path touches MX records (deploy/rollback code has no email operations — enforced by scope, documented in §3) | `f6a2964` + audit §3 |
| 6 | BACKUP_RESTORE / MONITORING_RECOVERY / DATABASE_OPS workers with retries/timeouts and honest no-heartbeat refusal, covered by `tests/orchestrator` | pre-existing, cited §3/§4 of this doc |
| 8 | AI operator endpoint: admin-gated, zod command enum, audit-logged; CSRF + rate limits in middleware; no paid inference configured anywhere | cited + `tests/ai-*` (pre-existing) |
| 9 | Final gate: **lint 0 · typecheck 0 · 524/524 tests (37 files) · build OK**; live E2E `scripts/e2e-smoke.mjs` **15/15** against the standalone production server (login, dashboard pages, monitoring/alerts/backups/pools/domains APIs, unauth 401 + redirect, CSRF flow, DNS create→panel-only publication→delete with fixture cleanup) | `10d7d68` |

### Partially completed

- **DNS execution**: local panel-only mode works end-to-end and says so; cloudflare/powerdns/registrar modes are implemented as *honest refusal* until credentials/engine are enrolled (by design — no simulation).
- **High availability (Phase 7)**: orchestration/planning only; no failover possible without second hosts — no drills run.
- **§19 dashboard sections still missing**: `/dashboard/ssl`, `/dashboard/github`, `/dashboard/projects`, `/dashboard/documents`, `/dashboard/security` (pages do not exist; nav does not link them). Data sources for documents (pools API) and GitHub/deployments exist; UI not built.
- **GitHub App pipeline**: pipeline worker + deployment surfaces exist with tests; live GitHub status callbacks are unverified (no GitHub App credentials in this workspace).

### Blocked (dependency missing — reported, never simulated)

- **Live host verifications (§25 BLOCKED-NVV)**: no SSH/host access from this workspace — restore drills, HTTPS-on-real-domain verification, container/Traefik state checks, capacity measurements on Server A/B/C/D remain unproven.
- **PowerDNS authoritative engine**: not installed anywhere in this workspace; `POWERDNS_API_URL`/`POWERDNS_API_KEY` unset → mode refuses mutations.
- **cPanel/Hostinger live calls**: adapter unit-tested with injected config; real credentials absent → tri-state reports `blocked`, never `connected`.
- **Production deploy proof**: main merge run `40662370310` was **cancelled** — a prod deploy from `main` is NOT proven. Requires an authorized re-run outside this workspace.
- **Database helper**: `/usr/local/sbin/alo-database-helper` absent here → creation honestly fails 500 (pinned by test); installing it on a host is a deployment task.

### Untested

- Browser-rendered UI (E2E is fetch-level; nav/structure covered by source tests only).
- Performance/load behavior; email sending; scheduled job execution on real servers.
