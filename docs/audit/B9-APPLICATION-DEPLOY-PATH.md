# B-9 — The application-level production deployment path

**Date:** 2026-10-29 · **Repo:** `aloeducation-org-crm/Hosting-Portal` @ `45d20de`
**Question:** can a user change production without passing the GitHub environment
reviewer gate?
**Answer: yes.** One RBAC permission is sufficient, and the execution is
synchronous within the request.

> Evidence class: **source code**, read at `45d20de`. Nothing here was executed
> against a production host. No behaviour was changed.

---

## 1. Call graph — every path from HTTP to a host mutation

```
POST /api/deploy/projects/{id}/deploy      requirePermission("WEBSITE_DEPLOY")
  └─ canAccessProject(user, project, website)          tenant check
  └─ enqueueDeployment({projectId, commitSha, …})
       └─ if (inlineWorkerEnabled())                    ← TRUE by default
            └─ withProjectLock(projectId, …)
                 └─ runDeployment(deploymentId)
                      └─ git clone / checkout (execFile, argv-only)
                      └─ activateRelease()                     files on disk
                      └─ restartExternalService("pm2"|"systemd")  ← HOST MUTATION
                      └─ verifyDeployment({expectedSha, …})

POST /api/deploy/projects/{id}/rollback    requirePermission("BACKUP_RESTORE")
  └─ rollbackProject(projectId, user.id)   → same activate + restart boundary, synchronously

POST /api/deploy/webhook                   shared-secret header (x-webhook-secret)
  └─ creates CiBuild + Deployment(status=PENDING)     ← records intent only
     (execution requires scripts/deploy-worker.ts → processPendingDeployments)

scripts/deploy-worker.ts                   standalone process; whether it runs in
  └─ processPendingDeployments(5)          production is UNKNOWN (needs `pm2 list`)
```

`inlineWorkerEnabled()` is `process.env.DEPLOY_INLINE_WORKER !== "false"` — so the
inline worker is **enabled unless explicitly disabled**. Nobody has to turn it on.

---

## 2. Findings

| # | Finding | Severity | Evidence |
|---|---|---|---|
| B9-1 | A holder of `WEBSITE_DEPLOY` triggers a real deployment — files replaced, service restarted — with **no second party, no approval record, and no environment gate**. The environment reviewer protects only GitHub Actions. | **High** | source |
| B9-2 | Execution is **synchronous** inside the HTTP request (`await runDeployment`), so the caller holds the request open through build + restart. Long builds risk proxy/request timeouts leaving an ambiguous state, and the response body is the only success signal. | Medium | source |
| B9-3 | `rollback` reuses the same boundary under `BACKUP_RESTORE`. A permission named for backups also redeploys production. | Medium | source |
| B9-4 | The webhook authenticates with a **shared static secret** in one header — no HMAC over the body, no timestamp, no nonce. Contrast the agent path, which signs the body and has replay protection. A captured request can be replayed. It only creates a `PENDING` row, so impact is bounded to spurious records and audit noise — unless the worker is running, in which case it is a deployment trigger. | Medium (High if worker runs) | source |
| B9-5 | `canAccessProject` scopes the target to the caller's organisation. Good — but it is a **tenancy** check, not an approval. | Info | source |
| B9-6 | Manual deploys are SHA-pinned (`/^[0-9a-f]{40}$/`) and default to `project.lastCommitSha`, so the deploy path is **not** vulnerable to the `git pull` moving-target defect that affected the GitHub workflow. | **Positive** | source |
| B9-7 | `verifyDeployment({expectedSha})` requires the health marker to name the expected commit. This is **stronger** release verification than the GitHub workflow had at `ec7ff40`. | **Positive** | source |
| B9-8 | Both mutating routes write an audit row (`DEPLOY_MANUAL`, `DEPLOY_ROLLBACK`) with actor, role and SHA. | Positive | source |
| B9-9 | Whether the inline worker is enabled in production, and whether `deploy-worker.ts` runs there, is **UNKNOWN** — both are host state. | — | `[BLOCKED]` |

**Net:** the application path has *better* release-identity verification than the
GitHub path (B9-6, B9-7) but *weaker* human governance (B9-1). That inversion is
why the environment gate alone is not a complete answer.

---

## 3. Threat model

