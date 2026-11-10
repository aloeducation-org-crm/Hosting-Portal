# Self-hosted dashboard acceptance gate

Date: 2026-10-31
Branch: `arena/649ce968-hosting-portal`
Decision: **NO-GO for production release or customer-workload migration.**

> **2026-11-02 update:** the workflow now also enforces a manual-only release hold in code because the production-environment reviewer API returned 403. See the dated section at the end. Acceptance and production NO-GO remain unchanged.

## Operating policy

The owner requires the previous manual deployment process to remain in use until explicit production-release approval. Do not deploy this branch, change production DNS, migrate workloads, replace the production workflow, delete customer files/databases, or remove recovery paths. Passing CI is not release approval. Destructive tests require separately approved, disposable targets. Changes to existing configuration require a reviewed diff and recoverable backup, never silent replacement.

This policy is an operating instruction, not a claim that repository settings enforce it. The existing workflow can initiate deployment from main and relies on production-environment protection. Current required-reviewer settings have NOT been inspected in this pass. Do not merge or dispatch a production run on the assumption that approval is enforced. A repository administrator must confirm the hold and approval protections before any merge that could trigger deployment. No workflow changes were made in this assessment; earlier uncommitted CI maintenance remains reviewable in the branch.

## Current evidence

Local verification performed in this session, with the inline release revalidation fixes:

| Check | Result |
| --- | --- |
| Root dependency installation | `npm ci --include=dev` completed |
| Lint | `npm run lint` passed |
| TypeScript | `npm run typecheck` passed |
| Automated tests | `npm test`: 49 files, 769 tests passed |
| Production build | `npm run build` passed |
| Shell syntax | 70 shell programs parsed with `bash -n` |
| Patch whitespace | `git diff --check` passed |
| Dependency advisories, refreshed in this assessment | `npm audit --json`: 0 reported vulnerabilities |

These results apply to this working tree, not a released production SHA. Shell parsing is not execution testing. Dependency auditing is not penetration testing or history secret scanning. No real browser E2E or live host lifecycle was verified in this assessment.

Historical reports under `docs/` and at the repository root describe different dates and commits. Their server specifications and past environment-setting observations must not be treated as current measurements. In particular, documented Nginx/PM2 and Caddy/systemd deployment shapes must be reconciled against actual target inventory before installation.

## Feature inventory and outstanding acceptance

Source and test presence is not operational completion. All rows below remain **not production-verified**.

| Area | Implemented foundation / evidence pointers | Remaining acceptance work |
| --- | --- | --- |
| Projects and repositories | `src/lib/deploy/projects.ts`, `github.ts`; deploy GitHub API tests | Real private-repository authorization, revocation, webhook signature/dedup and branch selection; browser-to-host drill |
| Framework/runtime detection | `detect.ts`, `start-command.ts`; detection/start-command tests | Real representative static, Node and Next projects; ambiguous/unsupported cases must block or request configuration |
| Build/test/deploy | `engine.ts`, `preflight.ts`, release scripts; deploy E2E and pipeline tests | Isolated untrusted builds, resource/time limits, concurrent projects, actual artifact activation and failed-build preservation |
| Domains/TLS | DNS provider and server-agent SSL/DNS tests | Approved staging domain; actual provider access, proxy validation, issuance, renewal and failure recovery |
| Databases | Database provisioning and migration-safety tests | Verify actual engines, connectivity, least-privilege grants, tenant isolation, backup and restore per supported engine |
| Environment variables | Secret-store/encryption code; control-plane secret tests | Browser/API/log redaction review, encryption-key custody, rotation, restart and backup recovery |
| History/rollback | Release identities, release guard and release-activation tests | Real forward release, stale release refusal, explicit attributed rollback, health-failure rollback and schema compatibility |
| Backups/restoration | Backup scripts, workers and recovery runbook | Consistent app+DB backup, integrity verification, isolated restore, data comparison, offsite retention and key recovery; agree RPO/RTO |
| Logs/metrics/alerts | Agent inventory, monitoring and honesty tests | Match CPU/RAM/disk/inodes against OS measurements, stale/unavailable handling, alert delivery and acknowledgement |
| Servers/resources | Agent bootstrap/inventory and infrastructure modules | Actual enrollment, privilege limits, port allocation, firewall reachability, resource limits and reboot recovery |
| Authentication/permissions | RBAC models, auth, CSRF and security tests | Complete endpoint/action permission matrix, cross-tenant IDOR sweep, MFA enforcement and browser session lifecycle |
| Background execution | Orchestrator leases/claims and agent allowlists; orchestrator/agent tests | Multi-process contention, kill/restart, lease expiry, duplicate webhook delivery, cancellation and reboot drills |
| Sales channels | Six setup guides and tested UTM link builder | Planning only: no account connection, live sending, order sync or revenue analytics implemented by this addition |

