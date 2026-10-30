# Blocker register — 2026-10-29

Single source of truth for what is open, verified, or blocked. Supersedes the
blocker tables in earlier documents on this branch.

**Last updated:** 2026-10-29 (session 2) — after independent re-verification of
all prior claims. See `VERIFICATION-2026-10-29-SESSION2.md`.

**States:** `VERIFIED` (evidence obtained) · `OPEN` (actionable, not done) ·
`BLOCKED` (cannot progress without access or approval).

---

## 1. Register

| # | Blocker | State | Evidence / reason | What clears it |
|---|---|---|---|---|
| **B-1** | No access to Servers A/B/C/D | **BLOCKED** | No SSH/Tailscale reachability from the execution environment. Nothing in any report claims host verification. | Authorised access, or an operator running the documented read-only commands and returning output |
| **B-2** | GitHub App vs PAT decision undocumented | **OPEN** | CI authenticates with a PAT; no GitHub App installation exists. Least-privilege permission set not written down | Decision + permission matrix (recommend: App with `contents:read`, `deployments:write`, `metadata:read`; no `admin:*`) |
| **B-3** | Hostinger product tier unknown (Server C) | **BLOCKED** | `lib/providers/hostinger.ts` exists; no account evidence obtained. Shared hosting cannot run Docker/daemons | Account/plan evidence from the Hostinger console |
| **B-4** | cPanel API token absent (Server D) | **BLOCKED** | `lib/providers/cpanel.ts` exists; no scoped token. Email integration unverified | A least-privilege cPanel API token, issued by the provider |
| **B-5** | Authoritative DNS provider / registrar unknown | **BLOCKED** | No registrar integration anywhere in the repo; no authoritative DNS engine; no evidence of who holds `alolabs.net` | Registrar + DNS authority confirmation. **No DNS change without approval** |
| **B-6** | No required reviewer on `production` | **OPEN** | `protection_rules: []`, `can_admins_bypass: true`, branch policy `null`. Repo is public, so reviewers are available | Admin applies `PRODUCTION-APPROVAL-GATE.md` §3, then §4 verification |
| **B-7** | Production release baseline unverified | **OPEN** — re-verified, unchanged | Reconciled: the 6 deployment records are re-runs of run #31 (`54e3454`), all failed. Last successful deploy job = `ec7ff40`, 2026-10-27T02:47:01Z, but under a workflow with no `environment:` and a health check that could not identify a commit. Run #54 may have mutated the host afterwards | Run the read-only commands in `DEPLOYMENT_RECONCILIATION_2026-10-29.md` §7 on the host |
| **B-8** | SQLite now vs MySQL 8 target | **OPEN** | `prisma/schema.prisma` declares `provider = "sqlite"`; brief mandates MySQL 8. A provider change is a migration, not a config edit | Approved migration design: backup, compatibility review, migration tests, rollback plan. **Not to be bundled with feature work** |
| **B-9** | Second production deploy path ungated | **OPEN** — analysed in depth | `WEBSITE_DEPLOY` alone triggers a real deploy (files + `restartExternalService`), executed **synchronously in-request**; inline worker is on by default (`DEPLOY_INLINE_WORKER !== "false"`). `rollback` does the same under `BACKUP_RESTORE`. Full call graph, 7-threat model and 5 remediation options in `B9-APPLICATION-DEPLOY-PATH.md` | Decide R-1 (approval record) and apply R-2 (`DEPLOY_INLINE_WORKER=false`, supervised worker). Do not weaken RBAC |
| **B-10** | Deploy job does not pin what it deploys | **OPEN** | At `ec7ff40` the job ran `git pull --ff-only origin main`; `github.sha` and the artifact are not used to pin the build. Run #32 deployed after #33 | Already fixed in `deploy-release.sh` at `7fc3d15` (requires 40-hex `DEPLOY_COMMIT_SHA`, verifies commit via health). Needs a successful run to be *demonstrated* |
| **B-11** | No host-side release identity | **OPEN** | `release-identity.json` is written only by `deploy-release.sh`/`deploy-production.sh`; neither has completed on this host | First successful deploy under `7fc3d15`+ writes it; until then identity is unprovable |
| **B-12** | Malware scanning not uniformly enforced (CRM) | **OPEN** — re-derived at `c549448` | 12 write primitives found; **2 of 9 externally-fed ingest paths scanned** (unchanged). WhatsApp webhook + media ingestion — the nominated vault wiring point — are unscanned. `lib/phd/storage.ts` is new at this HEAD with **zero callers**. Matrix and S-1…S-6 remediation in `B12-MALWARE-SCAN-COVERAGE.md` | Push the control into `storePrivateFile` (require a `ScanResult`) rather than adding 7 route-level calls. Vault stays disabled |
| **B-13** | Test coverage claims for the CRM conformance suite not reproduced | **OPEN** | 47+33=80 test counts come from the contract document; only "CI test job passes" was independently observed | Re-run the suite against the exact commit |
| **B-14** | Branch protection on `main` unreadable | **BLOCKED** | `GET /branches/main/protection` → `403 Resource not accessible by integration`. Token has read-only `pull` | Admin token to read; **no change without authorisation** |

