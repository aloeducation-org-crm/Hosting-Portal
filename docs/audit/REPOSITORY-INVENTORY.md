# Repository Inventory

> Reconciliation inventory for the Phase 0.5 containment pass, measured at
> commit `d1dc3d0` on `arena/4114dfbd-hosting-portal` (base `main` `0b51a10`).
> Counts below were produced by running commands in this checkout, not copied
> from earlier documents. Where an earlier audit number differs, the reason is
> stated.

## 1. Measured totals

| Metric | Value | How measured |
|---|---|---|
| Tracked files | 1,371 | `git ls-files \| wc -l` |
| Under `archive/retired-2026-11-09/` | 435 | sealed no-loss snapshot, never imported (`next.config.ts` excludes it from tracing) |
| Source under `src/` | 603 files | `git ls-files src \| wc -l` |
| `src/lib` modules | 125 | `git ls-files src/lib` |
| App Router pages | 80 | `find src/app -name page.tsx` |
| Layouts | 5 | `find src/app -name layout.tsx` |
| API route files | 252 | `find src/app/api -name route.ts` |
| Exported HTTP handlers | 386 | grep over route files |
| Prisma models | 124 | `grep -c '^model ' prisma/schema.prisma` |
| Prisma enums | 17 | `grep -c '^enum '` |
| Migration directories | 16 | `ls -d prisma/migrations/*/` |
| Privileged helpers | 23 | `ls helpers/` |
| Test files | 77 tracked (`tests/`) | includes 3 harness helpers, 74 suites |
| Test cases | 1,175 passing, 1 skipped across 74 suites | `npm test` |
| Repository size on disk | ~22 MB | `du -sh` |

Earlier documents quote 1,333 tracked files, 119 models and 15 migrations at
`80318b4`/`c5c81fdd`. The difference is four commits of work on `main`
(`dff5d2f` central automation) plus this pass.

## 2. Top-level layout

| Path | Purpose | Notes |
|---|---|---|
| `src/app/` | App Router: marketing site, customer dashboards, admin, 252 API routes | five page trees, see §4 |
| `src/lib/` | Domain logic: deploy engine, orchestrator, agents, billing, cloud, AI, security | the only place a route should get business logic from |
| `src/components/` | UI: `ui/` (48 shadcn primitives), `platform/`, `dashboard/`, `alolabs/`, `marketing/`, `ai/`, `factory/` | |
| `prisma/` | Schema (124 models) + 16 migrations + seed | |
| `db/custom.db` | Tracked **development fixture** | contains seeded accounts; never a production database. SEC-12 now refuses it in production. |
| `agent/` | `alo-agent.mjs`, 900+ lines, zero-dependency node agent | standalone deployable file |
| `helpers/` | 23 `alo-*` privileged bash helpers | invoked through `sudo` per the shipped sudoers policy |
| `deploy/` | `server-kit/` staged Ubuntu scripts, systemd units, nginx configs | |
| `scripts/` | Build, deploy, backup, migration applier, repo audit | |
| `tests/` | Vitest suites + `helpers/` harnesses | |
| `docs/` | 38 top-level documents, `audit/` (35), `design/` (11), `operations/` (4 new) | |
| `archive/retired-2026-11-09/` | sealed historical snapshot | excluded from build |
| `AUDIT-REPORT*.md`, `PRODUCTION-AUDIT-REPORT.md` etc. | historical root-level reports | superseded by `docs/audit/PHASE-0-MASTER-AUDIT-2026-11-11.md` |

## 3. `src/lib` module map

