# Real Lifecycle Proof — Remote-Node Acceptance

**Status: PASSED (independently verified).** This document replaces the previous
NOT-TESTED template with real, independently verified evidence gathered on
2026-11-13 (UTC) in a disposable sandbox that runs the full platform stack:
the panel (`:3051`), the orchestrator worker, two **distinct enrolled server
agents** simulating two Ubuntu hosts (each with its own mount namespace, site
root, edge proxy, pm2 and helpers), and a real SQLite-backed operations
database. Every claim below was verified from the operating system and the
database — not from the API's own success responses alone.

## 0. What this proves

| # | Acceptance target | Result |
|---:|---|---|
| 1 | A static site deployed and serving on **enrolled node A** through the full lifecycle workflow | **PASS** — run `28e583ee`, SUCCEEDED, verified=1 |
| 2 | A Node.js app deployed and serving on **enrolled node B** (a different agent) through the full lifecycle workflow | **PASS** — run `9e2abc68`, SUCCEEDED, verified=1 |
| 3 | Self-healing: detect a real outage, diagnose, roll back to the previous verified release, restart the process, and verify recovery — end to end, by the platform itself | **PASS** — run `b6e3941d`, SUCCEEDED, verified=1 |

Nodes are distinct: static site on agent `220780e5…` (acceptance-node-a), Node
app on agent `2b4ee39f…` (acceptance-node-b), each in its own mount namespace
with its own `/srv/alo-sites`, edge listener pair and pm2 daemon.

## 1. Environment

| Component | Identity / location |
|---|---|
| Panel | `alo-hosting-panel-9ea1ae7c`, port 3051 |
| Orchestrator worker | supervised `scripts/orchestrator-worker.ts`, ticks every 5 s, sweeps every ~65 s |
| Agent A (static) | `220780e5-6728-41f2-a891-9e4086a7824b`, edge `:8080` (http) / `:8443` (https) |
| Agent B (node app) | `2b4ee39f-73ab-4da2-9fae-71b88f77d24a`, edge `:8081` (http) / `:8444` (https), isolated mount namespace |
| Lifecycle workflow | `79474e43-3247-440a-be62-8c0ef45cdd3a` ("Repository to verified application") |
| Self-heal workflow | `7df74211-94e5-4a44-9f54-cb205b73c0af` ("Diagnose and recover application") |
| Static project | `00f2e31d…` / website `static-1.acceptance.alo.test`, port 4100, node A |
| Node project | `735b9b82…` / website `node-1.acceptance.alo.test`, port 4200, node B |
| Source repos | branch `acceptance/static-app` @ `8476b940`, branch `acceptance/node-app` @ `5e0b5b2eeca90f22e411a2e702cd4fd493183466` (zero-dep `server.js`) |

## 2. Static site on node A — run `28e583ee`

Started 2026-11-13T10:37:49Z via `workflow.run` with a pinned `commitSha`.
All 10 lifecycle steps SUCCEEDED (detect → install → lint → typecheck → test →
build → package → activate → service → verify), run `verified=1`, deployment
`19e4fc88…` recorded with `verifiedCommitSha`. Independent evidence:

```
$ curl -s -o /dev/null -w "%{http_code}" -H "Host: static-1.acceptance.alo.test" http://127.0.0.1:8080/
200
$ curl -sk -o /dev/null -w "%{http_code}" --resolve static-1.acceptance.alo.test:8443:127.0.0.1 https://static-1.acceptance.alo.test:8443/
200
$ curl -s -H "Host: static-1.acceptance.alo.test" http://127.0.0.1:8080/ | grep -o "<h1>[^<]*</h1>"
<h1>ALO Acceptance — Static Site</h1>
```

Listener confirmed on the node (`ss -ltn`: `127.0.0.1:4100`), and the
application-health monitor reports the project healthy with reason
`verified` (release-marker + HTTP check through the agent).

## 3. Node app on node B — run `9e2abc68`

Started 2026-11-13T10:45:55Z on the *other* agent. All 10 steps SUCCEEDED,
run `verified=1`. The service stage started the supervised process through the
node agent (`app.up` → pm2 service `alo-node-1.acceptance.alo.test`, port
4200); the verify stage confirmed the live commit over HTTP. Independent
evidence:

```
$ curl -s -o /dev/null -w "%{http_code}" -H "Host: node-1.acceptance.alo.test" http://127.0.0.1:8081/
200
$ curl -sk -o /dev/null -w "%{http_code}" --resolve node-1.acceptance.alo.test:8444:127.0.0.1 https://node-1.acceptance.alo.test:8444/
200
$ curl -s -H "Host: node-1.acceptance.alo.test" http://127.0.0.1:8081/ | grep -o "<h1>[^<]*</h1>"
<h1>ALO Acceptance — Node App</h1>
$ echo | openssl s_client -connect 127.0.0.1:8444 -servername node-1.acceptance.alo.test | openssl x509 -noout -subject -dates
subject=C = BD, O = ALO Labs, CN = node-1.acceptance.alo.test
notBefore=Nov 13 10:47:13 2026 GMT
notAfter=Dec 15 10:47:13 2027 GMT
```

