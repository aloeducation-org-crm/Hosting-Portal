# Security Audit

**Scope:** the repository at baseline `7fc3d15`, plus the changes made on
`arena/c02ea3c0-hosting-portal`.
**Method:** static analysis, programmatic scanning of all 206 API routes, and
hand-verification of every route the scanner flagged. No live system was probed and
no production data was touched.

**Important limitation.** This is a static audit. No penetration test, no dynamic
analysis, no authenticated session against a running instance, and no dependency
advisory scan (`npm audit` requires the npm advisory API, which is not reachable
from this environment). Findings of absence below mean "no evidence found by these
methods", not "proven secure".

---

## 1. Findings

### S-01 · HIGH · Reflected SSRF through the deployment health probe — FIXED

**Vector.** `project.healthUrl`, settable by any principal holding
`WEBSITE_CREATE` via `POST /api/deploy/projects` or `PATCH
/api/deploy/projects/[id]`, validated only by `z.string().url()`. Consumed by
`verifyDeployment` as `new URL(healthPath, baseUrl)` and fetched server-side
during every deployment and rollback.

**Reflection channel.** The health response body was discarded, but
`/__alo_release.json` was parsed into `marker`, and the entire `VerifyResult` —
`httpStatus`, `marker`, `attempts`, `reason` — was persisted to
`deployment.healthResult`, which is readable through the deployments API. Setting
`healthUrl` to `http://169.254.169.254/…` therefore turned a deployment record
into a read-back channel for a cloud metadata service, i.e. potentially temporary
cloud credentials.

**Aggravating.** `redirect: "manual"` and a 4-second timeout limited but did not
prevent it. The correct primitive already existed in the repository —
`isCloudMetadataOrLinkLocalHost`, documented as *"must NEVER be contacted by any
provider or webhook"* — and was applied to customer webhooks via
`validateExternalWebhookUrl`, but not here.

**Mitigation applied.** New shared `assertNotCloudMetadataUrl` in
`src/lib/security/url-guard.ts`: http/https only, no embedded credentials, no
metadata or link-local target. Applied to the base URL **and** the composed probe
and marker URLs — necessary because an absolute `healthPath` passed to
`new URL(path, base)` discards the base, so guarding the base alone leaves the
composed request open. Also enforced at both input boundaries so a bad value is
rejected with a clear message rather than stored.

**Deliberate allowance.** Loopback and RFC1918 remain reachable. The default
health base URL is `http://127.0.0.1:<port>`; blocking private ranges would fail
every deployment on the host. Public-internet-facing callers continue to use the
stricter `validateExternalWebhookUrl`, which does reject them.

**Verification.** `tests/ssrf-health-probe.test.ts`: 11 metadata targets fail
closed with `attempts: 0`, proving rejection *before* any request is made;
IPv4-mapped `::ffff:169.254.169.254` covered; `healthPath` override covered; a
real local HTTP server proves legitimate loopback verification still succeeds and
that a 200 from a stale process with a mismatched marker is still refused.

**Residual risk — R-01.** The guard inspects the hostname **string**, not resolved
addresses. A hostname under attacker control that resolves to `169.254.169.254`
bypasses it, and a DNS-rebinding attack (public at validation, private at fetch)
is not defeated. Closing this properly requires resolving and re-pinning the
address, or an egress proxy/network-level block on link-local ranges. Recorded
rather than fixed: a correct fix changes network behaviour for every probe and
needs a live host to validate.

---

### S-02 · HIGH · Two-factor authentication control gave false assurance — FIXED

`SettingsView.tsx` toasted `Two-factor authentication enabled` from a `Switch`
that only set local React state. No secret was issued, nothing was persisted, and
the state defaulted to `false` and was never reconciled — so it also reported
"disabled" to users who had 2FA **on**. A complete, `requireSession`-guarded TOTP
backend existed with zero callers.

**Security impact, precisely:** this is not a missing feature. It is a control
that told users they were protected when they were not, and told protected users
they were not protected. Both directions are harmful; the first is how an account
gets compromised by someone who believes they have 2FA.

**Mitigation.** Wired to `/api/user/mfa`, `/verify`, `/disable`. Status is read
from the server and `null` renders as *"could not be loaded"* rather than a
confident "off". Enabling is confirmed by **re-reading** the status endpoint, not
by trusting a 200 or by the local state just set. Disabling requires a TOTP or
backup code the server verifies. Enrollment states plainly that 2FA stays off
until verification.

**Verification.** `tests/settings-security-honesty.test.ts`, 6 cases.

---

### S-03 · HIGH · Session revocation was simulated — FIXED

The Active Sessions list was synthesized from `navigator.userAgent` into one
fabricated row (`ip: '•••'`, `lastActive: 'Now'`). Revoke removed that row from
local state and toasted success. `/api/security/sessions` — GET over the real
`session` table, DELETE by `sessionId` or `all=true` — had no callers.

**Security impact:** a user responding to a suspected session theft would see one
session, revoke it, be told it succeeded, and remain exposed on every real session.

