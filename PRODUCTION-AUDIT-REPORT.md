# ALO Labs Hosting Portal — Production Audit

**Audit date:** 2026-10-25  
**Scope:** repository checkout only; no Ubuntu VPS, DNS provider, mail server, firewall or production credentials were available. This is a source/build audit, not proof of infrastructure operation.

## Summary / status

**Current acceptance level: below LEVEL 1 — CODE COMPLETE.** This checkout does not pass typecheck, the root test command has no tests, and the full production build fails TypeScript. The nested legacy project has 104 passing tests, but those tests are not run by the root package and do not establish correctness of the root application. No real VPS lifecycle can be claimed.

The repo contains two overlapping applications (`src/` at repository root and `alo-hosting-portal/src/`), with separate packages, Prisma schemas, helpers, tests and deployment files. The root package is what root CI invokes. Treating the nested tests as root-application coverage would be misleading.

## Application verification

| Check | Result | Evidence |
|---|---|---|
| Root TypeScript | **FAIL (48 diagnostics)** | `npm run typecheck`: many implicit-any callbacks and Prisma types `DeploymentWhereInput`, `NotificationWhereInput` missing from generated client. |
| Nested TypeScript | **FAIL** | `cd alo-hosting-portal && npm run typecheck` also reports implicit-any and Prisma-generated typing failures; its test pass does not mean the project typechecks. |
| Root ESLint | **PASS after changes** | `npm run lint` succeeds. |
| Root test command | **PASS (1 test)** | `npm test` runs the new root AI adapter fail-closed test. This is narrow coverage, not broad app coverage. |
| Nested test suite | **PASS (104/104)** | `cd alo-hosting-portal && npm test`; 10 files pass. These tests cover nested code, not root `src/`. |
| Root production build | **FAIL** | Normal `next build` reaches typecheck and fails on the same root TypeScript/Prisma errors. |
| Root compile-only build | **Compiled, not a finished production build** | Existing script's compile mode said further generate/generate-env phase is required. Google font network fetch initially prevented compilation; fonts were changed to system fallbacks. |
| Root `npm ci` | **not verified to completion** | A root `package-lock.json` was generated. `npm ci` stopped at Prisma postinstall because its engine download from `binaries.prisma.sh` was unreachable in this environment. |
| `npm audit` | **7 findings reported** | Generated lockfile install audit: 1 moderate, 4 high, 2 critical. No automated force-upgrades applied. |
| Shell syntax | **PASS** | `bash -n helpers/alo-* helpers/install-helpers.sh helpers/install-ubuntu-server.sh install-scripts/*.sh`; 19 `alo-*` helper scripts parsed. Syntax is not operational/security verification. |
| API inventory | **141 root route handlers** | Counted under `src/app/api`; existence does not establish real backend functionality. |

## Changes made in this audit

1. Added root `package-lock.json` so CI's root `npm ci` has a lockfile (the install could not finish here due Prisma engine download networking).
2. Replaced fabricated fixed disk usage and random bandwidth in the root metrics endpoint with filesystem `statfs` data and `null` bandwidth (unknown pending interval samples).
3. Changed metric collection to store actual filesystem usage and leave unsampled bandwidth unknown instead of writing placeholder zeroes.
4. Removed shell-interpolated `openssl s_client` from monitoring SSL checks. The check now validates stored hostnames and uses Node TLS APIs with a timeout and certificate verification.
5. Removed helper argv and raw stderr from application logs because arguments/error output can contain secrets.
6. Removed two React lint violations without disabling lint rules.
7. Removed build-time Google Fonts fetching; the UI uses system fonts so the build does not require access to Google Fonts.
8. Changed root build script from compile-only experimental mode to normal `next build`, which correctly exposes the outstanding type errors instead of presenting compile-only output as a finished production build.
9. Added a shared server-side OpenAI-compatible AI provider adapter for chat, code, domain advice, and website generation. It can target a compatible gateway (including an operator-deployed UnoRouter gateway) using server-only environment settings, and fails closed without a key. Added an authenticated configuration-status endpoint and a no-key test; no live gateway credentials were available.
10. Disabled misleading fallback data: provider-backed AI routes no longer return echo/demo content without a configured provider, domain availability returns `UNKNOWN`/`501` without a registrar, the landing-page domain search displays an error instead of generated results, and email DNS output no longer invents a DKIM key or placeholder server IP.

