# Issue and Remediation Matrix

> Master matrix for the 22-phase directive. Status vocabulary is restricted to
> **PASS / PARTIAL / FAIL / BLOCKED / NOT APPLICABLE**. Every **FAIL** and
> **BLOCKED** row carries root cause, impact, remediation and a regression test
> (or the reason a regression test cannot exist yet).
>
> Reconciled at `b5a523e`. Rows marked `[prior]` are inherited from the 35 existing
> audit documents; rows marked `[0.5]` were re-verified or fixed in this pass.

| ID | Module | Requirement | Evidence | Status | Severity | Fix | Test |
|---|---|---|---|---|---|---|---|
| SEC-01 | Build factory | Customer build steps must not run with control-plane privilege | `src/lib/deploy/sandbox.ts`; `DEPLOY_BUILD_ISOLATION=required` in prod | **PASS** `[0.5]` | P0 | Namespace wrapper (`bwrap`>`unshare`>`sandbox-exec`), argv-only `-c` trampoline, refuse platform-secret env | `tests/build-isolation.test.ts` (23, 1 skipped where no namespace tool exists) |
| SEC-02 | Git connections | Connections must be tenant-scoped | `src/lib/deploy/connections.ts` | **PASS** `[0.5]` | P0 | `usable = connectedById===user.id \|\| DEPLOY_ADMIN_ROLES`; unknown→404, inactive→409 | `tests/deploy-tenant-isolation.test.ts` (23) |
| SEC-03 | Billing | Only an authorised path may grant a paid plan | `src/lib/billing/entitlements.ts`; rewritten `/api/subscriptions` | **PASS** `[0.5]` | P0 | Three authorizations; `PAYMENT_REQUIRED` 402; limits enforced | `tests/billing-entitlements.test.ts` (26) |
| SEC-04 | Release control | `main` protected; production approval required; runner scoped | GitHub settings (inspected) | **BLOCKED** | P0 | Protect `main`, add required reviewers to the `production` environment, move the runner off the host | Cannot be tested from the repository — it is a settings invariant. Owner action. |
| SEC-05 | Rate limiting | Identify a client, not one shared bucket | `src/lib/security/client-identity.ts` | **PASS** `[0.5]` | P0 | `TRUSTED_PROXY_COUNT` default 0; right-hand `x-forwarded-for` when trusted | `tests/client-identity.test.ts` (20) |
| SEC-06 | Auth | Unverified accounts cannot act; RESELLER not self-selectable | `src/lib/account-status.ts`, `src/proxy.ts` | **PASS** `[0.5]` | P0 | Exempt-prefix policy + 60 s claim refresh; role downgrade at signup | `tests/account-verification.test.ts` (21) |
| SEC-07 | Server agent | Verify signatures; HTTPS only; do not expire running work | `agent/alo-agent.mjs`, `src/lib/agents/agent.ts` | **PASS** `[0.5]` | P0 | Signed doc over all executed fields; start handshake; per-state expiry | `tests/agent-task-signing.test.ts` (23) |
| SEC-08 | Repo hygiene | Public repo carries fixture DB, internal addressing, IPv4 literal | 10 tracked files | **BLOCKED** | P0 | Owner decision on visibility + redaction | Partially mitigated by SEC-12 (runtime refusal) |
| SEC-09 | Secrets | Two secrets in Git history | Git history | **BLOCKED** | P0 | Rotate both; never reuse | Rotation is an owner action |
| SEC-10 | Command execution | No arbitrary remote shell | `helpers/*` allowlist; agent allowlist | **PASS** `[prior]` | P0 | Typed, allowlisted, argv-only | `tests/server-agent.test.ts` |
| SEC-11 | Deploy settings | Shared-host-affecting settings not customer-editable | not yet reviewed | **FAIL** | P1 | Settings-by-settings review with the deploy owner; operator-only for host-level knobs | Pending — next task |
| SEC-12 | Configuration | Production must refuse the fixture database | `src/lib/db.ts` `resolveDatabaseUrl` | **PASS** `[0.5]` | P1 | `process.exit(1)` when prod + no `DATABASE_URL` | `tests/health-reporting.test.ts` |
| SEC-13 | Health | Distinguish unreachable from schema-behind; real uptime; no injection | `src/lib/health.ts` | **PASS** `[0.5]` | P1 | Reason enum, sanitised detail, `requireIdentifier()`, module-load uptime | `tests/health-reporting.test.ts` (21) |
| SEC-14 | Privilege model | Panel is root-equivalent via 18 sudo grants | `deploy/sudoers/alo-hosting-deploy` | **FAIL** `[prior]` | P0 | Move helpers behind the agent; add `NoNewPrivileges` where possible | Architectural — cannot be closed in a containment pass; every customer-reachable path is checked first |
| SEC-15 | Secrets at rest | Docker helper passes env values as argv | `alo-docker-helper` | **FAIL** `[prior]` | P1 | Move env to a stdin contract | Needs host verification |
| AUTH-01 | Authentication | Password, OAuth, MFA, reset, API tokens, agent auth | `src/lib/auth.ts`, `nextauth.ts` | **PASS** `[prior]` | P0 | — | `tests/phase1-auth-rbac.test.ts`, `session-cookie.test.ts` |
| AUTH-02 | Authorization | Seeded 30-permission / 7-role matrix enforced | `prisma/seed.ts`, `hasPermission` | **PASS** `[prior]` | P0 | — | `tests/phase1-auth-rbac.test.ts` |
| AUTH-03 | Least privilege | `SERVER_MANAGE` covers containers *and* servers; ADMIN/DEVOPS bypass tenant ownership | `src/lib/auth.ts` | **PARTIAL** `[prior]` | P1 | Split permissions; per-resource ownership | Documented; narrowing mid-flight would break operators |
| TEN-01 | Tenant isolation | Deploy connections, builds, logs, artefacts scoped | SEC-02 + `build log` redaction | **PASS** `[0.5]` | P0 | — | `tests/deploy-tenant-isolation.test.ts` |
| TEN-02 | Tenant isolation | Automation/knowledge tables scoped per tenant | `src/lib/ai/rea/*` [prior] | **PARTIAL** `[prior]` | P1 | Enforce `tenantId` predicate in every REA read | `tests/ai-*` cover selection, not all reads |
| TEN-03 | Tenant isolation | Audit log for cross-tenant denials | `connections.ts` logs to stderr only | **PARTIAL** `[0.5]` | P2 | Durable denial log, not tenant-writable | Deliberate: writing an `AuditLog` row would let an attacker write into another tenant's feed |
| DB-01 | Migrations | Additive-vs-rebuild contract enforced | migration applier | **PASS** `[prior]` | P0 | — | `tests/migration-safety.test.ts` (27) |
| DB-02 | Migrations | Interrupted migration recovers; lock prevents concurrent apply | applier | **PASS** `[prior]` | P0 | — | same suite |
| DB-03 | Schema | 124 models / 17 enums / 16 migrations consistent | `prisma/schema.prisma` | **PASS** `[prior]` | P1 | — | `npx prisma validate` in CI |
| DB-04 | Backup | Off-host backup target + evidenced **database** restore drill | `/api/backups`; `alo-site-backup`/`alo-site-restore` (site files, checksum-verified) | **BLOCKED** | P1 | Provide storage credentials; implement destination interface | Site restore is real and checksum-verified; the **database** drill returns `NOT_IMPLEMENTED` (REL-05) |
| REL-01 | Deploy engine | clone → detect → build → package → activate → verify → rollback | deploy engine | **PASS** `[prior]` | P1 | — | `tests/deploy-e2e.test.ts` |
| REL-02 | Health | Unreachable vs stale schema | SEC-13 | **PASS** `[0.5]` | P1 | — | `tests/health-reporting.test.ts` |
| REL-03 | Workers | Supervised by a process manager | orchestrator: unit+Compose+CI; deploy-worker: none | **PARTIAL** `[0.5]` | P1 | Ship `deploy-worker` unit modelled on `alo-automation-worker.service` | No test can assert a unit is installed; CI checks the entrypoint exists |
| REL-04 | Agent tasks | Start transition + duplicate-execution guard | `POST /api/agents/tasks/start` | **PASS** `[0.5]` | P1 | — | `tests/agent-task-signing.test.ts` |
| REL-05 | Backup/DR | Off-host destination + evidenced restore | — | **BLOCKED** | P1 | Storage credentials + restore drill | Requires a host and a destination |
| REL-06 | Server runtimes | Node/Python/PHP actually run | detection yes; service manager `none` | **FAIL** `[0.5]` | P2 | Service-manager adapter with health checking | Pending |
| REL-07 | Scheduler | Cron endpoint exists but no caller shipped | `/api/cron` | **PARTIAL** `[prior]` | P2 | Ship a timer or document the external caller | — |
| BILL-01 | Billing | No fabricated checkout | `src/lib/stripe.ts` throws | **PASS** `[0.5]` | P0 | — | `tests/billing-entitlements.test.ts` |
| BILL-02 | Billing | Plan limits enforced | `entitlements.ts` | **PASS** `[0.5]` | P0 | — | same suite |
| BILL-03 | Billing | Real payment provider behind `PaymentVerifier` | interface only | **BLOCKED** | P1 | Adapter + signature verification + idempotency | Testable with fixtures; activation needs credentials |
| BILL-04 | Billing | Usage metering reconciles with actuals | usage tables [prior] | **PARTIAL** `[prior]` | P2 | Reconcile job | — |
| OBS-01 | Observability | Structured logs, redaction, request ids | `redact()`, proxy | **PASS** `[prior]` | P1 | — | `tests/deploy-e2e.test.ts` asserts no secret in logs |
| OBS-02 | Observability | Alert rules → **delivery** | rules exist | **PARTIAL** `[prior]` | P2 | Prove one delivery to a real channel | No channel configured |
| OBS-03 | Observability | Health/readiness endpoints for the orchestrator | `/api/health` | **PASS** `[0.5]` | P1 | — | `tests/health-reporting.test.ts` |
| INT-01 | Integrations | GitHub OAuth, clone, webhooks | `src/lib/deploy/*` | **PARTIAL** | P1 | Live OAuth round-trip on a host | Not reachable from this sandbox |
| INT-02 | Integrations | Stripe | see BILL-03 | **BLOCKED** | P1 | — | — |
| INT-03 | Integrations | SMTP delivery | `src/lib/smtp.ts` | **PARTIAL** | P2 | Configure a relay; prove one message | No relay |
| INT-04 | Integrations | DNS provider | `dns-provider.ts` | **BLOCKED** | P1 | Provider + scoped token | No credentials |
| INT-05 | Integrations | TLS / ACME | `alo-ssl-helper`; `cloudflare.ts` returns `NOT_IMPLEMENTED` | **PARTIAL** | P1 | Wire a verified provider | Refuses to invent a certificate — correct |
| AI-01 | AI | Local Ollama first, cloud optional | `src/lib/ai/providers.ts` | **PARTIAL** | P3 | Run a model on a host | No model run here |
| AI-02 | AI | Tenant-isolated knowledge/workforce | `src/lib/ai/rea/*` | **PARTIAL** | P3 | See TEN-02 | — |
| FE-01 | Frontend | 80 pages / 5 layouts build and route | `next build` | **PASS** `[prior]` | P2 | — | `tests/dashboard-pages.test.ts` |
| FE-02 | Frontend | End-to-end browser flows | — | **FAIL** | P2 | Playwright for five core flows | No E2E suite exists |
| TEST-01 | Quality | Unit + integration suite | 74 files / 1174 pass | **PASS** `[0.5]` | P1 | — | `npm test` |
| TEST-02 | Quality | Coverage measured | no provider configured | **FAIL** | P3 | Add `@vitest/coverage-v8` + floor | No coverage number is claimed anywhere |
| TEST-03 | Quality | CI runs lint/typecheck/test/build/audit | `.github/workflows/ci-cd.yml` | **PASS** `[prior]` | P1 | — | Live on `main` |
| CI-01 | Release | Digest-pinned artifact, commit re-validation, auto-rollback | `ci-cd.yml` `deploy` job | **PASS** `[prior]` | P1 | — | Pipeline structure inspected |
| DOC-01…15 | Documentation | Audit docs + operations runbooks | `docs/audit/*`, `docs/operations/*` | see §7 of checklist | P4 | — | — |

