# Execution Checklist — Phase 0.5 Containment Pass

> **Purpose.** This file is the persistent completion ledger for the current
> session. It records what has been done with evidence, what remains, and the
> exact next unfinished task, so a later session continues rather than restarts.

| | |
|---|---|
| Repository | `https://github.com/aloeducation-org-crm/Hosting-Portal` |
| Branch | `arena/4114dfbd-hosting-portal` |
| Base commit | `0b51a1096c357c79c529ebcd6a2af652834d8de5` (`main`) |
| Baseline status | Working tree clean at start; 1,357 tracked files |
| Baseline gate | `npm test` → 67 files / 1017 tests passing |
| Session date | 2026-11-12 (UTC) |
| Current gate | `npm run verify` → **76 files / 1234 tests** passing (1 skipped), lint clean, `tsc --noEmit` clean, production build succeeds, both worker bundles build, `audit:repo` 17/17 |
| Pull request | **#36** — https://github.com/aloeducation-org-crm/Hosting-Portal/pull/36 (open, not merged) |

## Honesty legend

| Label | Meaning |
|---|---|
| **PASS** | Implemented and verified by a test that would fail without the change. |
| **PARTIAL** | Part of the requirement is met; the remainder is named. |
| **FAIL** | Present and broken. |
| **BLOCKED** | Needs credentials, a host, an external provider, or owner approval. |
| **N/A** | Demonstrably outside this repository's scope. |

A green test run is not a production claim. Nothing in this session touched a
server, a database, DNS, a certificate provider, a payment provider or a CI
runner.

---

## 1. P0 — critical security and data integrity

| ID | Requirement | Status | Evidence |
|---|---|---|---|
| SEC-01 | Customer build steps must not run with control-plane privilege | **PASS** | `src/lib/deploy/sandbox.ts`; `tests/build-isolation.test.ts` (23) |
| SEC-02 | Git connections must be tenant-scoped | **PASS** | `src/lib/deploy/connections.ts`; `tests/deploy-tenant-isolation.test.ts` (23) |
| SEC-03 | Only an authorised path may grant a paid plan | **PASS** | `src/lib/billing/entitlements.ts`; `tests/billing-entitlements.test.ts` (26) |
| SEC-07 | Agent must verify task signatures, require HTTPS, not expire running work | **PASS** | `agent/alo-agent.mjs`; `src/lib/agents/agent.ts`; `tests/agent-task-signing.test.ts` (23) |
| SEC-05 | Rate limiting must identify a client, not one shared bucket | **PASS** | `src/lib/security/client-identity.ts`; `tests/client-identity.test.ts` (20) |
| SEC-06 | Unverified accounts must not act; RESELLER must not be self-selected | **PASS** | `src/lib/account-status.ts`; `src/proxy.ts`; `tests/account-verification.test.ts` (21) |
| SEC-13 | Health must distinguish failure classes; uptime must be real | **PASS** | `src/lib/health.ts`; `tests/health-reporting.test.ts` (21) |
| SEC-12 | Production must refuse the fixture database | **PASS** | `src/lib/db.ts` `resolveDatabaseUrl`; same test file |
| SEC-11 | Deployment settings affecting shared host resources must not be customer-editable | **PASS** | `src/lib/deploy/host-settings.ts`; enforced in `validateDeployConfig`, the PATCH route, both AI routes and `restartExternalService`; `tests/deploy-host-settings.test.ts` (30) |
| SEC-04 | Release control: `main` protection, required reviewers, runner scope | **BLOCKED** | GitHub repository settings are outside the repository; owner action. |
| SEC-08 | Public repository carries a fixture DB, internal addressing, a public IPv4 | **BLOCKED** | Owner decision on visibility and redaction. Partially mitigated by SEC-12. |
| SEC-09 | Two secrets in history to rotate if ever used | **BLOCKED** | Rotation is an owner action on the platform, not a code change. |

## 2. P1 — core platform reliability

