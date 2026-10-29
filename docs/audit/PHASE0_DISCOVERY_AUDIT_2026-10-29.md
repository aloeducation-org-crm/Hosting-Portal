# Phase 0 — Discovery Audit

**Date:** 2026-10-29
**Branch:** `arena/c04ebe8c-hosting-portal`
**Baseline commit:** `7fc3d15` (main) + audit commits on this branch
**Method:** direct repository inspection, a full local build, and execution of the existing test suite. No server access was available; every classification below states which of the two it rests on.

> **Nothing in this document is inherited from a previous session summary or from
> documentation claims.** Where a document asserted something, it was checked
> against code or a command. Where it could not be checked, the row says so.

---

## 0. Verified baseline (reproduced locally, this session)

| Gate | Command | Result |
|---|---|---|
| Dependencies | `npm ci --include=dev` | pass, 648 packages, **0 vulnerabilities** |
| Prisma client | `postinstall` → `prisma generate` | pass |
| Lint | `eslint src/` | **pass**, 0 problems |
| Typecheck | `tsc --noEmit` | **pass**, 0 errors |
| Tests | `vitest run` | **563 / 563 pass**, 40 files |
| Production build | `next build` | pass, standalone entrypoint present |

Baseline **before** this session's changes was **532 / 532 across 38 files**; the
difference is the 31 new tests added in §7. No existing test was skipped,
weakened or deleted.

**Size of the existing system:** 206 API routes, 91 Prisma models, 59 page
routes, 38→40 test suites, 17 `src/lib` subsystems.

---

## 1. Findings that change the plan

### 1.1 An entire duplicate dashboard is dead code — HIGH, verified

`src/components/platform/AppShell.tsx` defines a 19-view dashboard
(`ServersView`, `DomainsView`, `DatabasesView`, `StorageView`, `AgentsView`,
`MonitoringView`, …). **It is imported by nothing.** Verified:

```
grep -rn "AppShell" src   →   only its own definition
```

The live dashboard is the `src/app/dashboard/**` + `src/components/dashboard/**`
tree. Both trees exist and both compile, so the build cannot tell you that half
of it is unreachable:

| Tree | Files | Reachable |
|---|---|---|
| `src/app/dashboard/**` + `src/components/dashboard/**` | live routes | **yes** |
| `src/app/(dashboard)/**` + `src/components/platform/views/**` (19 views) | ~308 KB | **no** |
| `alo-hosting-portal/` (nested app, own Prisma schema) | 4.7 MB, **55 models** | **no** — not in `tsconfig` or `next.config` |

**Why this matters for the rest of the work:** every "the dashboard already
does X" claim must name *which* dashboard. Three surfaces exist, one is live,
and the nested one carries a **divergent schema (55 models vs 91)** that a
migration run could target by mistake. This is the same hazard the earlier audit
logged as R-03; it is re-confirmed here with counts.

**Not deleted.** Removing 3 unreachable trees is a large, destructive, reviewable
change that needs a maintainer decision. It is proposed as its own PR.

### 1.2 The live servers page fabricated hardware and health — HIGH, verified, **FIXED**

`GET /api/servers` inserted a hardcoded server whenever the table was empty — a
**write during a GET**:

```ts
name: "Primary Edge & App Node", ip: "100.85.239.114",
cpuCores: 4, ramGb: 15, diskGb: 100, region: "ap-south-1",
status: "ONLINE"
```

and `AdminServersManager.tsx` (the live component) filled every missing reading
with a plausible literal:

| Field | Fallback | Consequence |
|---|---|---|
| CPU | `?? 4` | claims 4 vCPU never measured |
| RAM | `?? 15` | claims 15 GB never measured |
| Disk | `?? 100` | claims 100 GB never measured |
| IP | `\|\| "127.0.0.1"` | claims loopback is the server's address |
| Status | `\|\| "ONLINE"` | claims a healthy host |
| OS / Role | `\|\| "Ubuntu 22.04 LTS"` / `"WEB"` | claims unset fields |

The status badge was **green for everything except `MAINTENANCE`** — so `OFFLINE`
and `ERROR` rendered as healthy green cards. An operator would size real work
against invented capacity and could not distinguish it from real telemetry.

Fixed in §7. The dead `ServersView.tsx` carries the same class of defect
(`Math.random()` CPU/RAM/disk, and a client-side timer that flips
`provisioning` → `running` with no backend confirmation); because it is
unreachable it is a latent hazard rather than a live lie, and it is folded into
the tree-removal proposal in §1.1.

### 1.3 UI/API status vocabulary mismatch — HIGH, verified

