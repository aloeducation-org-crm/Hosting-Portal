# Hybrid Infrastructure Plan — Hostinger Cloud + Office A + Office B

**Status:** the control-plane software described here is **built and tested** in this repository. The
infrastructure steps are **not yet executed** — nothing has been installed on Office A or Office B, no
replication is configured, no failover has been drilled, and no load test has been run. Every row below
says which of those two states it is in.

**Owner:** ALO Education ops
**Last updated:** 2026-10-27
**Branch of record:** `arena/b2ec9268-hosting-portal`

---

## 1. What this plan is for

One dashboard, three physical hosts, zero manual coding per new project. A developer connects a GitHub
repository, names the project and domain, and the platform detects the framework, builds, deploys, health
checks, rolls back, monitors and backs up — with a human approval gate on anything privileged or
destructive.

The hardware is fixed for now and is **not** to be expanded on guesswork:

| Host | Spec (as reported) | Public? | Role in this plan |
| --- | --- | --- | --- |
| Hostinger Cloud | 4 GB RAM / 100 GB SSD, < 25 GB used, 2 vCPU observed | Yes | **Sole public production**: Next.js panel (PM2) + database |
| Office Server A | Core i5 / 16 GB RAM / SSD / static IP / UPS | No | Database replica (if binlog is available) + recovery instance |
| Office Server B | ~8 GB RAM / SSD / static IP / UPS | No | CI/build worker + staging + monitoring + local backup copy |
| Offsite storage | not purchased | n/a | **Mandatory** encrypted offsite backup copy |

Agreed constraints that shaped every decision below:

- Office uplink is **10–50 Mbps**. Nothing on the public request path may depend on it.
- Acceptable downtime is **a few hours**. That makes a *tested manual* failover sufficient and an
  *untested automatic* failover a net risk.
- Target is **500+ concurrent users**, which has never been load-tested. Concurrent users are not load;
  requests/second and query cost are.
- **Buy RAM/SSD only after going live and measuring real workload.** No hardware purchase is authorised by
  this document.
- **A replica is not a backup.** A dropped table or a bad migration reaches a replica in milliseconds.
- The panel's own Prisma database is **SQLite/libSQL** (`file:./db/custom.db`), while the production
  service database is **reported** as MySQL/MariaDB. Those are two different systems. This plan never
  assumes they are interchangeable and never silently converts one into the other.

---

## 2. Evidence first: what is measured and what is not

The panel refuses to render a fabricated number. Every host carries a `dataState`:

| `dataState` | Meaning | UI renders |
| --- | --- | --- |
| `live` | an agent heartbeat arrived inside the 3-minute online window | real metrics |
| `stale` | an agent is enrolled but its heartbeat is too old | last known values, flagged stale |
| `unavailable` | no agent has ever reported | **"not measured"**, never `0` |
| `revoked` | the agent's credentials were revoked | excluded from capacity claims |

Implemented in `src/app/api/infrastructure/topology/route.ts` and
`src/components/infrastructure/UnifiedInfrastructure.tsx`.

**Open, blocking question:** does the Hostinger Cloud plan expose MySQL/MariaDB binary logging to the
tenant? Until that is answered, Office A is a *backup restore target*, not a streaming replica, and this
plan says so explicitly (`placementPlan()` in `src/lib/infra/db-audit.ts`, covered by
`tests/db-audit.test.ts`).

Answer it read-only, on the host, with:

```bash
node scripts/audit-database.mjs            # human readable
node scripts/audit-database.mjs --json     # machine readable
node scripts/audit-database.mjs --host hostinger-cloud --write   # also record it in the panel
```

The script never writes to the database server, never restarts anything, never accepts a password
argument (use `~/.my.cnf` or `--defaults-file`), and never prints a connection string — only its scheme
and host shape.

A sandbox run of that script produced, honestly: panel provider `sqlite`, service DB engine `unknown`,
client available `false`, replication variables *not observed*, capacity 2 cores / 3.8 GB RAM / disk 2.1
of 20.3 GB, 2 warnings, exit 0. That is the correct behaviour for an unmeasured host — it reports the
absence of evidence instead of inventing a verdict.