---

## 2. Required access and approvals (deliverable 7)

**Status at session 2: none granted.** No approval has been requested, granted or
assumed. In particular A-6 was *not* treated as granted, which is why no host was
contacted despite the instruction to proceed with host verification
(`VERIFICATION-2026-10-29-SESSION2.md` §3).

Nothing below has been requested, granted, or assumed.

| # | Access / approval | Needed for | Risk if granted carelessly |
|---|---|---|---|
| A-1 | Read-only SSH to Server A and Server B | B-1, B-7; Phase 2 verification; inventory | Low if read-only |
| A-2 | Repository **admin** scope (or a human admin) | B-6, B-14 | High — can change protection and deploy paths |
| A-3 | Hostinger console access (read) | B-3 | Low |
| A-4 | cPanel API token (least privilege, mail-scoped) | B-4 | Medium — mailbox access |
| A-5 | Registrar/DNS read access | B-5 | High if write; read is low |
| A-6 | Approval to run the host inspection commands in §7 of the reconciliation | B-7 | None — all read-only |
| A-7 | Approval for a SQLite→MySQL 8 migration plan | B-8 | High — data migration |
| A-8 | Approval to merge PR #19 | Unblocks deploys — **only after B-6** | High — first unattended-deploy path |
| A-9 | Approval to remove the two unreachable dashboard trees | Duplication D-1 | Medium — irreversible-ish (recoverable from history) |

---

## 3. Decisions explicitly deferred, not taken

| Item | Why deferred |
|---|---|
| Removing the dead `platform/` tree and nested `alo-hosting-portal/` app | Reviewer instruction: establish ownership, import references, deployment usage and dependency evidence first, then a removal plan, then maintainer sign-off. Evidence gathered so far: `AppShell` is imported nowhere; the nested tree is absent from `tsconfig`/`next.config`; its schema has 55 models vs 91 |
| Writers for `ServerMetric`, `LoadBalancer`, `ReplicationStatus` | Reviewer instruction: no speculative writers until product behaviour and data ownership are established. `ServerMetric` currently has zero writers |
| SQLite → MySQL 8 | Separate migration project (B-8) |
| Consolidating the three metric models + `Server.*Usage` mirrors | Needs a product decision on retention and ownership |

---

## 4. Verified-clear items (for completeness)

| Item | State |
|---|---|
| Build/test/lint/typecheck baseline reproducible locally | **VERIFIED** — 563/563, 40 files, 0 lint, 0 typecheck, build OK |
| Dependency vulnerabilities | **VERIFIED** — `npm ci` reported 0 across 648 packages |
| Fabricated server inventory + write-during-GET | **VERIFIED FIXED** (Phase 0) |
| Student ID single allocation path (CRM) | **VERIFIED** |
| CRM malware scanner exists and is genuine | **VERIFIED** |
| `production` environment has no reviewer | **VERIFIED ABSENT** |
| No successful deploy ever passed the environment gate | **VERIFIED** |