The `ServerStatus` enum is `ONLINE | ACTIVE | PROVISIONING | OFFLINE | ERROR |
MAINTENANCE`. The dead `ServersView` keys off `running | stopped | restarting |
provisioning` and falls back to `STATUS_CONFIG.stopped`, so on that tree **every
server renders as "Stopped" regardless of truth**, and no Start/Stop control ever
appears. Any future rewiring of that tree inherits the bug. The new presentation
layer normalises case/whitespace and maps unknown values to a grey `UNKNOWN`
that is explicitly **not** operational, so a new enum member surfaces as unknown
instead of silently green.

### 1.4 Three overlapping metric models, one with zero writers — MEDIUM, verified

| Model | Written by |
|---|---|
| `ResourceMetric` | `api/monitoring/collect`, `api/servers/discover` |
| `AgentMetric` | `lib/agents/agent.ts` |
| `ServerMetric` | **nothing — 0 writers** |

`Server` also carries denormalised `cpuUsage` / `memoryUsage` / `diskUsage`
columns that default to `0`. Four places to look for "what is this host doing",
one of which is dead and one of which presents an unset field as a measurement.
Reconciliation is a schema change and is **not** bundled into this audit.

---

## 2. Component classification

Legend: **VERIFIED** (exercised this session) · **PARTIAL** (code read, behaviour
not exercised) · **BROKEN** · **MISSING** · **DUPLICATE** · **DEAD** ·
**NOT VERIFIABLE** (needs infrastructure I do not have).

### Phase 1 — Core control plane

| Component | Status | Evidence |
|---|---|---|
| Auth / sessions / RBAC | **VERIFIED** | `tests/phase1-auth-rbac.test.ts` (7), `phase2-security-and-routes` pass; `requireAdmin`/`requireRole` used on the servers API |
| MFA (TOTP) | **PARTIAL** | backend + `UserMfa` model + status endpoint wired by PR #19 commit `884e2ec`; not exercised against a real authenticator |
| CSRF | **VERIFIED** | `tests/csrf.test.ts` |
| Secrets / encryption | **VERIFIED** | `tests/control-plane-secrets.test.ts` |
| Audit log | **VERIFIED** | `AuditLog` model, `db-audit.test.ts`; service-actor FK defect found and fixed in the CRM work |
| Durable job queue | **PARTIAL** | `OperationJob`, `src/lib/orchestrator/{contracts,orchestrator,workers}.ts`; `orchestrator.test.ts` passes. Restart-recovery and retry/backoff are **not** exercised |
| Server registry | **BROKEN → FIXED** | fabricated inventory, §1.2 |

### Phase 2 — Agents and provider adapters

| Component | Status | Evidence |
|---|---|---|
| Agent enrollment / nonce / rotate / revoke | **PARTIAL** | 13 routes under `api/agents/**` incl. `enroll`, `heartbeat`, `tasks/claim`, `tasks/result`, `tasks/[id]/approve`; `server-agent.test.ts` etc. pass. No live agent connected |
| Command allowlist | **PARTIAL, well built** | `lib/agents/allowlist.ts` (509 lines): argv-only (never shell strings), per-command Zod schema, risk level, timeout, `requiresSudo`, required scopes. This is a genuine trust boundary, not a stub |
| Hostinger adapter (Server C) | **PARTIAL** | `lib/providers/hostinger.ts`, token auth against `developers.hostinger.com`; **no live API call made** — plan tier unknown |
| cPanel adapter (Server D) | **PARTIAL** | `lib/providers/cpanel.ts`; **no live call** — credentials not available |
| Provider verification tracking | **VERIFIED** | `lib/providers/registry.ts` records `VerifiedAt`; refuses to claim verification without it |
| Bootstrap installer | **PARTIAL** | `alo-server-kit/` (setup/verify/status/backup/restore + stages), `agent/alo-agent.mjs`, `agent-bootstrap.test.ts`. **Not run on any host** |

### Phase 3 — Infrastructure management

| Component | Status | Evidence |
|---|---|---|
| Local host metrics | **VERIFIED** | `/api/monitoring/metrics` reads `os.*` + `statfs`, returns `bandwidth: null` rather than inventing it — correct |
| Per-server metrics | **BROKEN** | endpoint exists; live UI ignored it (§1.2). Fixed to consume `latestMetrics` |
| Inventory | **BROKEN → FIXED** | §1.2 |
| File manager | **PARTIAL** | `resolveWithinRoot` traversal guard present; protected-path deletion rules not exercised |
| Storage pools | **VERIFIED (unit)** | `lib/storage-pools.ts`, `bucketPath` + `resolveWithinRoot`, `storage-pools.test.ts`. All six pools ship with `bucketPath = null` ⇒ honest `409` |

### Phase 4 — Hosting automation