---

## 3. The build process from first step to now

Phases 1–7 of the implementation are complete in this branch. Phase 8 (testing) is the one you are
reading the results of; Phase 9 is the production plan in §4.

### 3.1 Durable job orchestrator (control plane)

`src/lib/orchestrator/{contracts,orchestrator,workers}.ts`

Work is a **database row**, not an in-memory promise, so a panel restart, a deploy or a crash cannot lose
it or run it twice.

- States: `QUEUED → RUNNING → VERIFYING → SUCCEEDED / FAILED`, plus `WAITING_APPROVAL`, `RETRYING`,
  `DEAD_LETTER`, `CANCELLED`, `ROLLED_BACK`.
- **Idempotency**: an `idempotencyKey` makes a repeated enqueue return the existing job
  (`duplicate: true`) instead of creating a second one — this is what makes "a verified GitHub event
  deploys exactly once" true even when GitHub retries a webhook.
- **Leases**: a running job holds `leaseExpiresAt` + `leasedBy`. `recoverAbandoned()` requeues jobs whose
  worker died and counts the dead attempt against the retry budget.
- **Per-key serialization**: at most one active job per `lockKey` (normally the project), enforced *inside*
  the same conditional `UPDATE` as the claim, so two workers cannot both pass the guard.
- **Retries with exponential backoff + jitter**, `NON_RETRYABLE_CODES`, and a **dead-letter** state that
  only a named human can requeue (`requeueDeadLetter`, audited as `JOB_REQUEUED`).
- **Approval gates**: `PRIVILEGED` and `DESTRUCTIVE` jobs wait for `approve(jobId, actor, note)`. A caller
  cannot lower a worker's declared risk level — the worker's `maxRisk` always wins.
- **Audit trail**: every transition writes `audit_logs` with the actor's identity, and every event string
  passes through secret redaction.
- **Targeted execution**: `runNext(workerId, { jobId })` runs one specific job and never silently picks up
  somebody else's.
- Platform-wide jobs need no website: `operation_jobs.websiteId` is nullable
  (migration `20261027093000_operation_jobs_platform_scope`).

Evidence: `tests/orchestrator.test.ts` — **32 tests**, including a real end-to-end deployment through the
`BUILD_TEST` worker against a throwaway git repository.

### 3.2 Ten specialized workers

`src/lib/orchestrator/workers.ts` — registry plus `defineWorker()` contracts. Each worker declares its
execution surface (`LOCAL` / `AGENT` / `EXTERNAL`), maximum risk, required scopes, timeout and retry
policy, and must return one of:

- `ok(data, message)` → `verified: true`
- `unverified(data, message)` → `verified: false` (honest "we could not confirm this")
- `fail(code, message)`
- `throw new WorkerError(code, message, retryable, details)` — `details` is merged back into the stored
  job input on retry (`mergeInput`), which is how the infrastructure worker polls an agent task instead of
  re-dispatching it.

| Worker | Surface | Risk | What it really does |
| --- | --- | --- | --- |
| `REPO_DISCOVERY` | LOCAL | READ_ONLY | GitHub repo/branch/commit manifest fetch |
| `FRAMEWORK_DETECTION` | LOCAL | READ_ONLY | existing detection engine over the fetched tree |
| `BUILD_TEST` | LOCAL | REVERSIBLE | the existing verified deploy engine; `maxAttempts = 1` |
| `SECURITY_ANALYSIS` | LOCAL | READ_ONLY | secret/dependency scan; critical finding → `SECURITY_CRITICAL` |
| `RELEASE` | LOCAL | READ_ONLY | release marker + sha256 digest of the artifact |
| `INFRASTRUCTURE` | AGENT | PRIVILEGED | dispatches an allowlisted task, then polls `agentTask` |
| `DATABASE_OPS` | AGENT | DESTRUCTIVE | audit / migration *plan*, never an unplanned write |
| `DOMAIN_TLS` | EXTERNAL | PRIVILEGED | DNS + certificate state from the provider |
| `MONITORING_RECOVERY` | LOCAL | PRIVILEGED | real HTTP health probe; rollback via `rollbackProject()` |
| `BACKUP_RESTORE` | LOCAL | DESTRUCTIVE | real sha256 verification, updates `backups` |