| ID | Requirement | Status | Evidence |
|---|---|---|---|
| REL-01 | Deploy engine: real clone → detect → build → package → activate → verify → rollback | **PASS** (static sites, local) | pre-existing `tests/deploy-e2e.test.ts`, still green after SEC-01 |
| REL-02 | Health distinguishes unreachable vs stale schema | **PASS** | SEC-13 above |
| REL-03 | Workers supervised by a process manager | **PASS** | Orchestrator: `alo-automation-worker.service` + Compose + CI check (pre-existing, earlier "none shipped" claim was wrong). Deploy worker: `alo-deploy-worker.service` + Compose `deploy-worker` + CI target cross-check + SIGTERM drain/heartbeat. `tests/deploy-worker-supervision.test.ts` (26). |
| REL-04 | Agent task lifecycle has a start transition and duplicate-execution guard | **PASS** | `POST /api/agents/tasks/start`; `startTask()`; SEC-07 tests |
| REL-05 | Off-host backup target + evidenced restore | **BLOCKED** | No off-host destination exists; requires storage credentials. |
| REL-06 | Server application runtimes (Node/Python/PHP) actually run | **FAIL** by design | Detection exists; service manager is `none` pending operator wiring. Documented, not fixed here. |

## 3. P2 — business functionality

| ID | Requirement | Status | Evidence |
|---|---|---|---|
| BILL-01 | Entitlement integrity | **PASS** | SEC-03 |
| BILL-02 | Plan limits enforced at write time | **PASS** | `assertWithinPlanLimit` wired into `/api/websites`, `/api/databases` |
| BILL-03 | Payment provider (checkout + verified webhook) | **BLOCKED** | No provider credentials; `src/lib/stripe.ts` now throws instead of fabricating |
| BILL-04 | Invoicing from real usage, dunning, suspension automation | **NOT STARTED** | Depends on BILL-03 |

## 4. P3 — AI and advanced automation

| ID | Requirement | Status | Evidence |
|---|---|---|---|
| AI-01 | AI provider chain with SSRF guards, no fabricated answers | **PASS** (pre-existing) | `tests/ai-*.test.ts` |
| AI-02 | AI operator cannot mint entitlements | **PASS** | SEC-03; `src/lib/operator/command-policy.ts` |
| AI-03 | Live provider verification (Ollama or cloud) | **BLOCKED** | No reachable provider from this workspace |

## 5. P4 — documentation and operations

| ID | Deliverable | Status |
|---|---|---|
| DOC-01 | `docs/audit/REPOSITORY-INVENTORY.md` | see section 7 |
| DOC-02 | `docs/audit/ARCHITECTURE-AND-DATA-FLOW.md` | see section 7 |
| DOC-03 | `docs/audit/ROUTE-API-INVENTORY.md` | see section 7 |
| DOC-04 | `docs/audit/DATABASE-AND-MIGRATION-AUDIT.md` | see section 7 |
| DOC-05 | `docs/audit/AUTH-RBAC-SECURITY-AUDIT.md` | see section 7 |
| DOC-06 | `docs/audit/WORKER-SCHEDULER-AUDIT.md` | see section 7 |
| DOC-07 | `docs/audit/DEPLOYMENT-INFRASTRUCTURE-AUDIT.md` | see section 7 |
| DOC-08 | `docs/audit/INTEGRATION-STATUS.md` | see section 7 |
| DOC-09 | `docs/audit/TEST-AND-COVERAGE-REPORT.md` | see section 7 |
| DOC-10 | `docs/audit/ISSUE-AND-REMEDIATION-MATRIX.md` | see section 7 |
| DOC-11 | `docs/audit/PRODUCTION-READINESS.md` | see section 7 |
| DOC-12 | `docs/operations/INSTALLATION.md` | see section 7 |
| DOC-13 | `docs/operations/BACKUP-RESTORE.md` | see section 7 |
| DOC-14 | `docs/operations/INCIDENT-RESPONSE.md` | see section 7 |
| DOC-15 | `docs/operations/RELEASE-AND-ROLLBACK.md` | see section 7 |

## 6. Exact next unfinished tasks

In priority order. Each is small enough to complete and verify in one pass.

1. ~~**SEC-11**~~ — done (`afa09cd`), 30 tests.
2. ~~**REL-03**~~ — done, 26 tests.
3. **REL-05** — implement an off-host backup destination interface with a
   filesystem implementation and a restore verification job; the off-host
   credential itself stays BLOCKED.
4. **BILL-03** — a provider adapter behind `PaymentVerifier` with signature
   verification and idempotency, testable against fixtures, inactive without
   credentials.
5. **REL-06** — a service-manager adapter for Node applications with health
   checking, so a detected server app can actually run.

## 7. Documentation progress

Each document is created in `docs/audit/` and `docs/operations/` as a
*reconciliation* file: it does not restate the 35 existing audit files, it
records what they got right, what this pass changed, and what remains.

