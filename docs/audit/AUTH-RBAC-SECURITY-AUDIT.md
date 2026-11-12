# Authentication, RBAC and Security Audit

> Reconciled at `d1dc3d0`. Findings marked **FIXED [0.5]** were reproduced from
> source or from the prior audit and now have a regression test that fails
> without the change. Findings marked **OPEN** are named with the reason they were
> not closed in a containment pass.

## 1. Authentication paths

| Path | Mechanism | Test evidence |
|---|---|---|
| Credentials login | password (bcrypt) → NextAuth JWT, 24 h, `secure` cookies gated by `secureSessionCookiesEnabled()` | `tests/session-cookie.test.ts`, `tests/phase2-security-and-routes.test.ts` |
| Signup | `/api/auth/signup`, `/api/auth/register` | `tests/phase2-*` |
| OAuth | Google, GitHub via NextAuth providers | provider list probe |
| MFA | TOTP (`otpauth`), challenge flow, backup codes | `tests/phase2-*` |
| Password reset | token issue + consume, single use | `tests/password-reset.test.ts` |
| API tokens / service credentials | scoped, hashed digest, HMAC | `tests/crm-service-auth.test.ts` |
| Agent auth | per-agent secret, HMAC over `ts.nonce.sha256(body)`, 5-min skew, single-use nonce | `tests/server-agent.test.ts`, `tests/agent-task-signing.test.ts` |
| Webhooks | GitHub HMAC signature; signed deploy webhook | `tests/deploy-e2e.test.ts` |

`requireSession` re-reads the user from the database on every request, so a lock,
role change or deactivation takes effect immediately rather than at token expiry.

## 2. RBAC matrix (as seeded)

30 permissions, 7 roles (`prisma/seed.ts`). Reproduced from source, not assumed:

| Permission | SUPER_ADMIN | ADMIN | RESELLER | DEVOPS | SUPPORT | CLIENT | VIEWER |
|---|---|---|---|---|---|---|---|
| WEBSITE_* (all 7) | ✓ | ✓ | ✓ | — | — | own | read |
| DOMAIN_*, SSL_MANAGE | ✓ | ✓ | ✓ | — | — | own | — |
| DATABASE_* (4) | ✓ | ✓ | ✓ | — | — | own | read |
| BACKUP_* | ✓ | ✓ | ✓ | — | — | own | read |
| FILE_MANAGE, LOGS_READ | ✓ | ✓ | ✓ | — | — | own | read |
| USER_CREATE/READ | ✓ | ✓ | ✓ | — | read | — | — |
| USER_UPDATE / DELETE | ✓ | ✓ | — | — | — | — | — |
| ROLE_MANAGE | ✓ | — | — | — | — | — | — |
| AUDIT_READ | ✓ | ✓ | — | — | — | — | ✓ |
| SERVER_MANAGE | ✓ | ✓ | — | ✓ | — | — | — |
| SYSTEM_MANAGE | ✓ | — | — | ✓ | — | — | — |

DEVOPS holds `SERVER_MANAGE`/`SYSTEM_MANAGE` but no website permission — it is an
infrastructure role, not a tenant-administration role.

## 3. Findings

### FIXED [0.5]

| ID | Severity | Finding | Evidence of fix |
|---|---|---|---|
| SEC-02 | **Critical** | `accessToken(connectionId)` resolved any Git connection by primary key with no ownership check; three routes accepted a caller-influenced id; `GET /api/github/status` listed every connection to every signed-in user, which made the ids discoverable. Cross-tenant read of private repositories. | `src/lib/deploy/connections.ts`; `tests/deploy-tenant-isolation.test.ts` (23) |
| SEC-01 | **Critical** | Customer build steps ran as the control-plane process, which is root-equivalent on the documented host. `postinstall` in an imported repository was host compromise. | `src/lib/deploy/sandbox.ts`; `tests/build-isolation.test.ts` (23) |
| SEC-03 | **High** | Three (plus one found this pass: signup) paths granted a paid plan with a `paid` invoice and no payment; plan limits were never enforced; `stripe.ts` fabricated a checkout URL. | `src/lib/billing/entitlements.ts`; `tests/billing-entitlements.test.ts` (26) |
| SEC-05 | **High** | Rate limits keyed on `x-real-ip \|\| "unknown"` collapsed into one shared bucket, so the per-client limit became platform-wide. | `src/lib/security/client-identity.ts`; `tests/client-identity.test.ts` (20) |
| SEC-06 | **Medium** | Unverified accounts had full API access; `RESELLER` was self-selectable at signup. | `src/lib/account-status.ts`, `src/proxy.ts`; `tests/account-verification.test.ts` (21) |
| SEC-07 | **Medium** | Agent task signatures registered but unverified; signed body omitted fields the agent executed; plain-http panel URL allowed; running tasks expired early. | `agent/alo-agent.mjs`, `src/lib/agents/agent.ts`; `tests/agent-task-signing.test.ts` (23) |
| SEC-13 | Low | Health could not distinguish schema-behind from unreachable; uptime was time since first request. | `src/lib/health.ts`; `tests/health-reporting.test.ts` (21) |
| SEC-12 | Low | Unset `DATABASE_URL` silently selected the shipped fixture database. | `src/lib/db.ts`; same suite |

