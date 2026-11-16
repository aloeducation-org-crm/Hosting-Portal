# Known Limitations Register — ALO Hosting Portal

**Maintained:** 2026-11-16 · Items here are **accepted, bounded gaps**, not aspirations.
Each entry states the limitation, the impact, and the condition that closes it.
"Not verified" is not the same as "broken" — it means no evidence was collected.

| # | Limitation | Impact | Closes when |
| --- | --- | --- | --- |
| L1 | Control plane is single-node SQLite/libSQL (see ADR-001) | Writes serialize; availability = one node; backup RPO = snapshot cadence | libSQL replica or PostgreSQL migration per ADR-001 triggers |
| L2 | No live DNS/SSL verification from the build environment | Custom-domain acceptance scenarios 15–17 unproven; certificates unrenewed in evidence | A test domain delegated to Cloudflare + one issuance/renewal cycle observed |
| L3 | No live GitHub→production deployment rehearsed this cycle | "Deploys work" rests on unit/integration tests, not a witnessed run | One deploy + one rollback with `deploy-release.sh` on staging/production, evidence filed |
| L4 | 500-concurrent-user target unmeasured | Capacity, p95/p99, DB connections under load unknown | Load test against staging with auth/deploy/log journeys; report committed to docs |
| L5 | Office Server A (i5-10310U, 15 GiB) and Server B (Core2 Duo E7500) unbenchmarked | Scheduling builds to them would be assumption-driven; public traffic must not depend on office connectivity | Actual benchmarks + enrollment drills recorded in `docs/HYBRID-INFRASTRUCTURE-PLAN.md` |
| L6 | Hostinger Cloud capacity/credentials unverified | Public ingress design unproven | Hostinger API access + verification from the real host |
| L7 | `prisma migrate deploy` unusable where `binaries.prisma.sh` is blocked | Schema changes must use `scripts/apply-deploy-schema.mjs` (offline-capable) | Egress allowlist or self-hosted engine mirror on hosts |
| L8 | Customer DBaaS provisioning (MariaDB/PostgreSQL) tested only against helper stubs | Real database creation/rotation/access isolation unproven | One end-to-end provision on a host with `alo-database-helper` |
| L9 | Backup encryption at rest is an ops procedure, not code | Theft of a backup file defeats confidentiality | Off-host copies encrypted (age/gpg) with key held separately; restore drill re-run |
| L10 | OBS Studio / CMake native builds not compiled in verification | "Native support" is planner-verified only | One real OBS build completing with artifacts hash-verified |
| L11 | CSRF/rate-limit/tenant-isolation coverage is sampled across 264 routes | A route could deviate unnoticed | Route-by-route authorization audit or static guard; target: every `route.ts` names its tenant check |
| L12 | In-memory rate limiter is per-process | Limits multiply by instance count | Shared Redis limiter (`REDIS_URL`) when running >1 replica |
| L13 | MFA enforced in code but not red-teamed | Account-takeover resistance unknown | External/internal MFA bypass attempt on staging, remediated or accepted |
| L14 | Stripe live-mode webhook untested | Billing automation unproven end-to-end | Stripe test-mode transaction + signature-rejection evidence |
| L15 | AI paid-provider path budget-gated but never exercised | Cost controls unvalidated against a real provider account | One approved low-cost call with usage recorded in `ai_token_usage` |
| L16 | No production host credentials in this workspace | All host-level claims (nginx, PM2, firewall, certificates) remain **NOT VERIFIED** | Operator rehearsal + screenshots/logs attached to an audit doc |
| L17 | Rollback proven in tests, not in a witnessed production event | Recovery confidence is indirect | Next production incident or drill performs an actual rollback with timeline |
| L18 | `archive/retired-2026-11-09/` retained in repo | Noise; risk of stale references | Never import from it; prune only with owner approval (snapshot value) |
| L19 | No HA / no automated failover for the control plane | Planned maintenance = downtime; failure = manual restore | HA design lands (ADR-001 path) or maintenance windows documented |
| L20 | Documentation completeness is indexed, not exhaustive | New readers may miss the right runbook | `docs/DOCUMENTATION-INDEX.md` kept current each release |