| Component | Status | Evidence |
|---|---|---|
| Deploy engine | **PARTIAL** | `src/lib/deploy/*` (16 modules): detect, config, engine, github, preflight, queue, redact, signature, start-command, webhook. `deploy-e2e`, `deploy-pipeline`, `deploy-detect`, `zero-terminal-deploy` all pass |
| GitHub integration | **PARTIAL** | `lib/deploy/github.ts` + `GitConnection`/`GitProject`/`WebhookDelivery`; note CI uses a PAT, **not** a GitHub App |
| Deployment status machine | **PARTIAL** | `Deployment`/`Release` models; the contract's 11 statuses are **not** all represented |
| Database provisioning | **PARTIAL** | `database-provisioning.test.ts` (5) pass, `DatabaseInstance`/`DatabaseCredential`; helper-backed. **Primary DB is SQLite, not MySQL 8** — see §4 |
| Reverse proxy | **PARTIAL** | `CaddySite` model + `Caddyfile`; Traefik is **not** present |
| Rollback | **PARTIAL** | release-guard + `ALLOW_RELEASE_ROLLBACK`, tested in `release-activation.test.ts` |

### Phase 5 — Domain, DNS, SSL, email

| Component | Status | Evidence |
|---|---|---|
| DNS records | **PARTIAL** | `DnsRecord` model, `api/network/dns/**`, `dns-provider.test.ts` pass |
| Authoritative DNS (PowerDNS) | **MISSING** | no engine, no zone server, no DNSSEC |
| Registrar integration | **MISSING** | no registrar API anywhere |
| SSL | **PARTIAL** | `SslCertificate`, `/api/ssl/*`; issuance not exercised |
| cPanel email | **PARTIAL** | `EmailAccount`, `api/email/**` incl. `dns-records`; **no live cPanel call** |

### Phase 6 — Storage, backup, recovery

| Component | Status | Evidence |
|---|---|---|
| Document vault (CRM) | **PARTIAL** | 8 endpoints + 80 conformance tests at `7cf8516`; **not deployed, no credential, pools unprovisioned** |
| Backups | **PARTIAL** | `Backup`/`BackupManifest`/`RestoreJob`, `api/backups/**` |
| Restore **testing** | **MISSING** | no restore has been performed anywhere; `restoreVerified` is correctly hard-`false` |
| Restic / encrypted offsite | **MISSING** | `alo-server-kit/backup.sh` exists; no Restic integration in the app |

### Phase 7 — High availability

| Component | Status |
|---|---|
| Replication | **MISSING** (`ReplicationStatus` model exists, no reconciler) |
| Failover | **MISSING** — correctly absent; enabling it without real failure simulations would be unsafe |
| `LoadBalancer` model | **DEAD** — no writer, no consumer found |

### Phase 8 — AI operations

| Component | Status | Evidence |
|---|---|---|
| Provider chain | **VERIFIED** | `ai-provider`, `ai-providers`, `ai-extra-providers`, `ai-security-and-routes` pass |
| Paid-inference guard | **PARTIAL** | `api/ai/token` was replaced from a fake `{token:"demo"}` stub; free-tier enforcement not re-verified against live providers |
| AI → infrastructure actions | **PARTIAL** | routed through the allowlist + approval (`tasks/[id]/approve`), which is the right shape |

### Phase 9 — Production readiness

| Item | Status |
|---|---|
| Production deployment | **UNVERIFIED** — records contradict each other (documented in `CRM_ADAPTER_VERIFICATION_2026-10-29.md`) |
| Required reviewer on `production` | **OPEN — verified absent** |
| Branch protection on `main` | **NOT VERIFIABLE** — API returns 403 |
| Servers A/B/C/D connected | **NONE** — no access from this environment |

---

## 3. Fabrication sweep

Targeted search of the **live** trees for invented data:

| Pattern | Live surface | Verdict |
|---|---|---|
| `Math.random()` | `components/ui/sidebar.tsx:611` | **Benign** — loading-skeleton width, not a metric |
| Random CPU/RAM/disk | `platform/views/ServersView.tsx` | **Dead tree**, latent hazard (§1.1) |
| `?? 4` / `?? 15` / `?? 100` / `\|\| "ONLINE"` | `dashboard/AdminServersManager.tsx` | **Live — FIXED** (§7) |
| Writes during GET | `api/servers/route.ts` | **Live — FIXED** (§7) |
| Fake `{token:"demo"}` | `api/ai/token` | Already replaced previously; confirmed absent |
| Fabricated `restoreVerified` | storage backup endpoint | Correctly hard-`false` |

The live dashboard is otherwise clean: no synthetic chart series and no
placeholder metric arrays were found in `src/components/dashboard/**` or
`src/app/**`.

---

## 4. Storage and database — decision needed

