# Implementation audit — ALO Hosting AI

**Baseline commit:** `cbf56fb` (branch `arena/c04ebe8c-hosting-portal`)
**`main`:** `7fc3d15` — unchanged, unmerged
**Date:** 2026-10-29
**Method:** direct repository inspection + a full local dependency install, lint,
typecheck, test run and production build. No host was contacted.

Evidence tags: `[SRC]` source code · `[TEST]` automated test · `[CI]` GitHub
workflow · `[HOST]` direct host observation · `[REPORTED]` not independently
verified · `[BLOCKED]` missing access or approval.

---

## 1. System size — re-derived, not carried forward

| Metric | Value | Prior claim | Tag |
|---|---|---|---|
| API routes | **207** | 206 | `[SRC]` |
| Prisma models | **91** | 91 | `[SRC]` |
| Page routes | **60** | 59 | `[SRC]` |
| Test files | **42** | 38 | `[SRC]` |
| Migrations | **10** | — | `[SRC]` |
| Agent allowlist | **588 lines, 31 commands** | "≈509 lines" | `[SRC]` |
| DB provider | **sqlite** | sqlite | `[SRC]` |
| `src/lib` subsystems | 10 dirs | "17" | `[SRC]` |

Two prior figures were wrong: the allowlist has grown to 588 lines with 31
allowlisted commands, and there are 10 `src/lib` *directories* (the "17
subsystems" figure presumably counted modules). Both corrected here rather than
repeated.

---

## 2. Baseline gates — this session

| Gate | Command | Result |
|---|---|---|
| Install | `npm ci --include=dev` | 648 packages, **0 vulnerabilities** |
| Lint | `eslint src/` | **0 problems** |
| Typecheck | `tsc --noEmit` | **0 errors** |
| Tests | `vitest run` | **607 / 607**, 42 files |
| Build | `next build` | pass, `.next/standalone/server.js` present |

Test count grew 532 → 563 → 595 → 607 across the four sessions of this branch,
entirely from added tests. No existing test has been skipped, weakened or deleted.

---

## 3. Component classification

Legend: **VERIFIED** exercised this session · **PARTIAL** code read, behaviour not
exercised · **BROKEN** · **MISSING** · **DEAD** · **BLOCKED** needs infrastructure.

### Control plane

| Component | State | Evidence |
|---|---|---|
| Auth / sessions / RBAC | VERIFIED | `phase1-auth-rbac`, `phase2-security-and-routes` pass |
| CSRF | VERIFIED | `csrf.test.ts` |
| Secrets / encryption | VERIFIED | `control-plane-secrets.test.ts` |
| Audit log | VERIFIED | `AuditLog`, `db-audit.test.ts` |
| MFA (TOTP) | PARTIAL | backend + `UserMfa`; not exercised with a real authenticator |
| Job queue / orchestrator | PARTIAL | `OperationJob`, `orchestrator/*`; restart-recovery not exercised |
| **Server registry (declared 4-server)** | **NEW, VERIFIED** | `server-inventory.ts` + `/api/infrastructure/inventory`, 44 tests |
| Server registry (DB-backed) | VERIFIED | `/api/servers`, `/api/infrastructure/topology` |

### Agents

| Component | State | Evidence |
|---|---|---|
| Enrol / heartbeat / claim / result / approve / revoke / rotate | PARTIAL | 13 routes; tests pass; **no live agent has ever connected** `[BLOCKED]` |
| HMAC request signing + nonce replay store | VERIFIED (unit) | `agent.ts`, `AgentNonce @@unique([agentId, nonce])` |
| Single-use hashed enrolment token | VERIFIED (unit) | `AgentEnrollmentToken.tokenHash @unique` |
| Command allowlist | VERIFIED (unit) | 31 commands, argv-only, per-command Zod, risk levels, sudo flags, scopes |
| Bootstrap installer | PARTIAL | `alo-server-kit/`, `agent/alo-agent.mjs`; never run on a host `[BLOCKED]` |

### Infrastructure & monitoring

| Component | State | Evidence |
|---|---|---|
| Local host metrics | VERIFIED | `/api/monitoring/metrics` reads `os.*`+`statfs`, returns `bandwidth: null` rather than inventing it — behaviour preserved |
| Per-server metric models | **BROKEN/DUP** | 3 models; `ServerMetric` has **zero writers**; `Server.*Usage` default to `0` |
| Fabricated inventory on GET | **FIXED** | Phase 0 — hardcoded server insert removed |
| Freshness / staleness | **PARTIAL** | windows duplicated inline (`3 * 60_000`); no per-metric state `[SRC]` |
| File manager / storage pools | PARTIAL | `resolveWithinRoot` traversal guard, `bucketPath` null by default |

### Hosting automation

| Component | State | Evidence |
|---|---|---|
| Deploy engine | PARTIAL | `src/lib/deploy/*` (16 modules); `deploy-e2e`, `deploy-pipeline` pass |
| GitHub integration | PARTIAL | PAT-based, **not** a GitHub App |
| **App-level deploy API** | **OPEN governance gap (B-9)** | `WEBSITE_DEPLOY` alone triggers restart; see `B9-APPLICATION-DEPLOY-PATH.md` |
| Database provisioning | PARTIAL | `database-provisioning.test.ts` |
| Reverse proxy | PARTIAL | `CaddySite`; Traefik absent |

### Domain / DNS / SSL / email

| Component | State |
|---|---|
| DNS records | PARTIAL (`DnsRecord`, `api/network/dns/**`) |
| Authoritative DNS (PowerDNS) | **MISSING** |
| Registrar integration | **MISSING** |
| SSL | PARTIAL (`SslCertificate`; issuance not exercised) |
| cPanel email | PARTIAL (`api/email/**`; no live call) `[BLOCKED]` |
| Hostinger adapter | PARTIAL (`providers/hostinger.ts`; no live call) `[BLOCKED]` |

### Storage / backup / HA

| Component | State |
|---|---|
| CRM document vault | PARTIAL — not deployed, no credential, pools unprovisioned |
| Backups | PARTIAL (`Backup`/`RestoreJob`) |
| Restore **testing** | **MISSING** — no restore ever performed; `restoreVerified` correctly hard-`false` |
| Restic / encrypted offsite | **MISSING** |
| Replication | **MISSING** (`ReplicationStatus` model exists, no reconciler) |
| Failover | **MISSING** — correctly absent |

### AI

| Component | State |
|---|---|
| Provider chain | VERIFIED (`ai-provider*`, `ai-security-and-routes`) |
| Paid-inference guard | PARTIAL |
| AI → infra actions | PARTIAL, routed through allowlist + approval (correct shape) |

---

## 4. Structural debt

| # | Issue | Impact |
|---|---|---|
| D-1 | **Three dashboard trees**: live (`app/dashboard`), dead (`components/platform/**, AppShell` imported by nothing), nested app (`alo-hosting-portal/`, 55 models vs 91, absent from tsconfig) | a contributor can edit or migrate the wrong one |
| D-2 | 3 metric models + `Server.*Usage` mirrors; `ServerMetric` has 0 writers | four places to answer one question |
| D-3 | `Server` vs `ServerAgent` vs `Site` vs `Website` | no single domain model |
| D-4 | Two settings surfaces | fixes don't propagate |

None removed: each is a reviewable, potentially destructive change needing
maintainer sign-off (A-9).

---

## 5. What this audit does not claim

No host was contacted (`[BLOCKED]` A-6). No production change was made. No
component is described as production-verified. The running release remains
**unverified** — see `DEPLOYMENT_RECONCILIATION_2026-10-29.md` §6.