| Group | Modules | Role |
|---|---|---|
| `deploy/` (22) | `engine`, `sandbox`*, `service`, `queue`, `webhook`, `signature`, `github`, `connections`*, `detect`, `detector`, `config`, `projects`, `http`, `preflight`, `release-guard`, `start-command`, `orchestrator`, `boot`, `redact`, `server-spec`, `types` | Git-connected deployment engine. `*` added this pass. |
| `orchestrator/` (7) | `contracts`, `workers`, `platform-workers`, `runner`, `store`, `types`, plus | durable job queue, 10 typed workers |
| `agents/` (3) | `agent`, `http`, `allowlist` | node agent control plane, signing and allowlist |
| `billing/` (1)* | `entitlements` | the single entitlement writer (SEC-03) |
| `ai/` (21) | `providers`, `client`, `gateway`, `automation/*`, `rea/*` | provider chain with SSRF guards, workflows |
| `cloud/` (8) | projects, BaaS, storage, usage, workers | Cloud Project tenancy |
| `security/` (5) | `csrf`, `csrf.browser`, `url-guard`, `ubuntu-cis-baseline`, `client-identity`* | |
| `providers/` (4), `integrations/` (3), `infrastructure/` (4), `factory/` (3), `marketing/` (5) | | |
| `account-status`*, `health`*, `stripe` | | policies added/changed this pass |

`*` = created or materially changed by this pass.

## 4. Page trees

| Tree | Pages | Audience | Purpose |
|---|---|---|---|
| `(auth)` | 5 | anonymous | login, register, forgot/reset, verify email |
| `(dashboard)` | 26 | customer | sites, apps, databases, storage, cloud, billing, AI modules, infrastructure |
| `dashboard` | 23 | customer | a **second** dashboard tree with overlapping billing/onboarding/settings |
| `(admin)` | 5 | administrator | audit, automation, plans, servers, users |
| `hosting`, `projects`, `industries`, marketing roots | 21 | public | mostly redirected by `next.config.ts` |

**Finding (pre-existing, unresolved).** There are two customer dashboard trees.
`dashboard/` (23 pages) and `(dashboard)/` (26 pages) expose overlapping
sections with different implementations. This is scope duplication, not a
security defect, and it is recorded here rather than merged in a security pass.
The `hosting/*` pages are retired storefront routes that `next.config.ts`
redirects to `/projects/hosting-portal`.

## 5. API surface

Largest groups by route file:

| Group | Routes |
|---|---|
| `cloud/projects/**` | 24 |
| `websites/[id]/**` | 11 |
| `internal/crm/**` | 8 |
| `deploy/projects/**` | 6 |
| `orchestrator/jobs/**` | 5 |
| `agents/*` and `agents/tasks/*` | 8 (including `tasks/start` added this pass) |
| `ai/**` | ~30 |
| `crm/**` | 8 |
| `security/**` | 8 |
| remaining | single-purpose routes |

Full enumeration: `docs/audit/ROUTE-API-INVENTORY.md`.

## 6. Dead, duplicated and mock inventory

| Item | Verified state |
|---|---|
| `TODO`/`FIXME`/`HACK`/`XXX` markers in `src/` | **0** (`grep -rn`) |
| `NOT_IMPLEMENTED` returns | 5 sites, all honest refusals rather than fake success: `cloudflare.ts` (certificate issuance), `orchestrator/contracts.ts` (error code), `platform-workers.ts` (remote release execution), `workers.ts` ×2 (database provisioning, restore drill) |
| `$queryRawUnsafe` | 2 sites, both in the health probe, both over compile-time constants with identifier validation added this pass |
| `src/lib/stripe.ts` | **was** fabricating a checkout URL; fixed this pass to throw `PaymentProviderUnavailableError` |
| Two dashboard trees | pre-existing duplication (see §4) |
| `archive/` | 435 files, sealed, excluded from the build. Not dead code in the bundle. |
| Retired storefront pages (`hosting/*`, `pricing`, `domains`, `email`, `ssl`) | still in the tree, redirected by `next.config.ts`. Deliberate, reversible. |

The prior audit's "mock/simulated" claim was checked at file level: the matches
are UI placeholders (`placeholder=` form attributes) and copy, not simulated
backends. The one real fabrication found was the Stripe checkout path, which is
fixed.

## 7. What this inventory does not claim

Host-level facts (what is installed on which server, which ports are open, what
the production database file contains) cannot be measured from this workspace.
They are inventoried as unverified in
`docs/audit/DEPLOYMENT-INFRASTRUCTURE-AUDIT.md` §5 with the read-only command
that settles each one.
