# Worker and Scheduler Audit

> Measured at `d1dc3d0`. Distinguishes what is durable and tested from what is
> merely present in the tree.

## 1. Execution paths

| Path | Entry point | Durability | Supervision | Status |
|---|---|---|---|---|
| Inline deploy worker | inside the Next.js process (`DEPLOY_INLINE_WORKER`) | `deployments` rows | the panel process | Implemented, tested |
| Job orchestrator (bundled) | `scripts/orchestrator-worker.ts` → `.next/standalone/automation-worker.cjs`, run by `deploy/systemd/alo-automation-worker.service` | `operation_jobs` rows | **systemd unit + Compose service + CI gate** | Implemented, tested, **supervised** |
| Standalone deploy worker | `scripts/deploy-worker.ts` → `.next/standalone/deploy-worker.cjs`, run by `deploy/systemd/alo-deploy-worker.service` | `deployments` rows | **systemd unit + Compose service + CI cross-check** | Implemented, **supervised** (REL-03, closed) |
| Agent task polling | the agent itself, `ALO_POLL_MS` | `agent_tasks` rows | systemd unit in `deploy/systemd` | Implemented |
| Cron endpoint | `/api/cron`, `/api/automation/cron` | — | external caller required | Implemented, **no caller shipped** |
| Alert evaluation | `/api/monitoring/collect` | alert rules | **no scheduler** | Read-only evaluation only |

### Correction to an earlier statement in this document

An earlier draft of this file — and the prior Phase 0 audit's §5.5 — said "no
supervised unit or timer is shipped for any worker". Investigating before
repeating it showed that is **wrong for the orchestrator**:

- `deploy/systemd/alo-automation-worker.service` runs
  `.next/standalone/automation-worker.cjs` (the esbuild bundle of
  `scripts/orchestrator-worker.ts`) with `Restart=always`, `RestartSec=5s`,
  `MemoryMax=2G`, `OOMPolicy=kill`, a 1900 s `TimeoutStopSec` for a graceful
  drain, and a `RuntimeDirectory` heartbeat file.
- `docker-compose.yml` has a matching `automation-worker` service.
- `deploy/README-hosting-engine.md` documents enabling it, and CI verifies the
  standalone entrypoint exists.

**REL-03 closed that gap.** `scripts/deploy-worker.ts` now ships with
`deploy/systemd/alo-deploy-worker.service`, a Compose `deploy-worker` service, and
a CI step that cross-checks every unit's `ExecStart` target against the build
output. The script itself gained the supervision contract the orchestrator worker
already had: SIGTERM/SIGINT drain, a heartbeat file rewritten each tick and every
15 s, a clamped poll interval, and no `process.exit()` on a failed tick.

The prior audit's statement is preserved here as a correction rather than quietly
edited, because an audit that overstates a gap is as damaging as one that
understates it.

## 2. Orchestrator guarantees (verified by test)

`tests/orchestrator.test.ts` (32 cases) covers:

| Property | Implementation |
|---|---|
| Durable jobs | `operation_jobs` table, survives restart |
| Idempotency | unique idempotency key; duplicate enqueue suppressed |
| Atomic claim | conditional update, one winner |
| Leases + reaper | expired lease returns the job to the queue |
| Retries | exponential backoff with jitter |
| Dead letter | `DEAD_LETTER` terminal state with the last error |
| Approval gate | `PRIVILEGED` and above require a named human approval with a TTL |
| Cancellation | `/api/orchestrator/jobs/[id]/cancel` |
| Per-key serialisation | `lockKey` |
| Redaction | every persisted log line passes `redact()` |

**Limitation, stated plainly:** `lockKey` serialisation is in-process only. With
two control-plane instances the same `lockKey` could run concurrently in each.
This is why the platform is documented as single-instance.

## 3. Worker contracts

| Worker | Verified behaviour | Honest refusal |
|---|---|---|
| site lifecycle | create/suspend/resume/terminate via helper | — |
| deploy | delegates to the deploy engine | — |
| backup | dump + verify | — |
| site restore | `helpers/alo-site-restore` verifies SHA-256 and aborts on mismatch | — real restore path |
| database restore drill | — | **returns `NOT_IMPLEMENTED`** rather than a false success |
| database provision | helper contract | **returns `NOT_IMPLEMENTED`** for the orchestrated path |
| certificate issue/renew | helper contract | **`NOT_IMPLEMENTED`** — does not claim issuance |
| agent task dispatch | signed task envelope | — |
| health probe | real HTTP + release marker | — |

A refusal that says `NOT_IMPLEMENTED` is the correct behaviour and is counted as
honest, not as a defect. It is listed here so nobody reads "10 workers" as "10
working capabilities".

## 4. Agent task lifecycle (changed this pass)

```
PENDING ──claim──► ASSIGNED ──start──► RUNNING ──result──► SUCCEEDED | FAILED | REFUSED
   │                   │                  │
   └── 5 min ──────────┴── no start ──────┴── overrun > timeoutMs + 60 s ──► TIMED_OUT
```

Before this pass:

- There was no `start` transition, so `RUNNING` was never set by the normal path.
- Expiry matched `status in (PENDING, ASSIGNED)` on `createdAt` with a 5-minute
  window, while allowlisted commands may run up to 10 minutes. A healthy
  long-running command was flipped to `TIMED_OUT` underneath the agent.
- The agent did not verify the task signature, and the signature did not cover
  every field the agent executed.

Now (`SEC-07`): a real start clock, expiry that measures the right thing per
state, a claim check that prevents duplicate execution of a task that was
expired or re-assigned, and a verified signature over the complete document.

## 5. Scheduling and time

| Concern | State |
|---|---|
| Timezone handling | all scheduling is UTC (`new Date()`, ISO storage) |
| Duplicate scheduler prevention | the orchestrator claim is atomic; there is no leader election for a multi-instance future |
| Graceful shutdown | the panel handles `SIGTERM`; the automation worker's unit sets `TimeoutStopSec=1900` and the worker drains its current job; `deploy-worker.ts` has no supervisor to send the signal |
| Job expiry | leases with a reaper (orchestrator); see §4 for agent tasks |
| Failure alerting | alert **rules** exist; **delivery** is unverified and no scheduler evaluates them on a timer |

## 6. Test evidence

| Suite | Cases | Subject |
|---|---|---|
| `tests/orchestrator.test.ts` | 32 | jobs, leases, retries, approvals, dead letter |
| `tests/agent-task-signing.test.ts` | 23 | signing, transport, lifecycle ordering |
| `tests/server-agent*.test.ts` | 26 | enrollment, heartbeat, inventory, allowlist |
| `tests/automation-center.test.ts` | — | automation definitions |
| `tests/migration-safety.test.ts` | 27 | applier locking and recovery |

## 7. Recommendations, in order

1. ~~Ship a systemd unit for `scripts/deploy-worker.ts`.~~ **Done (REL-03).**
   Remaining follow-up: an alert-evaluation timer (§7 item 2) so a dead worker
   pages someone rather than waiting to be noticed.
2. Add an alert-evaluation timer that calls `/api/monitoring/collect`, and prove
   one delivery to a real channel.
3. Publish RPO/RTO once an off-host backup destination exists.