## Confirmed source findings and security follow-up

1. **Fixed locally — inline explicit rollback conflict.** Section 3c now refreshes main and ancestry, then re-runs the shared `decideReleaseActivation` policy instead of an unconditional head-equality check. The original attributed rollback decision is also required when moving an older checkout. The actual shell section is exercised against disposable Git repositories in `tests/release-revalidation-shell.test.ts`. Real host rollback remains unverified.
2. **Fixed locally — inline final revalidation now fails closed.** A failed lookup (even with valid-looking output), empty/malformed SHA, failed history fetch or unavailable ancestry blocks checkout/reset. Fresh policy evaluation rejects stale, unmerged, unapproved and unattributed targets. Thirteen executable shell regressions pass. These fixes do not establish canonical activation or end-to-end server recovery.
3. **Approval enforcement unverified.** Workflow declares `environment: production`; that alone does not prove required reviewers are configured. Confirm current settings with a repository administrator. Do not infer that a merge is safe from YAML presence.
4. **Further security review required:** all privileged routes, tenant boundaries, remote command surfaces, SSH host-key verification and sudo policy, build isolation, proxy trust, secret/key rotation, configuration replacement and destructive-action approval. Existing tests cover portions, not the whole attack surface.
5. Dependency audit currently reports no advisories; repository-history secret scan, independent penetration review and deployed TLS/firewall assessment remain outstanding.

No safeguard was disabled. The two inline defects above are fixed in the working tree only, not deployed. Additional release review remains necessary: canonical activation has no equivalent final fresh guard immediately before its symlink swap; rollback audit append failure currently only warns; current-running-release changes by external/manual operators and host-local locking need review. Do not infer comprehensive release safety from the inline tests.

## State contract for dashboard actions

- **Available:** supported capability; not evidence of provider configuration.
- **Configured:** required settings validated; not evidence of a completed operation.
- **Requires setup:** credentials, agent, domain, capacity or other prerequisites missing.
- **Requires approval:** risk policy blocks execution pending an attributable approval.
- **Running:** actual queued/claimed execution identified by job ID, timestamps and heartbeat. Show queued separately where useful; expired heartbeat must not remain indefinitely running.
- **Failed:** operation or verification failed; show sanitized reason and recovery action.

Success must be based on independently checked postconditions, with operation ID, actor, target, commit/artifact identity where applicable, and audit record. Unknown metrics must be unavailable/stale, never synthetic zero. These are acceptance requirements; this assessment does not claim every existing view complies.

## Actual infrastructure verification

**NOT PERFORMED.** No production/staging SSH session, agent connection or server measurements were obtained. The sandbox is not the self-hosted server. Network access available here does not permit direct connections to the documented server. No DNS, firewall, production database, process or workload was changed.

Provision an approved disposable staging host using the same OS/runtime/proxy/database shape as production, with isolated test data and a controlled test domain. Arrange access through an approved secure mechanism; never send passwords/private keys/tokens in chat. Provide console recovery and a verified second management connection before firewall/reboot tests.

Required inventory: CPU, RAM, swap, disk bytes and inodes; OS/kernel; Node/package manager; proxy/process supervisor; database versions and storage paths; worker services and service users; bound ports and firewall; secret custody; backup destination/capacity; outbound provider access; DNS/TLS ownership. Do not size from an unverified historical server-spec document.

## Ordered work and acceptance evidence

