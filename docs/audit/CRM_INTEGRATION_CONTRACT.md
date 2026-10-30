# CRM ↔ Hosting-Portal Integration Contract

**Contract version:** `1.0.0`
**Status:** IMPLEMENTED and TESTED on the Hosting-Portal side; **not yet consumed**
by the CRM
**Hosting-Portal implementation:** commit `7cf8516`, branch
`arena/c02ea3c0-hosting-portal`
**CRM side:** NOT STARTED — adapter specification in §8
**Companion document:** `CRM_PHASE0_AUDIT.md`

---

## 1. Versioning policy

The contract version is independent of either repository's release version.

- The consumer sends `X-ALO-Contract-Version: 1.0` on every request.
- The provider echoes the version it actually served in the same response header.
- **Additive** changes — a new endpoint, a new optional field, a new error code —
  increment the MINOR version and require no consumer change.
- **Breaking** changes — removing or renaming a field, changing a status code's
  meaning, tightening validation on an existing field — increment the MAJOR
  version. A major version is served under a new path prefix
  (`/api/internal/crm/v2/…`), never by mutating `v1` behaviour in place, because
  the CRM and Hosting-Portal deploy independently and a mutated contract would
  break whichever side deploys second.
- A consumer receiving a response whose echoed version has a higher MAJOR than it
  sent must treat the integration as broken and stop, not best-effort parse.

Version `1.0.0` is the first. There is no prior contract to migrate from: before
this work the CRM had no path to the vault at all.

---

## 2. Transport and authentication

| | |
|---|---|
| Base URL | the Hosting-Portal deployment, e.g. `https://hosting.alolabs.net` |
| Path prefix | `/api/internal/crm` |
| Transport | HTTPS only. No plaintext fallback exists. |
| Scheme | `Authorization: Bearer <service-secret>` |
| Secret format | `alosvc_` + 64 hex characters (32 random bytes) |
| Correlation | `X-Request-Id: <caller-id>` — echoed back as `X-Correlation-Id` |
| Content type | `multipart/form-data` for uploads; JSON elsewhere |
| Caching | every response carries `cache-control: no-store` |

**What the provider stores:** only the sha256 digest of the secret, plus a
12-character non-secret prefix used to locate the candidate row. The plaintext
secret is returned exactly once, at creation, and cannot be recovered afterwards
— not by an administrator and not by anyone who reads the database.

**Credential lifecycle.** Provisioning and revocation are **operator actions
performed on Hosting-Portal**, not CRM API calls. There is deliberately no
endpoint by which a service credential can mint or revoke another service
credential: that would make a leaked CRM secret self-escalating. Rotation means
provision a new credential, switch the CRM to it, then revoke the old one — so a
rotation never has a window where the CRM holds no valid credential.

**Fail-closed rules.** These are properties of the implementation, not
aspirations, and each is covered by a conformance test:

- An unset or too-short signing key makes signed URLs **refuse to mint** (503).
  It never degrades into an unsigned public link.
- A credential with no organization is denied. "No tenant" never means "all
  tenants".
- A document with no organization is unreadable by every service.
- Every authentication failure returns **one identical client-visible message** —
  `Invalid or unauthorized service credential` — whether the credential was
  unknown, revoked, expired, mis-scoped or simply wrong. The precise cause is
  written to the audit log and the structured logger only. A rejected caller
  therefore cannot enumerate which credentials exist or diagnose why one failed.
- Scope is evaluated before tenancy, so `403 INSUFFICIENT_SCOPE` means
  "authenticated but not permitted" and `401` means "not authenticated".

---

## 3. Scopes

A credential holds only the scopes it was granted, checked per request.

| Scope | Grants |
|---|---|
| `storage:documents:upload` | `POST /documents` |
| `storage:documents:download` | `POST /documents/{id}/download-url`, `GET /documents/{id}/download` |
| `storage:documents:read` | `GET /documents/{id}` (metadata only) |
| `storage:quota:read` | `GET /storage/quota` |
| `storage:health:read` | `GET /storage/health` |
| `storage:backup:read` | `GET /storage/backup` |