Nothing in this table fabricates success. Where a worker cannot confirm an outcome it returns
`unverified`, and the dashboard shows that.

### 3.3 Secure server agent

`agent/alo-agent.mjs` (host side) + `src/lib/agents/{allowlist,agent,http}.ts` (panel side).

- **Enrollment**: `alo_enroll_*` token, sha256-hashed at rest, 15-minute TTL, **single use** via an atomic
  claim. Credentials `alo_agt_*` / `alo_ags_*`; the secret is returned exactly once and stored encrypted.
- **Requests**: HMAC-SHA256 over `timestamp.nonce.sha256(body)`, ±5 minute replay window, minimum nonce
  length, constant-time comparison. Failures are rejected **and** audited (`AGENT_AUTH_FAILURE`).
- **Allowlist**: nine commands, argv-only, never shell strings. The agent carries a **second compiled-in
  copy** and re-validates arguments, so a compromised control plane still cannot widen what a host runs.
  A new agent gets **read-only capabilities only**; `service.restart` and `backup.database` must be granted
  explicitly.
- **No root shell, no exposed Docker socket, no SSH or database port** is reachable from the AI layer or
  from the agent API. `sudo -n` is used only for the two allowlisted entries that declare it.
- **Task approval gate**: a PRIVILEGED/DESTRUCTIVE task is dispatched with `requiresApproval` and no
  `approvedBy`, and `claimTask()` will not hand it to a host until an administrator approves it
  (`approveAgentTask`, `POST /api/agents/tasks/{id}/approve`, audited with the approver's identity).
  Refusing it (`rejectAgentTask`) marks it `REFUSED` so it can never be claimed.
- **Egress redaction**: the agent strips GitHub tokens, AWS keys, private key bodies, database URLs with
  passwords and `password=…` values before anything leaves the host; the panel redacts again on write.
- **SSRF guard**: `health.probe` accepts loopback / RFC1918 / link-local / CGNAT only. Hostnames are
  refused because they can resolve anywhere.
- **Honest refusals**: `db.replication-status` refuses until credentials exist on the host in
  `/etc/alo-agent/db.cnf` — it will not take credentials from the panel or from argv.

Evidence: `tests/server-agent.test.ts` — **37 tests**, including a real loopback HTTP probe, a real
failing `df` invocation (reported `FAILED` with its exit code, never as success), and a proof that the
agent's signature verifies against the panel's verifier byte-for-byte.

### 3.4 GitHub integration

Signed webhook verification, delivery de-duplication, exact commit SHA checkout, atomic releases, health
check, automatic rollback, per-project history — built on the **existing** deploy engine, which the
orchestrator now drives as the `BUILD_TEST` worker instead of duplicating it.

Evidence: `tests/deploy-e2e.test.ts`, `tests/deploy-github-api.test.ts`, and the deployment case inside
`tests/orchestrator.test.ts` ("deploys a good commit, then fails a broken one without replacing it").

### 3.5 Dashboard

`/infrastructure` (admin-only, enforced in `src/middleware.ts`): topology, agents, replication, queue,
allowlist, workloads, backups and data state — one page, assembled only from observed data, with
empty states that tell you which command to run instead of showing zeros.

The queue tab lists orchestrator jobs (approve / reject / cancel / requeue) **and** agent tasks waiting
for a human, so nothing privileged runs without a named decision.

### 3.6 Database placement & capacity logic

`src/lib/infra/db-audit.ts` — pure functions, no I/O, fully unit-tested
(`tests/db-audit.test.ts`, **40 tests**):

- `describeDatabaseUrl` — shape only, never echoes a credential; flags a **relative** `file:./db/custom.db`
  as the production failure mode it already caused once (it breaks under PM2/systemd/CI).
- `parseEngineFromVersion` / `sameFamily` — a bare `8.0.36` is `unknown`, and MySQL vs MariaDB is a
  **blocked** topology, because their GTID implementations are not interchangeable.
- `replicationCapability` — `log_bin=OFF` ⇒ replication impossible ⇒ fall back to verified backups;
  SQLite ⇒ no streaming replication at all; missing client ⇒ "not observed", nothing assumed.
- `failoverReadiness` — automatic failover that has never been drilled is **blocked**; unhealthy
  replication is **blocked**; lag > 60 s is a warning that quantifies the possible data loss.
- `capacityVerdict` — 85 % RAM is blocked, 70 % is a warning, sharing a 4 GB host with the database is a
  warning with concrete tuning (`innodb_buffer_pool_size ≈ 1–1.5 GB`, PM2 `max_memory_restart`), and
  **without a load test the verdict can never be "adequate"**.
- `placementPlan` — the table in §1, with the assumption behind each row stated.

---

## 4. Stage sequence to go live

Each stage has an explicit gate. Do not start the next one until the previous gate is recorded.

### Stage 0 — Baseline on Hostinger Cloud (no changes) · ~1 hour

1. `node scripts/audit-database.mjs --json` on the production host; save the output.
2. `bash scripts/server-doctor.sh`; save the output.
3. Record: engine + version of the service DB, `log_bin`, `binlog_format`, `gtid_mode`, `server_id`,
   RAM/CPU/disk headroom, PM2 process list, nginx vhosts, certificate expiry.
4. Confirm `DATABASE_URL` is an **absolute** path in production.

**Gate:** the audit JSON is stored and the panel's Topology tab shows the production node as `live`
(agent installed in Stage 1) or explicitly `unavailable` — never a guessed value.

### Stage 1 — Agents on all three hosts · ~2 hours, no downtime

1. In the dashboard (Infrastructure → Agents) create an enrollment token per host: `office-a`, `office-b`,
   `hostinger-cloud`. Tokens are single-use and expire in 15 minutes.
2. On each host:
   ```bash
   ALO_PANEL_URL=https://<panel-host> ALO_ENROLL_TOKEN=alo_enroll_... \
     node agent/alo-agent.mjs --name office-a --enroll
   ```
   then run it under systemd (non-root user, `sudo -n` only for the two allowlisted commands).
3. Grant capabilities **explicitly**: read-only by default; add `service.restart` / `backup.database` only
   where the role needs it.
4. Verify heartbeats turn each node `live` and that the Server rows show real CPU/RAM/disk.

**Gate:** three agents `live`; one read-only task (`metrics.collect`) executed end to end; one
PRIVILEGED task dispatched, **refused by the gate**, approved by a named admin, then executed.

**Rollback:** revoke the agent from the dashboard. Revocation is immediate — the next signed request is
rejected and the task dispatch is refused.

### Stage 2 — Office B: CI/build + staging + monitoring · half a day

1. Self-hosted runner with **scoped** credentials (repository read + deploy key for staging only).
   Never give it production database access.
2. Staging copy of the panel on its own SQLite file and its own `DATABASE_URL`.
3. Builds run here, serialized, so they never compete with production on the 4 GB host.
4. Monitoring/alerting: agent heartbeats, queue depth, dead letters, oldest queued job, certificate
   expiry, disk high-water.

**Gate:** a real commit deploys to staging through the orchestrator with no manual step; a deliberately
broken commit fails the build and leaves the previous staging release live.

### Stage 3 — Backups: the non-negotiable · ~2 hours

1. Hostinger: daily full dump + panel SQLite copy + release directory, via the existing
   `scripts/backup.sh`, recorded through the `BACKUP_RESTORE` worker so the row carries a real sha256.
2. Office B: **local second copy** (rsync over the office LAN).
3. Offsite: encrypted copy, daily full + binary-log shipping **only if** Stage 0 proved `log_bin=ON`;
   14–30 day retention.
4. Restore is verified or it did not happen: `restoreDrillEverRun` must become true in the Topology tab.

**Gate:** one full restore drill onto Office A, from the offsite copy, with the measured duration written
into §5.3. Only then does the offsite copy count as a backup.

### Stage 4 — Office A: replica *or* restore target · depends on Stage 0

**If `log_bin=ON` and the same engine family + version can be installed:**

1. Install the **same family and minor version** as the primary (MySQL↔MariaDB mixing is blocked).
2. Unique non-zero `server_id` on both hosts; `binlog_format=ROW`; GTID on if the engine supports it.
3. Create a replication user, seed from the Stage 3 backup, start the replica read-only.
4. Record `Replica_IO_Running` / `Replica_SQL_Running` and lag into `replication_status` so the dashboard
   shows real lag.
5. Alert above 30 s of lag.

**If `log_bin=OFF` (or the plan does not expose it):** Office A is a **backup restore target**. Install the
panel + database engine, keep a warm restored copy refreshed on a schedule, and do not describe it as a
replica anywhere — the dashboard will say "Binary logging was NOT confirmed".

**Gate:** either `SHOW REPLICA STATUS` healthy with lag < 60 s for 24 hours, or a documented warm-restore
schedule with a measured restore time.

### Stage 5 — Load test · one maintenance window, staging only

Run against **staging on Office B** first, then a short window against production with a read-mostly
profile. Record, at 100 / 250 / 500 concurrent users:

- p50/p95/p99 latency, error rate
- CPU %, RAM %, disk latency on the panel host
- database connections, slow query log, buffer-pool hit rate
- office uplink saturation (this is the constraint most likely to break first)

**Gate:** a written result. This is the evidence that authorises a hardware purchase — until it exists,
`capacityVerdict` will keep returning "No load test at 500 concurrent users", by design.

### Stage 6 — Failover drill (manual, approval-gated) · one window

1. Announce the window; freeze deployments.
2. Simulate primary loss: stop the panel service on Hostinger (do **not** touch the database yet).
3. Promote Office A: verify data freshness, point DNS/nginx at it, start the panel, run health checks.
4. Measure: detection → decision → promotion → verified traffic. Write the number into §5.3.
5. Fail back, then re-verify replication direction.

**Gate:** measured failover time **inside** the acceptable downtime. Automatic failover stays **off**
until at least two drills have passed; `failoverReadiness()` blocks it in the meantime.

### Stage 7 — Go live + measure

Enable MFA for privileged users, confirm RBAC and tenant isolation, watch the queue and the audit log for
a week, and only then re-open the hardware question with data in hand.

---

## 5. Runbooks

### 5.1 Audit a host (read-only)

```bash
node scripts/audit-database.mjs --host office-a --write
bash scripts/server-doctor.sh
```

### 5.2 Apply the schema safely

`prisma migrate deploy` cannot be used here (client engine, no `_prisma_migrations`), so the repository
ships an idempotent applier:

```bash
DATABASE_URL="file:/absolute/path/db/custom.db" node scripts/apply-deploy-schema.mjs --check
DATABASE_URL="file:/absolute/path/db/custom.db" node scripts/apply-deploy-schema.mjs
```

Table-rebuild migrations carry a **post-condition** (for example `PRAGMA` check that
`operation_jobs.websiteId.notnull = 0`) so they are skipped wholesale once satisfied, and re-running the
applier is always safe. Always copy the database file first; the rebuild migration
`20261027093000_operation_jobs_platform_scope` rewrites `operation_jobs` and then rebuilds `audit_logs`
to restore its foreign-key text (SQLite rewrites stored FK text on `RENAME`).

Verified: row counts identical before/after (`audit_logs` 22, `users` 3, `websites` 1, `deployments` 2,
`git_projects` 1), FK text intact, 11 + 6 indexes recreated.

### 5.3 Measured numbers (fill in as drills happen)

| Drill | Date | Duration | Result | Notes |
| --- | --- | --- | --- | --- |
| Offsite restore onto Office A | — | — | not run | required by Stage 3 |
| Manual failover, panel only | — | — | not run | required by Stage 6 |
| Manual failover + promotion | — | — | not run | required by Stage 6 |
| Load test 500 concurrent | — | — | not run | required by Stage 5 |

Until these rows have dates, the dashboard shows them as *not verified* and this plan does not claim
failover capability.

### 5.4 Run the orchestrator worker

```bash
npx tsx scripts/orchestrator-worker.ts        # claims and executes queued jobs
npx tsx scripts/deploy-worker.ts              # existing deployment worker
```

---

## 6. Security controls

- MFA for privileged users; RBAC (`SUPER_ADMIN`/`ADMIN`/`DEVOPS`/`SUPPORT`/`VIEWER`/`RESELLER`/`CLIENT`).
- `/infrastructure` is admin-only in the UI **and** the API; `/api/agents` writes are admin-only through a
  method-specific guard so the existing AI-agent catalogue still serves signed-in clients.
- Agent endpoints are session-exempt but HMAC-authenticated, with a replay window and nonce.
- Tenant isolation on website/project queries; CSRF protection on mutations; SSRF guards on outbound
  probes; secret redaction on every stored string and log line; audit log for every mutation, approval,
  refusal and auth failure.
- A remaining known gap is recorded in §8: a CSRF token per mutation is still missing (pre-existing).

---

## 7. Hardware: when to buy more, and what

The decision is **evidence-triggered**, not calendar-triggered:

| Observation (from real metrics) | Action |
| --- | --- |
| RAM ≥ 85 % on the production host | blocked → raise RAM tier or move the DB off the host |
| RAM 70–85 % | keep builds/CI off this host, re-measure at peak |
| CPU ≥ 80 % sustained **and** request-driven | move builds and backups first; add vCPU only after that |
| Disk ≥ 80 % | prune old releases, rotate backups offsite, expand before 90 % |
| p95 latency rising while CPU/RAM are low | database-side: buffer pool, indexes, query cost — not RAM |

Order of spend, once Stage 5 evidence exists: **RAM on Hostinger first** (the app and the DB share it),
then a **second VPS** only if the load test or a failover drill shows the office path cannot carry the
recovery role. No auto-scaling is assumed anywhere in this plan.

---

## 8. Known gaps, risks and blockers

| Item | State | Impact |
| --- | --- | --- |
| Hostinger binlog availability | **unknown** | decides replica vs restore target (Stage 0 answers it) |
| Production DB is MySQL/MariaDB while the panel is SQLite | unresolved by design | never converted silently; a migration would be a separate rehearsed project with backups, staging, cutover and rollback limits |
| Automatic failover | **blocked** until two drills pass | intentional |
| CSRF token per mutation | missing (pre-existing) | medium; session + SameSite still apply |
| `agents.alolabs.net`, `marketing.alolabs.net` | hosts not in this checkout | those surfaces stay out of scope (see `docs/ROADMAP-STATUS.md`) |
| DNS / nginx / PM2 state | not reachable from the build sandbox | Stage 0 must record it on the host |
| Offsite storage provider | not chosen | Stage 3 cannot complete without it |
| Load test at 500 concurrent users | never run | capacity claims stay "not measured" |
| Legacy `alo-hosting-portal/` subtree | **do not deploy** | deploying it previously caused login 307s |

---

## 9. Test evidence for the control plane

```
npx tsc --noEmit        → clean (exit 0)
npx vitest run          → 22 files, 278 tests passed, 0 failed
```

| File | Tests | Covers |
| --- | --- | --- |
| `tests/orchestrator.test.ts` | 32 | durability, idempotency, leases, backoff, dead-letter, approval gates, cancellation, redaction, the 10-worker catalogue, real deployment |
| `tests/server-agent.test.ts` | 37 | allowlist, both copies of it, HMAC + replay window, enrollment single-use/expiry, task approval gate, redaction, SSRF guard, real probe, real failure |
| `tests/db-audit.test.ts` | 40 | engine/version parsing, family mismatch, binlog/GTID/server_id, failover readiness, capacity verdicts, placement plan |
| `tests/deploy-e2e.test.ts` and the rest | 169 | pre-existing behaviour — unchanged and still passing |

Test-suite hygiene fix included here: five pre-existing test files imported `@/lib/db` statically and
therefore wrote into the **tracked** development database. They now import
`tests/helpers/isolated-db.ts` first, which points `DATABASE_URL` at a throwaway copy; `db/custom.db` is
byte-identical after a full run (`git status` clean).
