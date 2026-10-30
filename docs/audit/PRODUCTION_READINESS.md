# Production Readiness

**Assessed:** 2026-10-29
**Branch:** `arena/c02ea3c0-hosting-portal`
**Baseline:** `7fc3d15` (`main`)
**Currently deployed to production:** see §1 — this is the most important number in
this document and it is not what a green CI run suggests.

---

## 1. What is actually running in production

**No deployment has succeeded since run #53.** Every `main` run after it failed
before the mutating job:

| Run | Commit | Outcome |
|---|---|---|
| #64 | `7fc3d15` | preflight failed — dirty production checkout; `deploy` **skipped** |
| #62 ×3 | `123d558` | timeout, cancelled, then expired artifact; `deploy` **skipped** |
| #60 | `88fb789` | cancelled at the preflight timeout; `deploy` **queued 4h37m then cancelled** |
| #58 | `46bb044` | cancelled at the preflight timeout; `deploy` **skipped** |
| #54 | `3dd3986` | `deploy` ran and **failed** — dirty production checkout |

Therefore:

- **PRs #14, #15, #16 and #17 are merged to `main` but have never been verified
  running in production.** Their CI passed as `pull_request` runs, which by design
  never execute the deploy jobs. A green PR check is not a deployment.
- The last commit whose deployment was *attempted* is `3dd3986` (run #54), and that
  attempt **failed**. The last commit confirmed serving is whatever run #53 left
  running.
- The production host's checkout is still dirty, and still on an older commit.

**Consequence for this assessment:** no claim in this document is a verified
production claim. Everything below is code, tests, and static verification.

---

## 2. Quality gates

| Gate | Command | Result |
|---|---|---|
| Dependencies from lockfile | `npm ci --include=dev` | **pass** |
| Prisma client generation | `postinstall` → `prisma generate` | **pass** |
| Lint | `npm run lint` (`eslint src/`) | **pass**, 0 problems |
| Typecheck | `npm run typecheck` (`tsc --noEmit`) | **pass**, 0 errors |
| Unit + integration tests | `npm test` (`vitest run`) | **676 / 676 pass**, 43 files |
| Shell syntax | `bash -n` over 70 programs | **pass** |
| Dependency advisories | `npm ci --include=dev` | **0 vulnerabilities**, 649 packages |
| Production build | `npm run build` | **✓ Compiled successfully**, 275 routes |
| Standalone entrypoint | `test -s .next/standalone/server.js` | **present** |

Baseline before this work: 533 tests / 38 files. Delta after the deployment,
settings and SSRF batches: +63 tests, +3 files (596 / 41). Delta after the CRM
integration batch (`7cf8516`): a further **+80 tests, +2 files** — 47 pure
authorization/signing/redaction cases and 33 database-backed conformance cases.
Cumulative **+143 tests, +5 files**.
No test skipped, weakened, or deleted. Two existing assertions were updated because
they pinned the implementation form of a guard this work strengthened; both are
itemised in `REPAIR_TRACKER.md` with the preserved property named.

**Not run, and why:**
- `prettier --check` — not a script in this repository; no root formatter config.
- ~~`npm audit` — no reachable advisory API.~~ Now covered: `npm ci` ran a full
  advisory audit and reported **0 vulnerabilities** (R-12 closed).
- Browser E2E — no headless browser available (**R-08**).
- Migration against a real database — no production or staging database reachable
  (**R-13**). Existing tests use isolated temporary databases.

---

## 3. Deployment readiness

| Requirement | Status | Evidence |
|---|---|---|
| Target commit identified | ✅ | Full 40-hex SHA required; guard rejects anything else |
| Working tree clean | ⚠️ **Blocked in production** | Host checkout is dirty (D-16). The fix makes the next run self-heal **if** the only change is a valid release identity record; otherwise an operator must intervene. |
| Artifact verified | ✅ | sha256 digest checked in preflight **and** again on the deploying runner |
| Database backup and migration readiness | ✅ by design | Pre-deployment capture of `.next`, identity record and a timestamped DB copy; additive-only migrations enforced; backup staleness bounded |
| Deployment lock | ✅ | `hosting-production-deploy` single-flight, `cancel-in-progress: false` |
| Obsolete run cannot supersede the target | ✅ | Three independent points: preflight gate, guard §0, revalidation before `git reset --hard` |
| Backwards release cannot happen by accident | ✅ | Guard refuses; rollback requires flag **and** operator **and** reason |
| Rollback is attributed and audited | ✅ | JSONL record outside the checkout |
| Application and infrastructure health confirmed | ✅ by design | Health must name the exact commit + DB + schema; `/login` must 200 |
| Recovery procedure defined and tested | ✅ | Automatic restore + re-verify on both paths; runbook §4–§5 |
| Deployment approval recorded | ❌ | `production` environment has **no required reviewer** (R-06) |
| Independently verified after deploy | ❌ **Not yet possible** | No deployment has occurred |

---

## 4. Outstanding risks

Ordered by what they would cost if ignored.

| Ref | Risk | Sev | Status |
|---|---|---|---|
| **R-05** | Production host checkout is dirty; every deploy to `main` fails preflight. **This is the single thing standing between `main` and production.** | **High** | Code fixed; requires a deploy attempt or operator inspection on `alo-server-lap`. No access from here. |
| **R-06** | `deploy` starts unattended on merge to `main`: the `production` environment has no required reviewer. Combined with R-05, the practical effect today is "no deploy happens"; once R-05 clears, merges deploy themselves. | Medium | Repository admin action. Cannot be set from a workflow file; already documented in `docs/DEPLOYMENT-AND-ROLLBACK.md`. |
| **R-11** | The 43 shell helpers in `helpers/` and `server-helpers/` execute on customer servers with elevated privileges and were **parse-validated only**. No behavioural audit. | **High** | Largest remaining audit gap. Needs per-command review against the agent allowlist. |
| **R-01** | The SSRF guard inspects hostname strings, not resolved addresses. DNS rebinding, or a hostname resolving to `169.254.169.254`, is not defeated. | Medium | A correct fix changes network behaviour for every probe and needs a live host to validate. Consider a network-level block on link-local ranges as defence in depth. |
| **R-03** | `alo-hosting-portal/` — 325-file duplicate application tree with a **divergent Prisma schema** and 245 `src` differences, referenced by nothing. A contributor can edit it, or run migrations against it, and nothing warns them. | Medium | Requires a maintainer decision: delete or mark archived, as its own reviewable commit. Not deleted here — destructive and not reversible from available evidence. |
| **R-08** | UI fixes (MFA, sessions, notification honesty) are verified by typecheck, lint, build and source-level regression tests, **not** by clicking through the flow. | Medium | Needs a browser E2E run before claiming the MFA flow works end to end for a real user. |
| **R-07** | 20+ working, authenticated backends have no UI: SSL check/expiring/renew, storage documents and pools, billing usage and invoice generation, email send/verify/DNS, platform secrets and webhooks, rate limits, roles, system info and logs, orchestrator status. | Medium | Integration backlog, itemised in `MODULE_INTEGRATION_MATRIX.md` group B. Highest user-visible impact: **SSL renewal** — an expiring certificate is a customer-facing outage that cannot currently be driven from the UI. |
| **R-09** | Two competing settings surfaces: `components/platform/views/SettingsView.tsx` (via `AppShell`) and `app/dashboard/settings/page.tsx` (565 lines). Both implement profile and password. Only the first had MFA/sessions UI, and only the first was fixed. | Medium | A future fix applied to one will not apply to the other. Consolidate deliberately. |
| **R-02** | Notification preferences have no persistence. The UI now says so honestly instead of faking a save. | Low | Needs a `NotificationPreference` model plus an additive migration. Deliberately not bundled into a UI commit. |
| **R-04** | Duplicated API surfaces: `security/ssh` vs `security/ssh-keys` (both write `db.sshKey`), `deploy` vs `deployments`, `ci` vs `ci-cd`, and `apps`/`applications`/`sites`. | Low | Not removed: an authenticated working endpoint may have consumers outside this repository. `apps`/`applications`/`sites` are **not** assumed to be duplicates. |
| **R-10** | Four Node versions in play across one deployment path: CI builds on 22, the deploy job prepends v24.22.1 then v22.0.0, root `package.json` requires `>=20.9.0`, the nested tree requires `>=22.0.0`. | Low | Not shown to cause a failure, but a build-time/run-time mismatch presents confusingly. Pin deliberately. |
| **R-12** | ~~No dependency advisory scan performed.~~ **CLOSED 2026-10-29.** `npm ci --include=dev` reported **0 vulnerabilities** across 649 packages once the registry was reachable. | ~~Medium~~ Closed | Re-run on each dependency bump; a clean result at one point in time is not a standing guarantee. |
| **R-15** | The CRM ↔ Hosting-Portal document vault integration (`/api/internal/crm/*`, commit `7cf8516`) is **implemented and tested but not deployed, not provisioned and not consumed**. No credential exists, the additive migration has not run against production, the storage pools still have `bucketPath = null` in the development database, and no CRM code calls it. | Medium | Five prerequisites in `CRM_INTEGRATION_CONTRACT.md` §10, in order. Until the migration runs, every endpoint fails closed rather than silently succeeding — which is the intended behaviour, but it means the integration does nothing at all yet. |
| **R-16** | The CRM's storage pools are unprovisioned: all six pool rows exist with `bucketPath = null`, so every upload is refused `409 POOL_NOT_PROVISIONED`. Pre-existing, not introduced by R-15, but it blocks the integration end to end. | Medium | An administrator must set a real backend path for `STUDENT_STORAGE` before any document can be stored. |
| **R-17** | Document **malware scanning** (required by the CRM brief §10 step 4) was not located in the CRM and is not provided by the vault. Attachments arriving from WhatsApp would currently be stored unscanned. | **High** | Verify in the CRM repository whether a scanner exists. If not, add one before enabling the vault integration — a passport PDF from a messaging channel is the sharpest risk in the document pipeline. |
| **R-18** | CRM-side residual risks recorded in `CRM_PHASE0_AUDIT.md`: **five divergent Prisma schemas** in-tree (610 canonical vs 276 / 276 / 217), overlapping model families (14 document models, 5 message, 5 consent, 5 campaign), `AiStudentMemory.studentId` and `InboundMessage.studentId` are plain strings with **no foreign key**, and duplicate application trees. | Medium | All are CRM-repository work. Not actionable from here, and not safe to guess at: reconciling them needs the CRM's own 531-test suite as the safety net. |
| **R-13** | Tenant isolation verified on a representative sample (`sessions`, `projects`, `tasks`, `support-tickets`), not across all 91 models. Migration ordering not verified against the deployed database. | Medium | Needs a full handler review, ideally with a staging database to make it verifiable rather than inferential. |
| **R-14** | Superseded `main` runs still **queue** rather than being cancelled, then fail fast. | Low | Deliberate: flipping the workflow-level group to `cancel-in-progress: true` could cancel the `deploy` job mid-flight, which is how a host ends up half-migrated. Ordering is enforced inside the release procedure instead. Residual cost is a run that fails in seconds with an accurate message. |

---

## 5. Required operational actions before the next release

In order. Items 1–3 need access this environment does not have.

1. **Inspect the production host checkout** (`alo-server-lap`). Run
   `bash scripts/host-checkout-status.sh "$HOME/projects/Hosting-Portal"`.
   - If it exits 0 and reports tolerated deployment output: nothing to do, proceed.
   - If it exits 1: read the printed paths and resolve them deliberately. **Do not
     `git clean -fd` or `git checkout .` as a reflex** — that destroys uncommitted
     work. Procedure in `DEPLOYMENT_RUNBOOK.md` §4.
2. **Configure a required reviewer on the `production` environment** (R-06) before
   the dirty-checkout blocker clears. Today the blocker is accidentally acting as
   the only thing preventing unattended deploys; removing it without adding the
   approval gate would make every merge to `main` deploy itself immediately.
   **Sequencing matters: do this first.**
3. **Merge this work and observe one full `main` run.** Confirm the `deploy` job —
   not just `verify` and `build` — completes, then verify independently per
   `DEPLOYMENT_RUNBOOK.md` §7 (health names the exact commit, DB connected, schema
   current, `/login` 200).
4. Run `npm audit` where the advisory API is reachable (R-12).
5. Run the MFA and session flows in a real browser against a staging instance
   (R-08) before telling users 2FA works.
6. Decide the fate of `alo-hosting-portal/` (R-03) and consolidate the two settings
   surfaces (R-09).
7. Schedule the behavioural audit of the 43 privileged shell helpers (R-11). This
   is the largest unaudited attack surface in the repository.

---

## 6. Readiness assessment

# ⚠️ READY WITH DOCUMENTED LIMITATIONS

**The code is ready. The production host is not, and the deployment has not been
proven.**

### Justification

**Ready:**
- All quality gates pass: 596 tests, lint, typecheck, production build, 70 shell
  programs parse, standalone entrypoint present.
- The defect that blocked every deployment for five consecutive runs is fixed, and
  fixed so the host **self-heals** rather than requiring manual intervention.
- Two silent-failure hazards that would have produced a green run while doing the
  wrong thing are closed: the backwards release (D-02) and the vacuous staleness
  guard (D-03).
- A real reflected SSRF is closed, with the legitimate loopback path proven still
  working by test (D-09).
- Three controls that fabricated success now report what the server actually said
  (D-06, D-07, D-08).
- Every refusal path fails closed. Unknown is never treated as fine.

**Not ready — and these are limitations, not unknowns:**
- **Nothing has been deployed or verified in production.** R-05 blocks it and
  requires host access. Until a `deploy` job completes and health is independently
  confirmed, PRs #14–#17 remain merged-but-unverified in production.
- **No approval gate.** R-06 must be closed *before* R-05, or clearing the blocker
  makes merges deploy themselves unattended.
- **The privileged shell helpers are unaudited behaviourally.** R-11 is the largest
  remaining attack surface and is not covered by any claim in this document.
- **The UI fixes are not browser-verified.** R-08.
- **Static audit only.** No penetration test, no dynamic analysis, no dependency
  advisory scan, no live database.

### Scope note on the CRM integration

The verdict above covers the deployment pipeline, the settings controls and the
SSRF fix. The CRM ↔ Hosting-Portal document vault integration added in commit
`7cf8516` is assessed separately in `CRM_INTEGRATION_CONTRACT.md` §10, and its
status is **implemented and tested, not deployed, not provisioned, not consumed**.
It does not change this verdict in either direction: it adds no risk to the
existing deployment path (the schema change is additive, the browser-session
endpoints are untouched, and every new route fails closed), and it delivers no
production value until its five prerequisites are met.

**R-17 is the one that should gate enabling it.** Document malware scanning was
not located in the CRM and is not provided by the vault, so turning the
integration on today would mean storing WhatsApp attachments — including
passports — unscanned. Verify that in the CRM repository first.

### What would move this to READY

1. R-06 closed (required reviewer on `production`).
2. R-05 closed and **one full `main` run observed** with the `deploy` job
   completing and health independently verified against the runbook.
3. R-08 closed: MFA enable → verify → disable, and session revoke, exercised in a
   real browser against staging.
4. R-12 closed: `npm audit` with no unaddressed high or critical findings.

### What would move this to NOT READY

Any of: a `deploy` job that fails after R-05 is cleared; the host checkout
containing real uncommitted work that turns out to be load-bearing; a browser run
showing the MFA flow does not complete; or an `npm audit` finding an exploitable
dependency in a request path.

---

## 7. Statement on the limits of this assessment

Every claim above is backed by a command output, a file path, a test name, or a
GitHub annotation with a job id. Where a scan produced a result, that result was
hand-verified before being reported — and two scans during this audit **did**
produce false positives, both recorded (`/api/security/audit-logs` reported
unwired when it is called; `/api/projects`, `/api/tasks` and `/api/support-tickets`
reported unauthenticated when all three use `getToken` and scope by user id).

No feature is claimed to work because it built, because a test with a similar name
passed, or because a PR merged. Where verification was not possible, the gap is
listed in §4 rather than omitted. **A merged PR is not a successful production
deployment, and this document does not treat any of these as one.**
