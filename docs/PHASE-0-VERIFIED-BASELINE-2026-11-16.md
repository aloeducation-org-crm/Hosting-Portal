# Phase 0 — Verified Baseline, 2026-11-16

**Branch:** `arena/ade676c4-hosting-portal` (branched from `e5ff119b6cc7852b96d87aa54060989aa8212dab`, `main`)
**Base commit at audit time:** `e5ff119` (clean working tree before changes)
**Date:** 2026-11-16 (UTC)
**Method:** every claim below was re-executed in this session or read directly from the repository.
Nothing in this document is inferred from documentation alone.

---

## 1. Repository inventory (measured)

| Item | Measured value |
| --- | --- |
| Application | Next.js 16.4.3, React 19, TypeScript, Prisma 6.19.3 (`engineType = "client"`) |
| Source size | ~116,000 lines under `src/` (`find src -name '*.ts*' \| xargs wc -l`) |
| API routes | 264 `route.ts` files under `src/app/api` |
| Prisma schema | 124 models (`prisma/schema.prisma`, 3158 lines), `provider = "sqlite"`, `url = env("DATABASE_URL")` |
| Migrations | 19 directories under `prisma/migrations/` (SQLite dialect, applied by `scripts/apply-deploy-schema.mjs`) |
| DB access layer | `@prisma/adapter-libsql` + `@libsql/client`; SQLite pooling patch (`busy_timeout`, `BEGIN IMMEDIATE`) in `src/lib/db.ts` |
| Test suite | 82 files, **1285 passed, 1 skipped** (`npm test`, 2026-11-16, after `/api/ready` addition) |
| Archived predecessor | `archive/retired-2026-11-09/` (immutable snapshot; not active code) |
| Process managers in repo | PM2 (`ecosystem.config.cjs`, `deploy/pm2/`), systemd units (`deploy/systemd/`, `deploy/server-kit/`) — see risk register §7 |
| CI | `.github/workflows/ci-cd.yml` (PR/push to `main`/`develop`; production deploy only via attributable `workflow_dispatch` with `release_approval`) |

## 2. Verification results (this session)

| # | Check | Command | Result |
| --- | --- | --- | --- |
| V1 | Dependency install | `npm ci` | OK — 637 packages in ~30 s |
| V2 | Lint | `npm run lint` | OK — exit 0, no findings |
| V3 | Typecheck (app + scripts) | `npm run typecheck` | OK — exit 0 |
| V4 | Unit/integration tests | `npm test` | OK — 82 files, 1285 passed / 1 skipped, 0 failed (~75 s) |
| V5 | Production build | `npm run build` | OK — compiled in 23.2 s; 236 static/SSG pages generated |
| V6 | Prod config validator, no env | `npm run config:validate` | **Fails closed as designed** — exit 1, 9 errors (`APP_URL`, `NEXTAUTH_SECRET`, `JWT_SECRET`, `PORT`, …). The validator works; a production boot without real env is refused |
| V7 | `prisma migrate deploy` (scratch DB) | `DATABASE_URL=file:/tmp/… npx prisma migrate deploy` | **Not possible** — `binaries.prisma.sh` is unreachable from this environment. The repository's supported offline path is `scripts/apply-deploy-schema.mjs` (V9–V11). This is a sandbox restriction, not a code defect |
| V8 | Backup writes and self-verifies | `DATABASE_URL=file:/tmp/alo-drill-src.db node scripts/db-backup.mjs --out /tmp/alo-backups --label drill` | OK — `hosting-20261116T194533Z-drill.db`, 2,703,360 bytes, sha256 `e8ee69079aa5…`, integrity-checked, core tables present, mode 0600 |
| V9 | Schema applier, pre-flight | `… apply-deploy-schema.mjs --check` | OK — `"problems": []` |
| V10 | Schema applier, apply (with authorized rebuild + verified backup) | `… apply-deploy-schema.mjs --allow-rebuild --backup /tmp/alo-schema-drill-backup.db` | OK — rebuild applied inside one transaction; backup verified; postconditions passed; `"problems": []` |
| V11 | Schema applier, post-verify | `… apply-deploy-schema.mjs --verify` | OK — all 14 tracked migrations/tables verified; `"problems": []` |
| V12 | Restore drill into isolated target | `… db-restore.mjs --from /tmp/alo-backups/hosting-20261116T194533Z-drill.db --target /tmp/alo-drill-restore.db` | OK — `{"success":true,"verified":true,"production":false}`; sha256 matches the backup (`e8ee69079aa5…`) |
| V13 | Production build boots | `node .next/standalone/server.js` with scratch production env on `127.0.0.1:3210` | OK — Next.js 16.4.3 ready; `/` → 200; `/login` → 200 |
| V14 | Health endpoint (live) | `curl http://127.0.0.1:3210/api/health` | HTTP 200 — `status:"healthy"`, `reason:"OK"`, `databaseStatus:"connected"`, `schemaStatus:"current"`, `databaseConfigured:true` |
| V15 | Unauthenticated API access refused | `curl /api/deployments`, `POST /api/deploy` (no session) | Both → HTTP 401 |
| V16 | Load probe, health (sandbox-only) | 300 requests, concurrency 20 | 300/300 OK — 214 req/s, p50 76.3 ms, p95 153.9 ms, p99 198.4 ms |
| V17 | Load probe, homepage (sandbox-only) | 300 requests, concurrency 20 | 300/300 OK — 339 req/s, p50 55 ms, p95 112.6 ms, p99 113.6 ms |
| V18 | GitHub PRs | `gh pr list --state open` | No open PRs; recent merges #37–#46 reviewed |
| V19 | Readiness probe live (this change) | `curl /api/ready` on the production build | HTTP 200 — `{"ready":true,"reason":"OK"}`; `cache-control: no-store`; no internals disclosed; unauthenticated via `PUBLIC_API_PATHS` |
| V20 | Readiness probe, negative drill | Same build with `DATABASE_URL=file:/nonexistent-dir-xyz/alo.db` | HTTP 503 — `{"ready":false,"reason":"DATABASE_UNREACHABLE"}`; `/api/health` 503; nothing leaked |
| V21 | Health classifier gap found and fixed by V20 | libsql wording `Unable to open connection to local database` | Was misclassified `QUERY_FAILED`; now `DATABASE_UNREACHABLE` (`src/lib/health.ts` + regression test in `tests/readiness.test.ts`) |