### OPEN — not closed in this pass

| ID | Severity | Finding | Why it remains open |
|---|---|---|---|
| SEC-11 | Medium | Some deployment settings affecting shared host resources are customer-editable. | Needs a settings-by-settings review with the owner of the deploy product; a partial change would give false assurance. Next task in the checklist. |
| — | High | The control-plane user is root-equivalent on its host (21 passwordless sudo entries; `NoNewPrivileges=false`). | Architectural. Removing it means moving the helper suite behind the agent (master brief Phase 2). Every customer-reachable capability that reaches a helper is now checked *before* the call, which reduces but does not remove the exposure. |
| — | Medium | `SERVER_MANAGE` is one permission covering containers *and* servers; `ADMIN`/`DEVOPS` bypass ownership on every tenant's deployment project. | RBAC restructuring is Phase 1; narrowing it mid-incident would break operators. Documented so it is not mistaken for least privilege. |
| — | Medium | Docker helper passes container env values as `KEY=value` argv, visible in the process list. | Needs the helper's stdin contract redesigned and tested on a host. |
| — | Medium | Two LiteLLM-shaped secrets exist in Git history. | Rotation is an owner action. **SEC-09.** |
| SEC-08 | Medium | The repository is public and carries a fixture database with operator email addresses and password hashes, internal addressing, and a public IPv4 literal in ten tracked files. | Owner decision on repository visibility. SEC-12 removes the *runtime* risk of the fixture; it does not remove the file from history. |
| SEC-04 | High | `main` is unprotected, the `production` environment has no required reviewers, the deploy workflow targets a self-hosted runner on the production host. | GitHub settings, not repository content. Owner action. |
| — | Low | In-process rate limiting is per-instance; a second instance would double the effective limit. | Depends on shared state (Redis) being provisioned. |

## 4. Adversarial test coverage

| Attack class | Coverage |
|---|---|
| Cross-tenant IDOR | `tests/deploy-tenant-isolation.test.ts`, `tests/phase1-auth-rbac.test.ts`, existing IDOR suites |
| Forged / replayed / tampered agent messages | `tests/agent-task-signing.test.ts` (forged HMAC, field mutation, injected unsigned field, replayed envelope, stale timestamp, malformed input) |
| Header spoofing for rate limits | `tests/client-identity.test.ts` (spoofed `x-forwarded-for`, no-proxy default) |
| Entitlement self-grant | `tests/billing-entitlements.test.ts` + a rewritten route test that asserts the customer is refused |
| SQL identifier injection in the health probe | `tests/health-reporting.test.ts` (`requireIdentifier`) |
| CSRF | `tests/csrf.test.ts` (24) |
| Command injection | Allowlist + argv-only execution; `tests/server-agent.test.ts` |
| Path traversal | Deploy `outputDir` containment; agent `ABS_PATH`/`LOG_PATH` patterns; `tests/server-agent.test.ts` |
| Secret leakage into logs | `tests/deploy-e2e.test.ts` asserts persisted deployment logs contain no secret |

## 5. Secrets and privacy

- No credential value is printed, committed or logged by this pass. Every new
  module redacts before persisting: `sanitiseDetail()` strips paths, hosts and
  connection URLs from health reasons; `connections.ts` logs an actor and a
  connection owner id but never a token.
- `.env.example` documents every environment variable the application reads; this
  is enforced by `npm run audit:repo`, which passed 17/17 after this pass added 14
  variables.
- The new cross-tenant denial log records `connectionId` and `connectionOwnerId`.
  It does **not** write an `AuditLog` row, because that would let an attacker
  write rows into another tenant's audit feed.

## 6. Honest residual risk statement

The three critical defects in this report were reproducible from source before
this pass. All three now have a regression test that fails if the defect returns.
None of the fixes has been exercised against a live host, a real GitHub
installation, or a real payment provider:

- SEC-01's namespace boundary is proven by argv construction and by a
  fail-closed policy. The sandbox that produced this report **cannot create user
  namespaces**, so the containment itself is unverified. That is why production
  defaults to `required` — a host where it does not work refuses to build rather
  than building unisolated.
- SEC-02's rule is unit-tested and compiled into every call site, but no
  end-to-end request against a real OAuth installation was made.
- SEC-03's payment verifier deliberately rejects everything. Billing is
  **BLOCKED**, and that is the correct state: the platform cannot take money, so
  it must not grant paid plans.