Listener confirmed (`127.0.0.1:4200`), pm2 daemon on node B reports
`alo-node-1.acceptance.alo.test` online.

## 4. Self-healing, end to end — run `b6e3941d`

**Incident (injected):** the pm2 service on node B was deliberately stopped
(`pm2 stop`), leaving the release on disk and the edge returning
`502 {"error":"upstream unreachable"}`. No other change was made.

**Detection:** the `application-health` sweep (~65 s cadence) probed the
project **through its own node agent** (`health.probe
http://127.0.0.1:4200/`), recorded the failure, and emitted
`application.health.failed`, which triggered the self-heal workflow.

**Diagnosis** (step output, run `b6e3941d`):

```json
{"action":"rollback","projectId":"735b9b82…","domain":"node-1.acceptance.alo.test",
 "agentId":"2b4ee39f…","rootCause":"Latest deployment failed at verify",
 "permittedAction":"restore previous verified release through the node agent (deploy.rollback)"}
```

**Recovery:** after operator approval of the gated rollback job
(`self-heal:rollback`), the platform, exclusively through preapproved agent
verbs, executed `deploy.list` → `deploy.rollback` → `deploy.list` →
`app.restart` → verification. Step output:

```json
{"projectId":"735b9b82…",
 "before":"/srv/alo-sites/node-1.acceptance.alo.test/releases/20261113104603",
 "after":"/srv/alo-sites/node-1.acceptance.alo.test/releases/20261113104453",
 "commitSha":"5e0b5b2eeca90f22e411a2e702cd4fd493183466",
 "rollbackDeploymentId":"d8b04d32-25aa-4d38-b653-a47078907e5f","checkedVia":"node-agent"}
```

**Verification** (final step):

```json
{"target":"http://127.0.0.1:4200/","status":200,"latencyMs":28}
```

Run outcome: **SUCCEEDED, verified=1** — evidence SUCCEEDED, diagnose
SUCCEEDED, restart SKIPPED (branch not taken), rollback SUCCEEDED,
restart-static SKIPPED, verify SUCCEEDED. The rollback was recorded as a real
deployment row (`d8b04d32…`, trigger `rollback`, `verifiedCommitSha` set), so
the platform's notion of "current verified release" follows the restored
state.

**Independent post-recovery evidence:**

```
$ curl -s -o /dev/null -w "%{http_code}" -H "Host: node-1.acceptance.alo.test" http://127.0.0.1:8081/
200
$ curl -sk -o /dev/null -w "%{http_code}" --resolve node-1.acceptance.alo.test:8444:127.0.0.1 https://node-1.acceptance.alo.test:8444/
200
$ sudo nsenter -t <nodeB-agent-pid> -m -- readlink /srv/alo-sites/node-1.acceptance.alo.test/current
/srv/alo-sites/node-1.acceptance.alo.test/releases/20261113104453      # rolled back from …104603
$ pm2 list (node B daemon)  →  alo-node-1.acceptance.alo.test  online  pid 65749  ↺ 0
```

The process (`node server.js`, uid alo-panel, pid 65749) was started at
11:32 by the recovery's `app.restart` — not by any manual action. The next
monitor sweep reported both projects healthy (`checked: 2, healthy: 2`,
reason `verified`) and **no further self-heal runs were created** — the
system converged instead of ping-ponging.

## 5. Real product bugs found and fixed at root cause during this acceptance

Every fix below is committed product code (not a harness workaround); each
one was proven by a before/after run pair in the ledger.

1. **`alo-app-helper` start-command validation rejected every Node app**
   (`helpers/alo-app-helper`): the ERE used `\s`, which bash's regex engine
   does not support, so `node server.js` failed validation and every node-app
   `app.up` died. Replaced with `[[:space:]]`. (Run `aea3e19a` FAILED before →
   `9e2abc68` SUCCEEDED after.)
2. **Provisioned projects lost their detection snapshot**
   (`src/app/api/ai/auto-deploy/route.ts`): a generic no-lockfile Node repo is
   *by design* flagged ambiguous by `detect.ts` until an operator confirms;
   the provision route didn't store that confirmation, so the lifecycle
   `detect` step failed. The route now persists the operator-confirmed
   detection snapshot. (Run `5556544c` FAILED before → later runs pass detect.)
3. **Orchestrator enqueue threw `UNSAFE_RETRY` for non-retry-safe actions even
   with no retry requested** (`src/lib/orchestrator/orchestrator.ts`): worker
   defaults (`defaultMaxAttempts: 3`) were treated as an explicit retry
   request, so the self-heal rollback step could never even be enqueued. Now
   only an explicit `request.maxAttempts > 1` throws; defaults clamp to 1.
   (Run `a34c2c36` FAILED before → rollback enqueues after.)