`prisma/schema.prisma` declares **`provider = "sqlite"`**, while the brief
mandates **MySQL 8** as primary. This is not a cosmetic mismatch:

- `src/lib/identity/student-id.ts` **in the CRM** relies on MySQL
  `LAST_INSERT_ID` semantics. The Hosting-Portal's own schema does not, but any
  future cross-repository identity work will.
- A provider change is a **migration**, not a config edit, and must not be
  bundled with feature work.

**Recommendation:** keep SQLite for now, record the MySQL 8 target as an explicit
Phase 4 decision with its own approved migration plan. Do **not** switch
providers inside this audit.

---

## 5. Duplication register

| # | Duplicate | Recommendation |
|---|---|---|
| D-1 | 3 dashboard surfaces (live / dead / nested app) | Remove dead + nested in one reviewable PR (§1.1) |
| D-2 | 3 metric models (`ResourceMetric`/`AgentMetric`/`ServerMetric`) + `Server.cpuUsage` columns | Consolidate onto `AgentMetric`; needs a migration |
| D-3 | `Server` vs `ServerAgent` vs `Site` vs `Website` | Needs a domain-model decision, not an audit guess |
| D-4 | Two settings surfaces (`SettingsView` vs `dashboard/settings`) | Consolidate |

---

## 6. Blockers (precise)

| # | Blocker | Needed to clear |
|---|---|---|
| B-1 | No access to Servers A/B/C/D | SSH/Tailscale reachability from the execution environment; without it Phases 2, 5–7 cannot be verified |
| B-2 | No GitHub App credentials | App installation to replace the PAT currently used |
| B-3 | Hostinger plan tier unknown (shared/VPS/cloud) | Account/plan confirmation before any adapter is claimed to work |
| B-4 | cPanel credentials + WHM API token absent | Provider-issued token |
| B-5 | Registrar + DNS authority unknown | Which registrar holds `alolabs.net`; no authoritative DNS engine exists |
| B-6 | Production reviewer not configured | Repository admin action (cannot be set from a workflow) |
| B-7 | `production` run time-of-day contradiction | Host inspection on `alo-server-lap` |
| B-8 | SQLite vs MySQL 8 | Approved migration plan |

---

## 7. This session's change (Phase 0 → first repair)

Scoped deliberately to **one live, verifiable honesty defect** rather than
starting Phase 1-wide work on top of a registry that fabricates its own state.

**New (pure, tested):**

- `src/lib/infrastructure/server-registry.ts` — builds the registry response from
  real rows only; `primary` is `null` rather than a synthetic row;
  `enrollmentRequired` / `allServersUnavailable` / `stateDetail` distinguish
  "nothing registered" from "everything is down".
- `src/lib/infrastructure/server-presentation.ts` — `describeServerStatus`
  (unknown ⇒ grey, non-operational; only `ONLINE`/`ACTIVE` are operational),
  `formatCapacity` (absent/zero-negative ⇒ `Not reported`), `formatAddress`
  (never `127.0.0.1`), `formatReported`, `describeRegistryState`.

**Changed:**

- `src/app/api/servers/route.ts` — removed the hardcoded seed and the write
  during GET; the response now carries `primary`, `enrollmentRequired`,
  `allServersUnavailable`, `stateDetail`. `systemData` is retained and labelled
  in code as describing **this** control-plane host, never a remote server.
- `src/components/dashboard/AdminServersManager.tsx` — all six fabricated
  fallbacks replaced with the presentation helpers; badge colour now derives from
  status tone; honest empty/warning state added.

**Tests:** `tests/server-registry-honesty.test.ts` (14),
`tests/server-presentation-honesty.test.ts` (17) = **31 new**.

Verification after the change: lint 0 · typecheck 0 · **563/563 tests** ·
build pass · standalone entrypoint present.

---

## 8. Recommended next phase

Phase 1 is **not** the next step despite the brief's ordering, because one item
inside it is load-bearing for everything after it and is currently unverified:

**Next: reconcile the deployment truth.** Confirm which commit production runs
and why the deployment records disagree (B-7), then confirm the reviewer gate
(B-6). Every later phase asserts "deployed and verified" against that baseline;
building on a baseline that cannot be established would make each subsequent
verification claim untrustworthy.

**Then:** Phase 2 (agent enrollment) — it needs B-1, and it unlocks real
inventory, real metrics and real storage-pool provisioning, which in turn
removes the remaining `Not reported` states by *supplying data* rather than by
reintroducing defaults.

---

## 9. Not done, and why

No deployment, migration, DNS/email/firewall/TLS change, credential creation,
vault activation, or branch/environment protection change was performed. No host
was contacted. No claim in this document rests on an unexecuted command.