1. **Release hold and baseline:** owner/admin confirms manual-only policy and approval protection; capture read-only staging inventory and configuration hashes. No production workflow replacement.
2. **Safety defects:** fix the release findings above; complete route/action permission audit and job concurrency/recovery review. Add failure-injection tests before considering staging activation.
3. **Core staging lifecycle:** authenticated UI → private repo → detection → build/test → approved deployment → independent HTTP/process/artifact verification. Retain existing application during failures.
4. **Data lifecycle:** create isolated database, prove grants/connectivity, create consistent backup, verify checksum and restore into a new isolated target; compare records/files and application behavior. Never restore over customer data during acceptance.
5. **Recovery/operations:** forward deployment and attributed rollback, concurrent same/different-project deploys, worker kill/restart, host reboot, disk/inode pressure, provider outage, DB disconnect and alert delivery. Validate cancellation and duplicate prevention.
6. **TLS/network:** approved staging DNS and actual issuance/renewal; firewall/access verification with console fallback. No production DNS changes.
7. **Security/release review:** browser E2E, permissions/IDOR, secrets/logs, build isolation, dependency/history scans, independent review; rerun all automated gates. Owner signs release and migration plan separately.

For every test record: UTC time, host ID, tested SHA, actor/reviewer, target, operation/job ID, command/API, expected result, sanitized observed output, independent postcondition, audit record, cleanup/recovery result. Failed, missing or stale evidence blocks acceptance. Link evidence to a specific release candidate; changed critical paths require revalidation.

## Infrastructure requirements

- Isolated staging server and test domain; secure operator access and out-of-band recovery.
- Supported pinned runtime/toolchain and verified proxy/process-supervisor configuration, not two competing installers.
- Build execution identity isolated from control-plane secrets and customer workloads; CPU/RAM/disk/time limits sized after measurement.
- Durable application/job database, supervised workers, project-scoped locking and tested recovery.
- Managed TLS renewal and explicit inbound/outbound firewall policy.
- Encrypted offsite backups with retention, independently held recovery keys and restore capacity.
- Real monitoring plus configured/tested alert receiver; agreed SLO, RPO and RTO.
- Production approval and branch-protection settings confirmed by administrator.

## Remaining development estimate

This is a preliminary planning range after reviewing existing reports, source release guards and test inventory, not a completion promise. A full route-by-route and live-host audit is still missing.

| Workstream | Initial engineering effort |
| --- | --- |
| Baseline inventory, action/permission audit and detailed backlog | 3–5 engineer-days |
| Release safeguards, recovery and durable-job remediation | 5–10 engineer-days |
| Core staging integration, provider/configuration gaps and browser E2E | 10–20 engineer-days |
| Backup/restore, TLS, alerts, load/reboot/failure drills | 7–15 engineer-days |
| Security hardening, regression fixes and release evidence review | 5–10 engineer-days |

Total preliminary effort: **30–60 engineer-days**, roughly **6–12 working weeks for one full-time engineer**, excluding access/procurement delays, observation/soak time and newly discovered architectural work. Provider breadth, workload diversity and isolation requirements can increase it. Re-estimate after baseline inventory and the first complete staging lifecycle; do not schedule customer migration from this range.

## Release decision

**NO-GO.** Local automated checks pass, but actual deployment, rollback, restore, host recovery, full permissions, live monitoring and security acceptance are unproven, and the remaining release-path review items are listed above. Continue the previous manual process. Only explicit owner approval following complete reviewed acceptance evidence can authorize production release.

## Deferred integrations

External AI/devtools/apps/marketing references are tracked only in `EXTERNAL-TOOLS-EVALUATION-BACKLOG.md`. No installation or integration is approved before core acceptance gates pass.

## 2026-10-31 remediation evidence

- `tests/release-revalidation-shell.test.ts`: 13 passing cases executing the actual section 3c with real Git repositories and the real TypeScript policy bridge. Only authoritative lookup output and fetch-failure injection are stubbed; all worktree changes are limited to throwaway fixtures. This is NOT a full deploy-script/backup/service test.
- `npm run lint`, `npm run typecheck`, `npm test` (769 tests / 49 files), `npm run build`, `bash -n scripts/deploy-release.sh`, `git diff --check`: passed after code changes.
- No production workflow edits were made in this remediation turn; earlier CI maintenance changes remain uncommitted from previous work. No commit/push/merge/dispatch or server operation was performed.
- Next release-safety work: canonical final authorization, durable pre-activation rollback audit and host-local mutual exclusion, with executable failure tests. Then staging forward/rollback/restore drills, full permission review and actual monitoring verification. All remain subject to the manual-only release hold.

## Live-status / approval check update — 2026-10-31

Read-only GitHub checks now confirm the production environment returns `protection_rules: []`. This supersedes the earlier "not inspected" / "unverified" approval-setting status without removing its historical context. The latest returned main run failed verification and skipped deploy; the latest returned production deployment record has a failure status. These records do not prove current live HTTP health or disprove an older manually deployed service. **Do not merge or dispatch this branch under the assumption that the production environment requires review.** No settings or workflows were changed in this check.

