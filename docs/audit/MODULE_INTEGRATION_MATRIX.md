# Module Integration Matrix

Status of every module in the platform: its API surface, whether that surface is
reachable from the UI or from server-side callers, its UI pages, its service-layer
modules, and an honest verification level.

**How "wired" was measured.** For each API route, the static prefix before any
dynamic segment (e.g. `/api/security/ssh-keys` from
`/api/security/ssh-keys/[id]`) was searched as a literal across all 268 non-API
TypeScript/TSX files in `src/`. The scanner was validated against a known false
positive — `/api/security/audit-logs`, which *is* called from
`SecurityView.tsx` — and correctly excludes it. An earlier, narrower scan produced
false findings for `/api/projects`, `/api/tasks` and `/api/support-tickets`; all
three were hand-verified as authenticated via `getToken` from `next-auth/jwt`,
which the first pattern did not include. **Counts below are from the validated
scanner.**

**What "unwired" does *not* mean.** It means no caller inside this repository. It
does not mean broken, unauthenticated, or unused — external schedulers, agents and
webhook senders are legitimate callers, and several routes below are machine-facing
by design. Each case is classified.

**Verification levels.**
- **Tested** — covered by an automated test that exercises behaviour.
- **Static** — read and reasoned about; typecheck/lint/build clean; no behavioural test added by this audit.
- **Enumerated** — counted and classified, contents not read in full.

---

## Matrix

| Module | API routes | Wired | UI pages | lib modules | Verification |
|---|---|---|---|---|---|
| Authentication & sessions | 10 | 9 | 2 | 3 | Static |
| MFA / two-factor | 5 | **4** | 0 | 0 | **Tested** (this audit) |
| RBAC, roles & permissions | 1 | 0 | 0 | 1 | Static |
| Companies & organisations | 1 | 1 | 0 | 0 | Enumerated |
| CRM (contacts, deals, pipeline) | 10 | 9 | 0 | 0 | Enumerated |
| Projects & tasks | 2 | 0 | 0 | 0 | Static |
| Websites / hosting sites | 13 | 13 | 8 | 0 | Enumerated |
| Applications & app center | 6 | 6 | 1 | 1 | Tested (existing) |
| Deployments & releases | 13 | 11 | 1 | 1 | **Tested** (this audit) |
| GitHub integration & webhooks | 6 | 5 | 0 | 1 | Tested (existing) |
| Domains & DNS | 5 | 5 | 0 | 2 | Tested (existing) |
| SSL / certificates | 5 | 2 | 0 | 0 | Enumerated |
| Servers & infrastructure | 11 | 8 | 1 | 1 | Static |
| Server agents | 13 | 12 | 0 | 1 | Tested (existing) |
| Containers & Node services | 2 | 2 | 0 | 1 | Enumerated |
| Databases & provisioning | 2 | 2 | 1 | 0 | Tested (existing) |
| Backups & recovery | 1 | 1 | 0 | 0 | Enumerated |
| File management & SSH | 4 | 1 | 0 | 1 | Enumerated |
| Storage pools & documents | 5 | 1 | 1 | 2 | Tested (existing) |
| Billing, invoices & plans | 10 | 7 | 1 | 1 | Enumerated |
| Email accounts & sending | 6 | 3 | 0 | 1 | Enumerated |
| Notifications & alerts | 5 | 5 | 0 | 0 | Enumerated |
| Monitoring, logs & metrics | 8 | 2 | 0 | 0 | Enumerated |
| Audit trail | 3 | 3 | 1 | 1 | Enumerated |
| AI providers & models | 4 | 3 | 0 | 3 | Tested (existing + this audit) |
| AI assistant / chat / builder | 5 | 5 | 3 | 1 | Tested (existing) |
| AI workflows & orchestration | 15 | 10 | 2 | 2 | Tested (existing) |
| Self-hosted agents / software factory | 2 | 2 | 1 | 2 | Tested (existing) |
| Platform settings & secrets | 8 | 3 | 1 | 2 | Enumerated |
| Security controls | 10 | 6 | 0 | 2 | **Tested** (this audit) |
| Marketing & newsletter | 6 | 6 | 0 | 1 | Enumerated |
| Support tickets | 1 | 0 | 0 | 0 | Static |
| Health & release identity | 1 | 1 | 0 | 3 | **Tested** (this audit) |
| **Total** | **206** | **149** | **60** | — | |