## Root cause / impact / remediation for every FAIL and BLOCKED row

**SEC-04 — BLOCKED (P0).** *Root cause:* repository settings are not repository
content; a self-hosted runner on the production host is reachable by a workflow
run. *Impact:* a push to `main` that satisfies the (absent) approval check reaches
the production host. *Remediation:* branch protection, required reviewers on the
`production` environment, runner isolation. *Test:* not testable from the
repository; verify by attempting a push to `main` and confirming rejection.

**SEC-08 — BLOCKED (P0).** *Root cause:* the repository is public and `db/custom.db`
is tracked with operator emails, password hashes, and internal addressing.
*Impact:* credential material and internal topology are public. *Remediation:*
owner decision on visibility; redact on any future history rewrite. *Test:*
`git grep` for the patterns; SEC-12 ensures the fixture is never used at runtime.

**SEC-09 — BLOCKED (P0).** *Root cause:* two LiteLLM-shaped secrets in history.
*Impact:* if either was ever live, it is public. *Remediation:* rotate both.
*Test:* n/a — rotation is an operational act.

**SEC-11 — FAIL (P1).** *Root cause:* deployment settings were modelled as
customer-editable without a per-setting review of which affect shared host
resources. *Impact:* a customer could change a host-level value. *Remediation:*
settings-by-settings review; operator-only for host knobs. *Test:* pending, and it
is the next task.

