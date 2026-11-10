# Master Cloud Platform — Phase 0 Audit, Threat Models & Execution Architecture

Date: 2026-11-04
Branch: `arena/5a1fa044-hosting-portal`
Base `main` Commit: `74b54614972f36c56b48dda9aab986dca7d53494` (PR #24)
Production Gate: **NO-GO / Manual-Only Release Hold remains active** (`.github/workflows/ci-cd.yml` + `docs/SELF-HOSTED-ACCEPTANCE-GATE.md`)

## 1. Repository & Baseline Summary

- **Canonical application root:** `/home/user/Hosting-Portal` (`alo-hosting-panel`, Next.js 16.4.3 standalone, React 19, TypeScript, Prisma 6.19.3 + `@prisma/adapter-libsql`).
- **Protected legacy & reference paths:** `alo-hosting-portal/` and `.gitignore` / `scripts/host-checkout-status.sh` rules for `aerus-usage-hud/` and `alo-hosting-portal/aerus-usage-hud/` are preserved untouched.
- **Tracked development database:** `db/custom.db` remains clean (`git diff --exit-code db/custom.db`). All tests and previews run against isolated temporary copies.

## 2. Reusable Subsystems (Extended Rather Than Duplicated)

1. **Identity & RBAC:** `src/lib/auth.ts`, `src/lib/nextauth.ts`, `src/proxy.ts`, `src/lib/app-center.ts` (`User`, `Role`, `Organization`, `Team`, `Membership`). No second incompatible identity store is introduced.
2. **Encryption & Redaction:** `src/lib/encryption.ts` (AES-256-GCM), `src/lib/secret-store.ts` (`sealSecretValue` / `openSecretValue` `enc:v1:`), `src/lib/deploy/redact.ts`, and `src/lib/cloud/crypto-auth.ts` (`alok_live_` / `alowh_` SHA-256 constant-time verification).
3. **Durable Job Orchestrator:** `src/lib/orchestrator/{contracts,orchestrator,workers}.ts` (`operation_jobs` with idempotency keys, conditional `updateMany` claims, expiring leases, per-`lockKey` serialization, exponential retry backoff, `DEAD_LETTER`, and human `WAITING_APPROVAL` gates).
4. **Host Agent & Allowlist:** `src/lib/agents/{agent,allowlist,http}.ts` and `agent/alo-agent.mjs` (`argv`-only execution, nonce replay protection).
5. **GitHub & Sites Deploy Pipeline:** `src/lib/deploy/{github,detect,config,engine,service,release-guard}.ts` (manifest-only `detectFramework()`, atomic symlink activation, automatic rollback on failed health check).
6. **Storage & Signed URLs:** `src/lib/storage-pools.ts` (`resolveWithinRoot`, filename sanitization) and `src/lib/integrations/service-auth.ts` (HMAC signed download URLs).
7. **AI Workflows & Governance:** `src/lib/ai/automation/*`, `src/lib/ai/capability-requests.ts`, `src/lib/ai/code-change-proposal.ts`, and `src/lib/ai/rea/reconstruction-ledger.ts`.

## 3. Source Security Gaps Remediated in Phases 1–5

1. **`POST /api/databases` (`src/app/api/databases/route.ts`)**: Enforce `assertWebsiteAccess(user, website)` to close cross-tenant `websiteId` IDOR.
2. **`PUT /api/websites/[id]/env` (`src/app/api/websites/[id]/env/route.ts`)**: Seal `isSecret` values with `sealSecretValue()` inside a transaction and record audit logs; add stage-scoped versioned `CloudSecret` storage for Cloud Projects.
3. **`/api/storage/buckets` (`src/app/api/storage/buckets/route.ts`)**: Redact `accessKey`, `secretKey`, and host `bucketPath`; convert `BigInt` safely; seal `secretKey`; reject path traversal.
4. **Out-of-process customer workloads**: All Cloud Sites builds and Cloud Function executions run strictly outside the Next.js server process via `scripts/cloud-worker.ts` / isolated subprocesses bounded by `prlimit`, clean environments, and hard process-group timeouts.
5. **Connection-time DNS-rebinding & SSRF defense (`src/lib/security/safe-egress.ts`)**: Validate DNS resolution at connection time, reject private/loopback/CGNAT/link-local/IMDS/IPv4-mapped-IPv6 destinations, pin the verified IP in the TLS socket `lookup` callback while preserving SNI, and revalidate every HTTP redirect hop.

## 4. Ten Threat Models

1. **Malicious customer repositories:** `git clone --config core.hooksPath=/dev/null`, manifest-only `fsReader()` confinement, post-checkout symlink boundary check, and disk size caps.
2. **Malicious build scripts:** Out-of-process worker only, stripped environment (zero control-plane secrets), `prlimit` memory/CPU/fsize/nproc limits, and `SIGKILL` process-group timeout.
3. **Malicious Cloud Functions:** No `/var/run/docker.sock` exposure; ephemeral per-invocation temp directory; `prlimit` + `--max-old-space-size`; stripped env; hard wall-clock timeout; `verifiedCompatible` gate before enabling execution.
4. **Cross-tenant access (IDOR):** Mandatory tenant/org ownership verification on every project, site, environment, secret, database, bucket, object, function, webhook, and deployment route.
5. **Webhook SSRF & DNS rebinding:** `safe-egress.ts` DNS resolution + IP pinning + manual redirect revalidation (max 3 hops).
6. **Credential leakage:** SHA-256 digests for API keys; AES-256-GCM sealing for env/DB secrets; streaming `redact()` + `redactCloudSecrets()` on logs/errors; secret-free AI tools.
7. **Resource exhaustion:** Per-project `lockKey` serialization, configurable `CloudProjectQuota` gates before enqueue, `2 MiB` log caps, upload byte limits, and bounded retries.
8. **Worker compromise:** Scoped job payloads, isolated scratch directories, allowlisted `argv`-only commands, and expiring leases.
9. **Unauthorized deployment:** HMAC webhook verification, immutable `Release` / `releaseImmutableId` identifiers, health-check gate before production promotion, and preservation of active production release on failure.
10. **Backup & restore attacks:** SHA-256 archive checksum verification before restore, confined archive paths, and attributable audit logging.

## 5. Control-Plane vs. Customer Database Separation

- **Control-plane database:** Prisma SQLite (`alo.db` / `db/custom.db`) stores platform metadata, RBAC, jobs, encrypted secrets, audit logs, and usage events only. Customer SQL never runs against it.
- **Customer databases (`CloudDatabaseInstance`):**
  - `SQLITE_ISOLATED`: Dedicated per-database SQLite file confined under `<CLOUD_DATA_ROOT>/customer-dbs/<projectId>/<slug>.sqlite` with WAL mode, size limits, credential rotation, and SHA-256 checksummed snapshots (verifiable locally without external daemons).
  - `MARIADB` / `POSTGRESQL`: Provisioned via enrolled `alo-agent` + `alo-database-helper` on dedicated database hosts; reports `REQUIRES_INFRASTRUCTURE` honestly when no database host agent is enrolled.

## 6. Infrastructure Assessment

- **Servers A & B (Office laptop & 2009 dual-core desktop):** Share office power and ISP (single failure domain); `OWNER_PROVIDED` unmeasured specs. Not suitable for untrusted production customer builds/functions.
- **Servers C & D (Hostinger 200-process shared plan & cPanel):** Shared hosting ceilings prevent isolated build/function daemons.
- **Required for production customer workloads:** At least one dedicated external Linux KVM worker VPS (4+ vCPU, 8–16 GB RAM, NVMe, Ubuntu 24.04 LTS, independent power/ISP) enrolled via `scripts/cloud-worker.ts` + `alo-agent.mjs`.