These changes do **not** prove the helper layer or APIs work against Ubuntu.

## Feature/infrastructure inventory

Statuses: **PARTIAL** = source/config exists but end-to-end real operation is unverified or visibly incomplete; **NOT TESTED** = no matching runtime available; **BLOCKER** = known build/config gap. Source presence is not a PASS.

| Subsystem | Audit status and evidence |
|---|---|
| Ubuntu 22.04/24.04 | **NOT TESTED** — installer targets Ubuntu, but was not run; no VPS. |
| Next.js / Node 22 | **PARTIAL / BLOCKER** — root build starts, then fails TypeScript. No production process deployed. |
| API/auth/RBAC | **PARTIAL / NOT VERIFIED** — auth and permission utilities/routes exist; no route-by-route authorization audit or penetration tests completed. |
| Prisma/database layer | **BLOCKER** — generated client appears out of sync with root schema; type errors. No live DB connection tested. |
| Website/site provisioning | **PARTIAL** — API calls helpers and then writes rows, but no real site provision tested; transaction/rollback and state reconciliation not demonstrated. |
| Domain/DNS | **PARTIAL** — routes/helpers exist; registrar/DNS provider and live DNS checks not verified. DNS control-plane integration not proven. |
| Caddy | **PARTIAL** — helpers attempt config generation/validation/reload. Caddy absent here; paths/config consistency and rollback not integration-tested. |
| Node/Next.js apps | **PARTIAL** — helper/service code exists; process/port collision, deploy, health, rollback not exercised on Ubuntu. |
| PHP/PHP-FPM | **NOT TESTED** — installer mentions PHP; no installed PHP-FPM server verification. |
| MariaDB/MySQL | **PARTIAL / NOT TESTED** — helper source exists; no database/user/grant/connection test. Password safe storage/return paths need review. |
| PostgreSQL | **PARTIAL / NOT TESTED** — helper source exists; no live SQL validation. |
| SSL/Certbot | **PARTIAL / NOT TESTED** — route/helper source exists; no issuance, renew or certificate verification against real DNS. Caddy and Certbot responsibilities need consolidation. |
| UFW/firewall | **NOT TESTED; installer risk** — installer enables UFW and opens ports including panel port 3101; this may expose the panel and can impact remote access. Do not run without a reviewed access plan. |
| File manager | **PARTIAL / NOT TESTED** — helper/API exist; no adversarial traversal/symlink tests on target filesystem. |
| Backups/restores | **PARTIAL / NOT TESTED** — scripts/helpers exist; no checksum/rollback/restore proof. |
| Cron | **SECURITY REVIEW REQUIRED** — helper writes `/etc/cron.d`; its `APP_USER` is declared but observed add format lacks the required cron user field. The command model needs a dedicated unprivileged identity and strict per-site scope before use. |
| Email (Postfix/Dovecot/Rspamd/DKIM) | **NOT TESTED / NOT PROVEN** — setup script/helper sources exist; no real mailbox, SMTP/IMAP, DKIM or deliverability proof. |
| SSH | **HIGH RISK / NOT TESTED** — helper/sudoers entries exist; no active-admin safety test or SSH-key lifecycle test. |
| Docker | **NOT TESTED** — helper/routes exist; no daemon or container operation tested. |
| Deployment/Git/webhooks | **PARTIAL / NOT TESTED** — route/helper sources exist; no real release, health check or rollback test. |
| Monitoring/health | **PARTIAL** — metrics changed to real local OS/filesystem data and unknown bandwidth; existing UI/collection paths still need verification. Some metrics are host-level, not per-site isolation. |
| Audit logs/operations | **PARTIAL / NOT VERIFIED** — models/routes exist; not every privileged operation's success, failure, output sanitization and operation ID lifecycle was verified. |
| SSO/MFA/API keys/encryption | **EXISTS IN SOURCE, NOT VERIFIED** — no end-to-end security tests against production configuration or secret rotation. |
| Billing/CRM | **Exists in app** — out of scope for an internal infrastructure control plane unless retained as internal admin features; no production data integration tested. |