**No scope grants filesystem access, directory listing, arbitrary path
resolution, or any privileged infrastructure command.** The surface is objects,
object metadata, quota, storage health and backup status. A storage path is never
returned by any endpoint, and `storagePath` is absent from every serialized
document by construction.

Least privilege for a first CRM deployment: `storage:documents:upload`,
`storage:documents:read`, `storage:documents:download`, `storage:quota:read`.
Grant `storage:health:read` and `storage:backup:read` only to whatever runs the
CRM's monitoring, not to the webhook path.

---

## 4. Response envelope

Every JSON response uses the same envelope as the rest of Hosting-Portal, so a
CRM client needs one parser for both browser and service endpoints:

```jsonc
// success
{ "status": 201, "success": true,  "message": "Success", "data": { … }, "error": null, "requestId": "…" }
// failure
{ "status": 409, "success": false, "message": "…", "data": null,
  "error": { "code": "POOL_NOT_PROVISIONED", "details": { … } }, "requestId": "…" }
```

`details` is present only when it carries something the caller can act on (quota
numbers, expected vs computed checksum).

---

## 5. Endpoints

### 5.1 `POST /api/internal/crm/documents`

Upload a document. Scope: `storage:documents:upload`.

**Request** — `multipart/form-data`:

| Field | Required | Notes |
|---|---|---|
| `poolKey` | yes | one of `STUDENT_STORAGE`, `PARTNER_STORAGE`, `EMPLOYEE_STORAGE`, `COMPANY_STORAGE`, `PROJECT_STORAGE`. `BACKUP_STORAGE` refuses manual upload for every caller. |
| `category` | yes | must belong to that pool. For `STUDENT_STORAGE`: `passport`, `academic-certificate`, `transcript`, `english-test-result`, `cv`, `statement-of-purpose`, `financial-document`, `admission-letter`, `visa-document` |
| `file` | yes | the bytes |
| `externalReference` | no | the CRM's Student ID, e.g. `AE-20260001`. Stored in the audit trail so a document traces back to a student without the CRM exposing it in a URL. |

**Headers:**

| Header | Required | Behaviour |
|---|---|---|
| `Idempotency-Key` | no | 8–200 chars of `[A-Za-z0-9._:-]`. A replay returns the FIRST attempt's stored response and performs **no write**. A malformed key is rejected `400`, not ignored — silently ignoring it would quietly disable idempotency. A key is bound to the tenant that first used it; replaying another tenant's key is `409` and does not disclose their document id. |
| `X-Content-SHA256` | no, **strongly recommended** | hex digest of the bytes. Verified **before** anything is written; a mismatch is `422` and stores nothing. |
| `X-Request-Id` | no | correlation id, echoed in `X-Correlation-Id` and written to the audit row |

**`201 Created`:**

```jsonc
{ "data": {
    "document": {
      "id": "…", "poolKey": "STUDENT_STORAGE", "organizationId": "…",
      "category": "passport", "filename": "passport.pdf",
      "sizeBytes": "184320",          // string: BigInt-safe
      "sha256": "…", "version": 1, "contentType": "application/pdf",
      "createdAt": "2026-10-29T02:50:00.000Z"
    },
    "deduplicated": false
} }
```

There is **no `storagePath` field**, and adding one would be a breaking change.

**Versioning:** `version` is `max(existing version for this organization + pool +
category + filename) + 1`. Uploading a newer document never overwrites a previous
version's row or its bytes — both remain retrievable.

**Errors:**

