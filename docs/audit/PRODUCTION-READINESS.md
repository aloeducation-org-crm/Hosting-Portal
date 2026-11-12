# Production Readiness

> Verdict at `b5a523e`: **NOT READY — CRITICAL ISSUES REMAIN**.
> The three code-level critical defects found in Phase 0 are fixed and
> regression-tested. Four things outside this repository's reach — release
> control, a payment provider, off-host backup, and the root-equivalent
> privilege model — still block a production claim.

## 1. Readiness scorecard by priority tier

| Tier | Area | Status | Why |
|---|---|---|---|
| **P0** | Auth / authz / tenant isolation | **PASS** | SEC-02, SEC-06, AUTH-01/02 closed with 44 tests |
| **P0** | Command execution | **PASS** | Allowlist + argv-only + signed agent tasks (SEC-07, SEC-10) |
| **P0** | Secrets | **BLOCKED** | SEC-09 rotation, SEC-08 repository visibility are owner actions |
| **P0** | Webhook verification | **PASS** | GitHub HMAC verified; bad signature refused |
| **P0** | DB safety | **PASS** | 27-case applier suite; additive contract; `db/` untouched |
| **P0** | Payments | **BLOCKED** | No provider; the platform correctly refuses to sell |
| **P0** | Privilege model | **FAIL** | SEC-14: the panel is root-equivalent. Architectural. |
| **P0** | Release control | **BLOCKED** | SEC-04: `main` unprotected, no required reviewers |
| **P1** | Lifecycle / deploy / agent | **PASS** | REL-01, REL-04, SEC-01 |
| **P1** | Workers | **PARTIAL** | Orchestrator supervised; `deploy-worker` is not (REL-03) |
| **P1** | Backup / DR | **BLOCKED** | REL-05: no off-host destination and no **database** restore drill. Site backup/restore **is** implemented and checksum-verified. |
| **P2** | Runtimes / E2E UI | **FAIL** | REL-06 service manager `none`; no browser suite |
| **P3** | AI | **PARTIAL** | Provider abstraction present; no model executed |
| **P4** | Docs | **PARTIAL** | Audit set landing; operations runbooks in progress |

## 2. What would make this READY FOR OWNER REVIEW

The blocking items are disjoint from what code can do in this sandbox. Each has an
owner and a next step:

| # | Blocker | Owner | Unblocks |
|---|---|---|---|
| 1 | Protect `main`; require reviewers on `production`; isolate the runner | Repository owner | SEC-04 |
| 2 | Rotate the two history secrets; decide repository visibility | Security owner | SEC-08, SEC-09 |
| 3 | Provide Stripe test-mode credentials | Billing owner | BILL-03, INT-02 |
| 4 | Provide an off-host backup destination | Ops owner | DB-04, REL-05 |
| 5 | Run the release on a host with `bwrap` and a Docker daemon | Ops owner | SEC-01 containment proof, SEC-15 |
| 6 | Move helpers behind the agent | Engineering (Phase 2) | SEC-14 |

Items 1, 2, 4 and 5 are configuration or credentials. Item 3 is an adapter with
fixtures and can be written before the credentials arrive. Item 6 is the only
substantial engineering programme.

## 3. Honestly stated confidence

| Claim | Confidence | Basis |
|---|---|---|
| The three critical defects are fixed | **High** | Each patch has a regression test that fails without it; full suite green at 1174 |
| No further cross-tenant IDOR in routes | **Medium** | 23-case suite + code review of the connection path; not an exhaustive route audit |
| Build isolation works | **Medium** | Argv construction proven; kernel containment **unverified** (no namespaces here) |
| Migrations are safe | **High** | 27-case suite incl. interrupted recovery, and `db/` is byte-identical after the run |
| The release pipeline is sound | **High** | Digest pinning, commit re-validation, activation rollback — inspected |
| The system is production-ready | **No** | Four external blockers above |

## 4. Recommended sequence to readiness

1. Owner actions 1–4 (hours, not days).
2. Land `deploy-worker` supervision (REL-03) and the payment adapter (BILL-03).
3. Run one full release on a staging host: build isolation with `bwrap` present,
   a Docker deploy, one backup→destroy→restore drill.
4. Re-run `npm run verify` and this matrix; promote only rows with evidence.

## 5. What must not be said

This platform must not be described as "production-ready", "secure", "battle-
tested" or "fully tested" in any README, pitch or handover until items 1–6 above
are closed. The correct public description is:

> A self-hostable hosting control plane with a tested core (74 suites, 1174
> assertions) whose payment, backup and release-control integrations are not yet
> connected. It refuses to grant paid plans, issue certificates, or restore
> backups rather than pretending to succeed.
