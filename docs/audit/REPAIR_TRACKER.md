# Repair Tracker

Every defect from `COMPLETE_SYSTEM_AUDIT.md`, with its fix commit, test evidence
and remaining blockers. **Status vocabulary is deliberate:**

- **Fixed & tested** — code changed and covered by a passing automated test in this repository.
- **Fixed upstream** — changed on `main` before this branch; verified by observation, not by this branch.
- **Documented** — deliberately not changed, with a reason that is not "ran out of time".
- **Blocked** — cannot be completed without access this environment does not have.

None of these mean *verified in production*. Nothing here has been deployed.

---

## Batch 1 — Deployment safety and release consistency

Commit `5236e74` · `fix(deploy): close the dirty-checkout deadlock and the stale/backwards release path`

| ID | Defect | Files | Status | Test evidence |
|---|---|---|---|---|
| D-01 | Deploy wrote `release-identity.json` into the production checkout; the untracked-file dirty check then blocked every later deploy | `scripts/host-checkout-status.sh` (new), `scripts/deploy-preflight.sh`, `.github/workflows/ci-cd.yml`, `.gitignore` (PR #18) | **Fixed & tested** | `tests/release-activation.test.ts` — 10 behavioural cases against real temporary Git repositories |
| D-02 | Obsolete queued run could reset production backwards and report success | `src/lib/deploy/release-guard.ts` (new), `scripts/decide-release-activation.mjs` (new), `scripts/deploy-release.sh` | **Fixed & tested** | 10 decision-table cases + 3 CLI-bridge cases |
| D-03 | Staleness guard compared against `git rev-parse origin/main`, which a shallow clone pins to the run's own commit | `scripts/latest-main-sha.mjs` (new), `scripts/deploy-release.sh`, `.github/workflows/ci-cd.yml` (`fetch-depth: 0`) | **Fixed & tested** | Resolver fails closed; vacuous form asserted absent |
| D-04 | Canonical deploy path had no release guard | `scripts/deploy-release.sh` (guard moved to section 0, before mode selection) | **Fixed & tested** | Ordering assertion: guard < shape decision < canonical branch < first mutation |
| D-05 | Rollback permitted with a bare env flag; no operator, reason or record | `scripts/deploy-release.sh`, `src/lib/deploy/release-guard.ts` | **Fixed & tested** | Attribution required; audit record shape asserted; record location asserted outside the checkout |
| D-11 | CI shell gate validated 32 of 70 shell programs | `.github/workflows/ci-cd.yml`, `tests/deploy-pipeline.test.ts` | **Fixed & tested** | Gate run locally: 70 programs validated; test asserts count ≥ 40 and fails rather than passing vacuously |
| D-12 | Queued run failed on an expired artifact after a confusing multi-minute download | `.github/workflows/ci-cd.yml` | **Fixed & tested** | Test asserts the staleness gate is ordered before `download-artifact` |

**Regression risk accepted, and why.** The top-level CI concurrency group still
uses `cancel-in-progress: false` for `push` events, so superseded `main` runs still
*queue* rather than being cancelled. Flipping it to `true` was considered and
rejected: the workflow-level group wraps the `deploy` job, so cancelling a
superseded run could interrupt a deployment mid-flight — the exact outcome the
job-level `hosting-production-deploy` group with `cancel-in-progress: false`
exists to prevent, and the file's own comment warns that an interrupted deploy is
how a host ends up half-migrated. Ordering is therefore enforced **inside** the
release procedure instead (three independent points: preflight gate, guard section
0, and revalidation immediately before `git reset --hard`), which satisfies
"reject stale queued deployment commits" without the cancellation hazard. The
residual cost is a queued run that fails in seconds with an accurate message.

### Existing assertions updated (not weakened)

Two assertions in `tests/deploy-pipeline.test.ts` pinned the *implementation form*
of behaviour this batch deliberately changed. Both were updated; each safety
property is still asserted.

| Test | Old assertion | New assertion | Property preserved? |
|---|---|---|---|
| `keeps the preflight job read-only…` | `expect(runs).toContain("status --porcelain")` | `expect(runs).toContain("host-checkout-status.sh")` **and** `toContain("Production checkout has local changes")`; the bare `git status` test asserted absent | Yes — a dirty checkout still blocks, via one versioned, unit-tested classifier instead of two copies of the rule. Read-only-ness still asserted by the unchanged forbidden-command list. |
| `refuses stale queued runs and backwards releases…` | `toContain('LATEST_MAIN_SHA="$(git rev-parse origin/main)"')` | `toContain("latest-main-sha.mjs")`, `not.toContain('…git rev-parse origin/main')`, plus `decide-release-activation.mjs`, `GUARD_DECISION=`, `RELEASE_ROLLBACK_OPERATOR/REASON` | Yes — strengthened. All four original assertions (`merge-base` both directions, `ALLOW_RELEASE_ROLLBACK`, "refusing backwards deployment", "not merged") retained verbatim. |

No test was deleted, skipped, or made less strict.

---

## Batch 2 — Controls that reported success they did not earn

Commit `884e2ec` · `fix(security): stop three settings controls reporting success they did not earn`

| ID | Defect | Files | Status | Test evidence |
|---|---|---|---|---|
| D-06 | 2FA switch set local state and toasted "enabled"; real MFA backend had zero callers; state defaulted to "disabled" for users who had it on | `src/components/platform/views/SettingsView.tsx` | **Fixed & tested** | `tests/settings-security-honesty.test.ts` — 6 cases |
| D-07 | Sessions list synthesized from `navigator.userAgent`; Revoke filtered local state and toasted success; `/api/security/sessions` unused | same | **Fixed & tested** | 4 cases, incl. tenant-scoping of both backend handlers |
| D-08 | Notification preferences toasted "saved"; no model, no endpoint | same | **Fixed & tested** (honest unavailability) | 3 cases, incl. asserting no `NotificationPreference` model exists |

Also added: a general guard that every remaining `toast.success` in this view
follows an awaited server response — so the same defect class cannot silently
return in this file.

**Deliberately not done.** No `NotificationPreference` model was added. A schema
change needs an additive migration and verification against a real database;
neither is possible from this environment, and coupling it to a UI commit would
make both harder to review. Recorded as **R-02**.

**Not browser-verified.** These are client components. Verification is typecheck,
lint, production build, and source-level regression tests. No headless browser run
was performed, so the rendered flow has not been clicked through. Recorded as
**R-08**.

---

## Batch 3 — Reflected SSRF

Commit `f9eea05` · `fix(security): close a reflected SSRF through the deployment health probe`

| ID | Defect | Files | Status | Test evidence |
|---|---|---|---|---|
| D-09 | `verifyDeployment` fetched user-supplied `project.healthUrl` with no host guard and persisted the parsed result to `deployment.healthResult` | `src/lib/security/url-guard.ts`, `src/lib/deploy/service.ts`, `src/app/api/deploy/projects/route.ts`, `src/app/api/deploy/projects/[id]/route.ts` | **Fixed & tested** | `tests/ssrf-health-probe.test.ts` — 13 cases |
| D-10 | `/api/ai/providers` kept a second, weaker copy of the metadata blocklist | `src/app/api/ai/providers/route.ts` | **Fixed & tested** | Delegation asserted; old blocklist asserted absent |

**A defect found by the test, not by review.** The first implementation composed
`new URL(healthPath, baseUrl)` *outside* the try/catch, so a malformed `healthUrl`
made `verifyDeployment` throw instead of returning `{ ok: false }` — an unhandled
exception in the middle of the deployment pipeline. The test
`rejects an unusable base URL instead of throwing past the caller` failed, and the
composition was moved inside the guard. Recorded because it is the clearest
available evidence that these tests exercise behaviour rather than restating the
implementation.

---

## Base — incorporated from PR #18

Commits `f65de56`…`9f285ba`, cherry-picked from
`fix/comprehensive-deploy-safety-audit` (PR #18, CI **success** run `40797896075`,
unmerged at time of writing).

Incorporated rather than reimplemented, to avoid two branches fixing the same
lines. PR #18's `.gitignore` rule and its `deploy-release.sh` guard are both
**superseded** by batch 1: the ignore rule alone cannot unblock a host whose dirty
file predates the rule (D-01), and the `git rev-parse origin/main` comparison is
vacuous under `fetch-depth: 1` (D-03). Its CI shell-syntax step was extended (D-11).

**Merge sequencing.** If PR #18 merges first, this branch needs a rebase; the
conflicts are content-identical or strictly stronger, so resolution is mechanical.
If this branch merges first, PR #18 becomes redundant. Either order is safe.
**Do not merge both without rebasing.**

---

## Documented, not changed

| ID | Defect | Why not changed | Tracking |
|---|---|---|---|
| D-14 | `alo-hosting-portal/` — 325-file nested duplicate tree, divergent Prisma schema, 245 `src` differences, referenced by nothing | Deleting 325 files is destructive and not reversible from evidence available here. It may be an intentional archive or migration source. Requires a maintainer decision as its own reviewable commit. | R-03 |
| D-15 | Overlapping API surfaces (`ssh`/`ssh-keys`, `deploy`/`deployments`, `ci`/`ci-cd`, `apps`/`applications`/`sites`) | Removing an authenticated, working endpoint could break a consumer outside this repository. `apps`/`applications`/`sites` are **not** assumed to be duplicates — they are plausibly distinct concepts. | R-04 |
| D-17 | `deploy` job starts unattended; no required reviewer on the `production` environment | Environment protection rules are repository settings. No workflow file can create its own approval gate, and `permissions: contents: read` is correctly the only permission held. Already recorded in `docs/DEPLOYMENT-AND-ROLLBACK.md`. | R-06 |
| D-18 | 57 API routes with no in-repo consumer | Mostly legitimate (machine-facing) or a UI backlog. Wiring 20+ screens is out of scope for a safety batch and would be unreviewable. Per-module breakdown recorded. | R-07 |

---

## Blocked

| ID | Defect | Blocker | What unblocks it |
|---|---|---|---|
| D-16 | Production host checkout is dirty; every deploy to `main` fails preflight | No access to `alo-server-lap` from this environment | The next deploy **should** now self-heal, because tolerance is content-validated rather than `.gitignore`-dependent. If it does not, an operator must inspect the host — procedure in `DEPLOYMENT_RUNBOOK.md`. |

---

## Test delta

| | Before | After |
|---|---|---|
| Test files | 39 | **41** (+2 new, 1 existing extended) |
| Tests | 533 | **596** (+63) |
| Failing | 0 | **0** |
| Skipped | 0 | **0** |

| Gate | Result |
|---|---|
| `npm ci --include=dev` | pass |
| `prisma generate` | pass |
| `npm run lint` | pass, 0 problems |
| `npm run typecheck` | pass, 0 errors |
| `npm test` | 596 / 596 pass |
| `bash -n` × 70 shell programs | pass |
| `npm run build` | ✓ Compiled successfully; 267 routes; standalone entrypoint present |