**Mitigation.** Real list, real DELETE, reports the count the server actually
deleted, honest empty state, plus "Revoke all others".

**Backend verified sound while wiring it:** both handlers scope to
`userId: user.id`, single revoke uses `findFirst({ where: { id, userId } })` so a
session id belonging to another user 404s rather than deleting, and bulk revoke
excludes the caller's own token so it cannot lock itself out.

---

### S-04 · MEDIUM · Duplicated, weaker SSRF blocklist — FIXED

`/api/ai/providers` carried its own `assertSafeEndpointUrl`. Against the shared
`isCloudMetadataOrLinkLocalHost` it missed `0.0.0.0`, `::`, `metadata`,
`metadata.azure.com`, `instance-data`, `fe80::/10`, and IPv4-mapped
`::ffff:169.254.x.x`, and did not reject credentials embedded in the URL. Now
delegates to the shared guard on both the register and probe paths.

**General lesson recorded:** two copies of a security rule diverge toward the
weaker one. The route remains admin-only (`isAdminRole`), unchanged, and
loopback/private stay allowed because registering a self-hosted ollama / LocalAI /
vLLM / LiteLLM engine on a private address is a supported use.

---

### S-05 · HIGH · Obsolete run could silently revert production — FIXED

Not a classic vulnerability, but a safety-control failure with security
consequences: reverting `main` silently reverts security fixes. Run #62's commit
`123d558` is a direct ancestor of `7fc3d15` (compare API: `ahead_by: 2,
behind_by: 0`), and it waited ~2 hours in a single-flight queue that never
cancels. The only check was `git merge-base --is-ancestor "$SHA" origin/main` —
"was this ever merged", which an obsolete release always satisfies.

**Mitigation.** `src/lib/deploy/release-guard.ts` refuses a forward release that
is not main's current head, and refuses backwards movement unless explicitly
authorized **and** attributed. Runs before the deployment shape is chosen, so it
covers the canonical path, which previously had no guard at all.

---

### S-06 · HIGH · Rollback was unattributable — FIXED

`ALLOW_RELEASE_ROLLBACK=1` alone permitted moving production backwards, with no
record of who or why. Now requires `RELEASE_ROLLBACK_OPERATOR` and
`RELEASE_ROLLBACK_REASON`, and appends a JSONL record — event, timestamp,
operator, reason, source release, target release, main head at decision,
deployment id, result — to `${ALO_DEPLOY_LOG_DIR}/rollback-audit.jsonl`.

**Deliberately outside the Git checkout.** Inside it, the record would make the
next deployment's dirty-tree check fail: the exact deadlock this audit opened
with. Asserted by test.

**Rollback ≠ database undo.** Additive migrations applied by the newer release are
not reversed. The guard's authorization message says so, and the runbook records
that a rollback is a code rollback only, requiring separate schema-compatibility
judgement.

---

### S-07 · MEDIUM · CI shell gate skipped the highest-privilege scripts — FIXED

`find … -name '*.sh'` validated 32 of 70 shell programs. The 38 skipped are the
extension-less helpers in `helpers/` and `server-helpers/` — `alo-firewall-helper`,
`alo-ssh-helper`, `alo-deploy-helper` — which agents execute on customer servers
with elevated privileges. The gate reported green while checking none of them.
Now selects by shebang as well as extension, covers `agent/`, validates all 70,
and **fails if it matches fewer than 40** so it cannot pass vacuously again.

---

## 2. Areas examined with no finding

Recorded with the method used, so the absence of a finding is auditable.