| Status | Code | Cause |
|---|---|---|
| 400 | `VALIDATION_ERROR` | missing field, empty file, malformed `Idempotency-Key` |
| 400 | `VALIDATION_ERROR` | category does not belong to the pool, or unknown pool key |
| 401 | `UNAUTHORIZED` | any credential failure (single generic message) |
| 403 | `UNAUTHORIZED` | authenticated but scope not granted |
| 404 | `NOT_FOUND` | pool does not exist |
| 409 | `POOL_NOT_PROVISIONED` | pool exists but has no backend path — honest refusal, not a silent success |
| 409 | `IDEMPOTENCY_KEY_CONFLICT` | key already used by another tenant |
| 413 | `PAYLOAD_TOO_LARGE` | exceeds `MAX_UPLOAD_SIZE_MB` |
| 413 | `QUOTA_EXCEEDED` | pool quota would be exceeded; `details` carries `recordedUsageBytes`, `quotaBytes`, `requestedBytes` |
| 415 | `UNSUPPORTED_MEDIA` | MIME type not in the allowlist |
| 422 | `CHECKSUM_MISMATCH` | declared sha256 ≠ received bytes; `details` carries `expected` and `computed`. **Nothing was stored.** |
| 429 | `RATE_LIMITED` | `Retry-After` header in seconds; `details.retryAfterMs` |
| 503 | `STORAGE_UNAVAILABLE` | the backend could not accept the write. **The upload is NOT recorded as successful** — the CRM must not mark the document stored. |
| 500 | `STORAGE_ERROR` | written file failed size verification, or a path escaped the pool root |

### 5.2 `GET /api/internal/crm/documents/{id}`

Document metadata. Scope: `storage:documents:read`. Returns the same `document`
object as §5.1. A document outside the caller's organization returns **`404`, not
`403`**, so document ids cannot be enumerated across tenants.

### 5.3 `POST /api/internal/crm/documents/{id}/download-url`

Mint a short-lived signed download URL. Scope: `storage:documents:download`.

```jsonc
{ "data": { "url": "https://…/api/internal/crm/documents/{id}/content?org=…&cred=…&exp=…&sig=…",
            "expiresAt": "2026-10-29T02:55:00.000Z", "documentId": "…" } }
```

- **TTL 300 seconds**, hard-capped at 900 even if a longer TTL is requested.
- The HMAC binds **document + tenant + issuing credential + expiry**. Changing any
  one of them invalidates the signature, so a URL cannot be retargeted at another
  document, replayed under another tenant, or have its expiry extended.
- **Preferred fetch mechanism**: a counselor's browser can follow this URL
  directly, so the CRM never proxies document bytes and never learns where the
  file lives on disk.
- Redeeming the URL **re-validates the issuing credential**, so revoking a
  credential also stops the URLs it already minted.
- `503 SIGNING_UNAVAILABLE` if the signing key is missing or weak. Never an
  unsigned URL.
- Treat the URL as a bearer secret: do not log it. Hosting-Portal logs it only
  with the `sig` parameter replaced by `[redacted]`.

### 5.4 `GET /api/internal/crm/documents/{id}/content`

Redeem a signed URL. **No bearer token** — authorized by the `sig`/`exp`/`org`/
`cred` query parameters, because a browser cannot carry the CRM's credential.
Returns raw bytes with `content-type`, `content-length`,
`content-disposition: attachment`, `x-content-sha256`, and
`cache-control: private, no-store`.

| Status | Code | Meaning |
|---|---|---|
| 403 | `BAD_SIGNATURE` / `MISSING_PARAMS` / `SIGNING_KEY_UNAVAILABLE` | not valid |
| 403 | `CREDENTIAL_REVOKED` | the issuing credential has since been revoked or deactivated |
| 404 | `NOT_FOUND` / `STORAGE_MISSING` | document not in this tenant, or the stored file is gone (stale row) |
| **410** | `EXPIRED` | **distinct from 403 on purpose** — it tells the CRM "re-request a fresh URL", which is a different remediation from "you were never allowed this" |

### 5.5 `GET /api/internal/crm/documents/{id}/download`

Server-to-server download proxy for a CRM backend that already holds the
credential and would rather stream bytes than mint a URL. Scope:
`storage:documents:download`. Same tenant rules, same headers, same `404`-not-`403`
behaviour as §5.2. Every read is audited.

### 5.6 `GET /api/internal/crm/storage/quota[?poolKey=…]`

Scope: `storage:quota:read`. Lets the CRM check headroom **before** transferring
a large file rather than discovering a `413` afterwards.

```jsonc
{ "data": { "pools": [ {
    "poolKey": "STUDENT_STORAGE", "provisioned": true,
    "quotaBytes": "1073741824",              // null = unlimited
    "usedByOrganizationBytes": "184320",
    "usedByOrganizationDocuments": 3,
    "poolTotalBytes": "9123456",
    "quotaRemainingBytes": "1073557504"
} ] } }
```