**SEC-14 — FAIL (P0, architectural).** *Root cause:* the panel must `sudo` into
root-owned helpers to manage sites, so it is root-equivalent. *Impact:* a panel
compromise is a host compromise. *Remediation:* move helpers behind the agent.
*Test:* the containment properties that reduce the blast radius (allowlist,
argv-only, pre-call checks) are tested; the architecture itself is not.

**SEC-15 — FAIL (P1).** *Root cause:* the Docker helper takes env values as argv.
*Impact:* values visible in the process list to any local user. *Remediation:*
stdin contract. *Test:* needs a host with a Docker daemon.

**DB-04 / REL-05 — BLOCKED (P1).** *Root cause:* no off-host destination is
configured, and the restore drill refuses to claim success. *Impact:* RPO/RTO are
unproven. *Remediation:* provider credentials + destination interface + drill.
*Test:* the refusal is tested; the drill cannot be.

**BILL-03 / INT-02 — BLOCKED (P1).** *Root cause:* no payment provider credentials;
`noPaymentVerifier` rejects every claim. *Impact:* paid plans cannot be sold —
which is the correct safe state. *Remediation:* adapter with signature
verification + idempotency. *Test:* fixtures can cover the adapter; live
verification needs credentials.

**REL-06 — FAIL (P2).** *Root cause:* detection exists but the service manager is
`none`, so a detected Node/Python/PHP app is not started. *Impact:* "deploy a Node
app" is not true end-to-end. *Remediation:* service-manager adapter with health
checking. *Test:* pending.

**FE-02 / TEST-02 — FAIL (P2/P3).** *Root cause:* no browser E2E suite and no
coverage provider. *Impact:* UI regressions and untested branches are invisible.
*Remediation:* Playwright + `@vitest/coverage-v8`. *Test:* the absence is the
finding; no number is invented to fill the gap.

## Summary counts

| Status | Count |
|---|---|
| **PASS** | 26 |
| **PARTIAL** | 12 |
| **FAIL** | 6 |
| **BLOCKED** | 8 |
| **Total matrix rows** | 52 |
| **NOT APPLICABLE** | (Firebase/Google Drive, and any vendor not referenced by code) |

Counts verified by parsing the table itself, not by hand-tallying (the first draft
said 6 BLOCKED; the table has 8 — SEC-04, SEC-08, SEC-09, DB-04, REL-05, BILL-03,
INT-02, INT-04).

Of the 6 FAIL rows: SEC-14 and SEC-15 are architectural at the privilege boundary,
SEC-11 is the imminently scheduled next task, REL-06 needs a service manager,
and FE-02 / TEST-02 are missing tooling (no E2E suite, no coverage provider) —
not broken code.