Data layer: **91** Prisma models, **242** unique/index directives, **10**
migrations plus `0_init`.

---

## Classification of the 57 unwired routes

### Group A — Legitimately machine-facing (no UI caller expected)

| Route | Auth | Caller |
|---|---|---|
| `/api/cron` | `requireSession` | External scheduler |
| `/api/operations/worker` | `verifyInternalSecret` | Orchestrator worker |
| `/api/monitoring/collect` | `requireSuperAdmin` **and** `verifyInternalSecret` | Collector |
| `/api/monitoring/check` | — | Internal |
| `/api/agents/seed` | — | Bootstrap |
| `/api/auth/providers` | — | NextAuth |

**Assessment: not a defect.** No action.

### Group B — Genuine UI gaps: working, authenticated backend with no screen

This is the real integration backlog. Ordered by user-visible impact.

| Route(s) | Impact of the gap |
|---|---|
| `/api/ssl/check`, `/api/ssl/expiring`, `/api/ssl/renew` | Certificate lifecycle cannot be driven from the UI. `renew` is `requirePermission`-guarded and works. **Highest-impact gap** — an expiring certificate is a customer-visible outage. |
| `/api/storage/documents`, `/[id]`, `/[id]/content`, `/api/storage/pools` | A storage page exists (`(dashboard)/storage`) but reaches only 1 of 5 routes; document management is not exposed. |
| `/api/billing/usage`, `/usage/aggregate`, `/invoices/generate` | Usage-based billing cannot be inspected or invoiced from the UI. |
| `/api/email/send`, `/verify`, `/dns-records` | Email sending, verification and DNS configuration are not reachable. |
| `/api/platform/secrets`, `/webhooks`, `/webhooks/[id]`, `/cron-jobs` | Platform secret and webhook administration has no screen. |
| `/api/security/rate-limits`, `/encrypt` | Rate-limit administration not exposed. |
| `/api/servers/discover`, `/health`, `/provision` | `provision` is **SUPER_ADMIN-only**, argv-only `execFile`, strict hostname regex, root-owned helper — fully functional and unreachable from the UI. |
| `/api/system/info`, `/resources`, `/services`, `/api/logs/center` | System inspection and log centre not exposed. |
| `/api/roles` | Role administration has no screen. |
| `/api/projects`, `/api/tasks` | Both authenticated and tenant-scoped (`where: { userId: token.id }`); no UI. Note two settings surfaces exist and neither links to them. |
| `/api/support-tickets` | Authenticated and tenant-scoped; no UI. |
| `/api/orchestrator/status`, `/api/operations`, `/operations/[id]` | Orchestration observability not exposed. |
| `/api/github/disconnect` | A GitHub connection can be created but not disconnected from the UI. |
| `/api/user/mfa/backup-codes` | **Partially closed by this audit.** MFA enable/verify/disable are now wired; regenerating backup codes is not. A user who exhausts their codes has no self-service path. |
| `/api/ai/models` | Live provider model catalogue not exposed; providers must be configured with a model name typed by hand. |
| `/api/sso`, `/api/file-manager`, `/api/security/ssh-keys` | See also D-15 (duplication). |

**Assessment: real functional gaps, correctly classified as "implemented but
disconnected".** None was closed by this audit except MFA (D-06/D-07), because
wiring 20+ screens is not a safety batch and would be unreviewable as one.
Tracked as **R-07**.

### Group C — Superseded or duplicated

See D-15 in `COMPLETE_SYSTEM_AUDIT.md`. `/api/deployments`, `/api/deployments/[id]`,
`/api/security/ssh-keys`, `/api/security/ssh-keys/[id]`.