| Area | Method | Result |
|---|---|---|
| **Broken access control** | Programmatic scan of all 206 routes for auth references; **all 19** unreferenced routes hand-read | 187/206 reference an auth helper. Of the 19: auth endpoints, `health`, `pricing`, `contact`, `newsletter`, `csrf`, root `api` are intentionally public; `github/webhook` verifies HMAC before parsing; `internal/sites/ssl-status` uses `timingSafeEqual` and **fails closed when the env var is unset**; 4 agent routes use `requireAgent`. An earlier narrower scan falsely flagged `/api/projects`, `/api/tasks`, `/api/support-tickets` — all three verified authenticated via `getToken` and tenant-scoped. **No unauthenticated privileged route found.** |
| **SQL injection** | `grep` for `queryRawUnsafe`, `executeRawUnsafe`, `$queryRaw`, `$executeRaw` | `*Unsafe`: **0**. `$queryRaw`: 2 uses, both tagged templates, both `LIMIT 0` schema probes in `/api/health`. All other data access is Prisma client. |
| **Command injection** | `grep` for `exec(`, `execSync(`, `spawn(` excluding `execFile` | No `exec`/`execSync`. One `spawn`, argv-array form, no shell. `/api/servers/provision` uses `execFile` with an argv array, a strict zod DNS-hostname regex, `sudo -n` with a fixed helper path, a 90s timeout and a 64KB buffer cap. Deploy scripts pass values as argv, not through a shell string. |
| **Dynamic code execution** | `grep` for `eval(`, `new Function(` | **0** occurrences in `src/`. |
| **XSS** | `grep` for `dangerouslySetInnerHTML` | One occurrence, `src/components/ui/chart.tsx` (shadcn/recharts CSS theme injection), not user content. |
| **Cross-tenant exposure** | Read the scoping clause of representative handlers | `sessions` (both handlers), `projects`, `tasks`, `support-tickets` all filter by the authenticated principal's id. Bulk session revoke excludes the caller's own token. **Not exhaustively verified across all 91 models** — see limitations. |
| **CSRF** | Inspected `src/lib/security/csrf.ts`, `/api/csrf`, `src/middleware.ts` | Real CSRF protection for browser mutations was added in an earlier merged PR (#14) and is covered by `tests/csrf.test.ts`. Not re-audited here. |
| **Secret storage** | Inspected `src/lib/encryption.ts`, `secret-store.ts`, provider routes | Provider API keys encrypted at rest via `encryptSecret`; private base URLs masked in responses. Deploy scripts resolve `DATABASE_URL` by *parsing* env files rather than sourcing them (no shell execution) and never print the value. No secret appears in any commit made by this audit. |
| **Webhook authentication** | Read `/api/github/webhook`, `/api/platform/webhooks` | GitHub webhook verifies HMAC **before** parsing the body, and returns `Cache-Control: no-store` plus `X-Content-Type-Options: nosniff`. Customer webhook URLs go through `validateExternalWebhookUrl` (HTTPS required, credentials rejected, loopback/private/IMDS blocked). |
| **Hardcoded credentials** | `grep` for the secret named in the repo's own remediation doc | `docs/UNIFIED_PROJECT_MERGE_MAP.md` called for removing a hardcoded `'alo-cron-secret-2026'` fallback. **0 occurrences in `src/`.** Already remediated. |
| **Path traversal / archive extraction** | Inspected deploy payload handling | Release payloads are assembled with `cp -a` into a staging directory then `mv`'d into an immutable release path; `sudo -n` is restricted by sudoers to one fixed helper path and a source under the release directory. No user-supplied archive extraction path was found. **Not exhaustively audited** across `file-manager`. |
| **Dependency vulnerabilities** | — | **Not performed.** No reachable advisory API. Recorded as a gap, not as a pass. |

---

## 3. Structural security properties worth preserving

These are load-bearing and should not be weakened by future changes:

1. **Deployments refuse to guess.** An unresolvable main head, an unknown running
   release, or an unidentifiable commit all fail closed. "Probably fine" is never
   treated as a fact.
2. **Success must be proven, not assumed.** Both deploy paths require `/api/health`
   to name the *exact* commit SHA plus database and schema health, and `/login` to
   return 200. A 200 from a stale process is explicitly rejected via the release
   marker. Failure triggers automatic restore and re-verification.
3. **Decisions live in tested code, not in YAML or shell strings.** The deployment
   shape (`src/lib/deploy/preflight.ts`) and release authorization
   (`src/lib/deploy/release-guard.ts`) are pure functions behind thin bash
   bridges, so the shell cannot drift from the tested behaviour.
4. **Additive-only migrations.** A deployment can never rewrite an existing table;
   `--allow-rebuild` requires a human and a verified backup. This is what makes
   automatic restore safe.
5. **Least privilege in CI.** `permissions: contents: read` at workflow level, with
   no elevated token anywhere in the file.
6. **Read-only preflight.** Runs on the production runner *before* any approval
   gate so the approver sees host evidence, and changes nothing: no checkout into
   the app directory, no install, no build, no migration, no restart.

---

## 4. Outstanding security work

| Ref | Item | Severity | Why not done here |
|---|---|---|---|
| R-01 | SSRF guard inspects hostname strings, not resolved addresses; DNS rebinding not defeated | Medium | A correct fix changes network behaviour for every probe and needs a live host to validate |
| R-06 | `production` environment has no required reviewer, so merges to `main` deploy unattended | Medium | Repository settings; cannot be set from a workflow file. Already documented in `docs/DEPLOYMENT-AND-ROLLBACK.md` |
| R-11 | Behavioural audit of the 43 shell helpers that run on customer servers with elevated privileges | **High** | Largest remaining gap. Parse-validated only; these need per-command review against the agent allowlist |
| R-12 | Dependency advisory scan (`npm audit`) | Medium | No reachable advisory API from this environment |
| R-13 | Tenant-isolation review across all 91 models, not a representative sample | Medium | Requires reading every handler; a live database would make it verifiable rather than inferential |

---

## 5. Statement on evidence

No finding in this document is based on an assumption about what code does. Each
is backed by a file path, a quoted construct, a command output, or a GitHub
annotation with a job id. Where a scan produced a result, that result was
hand-verified before being reported — and two scans in this audit **did** produce
false positives (`/api/security/audit-logs` initially reported unwired;
`/api/projects`, `/api/tasks`, `/api/support-tickets` initially reported
unauthenticated). Both are recorded in `MODULE_INTEGRATION_MATRIX.md` and here
because a scanner that is never checked against a known-positive is how a security
audit acquires findings that are not true.

Nothing was fixed by deleting a check, and no test was weakened to pass.