See [`PROJECT-LIVE-AND-AGENT-STATUS-2026-10-31.md`](PROJECT-LIVE-AND-AGENT-STATUS-2026-10-31.md) for exact GitHub IDs, current AI call paths, the provider-to-review service increment and remaining execution/reverse-engineering gaps. Current local verification is 813 passing tests across 51 files, lint/typecheck/build passing. No REA, self-editing runner or production release is enabled. All acceptance restrictions remain active.

## 2026-11-02 — release safety implementation follow-up (supersedes the listed source defects, not NO-GO)

Implemented locally, without running a deployment:

- `deploy-production.sh` now holds a nonblocking canonical host lock through assembly, activation, health checking and the EXIT rollback trap. Another cooperating canonical deploy is refused. A symlink lock path is refused.
- Immediately before the canonical `current` link swap, `canonical-release-check.mjs` reloads the actual current release identity, resolves authoritative main, refreshes Git history and calls the existing shared release policy. Unknown lookup/history/identity facts fail closed. Dangling current links and current releases outside the immutable release directory are refused. Existing target-release symlinks and mismatched target identities are refused too.
- Canonical authorization is durably appended (file and parent-directory fsync) before activation. `release-audit.mjs` refuses symlink/non-regular audit destinations and write failure; no symlink switch on audit failure. These records are authorization intents, **not proof of completed deployment**.
- Canonical activation compares the current link against the initial and freshly reviewed state. Its failure cleanup refuses to overwrite a different current release installed by an external/manual operator.
- Inline rollback attribution moved BEFORE checkout/reset/package/schema work. It uses the durable audit helper and fails closed instead of warning. The deployment ID is retained for the later release identity. This replaces, rather than removes, the earlier post-build attribution behavior.

Evidence: 14 new canonical shell/Git/filesystem regressions plus 2 additional inline audit regressions. The targeted 4-file release suite passes 94 tests. Full repository verification now passes **885 tests / 54 files**, lint, typecheck, production build, shell syntax for the touched scripts and diff-check. `db/custom.db` is unchanged. Tests run against disposable Git repositories and files, not the host, systemd, sudo, actual remote main or production storage.

Still required before GO:

- The lock is canonical-only and cooperative. Inline deployments and unrelated manual tools do not yet share it. Arbitrary external link writers cannot be made atomic with a check-and-swap shell sequence; trusted directory ownership and an agreed operator locking protocol are prerequisites.
- Canonical rollback restart/postcondition verification and durable outcome/recovery records still need hardening and actual failure drills. An authorization-intent audit does not establish successful activation or restoration.
- Artifact provenance, supported schema compatibility, privileged-route/tenant review, isolated builds and the complete infrastructure acceptance matrix above remain outstanding.
- No staging/production access, inventory, live deployment, DNS/TLS, backup restoration, workload migration or release approval was performed. Existing manual deployment policy and production **NO-GO** remain.

## 2026-11-02 — release hold and consolidated external intake

- A read-only check confirmed `production` still has `protection_rules: []`. Updating it with this integration token returned `403 Resource not accessible by integration`; branch/ruleset administration is still an administrator action.
- `.github/workflows/ci-cd.yml` now requires an explicit approved `workflow_dispatch` on `main` with a bounded owner ticket before it uploads a deployable artifact, preflights the host or starts the mutating job. A normal merge no longer deploys unattended. This is an additional hold, not a replacement for required reviewers.
- All 23 PRs are merged and there are no open PRs. The latest `main` CI run passed verification/build; its read-only preflight correctly stopped on two untracked local reference clones. The classifier now validates those exact clones by their own Git remote; all other local changes still fail closed.
- All owner-supplied external AI references are added as review-only catalogue records. No external tool was installed, executed or enabled; the Wi-Fi credential attack reference is excluded.
- Full local verification and PR checks are recorded in [`MERGE-AND-RELEASE-STATUS-2026-11-02.md`](MERGE-AND-RELEASE-STATUS-2026-11-02.md).

**Decision remains NO-GO.** Passing CI and merging code are not release approval. Staging/production lifecycle, rollback/restore, permissions, monitoring, security acceptance and explicit owner approval are still outstanding.
