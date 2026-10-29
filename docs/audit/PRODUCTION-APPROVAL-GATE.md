# Production Approval Gate — status and administrator recommendation

**Date:** 2026-10-29
**Owner of the change:** repository administrator (this cannot be set from a
workflow file, a commit, or by an agent with a read-only token).

---

## 1. Verified status — the gate does not exist

Evidence read directly from the GitHub API. `[CI]`

| Fact | Value |
|---|---|
| Environment `production` exists | yes, created `2026-10-25T05:32:00Z` |
| `protection_rules` | **`[]` — empty** |
| Required reviewers | **none** |
| `can_admins_bypass` | `true` |
| `deployment_branch_policy` | `null` (unrestricted) |
| Repository visibility | **public** — so required reviewers are **available**; this is a configuration gap, not a platform limitation |
| `deploy` job declares `environment: production` | yes, at `7fc3d15` (line 180) |
| `deploy` job trigger | `push` → `main` only |

**Net effect:** with no protection rule, a `push` to `main` starts the `deploy`
job immediately on the self-hosted runner and needs no human decision.

---

## 2. Why this is currently load-bearing

`[CI]` The six most recent runs on `main` all failed *before* the deploy job
(`skipped`) or failed inside it. The immediate blocker is the dirty-checkout
preflight failure. **That failure is, accidentally, the only thing preventing
unattended deploys today.**

PR #19 exists to clear that blocker. If it merges before a reviewer is
configured, the first merge after it deploys to production with no approval
step. The gate must therefore be configured **before** that merge, not after.

`[CI]` Also worth stating plainly: **no successful deployment has ever passed
through this environment.** Every successful deploy job ran under a workflow
that omitted `environment:` (see `DEPLOYMENT_RECONCILIATION_2026-10-29.md` §3).
The gate has been present only during failures and skips. It has never been
exercised, so its correctness is unproven as well as its existence.

---

## 3. Exact configuration recommendation

Apply in GitHub → **Settings → Environments → `production`**. These are the
values an administrator should set; none has been applied by this session.

| Setting | Recommended value | Reason |
|---|---|---|
| **Required reviewers** | Add **at least two named maintainers** (not a team with one active member) | One reviewer who is also the merge author defeats the purpose; two gives coverage for absence |
| **Prevent self-review** | **Enabled** | Stops the person who merged from also approving the deploy |
| **Deployment branches** | **Selected branches → `main` only** | Today it is `null`. Restricting it means a new workflow cannot deploy from a feature branch |
| **`can_admins_bypass`** | **`false`** | A bypass re-opens the exact unattended path this gate exists to close. If the organisation requires an emergency bypass, record it as an explicit, separately-approved exception rather than leaving it silently on |
| **Wait timer** | optional, 0–5 min | Gives a reviewer a window to abort a deploy already queued |
| **Environment secrets** | none needed | No production credential is created by this step |

**Do not** change `main` branch protection as part of this task. `[BLOCKED]`
Branch-protection state could not be read (`403 Resource not accessible by
integration` — the available token has read-only `pull` permission), so no claim
is made about it in either direction. Read it with an admin token before
changing anything, and change it only with explicit authorisation.

---

## 4. Verification procedure

The gate can be verified **without deploying anything**.

**Step 1 — read back the config.** `[CI]`

```
gh api repos/aloeducation-org-crm/Hosting-Portal/environments/production \
  --jq '{name, protection_rules, can_admins_bypass, deployment_branch_policy}'
```

Expected: `protection_rules` contains an object with
`"type": "required_reviewers"` and the named reviewers;
`can_admins_bypass: false`; `deployment_branch_policy` restricted to `main`.

**Step 2 — prove the next deploy waits.** After the next legitimate `push` to
`main`, open the run and confirm the `deploy` job shows **"Waiting for review"**
and has **not** started on the self-hosted runner. This is the real proof: the
job must be blocked *before* it touches the host.

Expected key sequence in the run's job list:
`verify` → `build` → `deploy-preflight` → `deploy: Waiting for review`.

**Step 3 — record it.** Capture the run URL, the timestamp, and a screenshot or
API output showing the waiting state, and attach it to the readiness report.

**Step 4 — do not "test" the gate by approving.** Approval is the production
change. Approving to see what happens converts a verification step into an
unauthorised deployment.

**Failure signals that mean the gate is not working:**

- the deploy job reaches `self-hosted` and starts executing shell commands
  before any approval;
- `protection_rules` is empty or `can_admins_bypass` is still `true`;
- a merge to `main` from a non-`main` branch deployment path succeeds.

---

## 5. What this gate does NOT cover

Configuring a reviewer addresses the GitHub path only. Three other
production-affecting paths remain:

1. **The application's own deploy endpoints.** `POST /api/deploy/projects/[id]/deploy`,
   `/rollback` and `/webhook` enqueue and (when the inline worker is enabled)
   execute deployments through `src/lib/deploy/engine.ts` using host-mutating
   helpers (`helpers/alo-deploy-helper`, `alo-hosting-helper`,
   `helpers/sudoers-alo`). `[SRC]` Authorisation is the RBAC permission
   `WEBSITE_DEPLOY` — a permission, not an approval. These routes are not
   governed by the environment reviewer.
2. **Re-running an old workflow run.** Run #31 is re-runnable. A re-run of run #31
   would attempt to deploy `54e3454`, nine commits behind `ec7ff40`. Five such
   re-runs have already failed; a reviewer gate does not prevent a sixth from
   being started, though it would require approval to proceed.
3. **The self-hosted runner's own trust boundary.** The deploy job executes on the
   production host with that host's filesystem and PM2 — `[SRC]` it references
   `$HOME/projects/Hosting-Portal`, `127.0.0.1:3051` and `pm2`. The runner is
   therefore inside the production trust boundary: anyone able to register a
   workflow that targets it inherits that boundary.

**Recommended follow-up (not implemented, needs authorisation):** decide whether
the application deploy endpoints should require an approval record in
production, and whether the inline worker should be disabled there. Record the
decision either way.

---

## 6. Standing restrictions until the gate is verified

- Do not merge PRs that can trigger a production deployment (PR #19, PR #18, and
  anything else touching `.github/workflows/` or the deploy scripts).
- Do not modify workflow triggers to route around the missing approval.
- Do not change environment or branch protection without explicit administrator
  authorisation — including making the recommended changes above; they are a
  recommendation, not an action taken.
- Do not deploy, migrate, restart production services, or modify production
  infrastructure.
- Do not describe the release baseline as known while
  `DEPLOYMENT_RECONCILIATION_2026-10-29.md` §6 says `UNVERIFIED`.
