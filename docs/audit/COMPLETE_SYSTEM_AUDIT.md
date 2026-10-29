# Complete System Audit — ALO Hosting Portal

**Audit date:** 2026-10-29
**Baseline commit:** `7fc3d15fcdfcfe5a2b494eea276935795d3f04a0` (`main`, merge of PR #17)
**Work branch:** `arena/c02ea3c0-hosting-portal`
**Production status at time of writing:** **no successful deployment since run #53.** Runs #54, #58, #60, #62 and #64 all failed before the mutating job.

This record distinguishes four things that are routinely conflated: a **code
change**, a **tested change**, a **merged change**, and a **verified production
change**. Nothing in this audit is a verified production change. See
`PRODUCTION_READINESS.md`.

---

## 1. Baseline evidence

| Item | Value | Source |
|---|---|---|
| Production reference commit | `7fc3d15` | `git log`, GitHub compare API |
| Latest `main` head at audit time | `7fc3d15` | `gh api .../compare` |
| Open PRs at start | #18 `fix/comprehensive-deploy-safety-audit` | `gh pr list` |
| PR #18 CI | **success**, 3m15s, run `40797896075` | `gh run list` |
| Workflow runs inspected | #53–#64 (76 total in repository) | `gh run view` |
| Self-hosted runner | `alo-server-lap` | job `runner_name` |
| Production deployment environment | `production` (no required reviewer configured) | workflow + `docs/DEPLOYMENT-AND-ROLLBACK.md` |

### Run-by-run outcome on `main`

| Run | Commit | Conclusion | Actual cause |
|---|---|---|---|
| #64 | `7fc3d15` | failure | Preflight: *"Production checkout has local changes"* (annotation on job `123187249221`) |
| #62 (att. 1) | `123d558` | failure | Preflight timeout `5m0s` |
| #62 (att. 2) | `123d558` | cancelled | Cancelled at 5m16s |
| #62 (att. 3) | `123d558` | failure | **Artifact digest step** — the queued run outlived the artifact's 2-day retention |
| #60 | `88fb789` | cancelled | Preflight exceeded `timeout-minutes: 5` |
| #58 | `46bb044` | cancelled | Preflight exceeded `timeout-minutes: 5` |
| #54 | `3dd3986` | failure | *"Production checkout has local changes"* (annotation on job `123149167333`) |
| #53 and earlier PR runs | — | success | Pull-request runs never reach the deploy jobs |

**Pattern:** every `pull_request` run passed in 2–3 minutes because the deploy
jobs are conditioned on `push` to `main`. Every `main` run failed. CI green on a
PR was therefore never evidence that a deployment worked.

---

## 2. Inventory and audit coverage

| Area | Count | Inspected | Notes |
|---|---|---|---|
| Tracked files | 1081 | — | |
| `src/**` TS/TSX | 474 | Partial | Full read of deploy, security, auth, release-identity paths |
| API route files | 206 | **All** (auth posture) | Programmatic scan, 19 hand-verified |
| UI pages (`page.tsx`) | 60 | Enumerated | Route reachability verified |
| Components | 115 | Partial | `SettingsView.tsx` read in full |
| `src/lib/**` | 81 | Partial | |
| Prisma models | 91 | Enumerated | 242 `@unique`/`@@index`/`@@unique` directives |
| Migrations | 10 + `0_init` | Enumerated | Additive-only policy enforced at deploy |
| Test files | 41 (was 39) | **All run** | 596 tests |
| Shell programs | 70 | **All** (`bash -n`) | 32 `.sh` + 38 extension-less helpers |
| `helpers/` | 24 | Syntax-validated | Not behaviourally audited |
| `server-helpers/` | 19 | Syntax-validated | Not behaviourally audited |

### Explicitly **not** audited

These are listed rather than implied to be covered:

1. **`alo-hosting-portal/` (325 files)** — a nested duplicate application tree.
   Not built, tested, linted, typechecked or deployed by anything (verified: no
   reference in `ci-cd.yml`, `Dockerfile`, `docker-compose.yml`, `next.config.ts`,
   `deploy-production.sh`, `deploy-release.sh`; `tsconfig.include` is `src/**`,
   `vitest.include` is `tests/**`, `lint` is `eslint src/`). Its
   `prisma/schema.prisma` **differs** from the root schema and its `src` diverges
   in **245** places. Content not reviewed. See D-14.
2. **`alo-server-kit/` (47 files)** — not reviewed beyond inventory.
3. **Behaviour of the 43 shell helpers** — parse-validated only. These execute on
   customer servers with elevated privileges; a behavioural audit is outstanding
   and is the largest remaining gap.
4. **Runtime behaviour against a live database** — no production or staging
   database was reachable from this environment. All verification is static plus
   unit/integration tests using isolated temporary databases.
5. **Browser-level E2E** — no headless browser run. UI fixes are verified by
   typecheck, lint, build and source-level regression tests, **not** by clicking
   through the flow.
6. **Dependency vulnerability scan** — `npm audit` was not run against a live
   advisory database (no outbound access to the npm advisory API from this
   environment).

---

## 3. Confirmed defects

Severity: **Critical** = production down, data loss, or unauthenticated privileged
access. **High** = silent wrong behaviour in a safety or security control.
**Medium** = defect requiring operator intervention or causing wasted work.
**Low** = maintainability, hygiene, or latent risk.

### D-01 · HIGH · Deployment deadlocked by its own output — FIXED

**Evidence.** `scripts/deploy-release.sh` set `IDENTITY_FILE="release-identity.json"`
and wrote it with `cat > "$IDENTITY_FILE"` while `cd`'d into `$APP_DIR`, the
production Git checkout. `git check-ignore -v release-identity.json` returned
*not ignored*; `git ls-files` confirmed it is not tracked. Both the workflow's
preflight step and `scripts/deploy-preflight.sh` gated on
`git status --porcelain --untracked-files=normal`, which counts untracked files.

**Root cause.** The running application reads its release identity from
`process.cwd()` (`src/lib/release-identity.ts` → `/api/health`), so in inline mode
the file *must* live in the checkout. The dirty-tree guard then treated the
deployment's own output as uncommitted work.

**Impact.** The first successful inline deploy permanently blocked every later
deploy. Self-perpetuating: the host could not pull the commit that would ignore
the file, because that pull was what the file was blocking. Confirmed cause of
runs #54 and #64, and the reason #58/#60/#62 never reached a deploy.

**Fix.** `scripts/host-checkout-status.sh` classifies rather than blanket-rejects.
Tolerance requires *untracked* **and** on an explicit allowlist **and**
content-validated as a well-formed release identity record. Modified or staged
tracked files still block; offending paths are printed. `.gitignore` now lists the
file (PR #18) as defence in depth.

**Why content-validation matters.** An allowlist on filename alone would let any
process smuggle an arbitrary payload past a safety check by naming it
`release-identity.json`. Test 3 in `tests/release-activation.test.ts` writes
`rm -rf /` to that filename and asserts the checkout is **blocked**.

**Verification.** `tests/release-activation.test.ts` builds real temporary Git
repositories in the exact state production was in and asserts exit codes. 10
behavioural cases. **Not verified in production** — see D-16.

---

### D-02 · HIGH · Obsolete queued run could silently roll production back — FIXED

**Evidence.** `gh api .../compare/123d558...7fc3d15` returned
`status: ahead, ahead_by: 2, behind_by: 0` — run #62's commit is a **direct
ancestor** of run #64's. Run #62 sat `pending` for ~2 hours in the
`hosting-production-deploy` concurrency group (`cancel-in-progress: false`,
deliberately, so a deploy is never interrupted mid-flight). Its `deploy` job would
have run `git reset --hard 123d558`, then satisfied its own health check and
reported success while reverting two commits of deploy and agent fixes.

**Root cause.** `scripts/deploy-release.sh` asked only *"is this commit on
`origin/main`?"* via `git merge-base --is-ancestor`. An ancestor of main is exactly
what an obsolete release is. Nothing compared the target against the release that
was actually running.

**Impact.** Silent backwards release with a green run and a passing health check.
Only D-01 prevented this from happening.

**Fix.** `src/lib/deploy/release-guard.ts` decides activation from the
authoritative main head, explicit ancestry facts, and the *running* release read
from `release-identity.json`. Forward releases must be main's current head.
Placed **before** the deployment shape is chosen, so it covers both paths.

**Verification.** 10 unit tests over the decision table plus CLI-bridge tests.

---

### D-03 · HIGH · The staleness guard added in PR #18 passed vacuously — FIXED

**Evidence.** PR #18 added:

```bash
git fetch origin main
LATEST_MAIN_SHA="$(git rev-parse origin/main)"
[[ "$SHA" == "$LATEST_MAIN_SHA" ]] || fail "commit ${SHA} is stale; ..."
```

`actions/checkout@v4` defaults to `fetch-depth: 1`. In a shallow clone
`git fetch origin main` writes `FETCH_HEAD` and does not reliably update
`refs/remotes/origin/main`; the ref stays pinned at the commit the workflow was
triggered by. `SHA` **is** `github.sha` for that run, so the comparison is true for
precisely the stale run it exists to reject.

**Root cause.** Deriving "current head of main" from a clone whose depth is
controlled by the CI system, not by the script.

**Impact.** A guard that reads as protection in review and provides none. This is
worse than no guard, because it suppresses the question.

**Fix.** `scripts/latest-main-sha.mjs` resolves the head from the GitHub REST API,
falling back to `git ls-remote` (which asks the remote and is depth-independent).
If neither works it prints nothing and exits non-zero, and callers **fail closed**.
The deploy job also checks out with `fetch-depth: 0` so ancestry questions can be
answered at all.

**Verification.** `tests/release-activation.test.ts` asserts the vacuous form is
absent from the script and that the resolver fails closed rather than guessing.

---

### D-04 · HIGH · Canonical deployment path had no release guard at all — FIXED

**Evidence.** PR #18's guard was placed in section *3c*, inside the inline branch.
`scripts/deploy-production.sh` (the canonical path — immutable release directory,
atomic symlink swap) contains no staleness or backwards-release check.
`deploy-release.sh` delegates to it and exits before reaching 3c.

**Impact.** Whichever path the preflight selected decided whether the guard ran.
Canonical is the *intended* production shape (`src/lib/deploy/preflight.ts`
docstring), so the guard was absent exactly where the host is meant to end up.

**Fix.** Guard moved to a new section 0, before mode selection, so both shapes are
covered by one code path.

**Verification.** Test asserts ordering: section 0 < shape decision < canonical
branch < first mutation.

---

### D-05 · MEDIUM · Rollback had no attribution or audit trail — FIXED

**Evidence.** PR #18 permitted a rollback with `ALLOW_RELEASE_ROLLBACK=1` alone —
no operator, no reason, no record.

**Fix.** `RELEASE_ROLLBACK_OPERATOR` and `RELEASE_ROLLBACK_REASON` are required;
without them the guard returns `unattributed-rollback` and refuses. A JSONL record
(event, timestamp, operator, reason, source release, target release, main head at
decision, deployment id, result) is appended to
`${ALO_DEPLOY_LOG_DIR}/rollback-audit.jsonl`.

**Deliberately outside the Git checkout.** Writing it into the tree would recreate
D-01. Asserted by test.

**Rollback and the database.** Additive migrations applied by the *newer* release
are **not** reversed by activating an older one. The guard's authorization message
says so explicitly, and `DEPLOYMENT_RUNBOOK.md` records that a rollback is a code
rollback only. `scripts/apply-deploy-schema.mjs` refuses rebuild migrations during
deployment (`--allow-rebuild` requires a human and a verified backup), which is
what makes "additive only" a real property rather than an intention.

---

### D-06 · HIGH · Two-factor authentication control reported success it did not earn — FIXED

**Evidence.** `src/components/platform/views/SettingsView.tsx` rendered:

```tsx
<Switch checked={twoFactor} onCheckedChange={(val) => {
  setTwoFactor(val)
  toast.success('Two-factor authentication ' + (val ? 'enabled' : 'disabled'))
}} />
```

`twoFactor` was `useState(false)` and never reconciled with the server. No API
call. No TOTP secret issued. Nothing persisted.

Meanwhile a complete, secured backend existed with **zero callers anywhere in the
UI** (verified by literal search across all 268 non-API TS/TSX files):
`/api/user/mfa` (GET status; POST enrollment issuing a TOTP secret, `otpauth://`
URI and 10 hashed backup codes), `/verify`, `/disable`, `/backup-codes` — all
`requireSession`-guarded, using `otpauth` with SHA1/6 digits/30s.

**Impact.** Two distinct harms. A user who enabled 2FA had no 2FA but was told
they did. A user who *had* 2FA saw "disabled", because the state defaulted false.
This is the precise anti-pattern the repair brief prohibits: a fake success
message standing in for real functionality, in a security control.

**Fix.** Wired end to end. Status is read from the server; `null` renders as
"could not be loaded" rather than a confident "off"; enrollment states plainly
that 2FA stays off until verification; enabling is confirmed by **re-reading**
`/api/user/mfa` rather than trusting the 200; disabling requires a code the server
verifies.

**Verification.** `tests/settings-security-honesty.test.ts`, 6 cases, plus a
general guard that every remaining `toast.success` in the view follows an awaited
server response.

---

### D-07 · HIGH · Active Sessions list was fabricated and revocation did nothing — FIXED

**Evidence.** The list was synthesized from `navigator.userAgent` into a single
row with `ip: '•••'`, `location: 'Current session'`, `lastActive: 'Now'`. Revoke
ran `setSessions(prev => prev.filter(...))` and toasted `Session "..." revoked`.
`/api/security/sessions` (GET listing the real `session` table scoped to
`userId`; DELETE by `sessionId` or `all=true`, excluding the caller's own token so
it cannot lock itself out) had no callers.

**Impact.** A user shown "1 active session (current)" could have had many. Revoking
a stolen session appeared to work and did not.

**Fix.** Real list (IP, user agent, created, expires, `isCurrent`), real DELETE,
reports the count the server actually deleted, honest empty state, plus
"Revoke all others".

**Verification.** 4 tests, including tenant-scoping assertions on the backend.

---

### D-08 · MEDIUM · Notification preferences claimed to save with no backend — FIXED (honestly)

**Evidence.** Save ran `setSavedNotifSettings({...notifSettings})` then
`toast.success('Notification preferences saved')`.
`grep '^model NotificationPreference' prisma/schema.prisma` → no match. No
endpoint accepts preferences.

**Fix.** The card now states that per-channel preferences are not stored,
distinguishes this from `/api/notifications` and `/api/alerts/rules` which **do**
persist, and records exactly what is needed to make it real.

**Deliberate scope decision.** Adding a `NotificationPreference` model is a schema
change requiring an additive migration and database verification against
production. Bundling that into a UI-honesty commit would have made the commit
unreviewable and coupled it to a migration that cannot be tested from this
environment. Recorded as **R-02** in `PRODUCTION_READINESS.md`.

---

### D-09 · HIGH · Reflected SSRF through the deployment health probe — FIXED

**Evidence.** `verifyDeployment` (`src/lib/deploy/service.ts`) fetched
`new URL(healthPath, baseUrl)` where `baseUrl = project.healthUrl`. That field was
accepted by `POST /api/deploy/projects` and `PATCH /api/deploy/projects/[id]`
under `z.string().url()` only — no host validation — behind
`requirePermission("WEBSITE_CREATE")`, not admin-only. The response body was
discarded (`arrayBuffer()`), **but** `marker` was parsed from
`/__alo_release.json` and the entire `VerifyResult` — `httpStatus`, `marker`,
`attempts` — was persisted to `deployment.healthResult`.

**Impact.** Set `healthUrl` to `http://169.254.169.254` and the metadata service's
JSON response is read back out of the deployment record. At minimum, a port/status
oracle against internal hosts.

**Aggravating factor.** The repository already contained the correct primitive —
`isCloudMetadataOrLinkLocalHost`, whose own docstring says these hosts "must NEVER
be contacted by any provider or webhook" — and `validateExternalWebhookUrl`
applied it to customer webhooks. The deploy probe did not use it.

**Fix.** New shared `assertNotCloudMetadataUrl` (http/https only, no embedded
credentials, no metadata or link-local target). Applied to the base **and** the
composed probe and marker URLs, because an absolute `healthPath` passed to
`new URL(path, base)` discards the base entirely. Also validated at both input
boundaries. Reports failure through its return value instead of throwing past the
deployment pipeline.

**Loopback and RFC1918 remain allowed, deliberately.** The default health base URL
is `http://127.0.0.1:<port>`; blocking private ranges would fail every deployment
on the host. Public-internet callers keep using the stricter
`validateExternalWebhookUrl`.

**Verification.** `tests/ssrf-health-probe.test.ts`: 11 metadata targets fail
closed with `attempts: 0` (proving rejection *before* any request), the
`healthPath` override is covered, IPv4-mapped `::ffff:169.254.169.254` is covered,
and a **real local HTTP server** proves legitimate loopback verification still
succeeds — including that a 200 from a stale process with a mismatched marker is
still refused.

**Residual.** See **R-01**: hostname-string checks do not defeat DNS rebinding.

---

### D-10 · MEDIUM · Duplicated, weaker copy of the SSRF rule — FIXED

**Evidence.** `/api/ai/providers` had its own `assertSafeEndpointUrl` with a
hand-listed blocklist. Compared with `isCloudMetadataOrLinkLocalHost` it missed:
`0.0.0.0`, `::`, `metadata`, `metadata.azure.com`, `instance-data`, `fe80::/10`,
IPv4-mapped `::ffff:169.254.x.x`; and it did not reject credentials embedded in
the URL.

**Root cause.** Two copies of one security rule. They diverge toward the weaker.

**Fix.** Delegates to the shared guard. Applied on both the register and probe
paths, as before. Admin-only (`isAdminRole`), unchanged.

---

### D-11 · MEDIUM · CI shell gate validated 32 of 70 shell programs — FIXED

**Evidence.** The step added in PR #18 used
`find ... -type f -name '*.sh' | xargs -0 -r -n1 bash -n`. 38 shell programs in
`helpers/` and `server-helpers/` are extension-less (`alo-deploy-helper`,
`alo-firewall-helper`, `alo-ssh-helper`, …) and are what agents execute on
customer servers. All were skipped; the gate still reported green.

**Fix.** Selection by shebang as well as extension, plus `agent/`. Coverage rose
from **32 to 70** programs, all passing. The gate now **fails** if it matches fewer
than 40, so it cannot pass vacuously again.

**Verification.** Test runs the same selection locally and asserts the count.

---

### D-12 · MEDIUM · Queued runs failed on expired artifacts — FIXED

**Evidence.** Run #62 attempt 3 failed at *"Verify the artifact digest matches
what CI built"*, not at preflight: the run was created 2026-10-28T22:31Z and
attempt 3 ran ~01:37Z, past the artifact's `retention-days: 2` relative to the
original build, so the download produced nothing.

**Fix.** The preflight job now resolves main's head and rejects an obsolete run
**before** downloading the payload. Obsolete runs fail in seconds with an accurate
message instead of minutes later with a confusing one.

---

### D-13 · MEDIUM · Preflight timeout shorter than the work it had to do — FIXED upstream (PR #17)

**Evidence.** `timeout-minutes: 5` on a self-hosted job that runs `npm ci`
(~1 min) then downloads a large artifact (~4–6 min on this runner). Runs #58 and
#60 died at the 5-minute boundary; #60's `deploy` job then sat `queued` for 4h37m
before the run was cancelled.

**Status.** Fixed by PR #17 (`timeout-minutes: 20`), verified in run #64, which
got past `npm ci` and the download. Not a defect of this branch; recorded because
it masked D-01 — the real blocker was only visible once the timeout stopped firing
first.

---

### D-14 · MEDIUM · 325-file nested duplicate application tree — DOCUMENTED, not changed

**Evidence.** `alo-hosting-portal/` contains a full second copy of the application:
its own `package.json` (same name `alo-hosting-panel`, but `engines.node >=22.0.0`
versus root `>=20.9.0`), `src/`, `prisma/`, `scripts/`, `tests/`, `helpers/`,
`server-helpers/`, `install-scripts/`, plus `bun.lock`, `worklog.md`,
`seed-platform.ts`, `mini-services/`, `examples/`.

- Its `prisma/schema.prisma` **differs** from the root schema.
- Its `src/` diverges from the root `src/` in **245** places, and is missing
  features the root has: the `(admin)`, `(auth)` and `(dashboard)` route groups,
  `api/agents/enroll`, `api/agents/heartbeat`, `api/agents/tasks`,
  `api/agents/enrollment-tokens`.

**Not referenced by anything.** Verified absent from `ci-cd.yml`, `Dockerfile`,
`docker-compose.yml`, `next.config.ts`, `deploy-production.sh`,
`deploy-release.sh`, `tsconfig.include`, `vitest.include`, and the `lint` script.
The deployed artifact paths (`.next/standalone`, `.next/static`, `public`,
`prisma`, `helpers`, `scripts/…`) do not include it.

**Impact.** No deployment hazard. Real human hazard: a contributor can edit the
wrong tree, or run `npm install` / `prisma migrate` against the divergent schema,
and nothing tells them it is dead. Two schemas for one product is a data-model
ambiguity waiting to be resolved incorrectly.

**Not changed, and why.** Deleting 325 files is destructive and not reversible
from evidence available here — the tree may be an intentional archive, a
migration source, or somebody's working copy. The repair brief prohibits broad
unverified replacements. **Recommended action:** an explicit decision by a
maintainer to delete it or mark it archived, as its own reviewable commit.
Tracked as **R-03**.

---

### D-15 · LOW · Overlapping API surfaces — DOCUMENTED

| Pair | Both used? | Assessment |
|---|---|---|
| `/api/security/ssh` · `/api/security/ssh-keys` | `ssh` used by `SecurityView.tsx`; `ssh-keys` has **0** consumers | Both write `db.sshKey` via `callHelper` + `getSshPublicKeyFingerprint`. Genuine duplication of one model behind two routes. |
| `/api/deploy` · `/api/deployments` | `deploy` 2 consumers; `deployments` 0 | `/deployments` superseded. |
| `/api/ci` · `/api/ci-cd` | 1 consumer each | Both live; scope overlap unverified. |
| `/api/apps` · `/api/applications` · `/api/sites` | 1 / 2 / 1 consumers | All live. **Not** assumed to be duplicates — app-center, applications and hosting sites are plausibly distinct concepts. Needs a maintainer decision. |

Not changed. Removing an authenticated, working endpoint could break a consumer
outside this repository (a script, an agent, an integration). Tracked as **R-04**.

---

### D-16 · HIGH · Production host checkout is still dirty — BLOCKER, requires host access

**Evidence.** Run #64's failure annotation, 2026-10-29T00:37:39Z.

**Status.** The code fix (D-01) makes the *next* deploy tolerate the file the
previous deploy wrote — that is precisely why tolerance is content-validated
rather than `.gitignore`-dependent, since the ignore rule cannot take effect until
the host pulls the commit containing it, and that pull is what is blocked.

**Cannot be verified from here.** No access to `alo-server-lap`. If the host's
dirty state contains anything *other* than a well-formed `release-identity.json`,
the classifier will still (correctly) block, and an operator must inspect it.
`DEPLOYMENT_RUNBOOK.md` §"Blocked: production checkout has local changes" gives
the exact procedure. Tracked as **R-05**.

---

### D-17 · MEDIUM · Deploy job starts unattended — DOCUMENTED, requires repository admin

**Evidence.** `deploy` declares `environment: production`, but the workflow's own
comment records that no required reviewer is configured, so the job starts
immediately on merge to `main`.

**Not fixable in code.** Environment protection rules are repository settings;
`permissions: contents: read` is (correctly) the only permission this workflow
holds, and nothing in a workflow file can create its own approval gate.
`docs/DEPLOYMENT-AND-ROLLBACK.md` already records the administrator action
required. Tracked as **R-06**.

---

### D-18 · LOW · 57 API routes have no in-repo consumer — DOCUMENTED

Programmatically established (static prefix of each route searched across all 268
non-API TS/TSX files; the scanner was validated against a known false positive,
`/api/security/audit-logs`, which it correctly excludes).

**Not a defect on its own.** These divide into three groups:

1. **Legitimately machine-facing** — no UI consumer is expected:
   `/api/cron` (external scheduler), `/api/operations/worker` and
   `/api/monitoring/collect` (`verifyInternalSecret`), `/api/monitoring/check`,
   `/api/agents/seed`, `/api/auth/providers`.
2. **Genuine UI gaps** — working, authenticated backends with no screen:
   `/api/user/mfa/backup-codes` (regenerate), `/api/ssl/check|expiring|renew`,
   `/api/storage/documents*`, `/api/storage/pools`, `/api/billing/usage*`,
   `/api/email/send|verify|dns-records`, `/api/platform/secrets|webhooks|cron-jobs`,
   `/api/security/rate-limits|encrypt`, `/api/roles`, `/api/github/disconnect`,
   `/api/system/info|resources|services`, `/api/logs/center`,
   `/api/orchestrator/status`, `/api/operations`.
3. **Superseded duplicates** — see D-15.

Group 2 is the real integration backlog. Full per-module breakdown in
`MODULE_INTEGRATION_MATRIX.md`. Tracked as **R-07**.

---

## 4. What is verifiably sound

Recorded so this report is not only a defect list, and so the next auditor does
not re-derive it.

| Property | Evidence |
|---|---|
| Authorization coverage | 187 of 206 API routes reference an auth helper. The 19 that do not were **each hand-verified**: auth endpoints, `health`, `pricing`, `contact`, `newsletter`, `csrf`, root `api`, `github/webhook` (HMAC via `handleGitHubWebhook`), `internal/sites/ssl-status` (`timingSafeEqual`, fails closed when the env var is unset, `.strict()` zod), and 4 agent routes (`requireAgent`). |
| No SQL injection surface | `queryRawUnsafe` / `executeRawUnsafe`: **0** occurrences. Only 2 `$queryRaw` uses, both tagged templates, both `LIMIT 0` schema probes in `/api/health`. |
| No dynamic code execution | `eval(` / `new Function(`: **0** occurrences in `src/`. |
| No shell interpolation | `spawn` used once, argv-array form (`src/lib/deploy/engine.ts`). No `exec`/`execSync`. `/api/servers/provision` uses `execFile` with an argv array, strict zod hostname regex, and a root-owned helper allowlist. |
| XSS | One `dangerouslySetInnerHTML`, in `src/components/ui/chart.tsx` (shadcn/recharts theme injection). |
| Tenant scoping | Spot-verified on `sessions` (both handlers filter `userId: user.id`; bulk revoke excludes the caller's own token), `projects`/`tasks`/`support-tickets` (`where: { userId: token.id }`). |
| Migration safety | Deployments apply **additive-only** migrations; `--allow-rebuild` requires a human plus a verified backup and is never passed by a deploy (asserted by existing tests). |
| Release verification | `/api/health` reports the release identity; both deploy paths require the health response to name the **exact** commit SHA plus database and schema health, and `/login` to return 200. A 200 from a stale process is not accepted. |
| Rollback on failure | Both paths restore automatically and re-verify; the inline path captures `.next`, the identity record and a database copy **before** changing anything. |
| Secrets hygiene | Deploy scripts resolve `DATABASE_URL` without sourcing env files (no shell execution) and never print it. Provider API keys are encrypted at rest (`encryptSecret`) and private base URLs are masked in responses. |
| Documented remediation is real | `docs/UNIFIED_PROJECT_MERGE_MAP.md` called for removing a hardcoded `'alo-cron-secret-2026'` fallback. `grep` across `src/`: **0** occurrences. Already remediated. |

---

## 5. Quality gates at time of writing

| Gate | Command | Result |
|---|---|---|
| Dependencies | `npm ci --include=dev` | pass |
| Prisma client | `postinstall` → `prisma generate` | pass |
| Lint | `npm run lint` (`eslint src/`) | pass, 0 problems |
| Typecheck | `npm run typecheck` (`tsc --noEmit`) | pass, 0 errors |
| Tests | `npm test` (`vitest run`) | **596 passed / 596**, 41 files |
| Shell syntax | `bash -n` over 70 programs | pass |
| Production build | `npm run build` | ✓ Compiled successfully; 267 routes; `.next/standalone/server.js` present |

Baseline before this work: 533 tests / 38 files. Added: 63 tests / 3 files.
No test was skipped, weakened, or deleted. Two existing assertions in
`tests/deploy-pipeline.test.ts` were **updated** because they pinned the
*implementation form* of a guard this work deliberately strengthened; every safety
property they asserted is still asserted, and both are documented in
`REPAIR_TRACKER.md`.

Format check (`prettier --check`) is **not** part of this repository's scripts and
was not run; no formatter config is present at the root.

---

## 6. Severity summary

| Severity | Count | Fixed | Documented with justified blocker |
|---|---|---|---|
| Critical | 0 | — | — |
| High | 7 (D-01, D-02, D-03, D-04, D-06, D-07, D-09) + D-16 | 7 | D-16 needs host access |
| Medium | 8 (D-05, D-08, D-10, D-11, D-12, D-13, D-14, D-17) | 5 | D-13 fixed upstream; D-14, D-17 need maintainer/admin |
| Low | 2 (D-15, D-18) | 0 | Both documented |

No defect was closed by removing functionality, and no test was made to pass by
weakening it.
