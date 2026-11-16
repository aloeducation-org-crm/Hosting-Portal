# Security Threat Model — ALO Hosting Portal

**Version:** 1.0 (2026-11-16) · **Scope:** control plane (Next.js app), execution plane (workers/helpers), data stores, CI/CD
**Method:** STRIDE-style enumeration per trust boundary; each mitigation names the actual control in this repository.
A mitigation marked **[test: …]** is enforced by an automated test. A mitigation marked **[ops]** is a runbook
control that cannot be proven from code and remains unverified until rehearsed on a host.

## 1. Assets

A1 Customer source code and build artifacts · A2 Customer environment variables/secrets · A3 Control-plane
database (SQLite/libSQL) · A4 GitHub installation/OAuth tokens · A5 Payment data & Stripe webhook secrets ·
A6 TLS private keys and Cloudflare API tokens · A7 Audit logs · A8 Worker enrollment credentials/nonces ·
A9 Customer DNS zones · A10 AI provider keys and usage budget

## 2. Trust boundaries

TB1 Internet → edge (nginx/Caddy/Cloudflare) · TB2 Edge → control plane · TB3 Control plane → database file ·
TB4 Control plane → workers/helpers (SSH/agent protocol) · TB5 Control plane → external APIs (GitHub, Stripe,
Cloudflare, AI providers) · TB6 Untrusted build containers → host · TB7 CI/CD → production host

## 3. Threats and mitigations

| # | Threat (boundary) | Mitigations in this repository | Residual risk |
| --- | --- | --- | --- |
| T1 | Malicious customer repository escapes build sandbox (TB6) | Non-root execution, CPU/RAM/disk/PID limits, read-only rootfs, network deny by default, workspace cleanup, log redaction (`src/lib/deploy/sandbox.ts`, `src/lib/deploy/engine.ts`); helper argv allowlisting (`helpers/`, `tests/helper-contracts.test.ts`); **[test: build-isolation.test.ts]** | Kernel/container escape not re-verified this session; mitigations are code+config, not a proven MAC profile on the host |
| T2 | Compromised customer account → cross-tenant access (TB2/TB3) | Session RBAC + tenant scoping on queries; `[test: deploy-tenant-isolation.test.ts]`, `tests/phase2-security-and-routes.test.ts`; per-tenant env var encryption (`src/lib/encryption.ts`, AES-GCM style payload) | No live MFA-bypass red team; MFA exists but field-tested enforcement is absent |
| T3 | Stolen GitHub token used to deploy attacker code (TB5) | Installation-token flow (short-lived), webhook signature verification (`src/lib/deploy/signature.ts`, `webhook.ts`), repo allowlist per project, commit SHA recorded on deployments | Token storage relies on host secret store; rotation procedure **[ops]** unverified |
| T4 | SSRF via webhook/AI provider/deploy target (TB5) | `src/lib/security/url-guard.ts` blocks IMDS/link-local/private ranges incl. IPv6; used by provider config and webhook registration; **[test: ssrf-health-probe.test.ts]** | DNS-rebinding TOCTOU not fully closed (guard checks hostname, not pinned resolution) — documented limitation |
| T5 | Payment webhook forgery (TB5) | Stripe signature verification; idempotent processing; **[test: billing-entitlements.test.ts]** | No live Stripe test-mode evidence this session |
| T6 | Privilege escalation to Super Admin (TB2) | Role enum gates on admin routes; audit log on sensitive actions (`src/lib/audit.ts`); operator authorization tests **[test: operator-authorization.test.ts, phase1-auth-rbac.test.ts]** | Insider misuse mitigated by auditability, not prevention |
| T7 | Compromised / rogue worker (TB4) | Worker enrollment tokens, per-request nonce + HMAC signing, heartbeat, quarantine, task claim/result protocol **[test: agent-bootstrap, agent-task-signing, server-agent*.test.ts]** | Enrollment token handling on hosts **[ops]**; no live rogue-worker drill |
| T8 | DNS takeover / dangling record (TB5) | Verification checks actual resolution before activation; conflicting-record detection; **[test: dns-provider.test.ts]** (mocked) | **No live DNS check executed** — acceptance scenario 15–17 unverified |
| T9 | Backup theft → offline cracking (TB3/TB6) | `VACUUM INTO` snapshot, 0600 perms, sha256 manifest; drill verifies restore **[this repo, 2026-11-16]** | Backups are not encrypted at rest by the script — encryption is **[ops]** (e.g., age/gpg off-host); R6 in risk register |
| T10 | Injection via API inputs (TB2) | Zod validation on routes, Prisma parameterization (no raw SQL on request path), CSRF tokens for browser mutations **[test: csrf.test.ts]** | 264 routes — audit coverage is sampled, not exhaustive per route |
| T11 | Secret leakage into logs/frontend (TB2/TB6) | `src/lib/deploy/redact.ts`, `secret-store.ts`, `maskSecret`; frontend never receives DB passwords; build-log redaction before persistence | Redaction patterns are heuristic; spot-check logs on next host deploy |
| T12 | AI tool misuse / unapproved spend (TB5) | Tool registry with permission requirements, approval workflow, budget/cost gates, provider abstraction; paid calls blocked without approval **[test: ai-capability-requests, ai-security-and-routes, operator-authorization]** | Prompt-injection against the operator agent not red-teamed live |
| T13 | Supply chain (CI/dependencies) (TB7) | `npm audit` in `docs/README.md` verify path; CI actions pinned by major; lockfile committed; no `pull_request_target` | Dependabot/npm-audit status not re-triaged this session; pin review pending |
| T14 | Rate-limit / brute force (TB1/TB2) | In-memory bucket limiter with plan tiers (`src/lib/rate-limit.ts`); account lockout on login; trusted-proxy handling with `TRUSTED_PROXY_COUNT` | Single-instance limiter is per-process — multi-replica needs shared store (Redis path exists: `src/lib/redis.ts`) |
| T15 | Control-plane secret default/placeholder boot (TB2) | `env.ts` fail-closed in production; `scripts/validate-prod-config.mjs` exits 1 on missing/placeholder secrets | Host discipline required at deploy time **[ops]** |