Note the distinction: `quotaBytes` and `poolTotalBytes` are **pool-wide** (shared
infrastructure), while `usedByOrganizationBytes` and `quotaRemainingBytes` are
**this tenant's**. Quota is enforced pool-wide, matching the existing
browser-session rule — one tenant filling a pool affects the others, so the CRM
should surface `poolTotalBytes` rather than only its own usage.

### 5.7 `GET /api/internal/crm/storage/health`

Scope: `storage:health:read`. **Probes the filesystem** rather than reporting
health from configuration, so a pool whose backend has been unmounted or made
unwritable reports `degraded`/`unavailable` instead of looking healthy.

```jsonc
{ "data": { "status": "ok" | "degraded", "organizationId": "…", "pools": [
  { "poolKey": "STUDENT_STORAGE", "status": "ready",           "writable": true,  "reason": null },
  { "poolKey": "PARTNER_STORAGE", "status": "unavailable",     "writable": false, "reason": "backend path is not accessible" },
  { "poolKey": "BACKUP_STORAGE",  "status": "not-provisioned", "writable": false, "reason": "no backend path configured" }
] } }
```

`status` is `ok` only if at least one pool is `ready`. **The CRM should use this
to decide whether to queue uploads instead of losing them during an outage.**

### 5.8 `GET /api/internal/crm/storage/backup`

Scope: `storage:backup:read`. Reports only what is observable:

```jsonc
{ "data": {
  "organizationId": "…",
  "backupPoolConfigured": true,
  "backupBackendPathSet": false,
  "backupBackendAccessible": null,     // true | false | null (unknown: no path set)
  "recordedBackupObjects": 0,
  "recordedBackupBytes": "0",
  "restoreVerified": false,
  "restoreVerifiedNote": "Restore verification requires an actual restore test, which this endpoint does not perform. Do not treat this response as evidence that backups are restorable.",
  "lastVerifiedRestoreAt": null
} }
```

**`restoreVerified` is always `false` from this endpoint, by design.** Verifying a
backup requires performing a restore, which this endpoint does not do. It will
report a backup as configured and its backend as accessible — both observable
facts — but it will never assert that backups are restorable. Any CRM dashboard
that shows a green "backups verified" badge fed by this endpoint would be
displaying a claim the provider explicitly refuses to make. Drive such a badge
from an actual restore test instead.

---

## 6. Audit and correlation

Every operation writes a row to Hosting-Portal's existing `audit_logs`:

| Field | Value |
|---|---|
| `actorRole` | `SERVICE` |
| `actorEmail` | `service:<serviceName>`, or `service:unauthenticated` |
| `domain` | `crm-integration` |
| `requestId` | the correlation id |
| `action` | `CRM_DOCUMENT_UPLOAD`, `CRM_DOCUMENT_DOWNLOAD`, `CRM_DOCUMENT_URL_ISSUED`, `CRM_DOCUMENT_SIGNED_DOWNLOAD`, `CRM_SERVICE_CREDENTIAL_CREATED`, `CRM_SERVICE_CREDENTIAL_REVOKED` |
| `result` | `SUCCESS`, `FAILURE`, or `DENIED` |
| `errorCode` | the precise internal cause, including for denials |
| `metadata` | organization, service, credential id, pool, category, filename, size, sha256, version, `externalReference` |

**`actorId` is deliberately absent.** `AuditLog.actorUserId` is a foreign key to
`users`, and a service credential is not a user. Passing the credential id makes
the insert fail, and `createAuditLog` swallows that failure in a catch block — so
the **entire service audit trail would have been silently absent** while every
request still returned success. This was caught by a test asserting on real audit
rows, not by review, and it is the reason §7 requires the CRM to verify audit
rows exist rather than assume them.

**Redaction** is applied on the way into the audit log, not left to each call
site: any field whose name matches
`secret|password|token|authorization|credential|apikey|signature|sig|keyHash|accessKey|privateKey`
is replaced with `[redacted]` at any depth. Signed URLs are logged only with
`sig=[redacted]`. No backend filesystem path appears in any audit row or response.

---

## 7. Reliability semantics the CRM must implement