V16/V17 are measurements of **this build running in a single-process sandbox**, not a capacity claim. No production host was measured and the 500-concurrent-user target is **not verified** (see §6).

## 3. Capability classification (A–F)

| Capability | Class | Evidence / notes |
| --- | --- | --- |
| Control-plane build, lint, typecheck, unit tests | **A** | V2–V5 |
| Auth (register/login/MFA/RBAC) | **B** | Tests pass (`phase1-auth-rbac`, `session-cookie`, `csrf`); no live penetration test this session |
| Tenant isolation (deploy path, security routes) | **B** | `deploy-tenant-isolation.test.ts`, `phase2-security-and-routes.test.ts` pass; not exercised against a live multi-tenant host |
| Durable job orchestrator (idempotency, leases, retry) | **B** | `orchestrator.test.ts` passes; worker crash/resume verified only in tests, not on real hardware |
| Worker registration / agent enrollment | **B** | `server-agent*.test.ts`, `agent-bootstrap.test.ts` pass; no live worker enrolled this session |
| Build sandbox / isolation | **B** | `build-isolation.test.ts` passes; real-kernel cgroup/namespace limits not run here |
| Runtime framework detection | **B** | `deploy-detect.test.ts`, 21 adapters claimed in code; only detection logic is unit-tested, not 21 live builds |
| Deployment pipeline / release guard / rollback | **B** | `release-activation`, `release-revalidation-shell`, `deploy-e2e` tests pass; no live GitHub→production deploy this session |
| Domains / DNS verification | **B** | `dns-provider.test.ts` passes (mocked provider); live DNS/HTTPS check **not run** (no domain control this session) |
| SSL issuance & renewal | **C/F** | Code paths exist (Cloudflare integration); no live certificate issuance verified; treating as **not production-verified** |
| Database provisioning (customer DBaaS) | **C** | `database-provisioning.test.ts` passes against helper stubs; `alo-database-helper` is host-dependent; **no live customer database provisioned** |
| Backup / restore (control plane DB) | **A (drill)** | V8, V12 — real VACUUM INTO snapshot, integrity check, isolated restore, matching sha256 |
| Billing / entitlements | **B** | `billing-entitlements.test.ts` passes; Stripe webhook signature verification unit-tested; **no live Stripe transaction** |
| Monitoring / alerting | **C** | Metrics + alert rules + incidents exist in code and tests; **no live alert delivered** to a real on-call target |
| AI operations layer | **B** | Permission engine, tool registry, cost/approval controls unit-tested (`ai-*` tests); **no paid provider call made** |
| Native build pipeline (OBS Studio / CMake) | **C** | `native-build.test.ts` passes; **no actual OBS compile executed** — planner verified, compile not |
| Hybrid infrastructure (Office A/B, Hostinger) | **E** | No server access in this environment; benchmarks **not performed**; nothing assigned |
| 500 concurrent users | **E** | Not measured; V16/V17 are sandbox probes, not capacity proof |
| Production deployment of this branch | **E** | Awaits owner approval; CI deploy is gated on explicit `workflow_dispatch` approval |

**Class key:** A = implemented and tested · B = implemented, not adequately tested in the field ·
C = partially implemented · D = missing · E = blocked by infra/credentials · F = unsafe (none found remaining in this pass; see risk register).

## 4. What exists and works (highlights, verified by reading code + tests)