4. **Agent-task dispatch idempotency key collapsed distinct calls**
   (`src/lib/agents/agent.ts`, `src/lib/orchestrator/platform-workers.ts`):
   the deterministic task id hashed `(jobId, agentId, command, args)`, so a
   second identical call inside the same job silently returned the first
   call's cached result. The recovery flow brackets its rollback with two
   `deploy.list` reads and therefore always saw the *pre*-rollback release —
   "rollback reported success but the active release is unchanged" — and any
   verify-loop retry after a transient probe failure could never succeed. The
   key now includes a per-execution dispatch ordinal: distinct calls get
   distinct tasks, while a replayed execution still realigns with the tasks
   its earlier attempt created. (Run `508c9b3d` FAILED before → `b6e3941d`
   rollback SUCCEEDED after.)
5. **Rollback verification pinned the wrong deployment identity**
   (`src/lib/orchestrator/workers.ts`, `src/lib/deploy/remote.ts`): a restored
   release directory keeps the marker written by the deployment that *built*
   it — by definition not the newest row — so verification compared the
   rolled-back marker against the latest deployment and always failed; the
   monitor likewise kept reporting the restored release unhealthy. The
   rollback path now verifies against the set of commits the platform has
   actually verified for the project (no deployment pin), records a
   `trigger: "rollback"` deployment row (same convention as the local engine),
   and monitoring verifies commit identity without pinning the deployment.
6. **A join step could never advance past skipped alternative branches**
   (`src/lib/orchestrator/workflows.ts`): dependencies were required to be
   `SUCCEEDED`, but the self-heal verify step depends on the
   restart|rollback|restart-static branches, two of which are always SKIPPED —
   so even a successful rollback left the run RUNNING forever. A SKIPPED
   dependency now counts as satisfied (it is a terminal, deterministic
   outcome); blocking statuses are unchanged. Regression test added in
   `tests/automation-center.test.ts` ("advances a join step whose alternative
   branches were skipped (self-heal shape)").
7. **Agent command failures reported no reason** (`agent/alo-agent.mjs`):
   helpers print their diagnostic JSON on stdout while the surfaced error was
   only `Command failed: sudo -n …`, making every failure look identical.
   Failed commands now surface the helper's own reason
   (`exit code 1: No previous release to rollback to`).

Earlier fixes from this engagement that the green runs also depend on:
`deployments.executedByAgentId` (node-aware deployment reuse), SQLITE_BUSY
handling in `db.ts`, orphaned `runuser` continuation lines after helper
patching, node-kit installer and agent allowlist updates.

## 6. Test status

- `npx tsc --noEmit`: clean.
- `npm test`: **1016/1017 passing**. The single failure
  (`tests/server-agent-deploy-ssl-dns.test.ts` → "executes deploy.list, dns.list,
  and ssl.list end-to-end") is **pre-existing host-state leakage, unrelated to
  these changes**: the test expects an empty `ssl.list` but this sandbox's host
  has the real internal-CA certificate issued for `static-1.acceptance.alo.test`
  during acceptance. Verified failing identically on the unmodified tree
  (`git stash` → run → same failure → `git stash pop`).

## 7. Mapping to the original 17-check plan

| # | Check | Result in this acceptance |
|---:|---|---|
| 1 | Server health/discovery | PASS — two enrolled agents heartbeating; inventory/metrics via agent tasks |
| 2 | Create static test site | PASS — §2, real site dir + edge fragment + listener on node A |
| 3 | Create database and user | Not in scope of the remote-node acceptance (no DB helper exercised) |
| 4 | Create Node app | PASS — §3, pm2-supervised `node server.js` on node B |
| 5 | Reverse proxy | PASS — edges `:8080/:8443` and `:8081/:8444` serving both apps |
| 6 | App process lifecycle | PASS — real stop (injected outage) and platform-driven restart (§4) |
| 7 | DNS | PASS (node-local zone) — A records verified via each node's zone; public DNS intentionally not claimed |
| 8 | SSL | PASS (internal CA) — real certs served with correct CN/SAN and expiry; `verifyReturnCode 19` (self-signed CA) is the expected client view |
| 9 | Cron | Not exercised in this acceptance |
| 10 | Backup | Not exercised in this acceptance |
| 11 | Restore | Not exercised in this acceptance |
| 12 | Suspend/resume | Not exercised in this acceptance |
| 13 | Logs | PASS (bounded, redacted step/job logs inspected throughout); full log-audit sweep not run |
| 14 | Firewall | Not applicable inside the sandbox |
| 15 | Audit | PASS — approval of the gated rollback, run start/finish and cancellation all produced audit rows |
| 16 | Delete/cleanup | Not exercised (test projects intentionally left running as live evidence) |
| 17 | Failure/rollback | PASS — §4: injected outage → detected → diagnosed → rolled back → restarted → verified |

## 8. Honest limitations

- The two "hosts" are strongly isolated mount namespaces on one sandbox
  kernel, not two physical machines; everything above the kernel
  (separate site roots, edges, pm2 daemons, agent allowlists) is genuinely
  separate per node.
- TLS uses the platform's internal CA (self-signed by design in this
  environment); DNS is verified in the node-local zone, and no public DNS or
  public CA claim is made.
- The failing self-heal runs in the ledger (§ "run ledger") are kept
  deliberately: each corresponds to a real bug in §5 that was subsequently
  fixed and re-tested to green.
- The acceptance database (`db/acceptance.db`) is a sandbox-generated
  artifact and is intentionally not committed to the repository.