The provider guarantees these; the consumer must honour its side.

| Situation | Provider behaviour | Required CRM behaviour |
|---|---|---|
| Retry after a network timeout | A replayed `Idempotency-Key` returns the first result, no second write | **Always send `Idempotency-Key` on upload**, derived from the provider message id or attachment id — never from `Date.now()` or a random value, which defeats deduplication |
| `429` | `Retry-After` in seconds | Back off exponentially and honour `Retry-After`; do not retry immediately |
| `503 STORAGE_UNAVAILABLE` | The write did **not** happen and is not recorded as successful | Queue and retry. **Never** mark the document stored. Check §5.7 health first to avoid queueing into a known outage |
| `409 POOL_NOT_PROVISIONED` | Honest refusal | Surface to an operator. This is a configuration fault, not a transient one — do not retry in a loop |
| `422 CHECKSUM_MISMATCH` | Nothing stored | Do not retry the same bytes. Re-read the source attachment; the bytes in transit were corrupted |
| `413 QUOTA_EXCEEDED` | Nothing stored | Read `details` for the real numbers and alert; do not retry |
| `410` on a signed URL | Expired | Request a fresh URL via §5.3. Do not treat as a permission failure |
| `403 CREDENTIAL_REVOKED` | Credential revoked | Stop, alert an operator. Do not retry |
| Duplicate webhook | n/a — the CRM's own `webhook-idempotency.ts` already handles this | Keep deriving event ids from the provider payload, as the CRM already does |

**A provider outage must not lose an inbound attachment the CRM already accepted.**
Queue with the idempotency key preserved so the eventual retry is a no-op if the
first attempt actually landed.

---

## 8. CRM-side adapter specification

This is the work remaining, for a session bound to
`tech360-bd/ALO_WEB_CRM_TECH`.

### 8.1 Placement

New module, additive — do not modify the existing local storage:

```
src/lib/integrations/hosting-vault/
  client.ts          # HTTP client: auth, correlation, retry, envelope parsing
  config.ts          # base URL + secret from env; no hardcoded values
  types.ts           # contract types mirroring §4–§5
  errors.ts          # error codes → CRM-side handling decisions
src/lib/integrations/hosting-vault/__tests__/
```

`src/lib/storage-service.ts` and `src/lib/storage/private-file-store.ts` stay as
they are. The vault adapter is a **new destination**, selected by policy, not a
replacement.

### 8.2 Configuration

| Variable | Purpose |
|---|---|
| `ALO_HOSTING_VAULT_URL` | Hosting-Portal base URL |
| `ALO_HOSTING_VAULT_SECRET` | the `alosvc_…` credential |
| `ALO_HOSTING_VAULT_ENABLED` | feature flag; **default false** |
| `ALO_HOSTING_VAULT_TIMEOUT_MS` | request timeout, suggested 30000 |

The secret must come from the CRM's secure server-side secret store, **not** an
ordinary database column and never committed. Add all four to `.env.example` with
placeholder values only.

### 8.3 Client contract

```ts
export interface HostingVaultClient {
  uploadDocument(input: {
    poolKey: string; category: string; filename: string;
    contentType: string; bytes: Buffer;
    /** REQUIRED in practice: provider message id or attachment id. */
    idempotencyKey: string;
    /** The CRM's Student ID, e.g. AE-20260001 — recorded in the vault audit trail. */
    externalReference?: string;
  }): Promise<UploadResult>;

  getDocument(id: string): Promise<DocumentMetadata>;
  createDownloadUrl(id: string): Promise<{ url: string; expiresAt: string }>;
  download(id: string): Promise<{ bytes: Buffer; metadata: DocumentMetadata }>;
  getQuota(poolKey?: string): Promise<PoolQuota[]>;
  getHealth(): Promise<StorageHealth>;
  getBackupStatus(): Promise<BackupStatus>;
}
```

Implementation requirements:

- Send `Authorization: Bearer`, `X-Request-Id` (use the CRM's existing
  correlation id if one is in scope), and `X-ALO-Contract-Version: 1.0`.