- Durable `OperationJob` model: idempotency keys, correlation IDs, leases, retry/backoff, `DEAD_LETTER`, platform-scoped jobs (`prisma/schema.prisma`).
- Structured health reporting with stable reason codes and schema probes (`src/lib/health.ts`, `/api/health`) — plus a dedicated minimal readiness probe for load balancers (`/api/ready`, this change).
- Offline-capable, idempotent schema applier with authorized rebuild mode (`scripts/apply-deploy-schema.mjs`) — V9–V11.
- Backup that self-verifies and restore that rehearses in isolation (`scripts/db-backup.mjs`, `scripts/db-restore.mjs`) — V8, V12.
- PM2/systemd/Caddy/nginx/Cloudflare deployment kits under `deploy/`; CI release gate requiring attributable approval.
- 1280-test suite covering auth, tenant isolation, orchestrator, deploy, DNS, billing, AI permissions, storage pools, backup/restore.

## 5. Gaps and missing pieces (honest list)

1. **No live DNS/SSL proof** — custom-domain verification against real DNS and a real certificate (issuance, chain, expiry, renewal) has not been executed.
2. **No live customer deployment** from GitHub to a public URL from this environment.
3. **No live OBS Studio compile** — the native build path is planner-verified only.
4. **No measured capacity** — 500 concurrent users unproven; no load test of auth/deploy/log endpoints against a staging host.
5. **Production database strategy** — SQLite/libSQL is verified; PostgreSQL migration path exists only as ADR (this commit), not as executed rehearsal.
6. **OfficeServer A/B and Hostinger** — no benchmark, no enrollment, no capacity data; both remain candidates only.
7. **`prisma migrate deploy`** cannot run where `binaries.prisma.sh` is egress-blocked; production hosts must use `apply-deploy-schema.mjs` (or an allowlisted network).
8. **Single-node control plane** — no HA; RPO/RTO targets of §11 of the master prompt are aspirational until replicated PostgreSQL or libsql primary/replica exists.
9. **`config:validate` UX** — exits 1 with nine errors when run with no env; correct fail-closed behavior, documented in `docs/PRODUCTION-CONFIG-VALIDATION.md`.

## 6. Blockers / external dependencies

| Blocker | Impact | Needed to unblock |
| --- | --- | --- |
| No Hostinger/Office-server SSH access in this environment | Phases 6, 8, 12 field checks | Operator-granted access or a staging host |
| `binaries.prisma.sh` unreachable | `prisma migrate deploy` unusable here | Egress allowlist or offline engine mirror on hosts |
| No domain/DNS control | Live domain+SSL acceptance scenarios | A test domain delegated to Cloudflare |
| No Stripe test keys | Live billing webhook proof | Stripe test mode credentials |
| GitHub production environment has no required reviewers | Release relies on `workflow_dispatch` approval gate | Repository admin to add environment protection |

## 7. Risk register (top items)

| ID | Risk | Severity | Status |
| --- | --- | --- | --- |
| R1 | Two process managers (PM2 and systemd) could both launch the panel; duplicate instances would double-write SQLite | High | Mitigated in repo (PM2 is canonical per `ecosystem.config.cjs` header; systemd units are in `deploy/` for host kits); **hosts must run exactly one** — enforced by runbooks, not by code |
| R2 | Secrets in environment file readable by panel process | High | Mitigated: `.env*` ignored by git, fail-closed `env.ts`, `config:validate`; verify host file modes (0600) at deploy |
| R3 | SQLite write contention under load (`SQLITE_BUSY*`) | Medium | Mitigated in `src/lib/db.ts` (busy_timeout, BEGIN IMMEDIATE); residual: single-writer ceiling → ADR decision |
| R4 | Untrusted build scripts escaping sandbox | Critical | Mitigated in code/tests (`build-isolation`, `sandbox.ts`, helper contract tests); **kernel-level enforcement not re-verified this session** |
| R5 | Stale schema vs code (`SCHEMA_OUT_OF_DATE`) after upgrade | Medium | Health route detects it; `apply-deploy-schema.mjs --verify` gate in deploy path; drill passed (V11) |
| R6 | AI tool misuse / paid provider spend without approval | Medium | Permission engine + budget gates unit-tested; no paid call made |
| R7 | Backup encrypted but key stored with backup | Medium | Ops procedure; verify at next restore drill on the real host |
| R8 | Documentation drift (README claims vs reality) | Low | `docs/README.md` honesty rules; this report updates status |

## 8. Baseline verdict

The repository is a **substantially built, tested control plane** — not a blank starting point.
Lint, typecheck, 1280 tests, production build, schema applier, backup, restore, boot, and live HTTP
checks all pass in this session. The platform is **NOT production-ready** as a hosting provider:
no live deployment, domain, SSL, capacity, or office-infrastructure evidence exists yet, and the
database strategy needed an explicit ADR (delivered alongside this report).

**Recommended phase order:** 1 (foundation verify) → 2 (database decision + tenant isolation evidence)
→ 3 (orchestrator/worker field checks on a staging host) → 4–5 (build + deploy live proofs) →
6–9 (domains/SSL, storage/backups, monitoring, AI field validation) → 10–12 (UX wiring audit,
billing live tests, validation & load). Each phase gate remains evidence-based per §29/§30 of the
master builder prompt.