## Security risks / blockers found

- **Build/type safety:** root build is blocked by dozens of TypeScript errors, including Prisma-generated type mismatches. Do not deploy the root application yet.
- **Two-app drift:** root routes and nested `alo-hosting-portal` code/tests/deployment differ. CI currently tests/lints the root but the 104 tests live in the nested project. Define one canonical project before claiming coverage.
- **Synthetic state remains elsewhere:** source inspection found random server statistics in `src/components/platform/views/ServersView.tsx`, plus other placeholder modules not exhaustively removed. The domain advisor, placeholder AI adapter, HeroSection fallback domain results, registrar availability endpoint and fabricated email DKIM response were changed to fail closed / report unknown; configure real providers before enabling these features.
- **Privileged command interface:** `src/lib/helpers.ts` uses `execFile` (not shell interpolation), but sudoers allows invoking the helper path with arbitrary arguments; safety consequently depends entirely on each helper's validation. Every helper/action/argument contract requires individual adversarial review.
- **Data leakage:** helper argv and raw stderr were logged before this audit and are no longer logged by the shared adapter. API error payloads and helper stdout/stderr forwarding still require review; do not pass secrets through responses/logs.
- **Root privileges:** helper adapter may call helpers directly when the web process is root. Production web process should be unprivileged and use exact helper-specific sudo policy.
- **Cron privilege model:** `/etc/cron.d` content must explicitly use an unprivileged user; arbitrary user-supplied commands need stricter constraints and site isolation.
- **Installer:** installer was not tested for idempotency and makes firewall/package/service changes. It should not run against an existing production host before a maintenance plan, SSH lockout protection, backup and review.
- **Dependencies:** npm audit identified 7 items; no triage/remediation was completed.
- **No actual VPS evidence:** no Linux system services, certificates, databases, firewall rules, DNS records, backup archives or email accounts were created/verified during this audit.

## Final level

**NOT LEVEL 1 (CODE COMPLETE).** The nested 104-test suite passes and root ESLint/shell syntax pass, but root typecheck and production build fail. **Not deployment ready, not deployed, and not real-production verified.**

## Exact next commands (do not run on production until reviewed)

### Local verification from repository root

```bash
npm ci
npm run lint
npm run typecheck
npm test
npm run build
bash -n helpers/alo-* helpers/install-helpers.sh helpers/install-ubuntu-server.sh install-scripts/*.sh
```

`npm ci` currently attempts Prisma engine downloads during postinstall. Root `npm test` currently has no tests; nested suite is separately run by:

```bash
(cd alo-hosting-portal && npm ci && npm test)
```

### Ubuntu preflight / deployment

**No safe one-line production deployment command is supplied yet.** First resolve root build/Prisma errors, select the canonical tree, review and test installer/firewall/sudoers changes on a disposable Ubuntu 22.04/24.04 VPS, validate `.env` values and backup/SSH lockout plan. Then use the reviewed installer documented in `helpers/install-ubuntu-server.sh` only on that disposable server. Do not run it on production: it modifies apt packages, UFW, Caddy, PHP/MariaDB, users and services. No infrastructure command was run in this audit.

See `REAL-LIFECYCLE-PROOF.md` for the honest test status and evidence checklist.