- Always compute and send `X-Content-SHA256`.
- Always send `Idempotency-Key` on upload.
- Retry **only** on network errors, `429` (honouring `Retry-After`) and `503`,
  with exponential backoff and a bounded attempt count. Never retry `4xx` other
  than `429`.
- Parse the envelope; on `success: false` throw a typed error carrying `code`,
  `status` and `details`.
- **Never log the secret, and never log a signed URL.** Redact `sig` if a URL must
  appear in a log line.
- Read `sizeBytes`, `quotaBytes`, `usedByOrganizationBytes`,
  `quotaRemainingBytes` and `poolTotalBytes` as **strings** and convert with
  `BigInt`, not `Number` — they are BigInt-serialized and can exceed
  `Number.MAX_SAFE_INTEGER`.

### 8.4 Wiring point

The attachment path in `src/lib/whatsapp-webhook-handler.ts` — which already
extracts `mediaId`, `mime_type` and `sha256` from the provider payload — is where
a document should be forwarded to the vault after it is retrieved through the
provider media API. Note that the provider already supplies a `sha256` for
WhatsApp media: pass it straight through as `X-Content-SHA256`, which gives
end-to-end integrity from Meta's edge to Hosting-Portal's disk.

Gate it behind `ALO_HOSTING_VAULT_ENABLED`, and on any vault failure **keep the
existing behaviour intact** — a vault outage must not break message ingestion.
This also satisfies the brief's requirement that an unavailable storage service
must not cause the CRM to falsely report a successful upload.

### 8.5 CRM-side tests required

Mirror the provider's conformance suite, using a mock transport (never a mock
that silently succeeds):

1. Valid credential → upload succeeds and returns a document id.
2. Missing / malformed / revoked / expired credential → surfaced as an auth error, not a crash.
3. Upload retries with the same `Idempotency-Key` → one document, second call returns the first result.
4. `422 CHECKSUM_MISMATCH` → CRM does not mark the document stored, and does not retry the same bytes.
5. `503 STORAGE_UNAVAILABLE` → CRM queues, does not report success.
6. `413 QUOTA_EXCEEDED` → CRM surfaces the real numbers from `details`.
7. `409 POOL_NOT_PROVISIONED` → CRM alerts an operator rather than retry-looping.
8. Signed URL is redeemed within TTL and refused after it; `410` triggers a fresh URL request.
9. Cross-tenant `404` is treated as not-found, not as a retryable error.
10. The adapter never logs the secret or a `sig` value.
11. With `ALO_HOSTING_VAULT_ENABLED=false`, message ingestion is byte-for-byte unchanged.
12. A vault outage does not prevent inbound message storage or Student ID processing.

---

## 9. Provider-side conformance evidence

Already implemented and passing — this is what the CRM codes against.

| Suite | Tests | Scope |
|---|---|---|
| `tests/crm-service-auth.test.ts` | **47** | pure authorization, scope parsing, key handling, signed-URL minting and tampering, expiry, idempotency-key normalization, correlation ids, redaction |
| `tests/crm-storage-integration.test.ts` | **33** | database-backed: credential provisioning and revocation, real writes to disk, replay idempotency, cross-tenant idempotency-key refusal, version increment, checksum mismatch storing nothing, real quota aggregates, pool/category validation, path traversal, cross-tenant `404`, signed URL round-trip, revocation stopping an outstanding URL, unwritable backend → `503`, health probe, backup honesty, audit rows and redaction |

Mapping to the 12 required conformance scenarios:

| # | Required scenario | Where covered |
|---|---|---|
| 1 | Valid CRM service authentication | `crm-service-auth` ✓ + `crm-storage-integration` credential provisioning ✓ |
| 2 | Invalid or revoked credentials | 8 auth cases (missing, wrong scheme, short, unknown, wrong secret, revoked, inactive, expired) ✓ |
| 3 | Cross-tenant access denial | `NO_ORGANIZATION` ✓, `canAccessOrganizationDocument` ✓, tenant B gets `404` ✓ |
| 4 | Unauthorized document download | cross-tenant `404` ✓, no-organization document unreadable ✓, tampered signature ✓ |
| 5 | Duplicate upload idempotency | replay returns first result, no second write, one row on disk ✓; cross-tenant key refusal ✓ |
| 6 | Upload hash mismatch | `422`, nothing stored, no file written, audited as FAILURE ✓ |
| 7 | Storage quota exceeded | `413` from real aggregate sums, real numbers in `details` ✓ |
| 8 | Expired signed URL | `EXPIRED` ✓, TTL cap ✓, expiry-tampering → `BAD_SIGNATURE` ✓, `410` distinct from `403` ✓ |
| 9 | Invalid storage pool | unknown pool ✓, wrong category for pool ✓, unprovisioned pool ✓, empty file ✓, disallowed MIME ✓ |
| 10 | Storage service unavailable | unwritable backend → `503`, no document row, audited FAILURE ✓, health probe reports `unavailable` ✓ |
| 11 | Backup status reporting | observable state only, `restoreVerified: false` asserted ✓ |
| 12 | Audit logging and secret redaction | real audit rows, `actorRole: SERVICE`, no secret, no `sig`, no filesystem path ✓ |

**Gate at commit `7cf8516`:** `npm test` → **676 passed / 43 files** (from
596 / 41); `npm run lint` clean; `npm run typecheck` clean; `npm run build`
compiled successfully with all 8 endpoints present in the route manifest;
`npm ci` reported **0 vulnerabilities**. The additive migration was validated with
the repository's own `scripts/apply-deploy-schema.mjs` against a disposable copy
(9 statements applied, 0 problems) and confirmed re-runnable.

---

## 10. Deployment prerequisites

Nothing here works until these are true. **None of them has been done.**

1. **Apply the additive migration** on the production database:
   ```
   DATABASE_URL="file:/var/lib/alo-hosting/alo.db" node scripts/apply-deploy-schema.mjs
   ```
   It creates `service_credentials` and `service_operation_records` with
   `IF NOT EXISTS`, alters no existing table and touches no row. Until it runs,
   every `/api/internal/crm/*` call fails — and the routes fail closed rather
   than silently succeeding.
2. **Set `CRM_INTEGRATION_SIGNING_KEY`** (≥32 chars) in `/etc/alo-hosting/panel.env`.
   Optional: without it, `APP_ENCRYPTION_KEY` is used. If neither is strong
   enough, signed URLs return `503` instead of minting — uploads, metadata,
   quota, health and backup all still work, and the CRM can use the §5.5 proxy
   download instead.
3. **Provision the CRM's credential** on Hosting-Portal, bound to the correct
   organization, with the least-privilege scopes from §3. Hand the secret to the
   CRM operator through a secure channel; it is shown once.
4. **Provision the storage pools.** In the development database all six pools
   exist with `bucketPath = null`, which means every upload is honestly refused
   with `409 POOL_NOT_PROVISIONED`. An administrator must set a real backend path
   for `STUDENT_STORAGE` (and any other pool the CRM will use) before uploads can
   succeed. This is pre-existing behaviour, not something this integration
   introduced.
5. **Deploy Hosting-Portal** through its normal pipeline, and only then set
   `ALO_HOSTING_VAULT_ENABLED=true` in the CRM.

### Verified-in-production status

**None.** This contract is implemented, unit-tested, integration-tested and
built, but it has not been deployed, no credential has been provisioned, no CRM
code calls it, and no document has crossed the boundary. Per the standing rule
that a merged PR is not proof of a successful production deployment, this section
must be updated with real evidence after the first production exchange — not
before.

---

## 11. Explicitly out of scope

Not provided by this contract, and the CRM must not assume them:

- No directory listing, arbitrary path access, or filesystem browsing of any kind.
- No privileged infrastructure command execution. The CRM cannot run a helper,
  restart a service, or reach a host.
- No document deletion. Retention and legal deletion (brief §12) are a separate
  policy surface and were deliberately not exposed to a machine caller: an
  integration that can delete official student documents is an integration whose
  leaked credential can destroy them.
- No document verification status transitions. Per brief §10.3, AI and machine
  callers must not mark a passport, academic certificate or financial document as
  officially verified; that stays with authorized staff in the CRM's own
  workflow.
- No credential self-service. A service credential cannot create or revoke
  another (§2).
- No bulk or batch upload. One document per request, which is what makes the
  idempotency key meaningful.
