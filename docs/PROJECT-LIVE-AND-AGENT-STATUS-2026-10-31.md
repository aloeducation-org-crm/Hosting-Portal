# Project live status and own-agent implementation check

Date: 2026-10-31
Branch: `arena/649ce968-hosting-portal`
Overall: **NOT COMPLETE / LIVE OPERATION NOT VERIFIED / NO-GO**

## 1. What was actually checked

Read-only GitHub operations:

- `gh run list --limit 6 --json databaseId,headSha,conclusion,status,workflowName,headBranch`
- `gh run view 41058844163 --json jobs`
- `gh api repos/aloeducation-org-crm/Hosting-Portal/environments/production`
- `gh api repos/aloeducation-org-crm/Hosting-Portal/deployments?per_page=3`
- `gh api repos/aloeducation-org-crm/Hosting-Portal/deployments/7383720425/statuses`

Repository check: root AI provider client/registry, workflow route/runner, scoped hosting tools, orchestrator contracts, proposal admission and current deployment workflow. This is a targeted implementation trace, not a complete route-by-route audit or penetration test.

No live HTTP/SSH/REA/provider requests were made. Network restrictions here exclude direct access to the production domain/server. GitHub status does not establish whether an older manually deployed application is still serving correctly. The sandbox cannot be substituted for the actual host.

## 2. Remote release evidence

