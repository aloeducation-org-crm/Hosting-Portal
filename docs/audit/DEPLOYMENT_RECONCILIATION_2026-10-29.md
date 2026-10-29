# Deployment Reconciliation — 2026-10-29

**Question this document answers:** which commit is running in production, and can
that be established from available evidence?

**Answer: no. The GitHub `production` deployment history does not describe the
release that actually ran.** It describes six failed attempts to deploy a
nine-commit-older commit. The most recent deploy job that actually succeeded ran
on 2026-10-27 at `ec7ff40`, and a later failed deploy job may have touched the
host afterwards. The running release is therefore **UNVERIFIED**, and
`ec7ff40` is the leading hypothesis, not a finding.

> **Verification taxonomy used throughout.** Every claim is tagged.
> `[SRC]` verified by source code · `[TEST]` verified by automated tests ·
> `[CI]` verified by GitHub workflow records · `[HOST]` verified on the actual
> server · `[REPORTED]` reported but not independently verified ·
> `[BLOCKED]` blocked by missing access or approval.

---

## 1. Repository and branch state

| Fact | Value | Tag |
|---|---|---|
| Repository | `aloeducation-org-crm/Hosting-Portal` (public) | `[CI]` |
| Default branch | `main` | `[CI]` |
| `main` HEAD | `7fc3d15fcdfcfe5a2b494eea276935795d3f04a0` | `[CI]` |
| Session branch | `arena/c04ebe8c-hosting-portal` @ `67d7f7d9eae07098d5a33de59b2cc624bc4462a3` | `[CI]` |
| Other remote branches | `arena/c02ea3c0` @ `a4c9b32` (PR #19 head), `fix/comprehensive-deploy-safety-audit` @ `c5c2780`, `arena/6987c648` @ `876e5e2` | `[CI]` |
| `production` deployment records | **6 total, all sha `54e3454`** | `[CI]` |

**Working-tree note.** The execution sandbox was re-cloned mid-session, resetting
local `HEAD` to `7fc3d15` while the pushed commits remained on the remote. Before
re-aligning, all eight changed files were compared by blob hash against
`origin/arena/c04ebe8c-hosting-portal` and confirmed byte-identical, so no work
was lost or altered by the reset. Recorded because the reflog alone would look
like history rewrote itself.

---

## 2. Every trigger that can deploy to production

`.github/workflows/` contains exactly one workflow: `ci-cd.yml`. `[SRC]`

| Trigger | Can reach production? | Why |
|---|---|---|
| `push` → `main` | **yes** | `deploy` job condition is `github.event_name == 'push' && github.ref == 'refs/heads/main'` |
| `push` → `develop` | no | same condition excludes it |
| `pull_request` → `main`/`develop` | no | condition excludes non-push events |
| `workflow_dispatch` | **does not exist** | no manual trigger is declared, so a human cannot invoke a deploy directly |
| Schedule | none | no `schedule:` trigger |

At `7fc3d15` the deploy job declares `environment: production` (line 180), runs on
`self-hosted`, and has `concurrency: hosting-production-deploy` with
`cancel-in-progress: false`. `[SRC]`

**Second, independent deploy path.** The running application can execute
deployments without involving GitHub Actions at all:

- Routes: `POST /api/deploy/projects/[id]/deploy`, `/rollback`, and
  `POST /api/deploy/webhook`. `[SRC]`
- Authorisation is `requirePermission(request, "WEBSITE_DEPLOY")` — an RBAC
  permission, not a human approval step. `[SRC]`
- Execution path: `enqueueDeployment` → `runDeployment` (`src/lib/deploy/engine.ts`),
  which spawns `git` with argv-only execution, and host-mutating helpers exist
  (`helpers/alo-deploy-helper`, `alo-hosting-helper`, `alo-site-lifecycle`,
  `helpers/sudoers-alo`). `[SRC]`
- Manual deploys are SHA-pinned (`/^[0-9a-f]{40}$/`) and audited
  (`DEPLOY_MANUAL`). `[SRC]`
- Whether the inline worker is enabled in production is **unknown**
  (`inlineWorkerEnabled()` reads configuration). `[BLOCKED]`

**Consequence for the approval gate:** an environment reviewer protects the
GitHub path only. It does not gate the application's own deploy endpoint. See
`PRODUCTION_APPROVAL_GATE.md` §5.

---

## 3. The core finding: the deployment history tracks the wrong run

All six `production` deployment records resolve, via their status `log_url`, to
**one workflow run**: `40256080253` (run #31, commit `54e3454`). `[CI]`

| Deployment id | Created (UTC) | Statuses | Resolves to |
|---|---|---|---|
| 7322320751 | 2026-10-26T01:52:04 | in_progress → **failure** 01:56:48 | run 40256080253 / job 121358731314 |
| 7327511787 | 2026-10-26T08:42:08 | in_progress → **failure** 08:47:45 | job 121475824878 |
| 7330728323 | 2026-10-26T11:31:29 | in_progress → **failure** 11:37:20 | job 121547641065 |
| 7344569182 | 2026-10-26T21:56:06 | in_progress → **failure** 22:01:00 | job 121872222444 |
| 7349690127 | 2026-10-27T03:37:20 | in_progress → **failure** 03:42:52 | job 121994659505 |
| 7383720425 | 2026-10-28T11:09:30 | queued 11:10:31 → in_progress 13:46:34 → **failure** 13:46:56 | job 122780389970 |

Six records, one workflow run, six job attempts at one commit, six failures,
spanning 2026-10-26T01:52 to 2026-10-28T13:46 — just under 60 hours.

**Why run #43 left no record.** The `environment:` declaration is not stable
across commits. Sampling the workflow file at each relevant commit: `[CI]`

| Commit | `environment:` declarations | Deploy job | Outcome |
|---|---|---|---|
| `54e3454` | **1** (line 75) | "Deploy to production server" | failure ×6 (all re-runs) |
| `adeeb15` | **0** | "Deploy to production server" | **success** |
| `3d94abe` | **0** | "Deploy to production server" | **success** |
| `a86df6f` | **0** | "Deploy canonical root portal…" | **success** |
| `12ac1c4` | **0** | "Deploy canonical root portal…" | failure |
| `ec7ff40` | **0** | "Deploy canonical root portal…" | **success** |
| `9533375` | **0** | "Deploy canonical root portal…" | failure |
| `3dd3986` | **0** | "Deploy canonical root portal…" | failure |
| `7fc3d15` | **1** (line 180) | "Deploy canonical root portal…" | skipped |

A job without `environment:` creates no `Deployment` object — so a successful
deploy produces no record, and the environment-scoped history silently omits it.

**Therefore: of the four deploy jobs that have ever succeeded on this host, all
four ran under a workflow with no environment declaration. The `production`
environment gate has never once been traversed by a successful deployment.** It
has only ever seen failures (the six re-runs) and skips (the four most recent
runs). `[CI]`

---

## 4. Full production-affecting history, chronological

`[CI]` — ordered by deploy job start, not by run number. The ordering is itself
evidence: run #32's deploy started *after* run #33's, despite the earlier commit.

| Deploy job start (UTC) | Run | Commit | Conclusion | `environment:` |
|---|---|---|---|---|
| 2026-10-26T01:52:09 | 40256080253 (#31) | `54e3454` | **failure** | yes |
| 2026-10-26T05:08:06 | 40272424240 (#33) | `3d94abe` | **success** | no |
| 2026-10-26T08:04:19 | 40270222887 (#32) | `adeeb15` | **success** | no |
| 2026-10-26T08:42:13 | #31 re-run | `54e3454` | **failure** | yes |
| 2026-10-26T11:31:34 | #31 re-run | `54e3454` | **failure** | yes |
| 2026-10-26T21:56:11 | #31 re-run | `54e3454` | **failure** | yes |
| 2026-10-27T00:13:56 | 40424767745 (#36) | `a86df6f` | **success** | no |
| 2026-10-27T00:42:30 | 40427809789 (#38) | `12ac1c4` | failure | no |
| **2026-10-27T02:41:46** | **40439634377 (#43)** | **`ec7ff40`** | **success → 02:47:01** | no |
| 2026-10-27T03:37:26 | #31 re-run | `54e3454` | **failure** | yes |
| 2026-10-27T05:27:46 | 40455213982 (#49) | `9533375` | failure | no |
| 2026-10-28T13:46:34 | #31 re-run | `54e3454` | **failure** | yes |
| 2026-10-28T13:54:58 | 40662370310 (#60) | `88fb789` | skipped | not sampled |
| 2026-10-28T22:35:58 | 40515206388 (#58) | `46bb044` | skipped | not sampled |
| 2026-10-28T22:50:42 | 40493667038 (#54) | `3dd3986` | **failure → 22:54:54** | no |
| 2026-10-29T00:37:50 | 40794019187 (#64) | `7fc3d15` | skipped | yes |
| 2026-10-29T00:42:48 | 40780568808 (#62) | `123d558` | skipped | not sampled |

Ancestry check: `54e3454...ec7ff40` → `ahead_by: 9, behind_by: 0`, so `ec7ff40`
is a strict descendant. `[CI]` Had any of the five post-#43 re-runs of run #31
succeeded, it would have attempted a **nine-commit backwards reset** of
production. All five failed. That failure is the only thing that occurred.

---

## 5. Three different questions, three different answers

The brief asks to distinguish these. They do not agree, and the disagreement is
the finding.

| Question | Answer | Tag |
|---|---|---|
| Did CI build and test pass for `ec7ff40`? | **Yes** — "Lint, typecheck, and tests" `success`, "Production build" `success` | `[CI]` |
| Did a deploy job succeed? | **Yes** — run #43, 2026-10-27T02:41:46→02:47:01, `success` | `[CI]` |
| Is `ec7ff40` the verified running release? | **No — unverified** | `[BLOCKED]` |

### Why "deploy job succeeded" is weaker than it sounds

The workflow at `ec7ff40` ran, with `set -euo pipefail`: `[SRC]`

```
cd "$HOME/projects/Hosting-Portal"
git fetch origin main ; git checkout main ; git pull --ff-only origin main
npm ci --include=dev ; npx prisma generate ; node scripts/apply-deploy-schema.mjs
npm run build ; <copy standalone assets>
pm2 restart alo-hosting-portal … ; pm2 save ; sleep 4
curl -sf http://127.0.0.1:3051/api/health && echo "Deploy OK" || (echo "Health check failed" && exit 1)
```

Two structural weaknesses:

1. **The deployed commit is not the run's commit.** The job runs
   `git pull --ff-only origin main` — it deploys whatever `origin/main` is at
   execution time. The downloaded artifact and `github.sha` are never used to pin
   what gets built. Run #32 deploying after run #33 (§4) is the observable
   consequence.
2. **The health check could not identify a release.** `/api/health` at `ec7ff40`
   returned `version: process.env.npm_package_version ?? '1.0.0'` and **no commit
   SHA**, so `curl -sf` proving only HTTP 200 + DB/schema reachable. A 200 from
   the *previous* process would have satisfied it. `[SRC]`

`deploy-release.sh` at `7fc3d15` fixes both — it requires a full 40-hex
`DEPLOY_COMMIT_SHA`, writes `release-identity.json`, and its `verify_health`
rejects a response whose commit differs from the target. `[SRC]` That script has
**never run successfully on this host**, because run #64 skipped the deploy job.

### Strongest supportable statement about `ec7ff40`

`[CI]` On 2026-10-27 between 02:41:46 and 02:47:01 the host executed a job that
fast-forwarded `$HOME/projects/Hosting-Portal` to `origin/main` (which was
`ec7ff40`, the only push between #38 at 00:39 and #49 at 05:25), rebuilt
successfully, restarted the panel through PM2, and received HTTP 200 from
`http://127.0.0.1:3051/api/health`.

That is a successful deploy job on the real host. It is **not** a verified
release identity, because nothing recorded which commit the responding process
was built from, and no health response contained a SHA.

### Complication: run #54 may have changed the host afterwards

`[CI]` Run #54 (`3dd3986`) executed its deploy job on 2026-10-28 22:50:42→22:54:54
(4m12s) under a workflow with **no** `environment:` declaration, and failed. Its
workflow performed, in order: pull, `apply-deploy-schema.mjs` (a **schema
migration**), build, PM2 restart.

Whether it mutated the host before failing is **`[BLOCKED]`** — job logs cannot be
retrieved from this environment (Actions log downloads are served from
`*.blob.core.windows.net`, which is outside the permitted egress allowlist; the
attempt returned `EOF`). A fast failure before the pull would mean no change; a
failure after `apply-deploy-schema.mjs` would mean the running app may not match
its schema. Both are consistent with the observed 4m12s.

**This is why the baseline cannot be asserted, not merely why it was not
measured.** A later failed job may have left the host in a state that differs
from `ec7ff40`.

---

## 6. Baseline conclusion

| Item | Status |
|---|---|
| Last deploy job that succeeded | **`ec7ff40`, run #43, 2026-10-27T02:47:01Z** `[CI]` |
| Leading hypothesis for running release | `ec7ff40` |
| Running release **verified** | **NO — `UNVERIFIED`** `[BLOCKED]` |
| Host-side release identity artefact | **Does not exist for `ec7ff40`.** `release-identity.json` is written only by `deploy-release.sh` / `deploy-production.sh`, neither of which has completed on this host `[SRC]` + `[CI]` |
| Whether run #54 mutated the host | **Unknown** `[BLOCKED]` |
| Has any successful deploy passed the `production` gate? | **No, never** `[CI]` |

**`54e3454` must not be treated as the production baseline.** It is the subject
of six failed attempts and is nine commits *behind* `ec7ff40`. The deployment
records naming it describe abandoned retries, not a release.

---

## 7. What would establish the baseline (deliverable 2)

Read-only, in ascending cost. None of these was performed — `[BLOCKED]` on host
access (B-1).

1. `cat ~/projects/Hosting-Portal/release-identity.json` on `alo-server-lap`.
   Absent ⇒ the commit-verifying deploy path has never completed.
2. `git -C ~/projects/Hosting-Portal rev-parse HEAD` and `git status --porcelain`
   — the working tree is what the running build came from. `[SRC]` of
   `deploy-release.sh` shows the dirty-tree guard exists precisely because this
   drifts.
3. `pm2 jlist | jq '.[] | select(.name|test("alo-hosting")) | {name, pm2_env: {pm_cwd: .pm2_env.pm_cwd, status: .pm2_env.status, restart_time: .pm2_env.restart_time}}'`
   — process start time brackets the release.
4. `curl -s http://127.0.0.1:3051/api/health` — will report `commitSha` **only if**
   the running build is ≥ `7fc3d15` *and* `release-identity.json` exists. If it
   reports no SHA, that is itself the answer: the running release predates
   release-identity support.
5. Corroborate with `bash scripts/host-checkout-status.sh "$HOME/projects/Hosting-Portal"`
   (exit 0 = classify-tolerable, 1 = needs deliberate resolution).

Until 1–5 are run on the host, the baseline stays `UNVERIFIED` and no later
"deployed and verified" claim can be made against it.

---

## 8. Unresolved contradictions (stated, not resolved)

| # | Contradiction | Current best explanation | Status |
|---|---|---|---|
| C-1 | Env history says production is `54e3454`; a successful deploy job ran at `ec7ff40` | `ec7ff40`'s workflow had no `environment:`, so it created no record. The history is not a deployment log. | **Explained** `[CI]` |
| C-2 | Run #43 succeeded, yet no deployment record exists for it | same cause | **Explained** `[CI]` |
| C-3 | Deployment record created 2026-10-28 for a 2026-10-26 commit | It is the 6th re-run of run #31, which is pinned to `54e3454` | **Explained** `[CI]` |
| C-4 | Deploy job "success" vs "which code is running" | Health check could not identify a commit | **Explained** `[SRC]` |
| C-5 | Did run #54 change the host? | Unknown | **UNRESOLVED** `[BLOCKED]` |
| C-6 | Is the panel currently healthy? | No probe from here; no external health record reviewed | **UNRESOLVED** `[BLOCKED]` |

---

## 9. What this document does not claim

- It does not claim production is broken. It claims production's identity is
  unverified.
- It does not claim `ec7ff40` is running. It names it the leading hypothesis and
  gives the exact commands that would settle it.
- No deployment, re-run, rollback, migration, restart, or host access was
  performed in producing this report.
- No conclusion here rests on a document, a PR description, or a prior session
  summary; every row is tagged with the evidence class it came from.