| File | State |
|---|---|
| `docs/audit/REPOSITORY-INVENTORY.md` | written |
| `docs/audit/ARCHITECTURE-AND-DATA-FLOW.md` | written |
| `docs/audit/ROUTE-API-INVENTORY.md` | written |
| `docs/audit/DATABASE-AND-MIGRATION-AUDIT.md` | written |
| `docs/audit/AUTH-RBAC-SECURITY-AUDIT.md` | written |
| `docs/audit/WORKER-SCHEDULER-AUDIT.md` | written |
| `docs/audit/DEPLOYMENT-INFRASTRUCTURE-AUDIT.md` | written |
| `docs/audit/INTEGRATION-STATUS.md` | written |
| `docs/audit/TEST-AND-COVERAGE-REPORT.md` | written |
| `docs/audit/ISSUE-AND-REMEDIATION-MATRIX.md` | written |
| `docs/audit/PRODUCTION-READINESS.md` | written |
| `docs/operations/INSTALLATION.md` | written (154 lines) |
| `docs/operations/BACKUP-RESTORE.md` | written (127 lines) |
| `docs/operations/INCIDENT-RESPONSE.md` | written (116 lines) |
| `docs/operations/RELEASE-AND-ROLLBACK.md` | written (126 lines) |

Every file above was verified to exist with non-zero length before this row was
marked written; three of them were corrected during writing after checking the
source (see §9).

## 8. Session log

| Commit | Scope | Tests |
|---|---|---|
| `4255b37` | SEC-01 build isolation, SEC-02 git tenancy | +46 |
| `23cef42` | SEC-03 entitlement integrity, plan limits, no fabricated checkout | +26 |
| `5f87c0f` | SEC-07 agent task signing, transport, lifecycle | +23 |
| `8b6b5fb` | SEC-13 health classes, SEC-12 fixture refusal | +18 |
| `3dd87af` | SEC-05 client identity for rate limiting | +20 |
| `d1dc3d0` | SEC-06 verification gate, self-selected roles | +21 |
| `37b4a41` | SEC-13 identifier validation before the raw probe | +3 |
| `b5a523e` | audit baseline: 8 audit documents | 0 |
| `0d4ea40` | operations runbooks + 3 audit docs | 0 |
| `afa09cd` | SEC-11 host-level deploy settings operator-only | +30 |
| `ea15686` | REL-03 deploy worker supervision | +26 |
| `aa91fa1` | SEC-02 disconnect through shared rule | +4 |

## 9. Corrections made while writing the docs

Documentation that flatters the code is worse than none. Six claims were written,
checked against the source, and corrected:

| Claim | Reality | Where corrected |
|---|---|---|
| "No unit or timer supervises any worker" | `deploy/systemd/alo-automation-worker.service` + Compose `automation-worker` + a CI entrypoint check supervise the orchestrator. Only `scripts/deploy-worker.ts` is unsupervised. | `WORKER-SCHEDULER-AUDIT.md`, checklist REL-03 |
| "The restore path is refused" | Site restore is **real**: `helpers/alo-site-restore` verifies SHA-256 and aborts on mismatch. Only the **database** restore drill returns `NOT_IMPLEMENTED`. | `BACKUP-RESTORE.md`, `INTEGRATION-STATUS.md`, matrix DB-04 |
| "`npm run db:migrate -- --check`" | `db:migrate` is `prisma migrate deploy` and takes no such flags. The dry-run flags belong to `node scripts/apply-deploy-schema.mjs`. | `INSTALLATION.md` |
| "`curl ... \| jq -r '.version // .release'`" | `/api/health` reports `release.commitSha`, and `scripts/deploy-release.sh` verifies that exact field. | `RELEASE-AND-ROLLBACK.md` |
| Matrix summary "6 BLOCKED" | The table has 8. Counts are now parsed from the table, not hand-tallied. | `ISSUE-AND-REMEDIATION-MATRIX.md` |
| "`alo-site-backup <site-id> --dest …`" | The helper takes a **domain**, has no `--dest` (destination is fixed), and its actions are `create`/`list`/`cleanup`/`delete-one`. `alo-site-restore` takes `(domain, archive)`. | `BACKUP-RESTORE.md` |

### Test accounting across the pass

Baseline `0b51a10`: 67 files / 1017 tests. At `b5a523e`: 74 files / 1174 passed
plus 1 skipped. No test was deleted or weakened to make CI green; tests that
asserted defective behaviour were rewritten to assert the correct behaviour, and
the reason is recorded in each commit message. The single skip is the SEC-01
namespace test, skipped only where the OS cannot create a namespace.