| Threat | Actor | Precondition | Impact | Current control | Gap |
|---|---|---|---|---|---|
| T-B9-1 Unauthorised production deploy | Authenticated user with `WEBSITE_DEPLOY` | valid session | code replaced, service restarted | RBAC + tenancy + audit | no approval, no second party |
| T-B9-2 Insider rollback to an older release | holder of `BACKUP_RESTORE` | valid session | regression, possible data/schema mismatch | audit row | no approval |
| T-B9-3 Webhook replay | anyone who captured one request | secret in a log/proxy | spurious deployments if worker runs | constant-time compare | no HMAC, no timestamp, no nonce |
| T-B9-4 Stolen session | credential thief | session token | full deploy control | session expiry, CSRF | no step-up for destructive ops |
| T-B9-5 Deploy a commit not on the protected branch | holder of `WEBSITE_DEPLOY` | any 40-hex SHA | arbitrary code to production | SHA format only | no ancestry check against `main` |
| T-B9-6 Cross-tenant deploy | authenticated user | — | none found | `canAccessProject` | — |
| T-B9-7 Partial deploy on timeout | any caller | slow build | half-applied release | lock, failure stage | no automatic rollback on client disconnect |

---

## 4. Remediation options (proposals only — nothing implemented)

Ordered by risk reduction per unit of change. All require product and security
review; none is applied.

| # | Proposal | Addresses | Cost | Risk of the change itself |
|---|---|---|---|---|
| R-1 | **Require an approval record** for a production deploy: create the `Deployment` in `AWAITING_APPROVAL`, execute only after a second principal approves (reuse `AgentTask.approve` shape). | T-B9-1, T-B9-2 | Medium | Changes a working route; needs a new state and UI |
| R-2 | **Decouple execution from the request**: always enqueue, never deploy inline in production (`DEPLOY_INLINE_WORKER=false`), and run the worker as a supervised process. | T-B9-2, T-B9-7 | Low (config) + ops | Requires the worker to actually run — otherwise deploys silently stop |
| R-3 | **Verify commit ancestry** against the project's `productionBranch` before executing. | T-B9-5 | Low | Rejects legitimate hotfix SHAs unless explicitly allowed |
| R-4 | **Upgrade the webhook to HMAC + timestamp + nonce**, matching the agent scheme already in the codebase. | T-B9-3 | Medium | External callers must be updated — breaking |
| R-5 | **Step-up confirmation** (re-authentication or MFA) for `WEBSITE_DEPLOY` and `BACKUP_RESTORE` on production resources. | T-B9-4 | Medium | UX friction |

**Recommended minimum before PR #19 merges:** R-2 as an explicit, documented
production setting, plus a decision recorded for R-1. R-2 is configuration, not
code, and it removes the synchronous-in-request hazard without touching
authorisation.

**Do not** weaken RBAC, change scopes, or alter the agent trust boundary as part
of any of these.

---

## 5. Tests proposed

| Test | Asserts |
|---|---|
| T1 | `WEBSITE_DEPLOY` alone does not cause `restartExternalService` to be called when approval is required |
| T2 | A deployment created by a non-approver cannot transition to executing |
| T3 | Replaying a webhook body with the same secret and no timestamp is rejected once HMAC+nonce is added |
| T4 | A `commitSha` that is not an ancestor of the production branch is rejected |
| T5 | A deploy route returns `202 queued` and performs no filesystem write when inline is disabled |
| T6 | Cross-tenant deploy attempt returns not-found, not 403 |
| T7 | Audit row is written for every attempted execution, including denied ones |

None of these is implemented; B-9 stays **OPEN** until the chosen remediation is
implemented and verified.

---

## 6. What is still unknown

`[BLOCKED]` on A-6:

- whether `DEPLOY_INLINE_WORKER` is set in production;
- whether `scripts/deploy-worker.ts` is a running PM2 process;
- whether any production deployment has ever been executed through this path
  (which would mean a release exists that the GitHub workflow history cannot see).
- how many principals actually hold `WEBSITE_DEPLOY` / `BACKUP_RESTORE`.

That last item matters most: if exactly one administrator holds both permissions,
the practical exposure today is small and R-1 is a hardening task. If a wider set
of users holds `WEBSITE_DEPLOY`, B9-1 is a live governance hole.