| Evidence | Observed result | Interpretation |
| --- | --- | --- |
| Main run [41058844163](https://github.com/aloeducation-org-crm/Hosting-Portal/actions/runs/41058844163), SHA `64d1dea596459ae13fb4060c4c02d195008a1903` | Verify failed; build, preflight and deploy skipped | This run did not deploy the branch fixes or prove main live |
| Deployment `7383720425`, SHA `54e34548f229015b9c5025d3234d078698858907` | Latest status `failure`, recorded 2026-10-28T13:46:56Z | Latest returned production deployment record is not success; not a live-health measurement |
| Production environment | `protection_rules: []` | **Confirmed approval-control blocker:** environment name alone does not enforce required reviewers |
| Current working tree | Local, uncommitted changes | These changes are not represented by remote CI or production deployment evidence |

No repository setting or workflow was modified in this check. Do not merge or dispatch merely because local tests pass: owner release approval and effective repository protection are separate prerequisites. The owner must retain the manual process. Before any production-triggering merge, an administrator must establish an effective approval hold/protection mechanism; this check does not authorize changing the deployment policy.

## 3. How the current AI system is used

| Current path | Actual responsibility | Not supplied by this path |
| --- | --- | --- |
| `src/lib/ai/providers.ts` → `client.ts` | Configured OpenAI-compatible providers, bounded retries, timeouts, JSON parsing, provider failover | Does not itself inspect Mac apps or supply an isolated executor |
| `/api/ai/workflows/[id]/run` → `automation/runner.ts` → `automation/engine.ts` | Authenticated owner/admin workflow runs, graph validation, provider calls, usage/run recording | Not a self-modifying-agent runtime |
| `automation/tools.ts` | Read-only tenant-scoped hosting inspection | No arbitrary shell, source write or REA tools |
| `orchestrator/contracts.ts` + workers | Typed workers, approval/risk model and durable orchestration foundations | No REA or code-evolution worker registered by these changes |
| `code-change-proposal.ts` | Deterministic review-artifact validation against trusted source snapshot | No file application, approval authentication or execution |
| NEW `code-evolution.ts` | Single provider-backed generation wired to the existing `completeJSON` client, then deterministic proposal validation | Not called by a route/worker yet; no automatic tests, writes, deployment or running-agent replacement |

**REA MCP is not integrated. Claude Code is not an installed executor for this portal. Mac companion, voice input/output, binary-analysis worker and isolated evolution runner are not implemented here.** Earlier pinned source research is in `design/OWN-AGENT-RECONSTRUCTION-RESEARCH.md`; partial source inspection is not integration or compatibility proof.

## 4. Own-agent code-evolution increment

The new service connects the existing provider client to proposal admission instead of trusting raw model text. It:

1. Validates request and narrow source scope before any provider invocation.
2. Copies only explicit allowed snapshot entries, limits count/UTF-8 bytes and blocks hidden/protected/invalid paths.
3. Requires a trusted source-disclosure grant bound to project, base commit, canonical snapshot digest, selected provider and expiry.
4. Selects only that provider; it cannot silently send source through the general provider fallback chain. No provider URL, API key or arbitrary command comes from a model.
5. Makes one bounded generation with no automatic repair loop; passes cancellation and rejects expired/cancelled completion.
6. Rejects invalid output, mismatched purpose/provider, implicit overwrites and changes outside the scoped baseline.
7. Returns `REQUIRES_APPROVAL`, `executable: false`, and `executionState: REQUIRES_SETUP` with proposal/source digests.

The grant is a **trusted in-process contract**, not a signed token or implemented approval endpoint. A future authenticated backend must load it from durable server-side authorization, enforce revocation and scope, and persist an audit event before using this service. Never pass client/model-supplied grants directly. Digest validation does not scan secrets or prove ownership; an administrator must approve source disclosure to the named provider. Source comments remain potentially hostile instructions. No prompt is a security boundary.

The service is not enabled through an API/UI/worker because durable scope/approval records and sandbox execution are missing. The current agent cannot be honestly described as editing/running/evolving itself. Controlled evolution means a reviewed candidate in an isolated workspace and separate promotion; guard/auth/agent-policy files cannot be self-rewritten through this path.

## 5. Reverse-engineering implementation still required

- Per-target evidence of ownership/inspection authorization, allowed observation methods and licence review.
- Pinned REA installation on a dedicated analysis host, MCP client/session handling, deterministic tool/method allowlists and structured result validation.
- Restricted target registry: no arbitrary URLs, production process attachment, private network probing, credential collection or access-control bypass.
- For Mac apps: approved local companion, OS permission checks, signed/scoped pairing and independently tested revocation.
- Separate static-analysis and dynamic-debug execution profiles; unknown binaries run only with explicit approval in disposable isolated environments.
- Evidence storage linking binary/source hashes, UI observations, API maps and architecture findings to reconstruction requirements.
- Voice transcription/synthesis as an interface, never an independent authority to authorize privileged operations.

Reconstruction must preserve authorized originals and existing content. Behavioural similarity is not evidence of recovered private backend source. No DRM/licensing/authentication bypass is permitted.

## 6. Tests and limitations

Local checks after implementation:

- `npm ci --include=dev`: PASS.
- `npm run lint`: PASS.
- `npm run typecheck`: PASS.
- `npm test`: **813 tests / 51 files PASS**, including 16 new provider-to-proposal orchestration tests.
- `npm run build`: PASS.
- `git diff --check`: PASS.

New service tests mock the provider boundary; they do not prove any live model generated a valid patch. Tests cover provider restriction, grant mismatch/expiry, disclosure scope/size, hostile authority fields, invalid model output, cancellation, provider failure and snapshot copying across asynchronous generation. One initial failure was a test-hook bug: returning a mock from `beforeEach` registered it as cleanup. It was corrected with an explicit void hook, and the full suite was rerun successfully; no failure case was disabled.

No real reverse-engineering session, code application, sandbox check run, staging deployment, rollback, restore or voice round-trip was performed.

## 7. Completion gates in priority order

1. Hosting release safety: canonical final authorization, host-local mutual exclusion, durable rollback auditing and effective production approval protection.
2. Actual staging forward deployment, rollback, isolated backup restoration, permission isolation, resource monitoring and reboot/worker recovery.
3. Durable internal task/proposal/approval/audit records and a scoped supervisor capability with server-side tests.
4. REA analysis adapter and authorized-target lifecycle on an isolated host; read-only first.
5. Approval-bound patch application, isolated build/test runner, iteration/resource budgets and recovery tests.
6. Evidence-backed reconstruction and optional voice/Mac companion, each with acceptance tests.
7. Owner-authorized production promotion only after all critical gates pass.

No reliable full-project completion date can be inferred from local test counts. Keep the earlier effort estimate provisional until staging inventory and first real end-to-end lifecycle expose the remaining integration work. **Release recommendation: NO-GO.**

## Additive update: REA MCP implementation library

A bounded stdio client and target-bound static-analysis session have now been implemented; see [`design/REA-MCP-ADAPTER.md`](design/REA-MCP-ADAPTER.md). This supersedes the earlier absence of an adapter library but does NOT change the earlier finding that upstream REA is not installed/integrated/live. There is still no user-facing REA worker, Mac companion, voice interface or self-editing runner. Twenty-four new protocol/session tests include a real child-process fixture, not upstream REA. Together with one extra protected-path regression, current local verification is 838 passing tests across 52 files, lint/typecheck/build passing. No live-host/provider/REA run or production change was performed.

## 2026-11-02 — durable capability intake/review implemented, execution still disabled

Added administrator `/ai/research` UI, authenticated GET/POST/PATCH request APIs, strict target/scope intake, independent time-bounded approval/rejection/revocation and transactional audits. Approved records explicitly remain `executable:false / REQUIRES_SETUP`; no runner dispatch, provider disclosure, self-edit, target fetch or Mac/voice integration occurs. Target hashes/authorization evidence are assertions requiring future independent verification. Additive migration is registered but was applied only to a disposable test copy (check/apply/reapply/verify), not the existing dev/production DB. Missing storage returns a truthful 503 rather than synthetic work.

Verification: **869 tests / 53 files, lint, typecheck, production build and diff-check PASS**. New suite has 29 tests including real-cookie API authorization, disabled-account denial and real-transaction audit rollback; proposal tests additionally protect the new gate files. No browser or self-hosted acceptance claimed. Detailed contract: `docs/design/AI-CAPABILITY-REVIEW.md`. Prior production **NO-GO/manual-only** and all execution/infrastructure acceptance blockers remain unchanged.

## 2026-11-02 — canonical activation and inline rollback audit hardening

Continued the requested remaining work by addressing core release blockers before enabling experimental execution. Canonical activation now has a fresh identity/main/ancestry policy check at its final activation boundary, a canonical host lock, durable authorization audit, target-identity checks and refusal to overwrite externally changed current releases during activation/automatic recovery. Inline rollback audit now must persist before checkout/reset; failures block rather than warn. Authorization records are not deployment-completion evidence.

**885 tests / 54 files + lint/typecheck/build/diff PASS**; 14 canonical regressions and 2 new inline audit regressions use actual shell/Git/filesystem operations on temporary fixtures. Current database and production were not modified. Canonical-only locking does not yet cover inline/manual tools; live recovery and remaining infrastructure/AI execution acceptance are still incomplete. See the dated follow-up in `SELF-HOSTED-ACCEPTANCE-GATE.md`. Production remains NO-GO/manual-only. This is tested progress, not a claim that “all” requested capabilities are complete.