## 4. Cross-cutting controls

- **Encryption at rest for app secrets:** `encryptSecret`/`decryptSecret` (AES-GCM-style, key from `APP_ENCRYPTION_KEY`) — key rotation = re-encrypt with new key via admin path **[ops: not drilled]**.
- **Audit log:** `audit_logs` model + `src/lib/audit.ts`; admin actions and auth events recorded; export via `/api/audit/logs` (role-gated).
- **Input validation:** zod schemas at route boundary; `apiError` consistent error envelope (`src/lib/response.ts`).
- **Secure headers / CSRF:** `next.config.ts` headers + `src/lib/security/csrf.ts` (double-submit, browser variant `csrf.browser.ts`).
- **Tenant isolation invariant:** every project-scoped query must filter by owner/tenant — enforced by tests in the deploy path; **not** statically provable for all 264 routes.

## 5. Explicit non-goals / unverified items

- No penetration test or external audit has been performed in this phase.
- No live certificate issuance/renewal check; no live DNS propagation check.
- No host-level MAC (AppArmor/SELinux) verification; container isolation is config-level.
- The archived `archive/retired-2026-11-09/` tree is excluded from this model (dead code, kept for traceability).
- Office Server A/B and Hostinger hosts are unassessed — no inventory, no benchmark, no firewall review.

## 6. Required before production (P0 gates)

1. Live DNS + SSL acceptance run (scenarios 15–17) with real records.
2. Live backup restore on the production host + encryption of off-host copies with a separately held key.
3. `npm audit` triage clean or risk-accepted in writing; host `TRUSTED_PROXY_COUNT` set correctly behind nginx.
4. One full deploy → rollback rehearsal with `scripts/deploy-release.sh` on staging, evidence filed.
5. Worker enrollment + heartbeat + quarantine drill on a real node.
