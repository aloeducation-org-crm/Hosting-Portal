# Production Readiness Report

**Date:** 2026-10-27
**Branch:** `arena/b2ec9268-hosting-portal`
**Last commit at time of writing:** `994d737` (Gate B remediation)
**Previous merge to `main`:** `3dd3986` (PR #13, merged 2026-10-27 11:06 UTC by `aloeducation-org-crm`)

**Overall recommendation: NOT production-ready.** The application layer is
implemented and tested; the *release path* is not safe yet, because one required
GitHub setting can only be changed by an administrator, and no host, database,
backup or drill has been verified.

---

## 1. Verification method

Everything below is either (a) a command run in this workspace, with its output
summarised, or (b) a GitHub API response, or (c) explicitly marked
**UNVERIFIED** with the evidence needed. No status was inferred from documentation
or from a passing build.

```
npx tsc --noEmit          → exit 0, no output
npm run lint              → exit 0, 0 problems
npm run build             → exit 0, "Compiled successfully", 2 pre-existing warnings
npx vitest run            → exit 0, 25 files, 365 tests passed, 0 failed
git status --short db/custom.db → empty (byte-identical after every run)
```

The two remaining build warnings are `Dynamic filesystem access causes tracing of
the whole project` at `src/lib/orchestrator/workers.ts:445` and one pre-existing
instance from `src/lib/helpers.ts`. Both are documented in `next.config.ts`; they
inflate the standalone output and do not fail the build.

---

## 2. Status by area

Labels: `PASS — VERIFIED` (evidence exists), `IMPLEMENTED, TESTING REQUIRED`,
`TESTED, NOT PRODUCTION-VERIFIED`, `BLOCKED`, `NOT IMPLEMENTED`,
`UNVERIFIED — EVIDENCE MISSING`.

| Area | Status | Evidence / what is missing |
| --- | --- | --- |
| Durable job orchestrator | **TESTED, NOT PRODUCTION-VERIFIED** | `tests/orchestrator.test.ts` (32): persistence, idempotency, atomic claim, per-key serialization inside the claim, lease recovery, backoff/jitter, dead-letter, admin-only requeue, approval gate, cancellation, redaction, restart via a second instance on the same DB. No real process-kill test; no production worker running. |
| 10 specialized workers | **TESTED, NOT PRODUCTION-VERIFIED** | Catalogue assertions + `BUILD_TEST` driving a real deployment end to end. Workers return `ok`/`unverified`/`fail`; no path reports unobserved success. |
| Secure server agent (protocol) | **TESTED, NOT PRODUCTION-VERIFIED** | `tests/server-agent.test.ts` (46). **No agent is enrolled on any host.** |
| Agent nonce replay prevention | **PASS — VERIFIED (in test)** | `agent_nonces` unique on `(agentId, nonce)`; concurrent replay → exactly one success; replay cannot forge a task result; nonces consumed only after signature verification. |
| Agent approval gate + expiry | **PASS — VERIFIED (in test)** | Privileged task unclaimable until `approveAgentTask`; approval expires after 1 h; `expireStaleTasks` clears it and audits; 5 concurrent claims → 1 winner. |
| Command allowlist (both copies) | **PASS — VERIFIED (in test)** | Panel and agent command sets and risk levels asserted identical; argv-only; metacharacters rejected; read-only default. |
| SSRF / cloud-metadata guard | **PASS — VERIFIED (in test)** | `169.254.0.0/16`, `169.254.169.254`, `100.100.100.200`, `metadata.google.internal`, `fd00:ec2::254`, `fe80::/10`, `0.0.0.0/8`, malformed octets, all hostnames, non-http schemes refused; redirects `error`. |
| Secret redaction | **PASS — VERIFIED (in test)** | Agent-side `sanitize()` and panel-side `redact()`; `describeAgents()` leaks no secret material. |
| CSRF for browser mutations | **PASS — VERIFIED (in test)** | `tests/csrf.test.ts` (24): signed double-submit cookie, enforced after session/role guards, every unsafe method, exempt paths, issuing route, fail-closed without a secret. **Not verified in a real browser session.** |
| Origin validation | **PASS — VERIFIED (in test)** | Cross-site Origin rejected even with a valid CSRF token; retained as defence in depth. |
| Trusted-proxy rate limiting | **PASS — VERIFIED (code + test)** | Agent enrollment keyed on `x-real-ip`; middleware already used `x-real-ip`. |
| RBAC / session guards | **PASS — VERIFIED (in test)** | `phase1-auth-rbac`, `phase2-security-and-routes`, plus a guard map for every new route (`requireAdmin` ×9, `requireSession` ×4, `requireAgent` ×3, `verifyInternalSecretValue` ×1). |
| MFA enforcement | **UNVERIFIED — EVIDENCE MISSING** | `UserMfa` model and `/api/auth/mfa-challenge` exist; enforcement was not exercised in this pass. Needs a test that a privileged user without MFA cannot perform a privileged mutation. |
| Tenant isolation / IDOR | **PARTIAL** | Website/domain tenant checks tested in `phase2-security-and-routes`. A full route-by-route IDOR sweep has **not** been done. |
| Migration safety | **PASS — VERIFIED (in test)** | `tests/migration-safety.test.ts` (27): rebuilds opt-in, transactional, backup-verified, precondition/postcondition, lock, fail-closed targets, both Gate A failure scenarios reproduced and now refused, documented recovery proven. |
| Production database engine / path | **UNVERIFIED — EVIDENCE MISSING** | Schema declares SQLite+libSQL; operator reports MySQL/MariaDB for the *service* DB. Needs `scripts/audit-database.mjs --json` and the `DATABASE_URL` scheme (not value) on the host. |
| Deployment approval gate | **BLOCKED — APPROVAL REQUIRED** | Deploy job declares `environment: production`, but the environment has `protection_rules: []` and configuring reviewers returns **403** for this token. Until an admin adds a required reviewer, a push to `main` deploys unattended. |
| Branch protection on `main` | **UNVERIFIED — EVIDENCE MISSING** | `GET /branches/main/protection` → 403; `GET /rulesets` → `[]`. |
| Artifact integrity | **TESTED, NOT PRODUCTION-VERIFIED** | Digest recorded at build, verified in preflight and again on the deploying runner; asserted by `tests/deploy-pipeline.test.ts` (27). Never executed on the host. |
| Deployed-release verification | **TESTED, NOT PRODUCTION-VERIFIED** | `/api/health` reports `release.commitSha`; both deploy scripts require it to match. Not run against a live release. |
| Automatic rollback | **TESTED, NOT PRODUCTION-VERIFIED** | Inline path captures previous commit/build/database and restores + re-verifies; canonical path restores the previous symlink. Failure path never exercised on a real host. |
| Single-flight deployment | **PASS — VERIFIED (config + test)** | `concurrency: {group: hosting-production-deploy, cancel-in-progress: false}`. |
| CI trigger filtering | **PASS — VERIFIED (config + test)** | `on.push.branches: [main, develop]`; no `workflow_dispatch`, no tag trigger, one workflow file. |
| Backup exists / is restorable | **NOT IMPLEMENTED (operationally)** | `scripts/backup.sh` exists and the `BACKUP_RESTORE` worker verifies a sha256 before reporting success, but **no scheduled backup, no offsite copy, no restore drill**. |
| Replication (Office A) | **NOT IMPLEMENTED** | Blocked on `log_bin` evidence. Until proven, Office A is a *restore target*, not a replica. |
| Staging environment (Office B) | **NOT IMPLEMENTED** | No staging host, no runner, nothing deployed. |
| Monitoring / alerting | **PARTIAL** | `/infrastructure` shows `live`/`stale`/`unavailable`/`revoked` and refuses to render fabricated zeros; queue depth, dead letters and approval backlog are surfaced. **No alert delivery channel is configured or tested.** |
| Load test (100/250/500) | **NOT IMPLEMENTED** | Never run. `capacityVerdict` cannot return "adequate" without it, by design. |
| Failover drills | **NOT IMPLEMENTED** | Zero drills. Automatic failover stays blocked. |
| Dependency vulnerabilities | **PASS — VERIFIED (this workspace)** | `npm ci` reported `found 0 vulnerabilities`. Registry advisories were resolved from the lockfile. |
| Secret scanning / committed credentials | **UNVERIFIED — EVIDENCE MISSING** | `GET /secret-scanning/alerts` → 403, `GET /dependency-graph/alerts` → 404 for this token. A manual diff scan of this branch found only fixture values (`ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ012345`, `ghp_0123456789…`, `AKIAIOSFODNN7EXAMPLE`, `alo_ags_test-secret`) — all obviously fake and used to assert redaction. **Repository history has not been scanned.** |
| AI long-term memory | **NOT IMPLEMENTED** | Only `AIConversation` / `AIMessage`. Design in `AI-MEMORY-ARCHITECTURE.md`. |
| Bangla-first voice | **NOT IMPLEMENTED** | No ASR/TTS/VAD code. Plan in `MULTILINGUAL-VOICE-EVALUATION.md`. |
| CRM / call centre | **UNVERIFIED — EVIDENCE MISSING** | `CrmContact`, `CrmDeal`, pipelines and activities exist; not audited in this pass. No telephony. |
| Webhook → orchestrator unification | **NOT IMPLEMENTED (deliberately deferred)** | GitHub webhook still uses the legacy deploy queue (`enqueueDeployment`). Dedup tested in `deploy-e2e.test.ts`. The orchestrator worker drains both queues in one process, so there is no duplicate execution — but webhook deploys do not yet have leases/backoff/dead-letter/correlation. |
| Legacy `alo-hosting-portal/` | **DO NOT DEPLOY** | Previously caused login 307s. Unchanged here. |
| `agents.alolabs.net`, `marketing.alolabs.net` | **BLOCKED** | Not present in this checkout; no DNS/TLS/proxy evidence available. |

---

## 3. Test inventory at `994d737`

365 tests, 25 files, 0 failures.

| File | Tests | Focus |
| --- | --- | --- |
| `tests/server-agent.test.ts` | 46 | allowlist (both copies), HMAC, nonce replay, approval gate + expiry, redaction, SSRF, heartbeats |
| `tests/db-audit.test.ts` | 40 | engine/version parsing, family mismatch, binlog/GTID/server_id, failover readiness, capacity, placement |
| `tests/orchestrator.test.ts` | 32 | durability, idempotency, leases, backoff, dead-letter, approvals, real deployment |
| `tests/migration-safety.test.ts` | 27 | migration applier safety, both reproduced failure modes, recovery |
| `tests/deploy-pipeline.test.ts` | 27 | deployment decision, release identity, `/api/health`, workflow controls, script guarantees |
| `tests/csrf.test.ts` | 24 | CSRF primitive, middleware enforcement, exemptions, issuing route |
| `tests/self-hosted-agents.test.ts` | 17 | AI agent catalogue, VRAM sizing (pre-existing) |
| `tests/ai-providers.test.ts` | 15 | provider chain (pre-existing) |
| `tests/ai-auto-deploy-studio.test.ts` | 14 | zero-terminal deploy studio (pre-existing) |
| `tests/ai-automation.test.ts` | 12 | automation tools (pre-existing) |
| `tests/ai-client.test.ts` | 11 | AI client (pre-existing) |
| `tests/deploy-detect.test.ts` | 11 | framework detection (pre-existing) |
| `tests/ai-security-and-routes.test.ts` | 11 | AI route security (pre-existing) |
| `tests/phase2-security-and-routes.test.ts` | 11 | tenant isolation, headers, rate limiting (pre-existing) |
| `tests/deploy-config.test.ts` | 10 | deploy config (pre-existing) |
| `tests/deploy-e2e.test.ts` | 9 | signed webhook → dedup → deploy → rollback (pre-existing) |
| `tests/ai-extra-providers.test.ts` | 8 | extra providers (pre-existing) |
| `tests/deploy-github-api.test.ts` | 7 | GitHub API (pre-existing) |
| `tests/phase1-auth-rbac.test.ts` | 7 | auth/RBAC (pre-existing) |
| `tests/marketing-operator-and-providers.test.ts` | 6 | marketing operator (pre-existing) |
| `tests/zero-terminal-deploy.test.ts` | 6 | zero-terminal deploy (pre-existing) |
| `tests/helpers.test.ts` | 5 | helpers (pre-existing) |
| `tests/security-hardening-audit.test.ts` | 5 | hardening audit (pre-existing) |
| `tests/ssh-key.test.ts` | 3 | SSH keys (pre-existing) |
| `tests/ai-provider.test.ts` | 1 | provider (pre-existing) |

Test hygiene: five pre-existing files imported `@/lib/db` statically and were
writing into the **tracked** development database. They now import
`tests/helpers/isolated-db.ts` first, which points `DATABASE_URL` at a throwaway
copy. `db/custom.db` is byte-identical after a full run — asserted inside
`tests/migration-safety.test.ts` as well as by `git status`.

---

## 4. Outstanding blockers, in priority order

| # | Blocker | Owner | Effect if ignored |
| --- | --- | --- | --- |
| 1 | **`production` environment has no required reviewer** (403 for this token) | Repository administrator | A merge or push to `main` deploys to production with no human approval |
| 2 | **Queued deploy run `40493667038`** from the PR #13 merge, still `queued` since 11:09 UTC, carrying the **old** unsafe workflow | Someone with runner/repo access | If a self-hosted runner comes online it will run migrations against the production database with no backup, no transaction and no lock |
| 3 | Production database path, engine and `DATABASE_URL` scheme unverified | Operator, on the host | The hardened deploy will (correctly) refuse until it can identify the database |
| 4 | No verified backup and no restore drill | Operator | There is no recovery path if anything goes wrong |
| 5 | Branch protection on `main` unverified | Administrator | Direct pushes and force pushes may be possible |
| 6 | Secret scanning / history scan not permitted for this token | Administrator | A credential committed in history would go unnoticed |

---

## 5. Production-readiness checklist

Do not tick anything you have not watched happen.

**Repository and pipeline**
- [ ] `production` environment has at least one required reviewer, self-review prevented
- [ ] `main` branch protection: required checks, PR required, no force push, no deletion
- [ ] Queued run `40493667038` cancelled or superseded
- [ ] Secret scanning enabled and history scanned; alerts triaged
- [ ] The merge that carries these fixes is the one that deploys — not the older queued run

**Host (Gate C, read-only)**
- [ ] `bash scripts/server-doctor.sh` output captured
- [ ] `node scripts/audit-database.mjs --json` output captured
- [ ] `DATABASE_URL` scheme and path confirmed absolute and outside the checkout (value not printed)
- [ ] PM2/systemd process name, user and working directory confirmed
- [ ] Reverse proxy / tunnel routing confirmed
- [ ] Certificate expiry confirmed
- [ ] `bash scripts/deploy-preflight.sh` run on the host, mode recorded (canonical / inline / blocked)

**Data**
- [ ] A backup exists, is newer than the last schema change, and passes `integrity_check`
- [ ] A restore drill onto an isolated target completed, with duration recorded
- [ ] `scripts/apply-deploy-schema.mjs --verify` passes against production (read-only)
- [ ] Offsite encrypted copy configured with retention

**Release**
- [ ] One deployment performed with the new pipeline, end to end
- [ ] `/api/health` reported the expected `release.commitSha`
- [ ] `/login` returned 200
- [ ] A deliberate failure exercised the restore path (staging first)
- [ ] Deploy log retained

**Only after all of the above**
- [ ] Load test at 100 / 250 / 500 with recorded p50/p95/p99, error rate, CPU/RAM, DB connections, disk, uplink saturation
- [ ] Two manual failover drills, recovery time recorded
- [ ] Hardware decision revisited with measurements in hand

---

## 6. Authorization checklists

### Staging (Gate C) — read-only evidence gathering
Authorized actions: run `server-doctor.sh`, `audit-database.mjs --json`,
`deploy-preflight.sh`, `apply-deploy-schema.mjs --verify` / `--check`; inspect
PM2/systemd, nginx, tunnel, certificate, backup freshness; deploy to a staging
host that shares no data or credentials with production.
Not authorized: any production mutation, any schema change, any DNS change, any
agent enrollment, any service restart on production.

### Production (Gate H) — separate explicit approval required
Prerequisites: every item in §5 except the last block; a named approver; a
recorded rollback target SHA; a verified backup taken after the last schema
change.
Authorized only with explicit approval: merge to `main`, deployment, additive
migration on the production database, service restart, agent enrollment.
Never authorized implicitly: a rebuild migration (needs `--allow-rebuild` plus a
verified backup, run by a human), DNS changes, firewall/SSH changes, enabling
automatic failover, purchasing hardware.

---

## 7. Remaining risk register

| Risk | Severity | Mitigation in place | Residual |
| --- | --- | --- | --- |
| Unattended production deploy on merge | **Critical** | `environment: production` declared; single-flight; read-only preflight | Gate not active until an admin adds a reviewer |
| Queued old-workflow deploy runs an unsafe migration | **Critical** | Documented; cancellation requires access this session does not have | Live until cancelled or superseded |
| Production database identity unknown | High | Deploy refuses an unidentified/relative/in-checkout target | Blocks the first deploy until resolved on the host |
| No verified backup | High | Deploy captures a pre-change copy; backup script exists | A deploy-time copy is not a backup strategy |
| Inline deploy rebuilds on the host (Node 24 vs CI 22) | Medium | Digest proves the delivered payload; canonical path runs the artifact | Inline path still not byte-identical to CI |
| CSRF control not verified in a real browser | Medium | 24 tests including middleware enforcement; global fetch patch | Needs one manual pass over login → dashboard → a mutation |
| No IDOR sweep across all routes | Medium | Tenant checks tested for websites/domains | Other resource routes unaudited |
| MFA enforcement untested | Medium | Model and challenge route exist | Privileged mutations may not require it |
| Alerting has no delivery channel | Medium | States are honest in the UI | Nobody is paged |
| Turbopack whole-project tracing | Low | Documented in `next.config.ts`; releases pruned | Large artifacts |
| Two orchestrations (legacy deploy queue + orchestrator) | Low | One worker process drains both; no duplicate execution | Webhook deploys lack leases/backoff/dead-letter |