---

## Duplicate and competing surfaces

| Surface | Finding | Risk |
|---|---|---|
| **Settings** | **Two implementations.** `src/components/platform/views/SettingsView.tsx` (reached via `AppShell`) and `src/app/dashboard/settings/page.tsx` (565 lines, re-exported by `(dashboard)/settings/page.tsx`). Both implement profile + password against the same endpoints. Only the first had MFA and sessions UI. | A user can reach either. A fix applied to one is not applied to the other — this audit fixed the one containing the fabricated controls; the other simply has no MFA or session UI at all. **R-09.** |
| **SSH keys** | `/api/security/ssh` (used) and `/api/security/ssh-keys` (unused) both write `db.sshKey` via `callHelper` + `getSshPublicKeyFingerprint`. | One model, two divergent write paths. **R-04.** |
| **Deploy** | `/api/deploy` (2 consumers) and `/api/deployments` (0). | **R-04.** |
| **CI** | `/api/ci` and `/api/ci-cd`, one consumer each. | Scope overlap unverified. **R-04.** |
| **Apps** | `/api/apps`, `/api/applications`, `/api/sites` — all have consumers. | **Not** assumed to be duplicates; app-center, applications and hosting sites are plausibly distinct. Needs a maintainer decision. **R-04.** |
| **Application tree** | `alo-hosting-portal/` — 325 files, complete second copy, **divergent Prisma schema**, 245 `src` differences, referenced by nothing. | See D-14. **R-03.** |
| **Node engines** | Root `package.json` requires `>=20.9.0`; nested tree requires `>=22.0.0`; CI uses Node 22; the deploy job prepends `v24.22.1` then `v22.0.0` to `PATH`. | Four Node versions in play across one deployment path. Not proven to cause a failure, but it is undocumented and unreconciled. **R-10.** |

---

## Navigation integrity

**Verified: 0 dead links.** Every `href`, `router.push`, `router.replace` and
`redirect` target in `src/` resolves to an existing `page.tsx`, after normalising
Next.js route groups `(admin)`/`(auth)`/`(dashboard)` and dynamic segments.

60 pages enumerated:

- `(dashboard)` — 23 pages: `ai/{analytics,assistant,builder,auto-deploy,automations,operator,self-hosted}`, `apps`, `billing`, `settings`, `databases`, `deployments`, `infrastructure`, `onboarding`, `sites`, `sites/new`, `sites/[id]`, `sites/[id]/{deployments,domains,env,logs,settings}`, `storage`
- `(admin)` — 4 pages: `audit`, `plans`, `servers`, `users`
- `(auth)` — login/register surfaces
- root — marketing and public pages

---

## Data model observations

| Observation | Evidence | Assessment |
|---|---|---|
| Index and unique coverage is substantial | 242 directives across 91 models | Not a missing-index emergency; no query-plan analysis was possible without a live database. |
| Migration policy is enforced, not merely documented | `scripts/apply-deploy-schema.mjs` refuses rebuild migrations during deploy; `--allow-rebuild` needs a human plus a verified backup; existing tests assert no deploy passes the flag | Sound. This is what makes "additive only" a real property. |
| Backup staleness is bounded | `apply-deploy-schema.mjs` rejects a backup older than a configured minute limit | Sound. |
| Migrations are not reversible by design | Additive-only means a rollback does **not** undo schema changes | Correctly handled: the release guard's authorization message states it, and `DEPLOYMENT_RUNBOOK.md` records it. **Never assume a migration can be reversed.** |
| Two divergent schemas exist in the repository | `prisma/schema.prisma` vs `alo-hosting-portal/prisma/schema.prisma` | **Ambiguity, not a proven defect.** Only the root schema is used by any build or deploy path. See D-14 / R-03. |

**Not verified:** actual migration ordering against the deployed database,
tenant-level isolation beyond the routes spot-checked, soft-delete and cascade
behaviour, and query performance. All require a live database, which was not
reachable. Recorded as coverage limitations, not as passes.
