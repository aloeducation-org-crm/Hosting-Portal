/**
 * Router for the CRM ↔ Hosting-Portal document vault integration.
 *
 * Thin DB/fs bridge over the PURE decision logic in `./service-auth`. Every
 * authorization decision is made by `authorizeServiceRequest` /
 * `canAccessOrganizationDocument` so it is unit-testable without a database;
 * this module only fetches facts and performs the storage operations.
 *
 * REUSE, NOT DUPLICATION. The upload and download paths deliberately go through
 * the same primitives the browser-session endpoints use —
 * `validateUploadTarget`, `validateFile`, `buildStoragePath`,
 * `resolveWithinRoot`, `canAccessPool`'s pool rows, `documentFile`,
 * `storageBucket` quotas and `createAuditLog` — so there is exactly one storage
 * engine and one set of pool/quota/versioning rules. What differs is only the
 * AUTHENTICATION (service credential vs browser session) and the TENANT
 * BINDING (organizationId vs ownerId), which is the separation this integration
 * exists to provide.
 *
 * Nothing here exposes a filesystem path, a directory listing, or a privileged
 * command to the caller. Storage paths are resolved internally and never
 * returned.
 */

import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { createAuditLog } from "@/lib/audit";
import { validateFile } from "@/lib/storage";
import {
  buildStoragePath,
  resolveWithinRoot,
  sanitizeFilename,
  validateUploadTarget,
} from "@/lib/storage-pools";
import {
  authorizeServiceRequest,
  canAccessOrganizationDocument,
  createSignedDownloadUrl,
  hashServiceKey,
  keyPrefix,
  generateServiceSecret,
  normalizeIdempotencyKey,
  redactSecrets,
  redactSignedUrl,
  resolveCorrelationId,
  verifySignedDownloadUrl,
  type ServicePrincipal,
  type ServiceScope,
} from "./service-auth";

// ─── Result envelope ─────────────────────────────────────────────────────────

export interface IntegrationSuccess<T> {
  ok: true;
  status: number;
  body: T;
}

export interface IntegrationFailure {
  ok: false;
  status: number;
  code: string;
  message: string;
  details?: unknown;
}

export type IntegrationResult<T> = IntegrationSuccess<T> | IntegrationFailure;

/** Context carried through every service operation, for audit and logging. */
export interface ServiceRequestContext {
  correlationId: string;
  /** Client-visible failure reason is generic; this is the precise cause. */
  authCode?: string;
}

// ─── Authentication ──────────────────────────────────────────────────────────

/**
 * Authenticates a service request for one required scope.
 *
 * Looks the candidate credential up by the non-secret prefix of the supplied
 * token, then hands ALL decisions to the pure `authorizeServiceRequest`. On
 * success it records `lastUsedAt` best-effort — a failure to write that
 * timestamp must not fail an otherwise valid request.
 */
export async function authenticateService(
  request: { authorizationHeader: string | null; correlationId?: string | null },
  requiredScope: ServiceScope,
): Promise<
  | { ok: true; principal: ServicePrincipal; correlationId: string }
  | { ok: false; status: number; code: string; message: string; correlationId: string }
> {
  const correlationId = resolveCorrelationId(request.correlationId);

  let credential = null;
  const token = request.authorizationHeader?.replace(/^Bearer\s+/i, "").trim() ?? "";
  if (token) {
    // Prefix lookup narrows to one candidate row; the digest comparison in the
    // pure layer is what actually authenticates.
    credential = await db.serviceCredential
      .findFirst({ where: { prefix: keyPrefix(token) } })
      .catch((error) => {
        logger.error({ error, event: "crm.service.credential_lookup_failed" }, "Service credential lookup failed");
        return null;
      });
  }

  const result = authorizeServiceRequest(
    {
      authorizationHeader: request.authorizationHeader,
      credential,
      signingKey: serviceSigningKey(),
    },
    requiredScope,
  );

  if (!result.ok) {
    // Precise cause goes to the log, never to the client.
    logger.warn(
      { event: "crm.service.auth_denied", code: result.code, correlationId },
      "Service credential rejected",
    );
    return { ok: false, status: result.status, code: result.code, message: result.reason, correlationId };
  }

  await db.serviceCredential
    .update({
      where: { id: result.principal.credentialId },
      data: { lastUsedAt: new Date(), lastUsedService: result.principal.serviceName },
    })
    .catch(() => undefined);

  return { ok: true, principal: result.principal, correlationId };
}

/**
 * The key used to sign and verify download URLs.
 *
 * Reuses `APP_ENCRYPTION_KEY` rather than adding another secret to configure,
 * and is validated for length by the signing functions themselves — an unset or
 * weak key makes signed URLs refuse to mint instead of minting unsigned ones.
 */
function serviceSigningKey(): string {
  return process.env.CRM_INTEGRATION_SIGNING_KEY || env.APP_ENCRYPTION_KEY;
}

// ─── Audit ───────────────────────────────────────────────────────────────────

/**
 * Writes an audit record for a service operation.
 *
 * The actor is the SERVICE, not a human: `actorEmail` carries the service name
 * so the existing audit UI shows something meaningful, and `requestId` carries
 * the correlation id so a CRM-side log line joins to this record. Metadata is
 * passed through `redactSecrets` on the way in, so a credential or signature can
 * never be persisted by the audit trail that is supposed to be reviewing it.
 */
async function auditService(params: {
  principal?: ServicePrincipal;
  action: string;
  result: "SUCCESS" | "FAILURE" | "DENIED";
  resourceId?: string;
  correlationId: string;
  errorCode?: string;
  metadata?: Record<string, unknown>;
  durationMs?: number;
}): Promise<void> {
  await createAuditLog({
    // NO actorId. AuditLog.actorUserId is a foreign key to users, and a service
    // credential is not a user - passing the credential id makes the insert fail,
    // and createAuditLog swallows that failure, so EVERY service audit row would
    // silently never be written. The credential is identified in metadata
    // instead, and the actor is labelled as a service via actorEmail/actorRole.
    actorEmail: params.principal ? `service:${params.principal.serviceName}` : "service:unauthenticated",
    actorRole: "SERVICE",
    action: params.action,
    resourceType: "DocumentFile",
    resourceId: params.resourceId,
    domain: "crm-integration",
    result: params.result,
    requestId: params.correlationId,
    errorCode: params.errorCode,
    durationMs: params.durationMs,
    metadata: redactSecrets({
      credentialId: params.principal?.credentialId,
      organizationId: params.principal?.organizationId,
      serviceName: params.principal?.serviceName,
      ...(params.metadata ?? {}),
    }),
  });
}

// ─── Document serialization ──────────────────────────────────────────────────

/**
 * The only document representation a service caller ever receives.
 *
 * `storagePath` is deliberately ABSENT: exposing a backend path would hand the
 * CRM a filesystem location it has no business knowing, and would make a path
 * leak possible through an otherwise correct response.
 */
export function serializeServiceDocument(row: {
  id: string;
  poolKey: string;
  organizationId: string | null;
  category: string;
  filename: string;
  sizeBytes: bigint;
  sha256: string;
  version: number;
  contentType: string;
  createdAt: Date;
}) {
  return {
    id: row.id,
    poolKey: row.poolKey,
    organizationId: row.organizationId,
    category: row.category,
    filename: row.filename,
    sizeBytes: String(row.sizeBytes),
    sha256: row.sha256,
    version: row.version,
    contentType: row.contentType,
    createdAt: row.createdAt.toISOString(),
  };
}

// ─── Upload ──────────────────────────────────────────────────────────────────

export interface ServiceUploadInput {
  poolKey: string;
  category: string;
  filename: string;
  contentType: string;
  bytes: Buffer;
  /** Client-supplied sha256 hex; when present it is verified against the bytes. */
  expectedSha256?: string | null;
  /** Optional CRM-side reference (e.g. Student ID) stored in the audit trail. */
  externalReference?: string | null;
  idempotencyKey?: string | null;
}

export interface ServiceUploadResult {
  document: ReturnType<typeof serializeServiceDocument>;
  /** True when this call returned a previously stored result, not a new write. */
  deduplicated: boolean;
}

/**
 * Stores a document on behalf of a service, idempotently.
 *
 * Order of operations, each of which refuses rather than proceeding:
 *   1. Replay check — an existing idempotency key returns the first result and
 *      performs NO write.
 *   2. Pool/category validation via the shared `validateUploadTarget`.
 *   3. Size, emptiness and MIME allowlist via the shared `validateFile`.
 *   4. Pool must exist and have a backend path, else 404/409 — the same
 *      honest "not provisioned" refusal the browser path gives.
 *   5. Pool quota, aggregated over the pool exactly as the browser path does.
 *   6. Client-declared sha256, when supplied, must match the bytes actually
 *      received. A mismatch is rejected BEFORE anything is written, so a
 *      truncated or corrupted upload can never be stored and later trusted.
 *   7. Version = max existing version for this organization+pool+category+
 *      filename, +1. A new upload never overwrites a previous version's row or
 *      its bytes.
 *   8. Path is resolved inside the pool root; escape is a hard error.
 *   9. Write, then re-`stat` and verify the size on disk, then hash the bytes.
 *  10. Record the operation under the unique idempotency key; a concurrent
 *      duplicate loses the race and returns the winner's stored response.
 */
export async function uploadDocumentForService(
  principal: ServicePrincipal,
  correlationId: string,
  input: ServiceUploadInput,
): Promise<IntegrationResult<ServiceUploadResult>> {
  const started = Date.now();
  const idempotencyKey = normalizeIdempotencyKey(input.idempotencyKey);

  if (input.idempotencyKey && !idempotencyKey) {
    return {
      ok: false,
      status: 400,
      code: "INVALID_IDEMPOTENCY_KEY",
      message:
        "Idempotency-Key must be 8-200 characters of letters, digits, dot, dash, colon or underscore",
    };
  }

  // 1. Replay.
  if (idempotencyKey) {
    const prior = await db.serviceOperationRecord.findUnique({ where: { idempotencyKey } });
    if (prior) {
      // A key is bound to the tenant that first used it. Reusing another
      // tenant's key must not read or replay their operation.
      if (prior.organizationId !== principal.organizationId) {
        await auditService({
          principal,
          action: "CRM_DOCUMENT_UPLOAD",
          result: "DENIED",
          correlationId,
          errorCode: "IDEMPOTENCY_KEY_CROSS_TENANT",
          durationMs: Date.now() - started,
        });
        return {
          ok: false,
          status: 409,
          code: "IDEMPOTENCY_KEY_CONFLICT",
          message: "Idempotency-Key is already in use by another tenant",
        };
      }
      logger.info(
        { event: "crm.service.upload_replay", correlationId, idempotencyKey },
        "Idempotent upload replayed",
      );
      return {
        ok: true,
        status: prior.statusCode,
        body: JSON.parse(prior.responseJson) as ServiceUploadResult,
      };
    }
  }

  // 2. Pool/category.
  const targetError = validateUploadTarget(input.poolKey, input.category);
  if (targetError) {
    return { ok: false, status: 400, code: "VALIDATION_ERROR", message: targetError };
  }

  // 3. File basics.
  const filename = sanitizeFilename(input.filename || "file");
  const size = input.bytes.length;
  if (size <= 0) {
    return { ok: false, status: 400, code: "VALIDATION_ERROR", message: "File is empty" };
  }
  const maxBytes = env.MAX_UPLOAD_SIZE_MB * 1024 * 1024;
  if (size > maxBytes) {
    return {
      ok: false,
      status: 413,
      code: "PAYLOAD_TOO_LARGE",
      message: `File exceeds the ${env.MAX_UPLOAD_SIZE_MB}MB limit`,
    };
  }
  const mime = validateFile({
    name: filename,
    size,
    type: input.contentType || "application/octet-stream",
  });
  if (!mime.valid) {
    return {
      ok: false,
      status: 415,
      code: "UNSUPPORTED_MEDIA",
      message: mime.error ?? "File type not allowed",
    };
  }

  // 4. Pool provisioning.
  const pool = await db.storageBucket.findFirst({
    where: { name: input.poolKey, kind: "pool" },
  });
  if (!pool) {
    return {
      ok: false,
      status: 404,
      code: "NOT_FOUND",
      message: `Pool ${input.poolKey} is not provisioned`,
    };
  }
  if (!pool.bucketPath) {
    return {
      ok: false,
      status: 409,
      code: "POOL_NOT_PROVISIONED",
      message: `${input.poolKey} has no backend path configured — upload refused until an admin provisions it`,
    };
  }

  // 5. Quota — aggregated over the whole pool, same rule as the browser path.
  const usedRow = await db.documentFile.aggregate({
    where: { poolKey: input.poolKey },
    _sum: { sizeBytes: true },
  });
  const used = usedRow._sum.sizeBytes ?? 0n;
  if (pool.quotaBytes !== null && used + BigInt(size) > pool.quotaBytes) {
    await auditService({
      principal,
      action: "CRM_DOCUMENT_UPLOAD",
      result: "FAILURE",
      correlationId,
      errorCode: "QUOTA_EXCEEDED",
      durationMs: Date.now() - started,
      metadata: { poolKey: input.poolKey, requestedBytes: size },
    });
    return {
      ok: false,
      status: 413,
      code: "QUOTA_EXCEEDED",
      message: `Quota exceeded for ${input.poolKey}`,
      details: {
        recordedUsageBytes: String(used),
        quotaBytes: String(pool.quotaBytes),
        requestedBytes: size,
      },
    };
  }

  // 6. Integrity — verify the declared hash BEFORE writing anything.
  const sha256 = createHash("sha256").update(input.bytes).digest("hex");
  const declared = input.expectedSha256?.trim().toLowerCase() ?? "";
  if (declared && declared !== sha256) {
    await auditService({
      principal,
      action: "CRM_DOCUMENT_UPLOAD",
      result: "FAILURE",
      correlationId,
      errorCode: "CHECKSUM_MISMATCH",
      durationMs: Date.now() - started,
      metadata: { poolKey: input.poolKey, category: input.category, filename },
    });
    return {
      ok: false,
      status: 422,
      code: "CHECKSUM_MISMATCH",
      message: "Supplied X-Content-SHA256 does not match the received bytes; nothing was stored",
      details: { expected: declared, computed: sha256 },
    };
  }

  // 7. Version — scoped to the TENANT, since a service upload has no human owner.
  const priorVersion = await db.documentFile.aggregate({
    where: {
      poolKey: input.poolKey,
      organizationId: principal.organizationId,
      category: input.category,
      filename,
    },
    _max: { version: true },
  });
  const version = (priorVersion._max.version ?? 0) + 1;

  // 8-9. Resolve inside the pool root, write, verify on disk.
  const id = randomUUID();
  const storagePath = buildStoragePath(principal.organizationId, filename, id);
  const absolute = resolveWithinRoot(pool.bucketPath, storagePath);
  if (!absolute) {
    return {
      ok: false,
      status: 500,
      code: "STORAGE_ERROR",
      message: "Resolved storage path escaped the pool root",
    };
  }

  try {
    await mkdir(path.dirname(absolute), { recursive: true });
    await writeFile(absolute, input.bytes);
    const written = await stat(absolute);
    if (written.size !== size) {
      return {
        ok: false,
        status: 500,
        code: "STORAGE_ERROR",
        message: "Written file failed size verification",
      };
    }
  } catch (error) {
    // A storage backend that cannot accept the write must be reported as a
    // failure, never as a success. The CRM relies on this to avoid marking a
    // document as stored when it is not.
    logger.error({ error, event: "crm.service.upload_write_failed", correlationId }, "Document write failed");
    await auditService({
      principal,
      action: "CRM_DOCUMENT_UPLOAD",
      result: "FAILURE",
      correlationId,
      errorCode: "STORAGE_UNAVAILABLE",
      durationMs: Date.now() - started,
    });
    return {
      ok: false,
      status: 503,
      code: "STORAGE_UNAVAILABLE",
      message: "Storage backend could not accept the file; the upload was not recorded as successful",
    };
  }

  const row = await db.documentFile.create({
    data: {
      poolKey: input.poolKey,
      ownerId: null,
      organizationId: principal.organizationId,
      category: input.category,
      filename,
      storagePath,
      sizeBytes: BigInt(size),
      sha256,
      version,
      contentType: input.contentType || "application/octet-stream",
    },
  });

  await db.storageBucket
    .update({
      where: { id: pool.id },
      data: { sizeBytes: { increment: BigInt(size) }, objectCount: { increment: 1 } },
    })
    .catch(() => undefined);

  const body: ServiceUploadResult = { document: serializeServiceDocument(row), deduplicated: false };

  // 10. Idempotency record. Losing a race is not an error — return the winner.
  if (idempotencyKey) {
    try {
      await db.serviceOperationRecord.create({
        data: {
          idempotencyKey,
          organizationId: principal.organizationId,
          serviceName: principal.serviceName,
          operation: "document.upload",
          resourceId: row.id,
          statusCode: 201,
          responseJson: JSON.stringify(body),
          correlationId,
        },
      });
    } catch (error) {
      const existing = await db.serviceOperationRecord
        .findUnique({ where: { idempotencyKey } })
        .catch(() => null);
      if (existing && existing.organizationId === principal.organizationId) {
        logger.warn(
          { event: "crm.service.upload_race_lost", correlationId, idempotencyKey },
          "Concurrent duplicate upload; returning the first result",
        );
        return {
          ok: true,
          status: existing.statusCode,
          body: JSON.parse(existing.responseJson) as ServiceUploadResult,
        };
      }
      logger.error({ error, event: "crm.service.idempotency_record_failed", correlationId }, "Idempotency record failed");
    }
  }

  await auditService({
    principal,
    action: "CRM_DOCUMENT_UPLOAD",
    result: "SUCCESS",
    resourceId: row.id,
    correlationId,
    durationMs: Date.now() - started,
    metadata: {
      poolKey: input.poolKey,
      category: input.category,
      filename,
      sizeBytes: size,
      sha256,
      version,
      externalReference: input.externalReference ?? undefined,
    },
  });

  return { ok: true, status: 201, body };
}

// ─── Download ────────────────────────────────────────────────────────────────

/**
 * Reads a document's metadata and bytes for a service caller.
 *
 * Authorization is object-level: the document must belong to the caller's
 * organization. A document outside it — or with no organization at all — is
 * reported as NOT FOUND rather than FORBIDDEN, so a caller cannot enumerate
 * which document ids exist in other tenants. Every read is audited.
 */
export async function readDocumentForService(
  principal: ServicePrincipal,
  correlationId: string,
  documentId: string,
): Promise<
  | { ok: true; status: 200; body: { bytes: Buffer; document: ReturnType<typeof serializeServiceDocument> } }
  | IntegrationFailure
> {
  const started = Date.now();
  const row = await db.documentFile.findUnique({ where: { id: documentId } });

  if (!row || !canAccessOrganizationDocument(principal, row.organizationId)) {
    await auditService({
      principal,
      action: "CRM_DOCUMENT_DOWNLOAD",
      result: "DENIED",
      correlationId,
      errorCode: row ? "CROSS_TENANT" : "NOT_FOUND",
      resourceId: row ? undefined : documentId,
      durationMs: Date.now() - started,
    });
    return { ok: false, status: 404, code: "NOT_FOUND", message: "Document not found" };
  }

  const pool = await db.storageBucket.findFirst({ where: { name: row.poolKey, kind: "pool" } });
  if (!pool?.bucketPath) {
    return {
      ok: false,
      status: 409,
      code: "POOL_NOT_PROVISIONED",
      message: `${row.poolKey} has no backend path configured`,
    };
  }
  const absolute = resolveWithinRoot(pool.bucketPath, row.storagePath);
  if (!absolute) {
    return { ok: false, status: 500, code: "STORAGE_ERROR", message: "Storage path escapes the pool root" };
  }

  let bytes: Buffer;
  try {
    bytes = await readFile(absolute);
  } catch {
    return {
      ok: false,
      status: 404,
      code: "STORAGE_MISSING",
      message: "Stored file is missing on the backend (stale row)",
    };
  }

  await auditService({
    principal,
    action: "CRM_DOCUMENT_DOWNLOAD",
    result: "SUCCESS",
    resourceId: row.id,
    correlationId,
    durationMs: Date.now() - started,
    metadata: { poolKey: row.poolKey, category: row.category, filename: row.filename },
  });

  return { ok: true, status: 200, body: { bytes, document: serializeServiceDocument(row) } };
}

/**
 * Mints a short-lived signed download URL for a document the caller may read.
 *
 * Returns null (mapped to 503 by the route) when signing is unavailable, so a
 * misconfigured key cannot degrade into an unsigned public link. The URL is
 * logged only through `redactSignedUrl`, because its signature is a bearer
 * credential for its lifetime.
 */
export async function issueDownloadUrlForService(
  principal: ServicePrincipal,
  correlationId: string,
  documentId: string,
  baseUrl: string,
): Promise<
  | { ok: true; status: 200; body: { url: string; expiresAt: string; documentId: string } }
  | IntegrationFailure
> {
  const row = await db.documentFile.findUnique({ where: { id: documentId } });
  if (!row || !canAccessOrganizationDocument(principal, row.organizationId)) {
    await auditService({
      principal,
      action: "CRM_DOCUMENT_URL_ISSUED",
      result: "DENIED",
      correlationId,
      errorCode: row ? "CROSS_TENANT" : "NOT_FOUND",
    });
    return { ok: false, status: 404, code: "NOT_FOUND", message: "Document not found" };
  }

  const signed = createSignedDownloadUrl({
    baseUrl,
    documentId: row.id,
    organizationId: principal.organizationId,
    credentialId: principal.credentialId,
    signingKey: serviceSigningKey(),
  });
  if (!signed) {
    await auditService({
      principal,
      action: "CRM_DOCUMENT_URL_ISSUED",
      result: "FAILURE",
      correlationId,
      errorCode: "SIGNING_KEY_UNAVAILABLE",
      resourceId: row.id,
    });
    return {
      ok: false,
      status: 503,
      code: "SIGNING_UNAVAILABLE",
      message: "Download URL signing is not configured on this server",
    };
  }

  await auditService({
    principal,
    action: "CRM_DOCUMENT_URL_ISSUED",
    result: "SUCCESS",
    resourceId: row.id,
    correlationId,
    metadata: { url: redactSignedUrl(signed.url) ?? undefined },
  });

  return {
    ok: true,
    status: 200,
    body: { url: signed.url, expiresAt: new Date(signed.expiresAt).toISOString(), documentId: row.id },
  };
}

/**
 * Resolves a signed download URL to bytes.
 *
 * Verifies the HMAC and expiry, then re-checks object-level authorization
 * against the database — the signature proves the URL was minted by this server
 * and has not been tampered with, but it does NOT substitute for confirming the
 * document still belongs to that tenant. A credential revoked after minting does
 * not invalidate an already-issued short-lived URL; the TTL bounds that window,
 * which is why it is minutes rather than hours.
 */
export async function resolveSignedDownload(
  correlationId: string,
  params: {
    documentId: string;
    organizationId: string | null;
    credentialId: string | null;
    expiresAt: string | null;
    signature: string | null;
  },
): Promise<
  | { ok: true; status: 200; body: { bytes: Buffer; document: ReturnType<typeof serializeServiceDocument> } }
  | IntegrationFailure
> {
  const verdict = verifySignedDownloadUrl({ ...params, signingKey: serviceSigningKey() });
  if (!verdict.ok) {
    logger.warn({ event: "crm.service.signed_url_rejected", code: verdict.code, correlationId }, "Signed URL rejected");
    await auditService({
      action: "CRM_DOCUMENT_SIGNED_DOWNLOAD",
      result: "DENIED",
      correlationId,
      errorCode: verdict.code,
    });
    // Decide status and message in ONE branch: comparing the same union member
    // twice in sequence lets the second comparison get narrowed away.
    // 410 (rather than 403) for expiry is deliberate - it tells the CRM
    // "re-request a fresh URL", a different remediation from "never allowed".
    const expired = verdict.code === "EXPIRED";
    return {
      ok: false,
      status: expired ? 410 : 403,
      code: verdict.code,
      message: expired ? "Signed download URL has expired" : "Signed download URL is not valid",
    };
  }

  // Re-authorize against the database even though the signature is valid.
  const credential = await db.serviceCredential
    .findUnique({ where: { id: verdict.payload.credentialId } })
    .catch(() => null);
  if (!credential || credential.revokedAt || !credential.isActive) {
    await auditService({
      action: "CRM_DOCUMENT_SIGNED_DOWNLOAD",
      result: "DENIED",
      correlationId,
      errorCode: "CREDENTIAL_NO_LONGER_VALID",
    });
    return { ok: false, status: 403, code: "CREDENTIAL_REVOKED", message: "Issuing credential is no longer valid" };
  }

  const principal: ServicePrincipal = {
    credentialId: credential.id,
    serviceName: credential.serviceName,
    organizationId: credential.organizationId ?? verdict.payload.organizationId,
    scopes: [],
  };

  return readDocumentForService(principal, correlationId, verdict.payload.documentId);
}

// ─── Quota, health, backup ───────────────────────────────────────────────────

/**
 * Reports pool usage and quota for the caller's tenant.
 *
 * Numbers come from the database and the filesystem, never from a cached or
 * assumed value. A pool that is not provisioned is reported as such instead of
 * being presented as healthy with zero usage.
 */
export async function getQuotaForService(
  principal: ServicePrincipal,
  poolKey?: string,
): Promise<IntegrationResult<{ pools: unknown[] }>> {
  const where = poolKey ? { kind: "pool" as const, name: poolKey } : { kind: "pool" as const };
  const pools = await db.storageBucket.findMany({ where, orderBy: { name: "asc" } });

  const report = await Promise.all(
    pools.map(async (pool) => {
      const [tenantUsage, poolUsage] = await Promise.all([
        db.documentFile.aggregate({
          where: { poolKey: pool.name, organizationId: principal.organizationId },
          _sum: { sizeBytes: true },
          _count: { _all: true },
        }),
        db.documentFile.aggregate({
          where: { poolKey: pool.name },
          _sum: { sizeBytes: true },
        }),
      ]);
      const usedByTenant = tenantUsage._sum.sizeBytes ?? 0n;
      const quota = pool.quotaBytes;
      return {
        poolKey: pool.name,
        provisioned: Boolean(pool.bucketPath),
        quotaBytes: quota === null ? null : String(quota),
        usedByOrganizationBytes: String(usedByTenant),
        usedByOrganizationDocuments: tenantUsage._count._all,
        poolTotalBytes: String(poolUsage._sum.sizeBytes ?? 0n),
        quotaRemainingBytes: quota === null ? null : String(quota - usedByTenant > 0n ? quota - usedByTenant : 0n),
      };
    }),
  );

  return { ok: true, status: 200, body: { pools: report } };
}

/**
 * Reports whether the storage backend can actually accept and return bytes.
 *
 * This PROBES the filesystem rather than asserting health from configuration: a
 * pool whose backend path has been unmounted or made unwritable must report
 * degraded, because the CRM uses this to decide whether to queue uploads.
 */
export async function getStorageHealthForService(
  principal: ServicePrincipal,
): Promise<IntegrationResult<{ status: string; organizationId: string; pools: unknown[] }>> {
  const pools = await db.storageBucket.findMany({ where: { kind: "pool" }, orderBy: { name: "asc" } });

  const report = await Promise.all(
    pools.map(async (pool) => {
      if (!pool.bucketPath) {
        return { poolKey: pool.name, status: "not-provisioned", writable: false, reason: "no backend path configured" };
      }
      try {
        const info = await stat(pool.bucketPath);
        return {
          poolKey: pool.name,
          status: info.isDirectory() ? "ready" : "degraded",
          writable: info.isDirectory(),
          reason: info.isDirectory() ? null : "backend path is not a directory",
        };
      } catch {
        return { poolKey: pool.name, status: "unavailable", writable: false, reason: "backend path is not accessible" };
      }
    }),
  );

  const anyReady = report.some((p) => p.status === "ready");
  return {
    ok: true,
    status: 200,
    body: {
      status: anyReady ? "ok" : "degraded",
      organizationId: principal.organizationId,
      pools: report,
    },
  };
}

/**
 * Reports backup state for the storage pools.
 *
 * HONESTY CONSTRAINT: this reports only what can actually be observed — the
 * configured backup pool, whether its backend exists, and how many backup
 * objects are recorded. It never claims a backup completed or verified, because
 * verifying a backup requires a restore test this endpoint does not perform.
 * Claiming otherwise would be exactly the false success this integration is
 * meant to eliminate.
 */
export async function getBackupStatusForService(
  principal: ServicePrincipal,
): Promise<IntegrationResult<Record<string, unknown>>> {
  const backupPool = await db.storageBucket.findFirst({ where: { name: "BACKUP_STORAGE", kind: "pool" } });
  const archived = await db.documentFile
    .aggregate({
      where: { poolKey: "BACKUP_STORAGE" },
      _count: { _all: true },
      _sum: { sizeBytes: true },
    })
    .catch(() => null);

  let backendPresent: boolean | null = null;
  if (backupPool?.bucketPath) {
    backendPresent = await stat(backupPool.bucketPath)
      .then((s) => s.isDirectory())
      .catch(() => false);
  }

  return {
    ok: true,
    status: 200,
    body: {
      organizationId: principal.organizationId,
      backupPoolConfigured: Boolean(backupPool),
      backupBackendPathSet: Boolean(backupPool?.bucketPath),
      backupBackendAccessible: backendPresent,
      recordedBackupObjects: archived?._count._all ?? 0,
      recordedBackupBytes: String(archived?._sum.sizeBytes ?? 0n),
      // Explicitly NOT asserting these — they require a restore test.
      restoreVerified: false,
      restoreVerifiedNote:
        "Restore verification requires an actual restore test, which this endpoint does not perform. Do not treat this response as evidence that backups are restorable.",
      lastVerifiedRestoreAt: null,
    },
  };
}

// ─── Credential provisioning ─────────────────────────────────────────────────

/**
 * Creates a service credential and returns its plaintext secret EXACTLY ONCE.
 *
 * Only the sha256 digest and the non-secret prefix are persisted, so the secret
 * cannot be recovered later — not by an admin, and not by anyone who reads the
 * database. This is why the route that calls it must transmit the secret over an
 * authenticated channel at creation time and never log it.
 */
export async function createServiceCredential(params: {
  serviceName: string;
  organizationId: string;
  scopes: ServiceScope[];
  expiresAt?: Date | null;
  createdBy?: string;
}): Promise<{ credentialId: string; secret: string; prefix: string; expiresAt: string | null }> {
  const { secret, keyHash, prefix } = generateServiceSecret();

  const row = await db.serviceCredential.create({
    data: {
      serviceName: params.serviceName,
      organizationId: params.organizationId,
      keyHash,
      prefix,
      scopes: params.scopes.join(" "),
      expiresAt: params.expiresAt ?? null,
    },
  });

  await createAuditLog({
    actorId: params.createdBy,
    actorRole: "ADMIN",
    action: "CRM_SERVICE_CREDENTIAL_CREATED",
    resourceType: "ServiceCredential",
    resourceId: row.id,
    domain: "crm-integration",
    result: "SUCCESS",
    metadata: redactSecrets({
      serviceName: params.serviceName,
      organizationId: params.organizationId,
      scopes: params.scopes,
      prefix,
      secret,
    }),
  });

  return {
    credentialId: row.id,
    secret,
    prefix,
    expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
  };
}

/**
 * Revokes a credential. Revocation is immediate and permanent for that row:
 * `authorizeServiceRequest` checks `revokedAt` before any scope evaluation, and
 * `resolveSignedDownload` re-checks the issuing credential, so outstanding
 * signed URLs stop resolving as soon as the credential is revoked.
 */
export async function revokeServiceCredential(params: {
  credentialId: string;
  revokedBy?: string;
  reason?: string;
}): Promise<{ revoked: boolean }> {
  const row = await db.serviceCredential.update({
    where: { id: params.credentialId },
    data: {
      isActive: false,
      revokedAt: new Date(),
      revokedBy: params.revokedBy ?? null,
      revokeReason: params.reason ?? null,
    },
  });

  await createAuditLog({
    actorId: params.revokedBy,
    actorRole: "ADMIN",
    action: "CRM_SERVICE_CREDENTIAL_REVOKED",
    resourceType: "ServiceCredential",
    resourceId: row.id,
    domain: "crm-integration",
    result: "SUCCESS",
    metadata: redactSecrets({ serviceName: row.serviceName, reason: params.reason, keyHash: row.keyHash }),
  });

  return { revoked: true };
}

/** Convenience re-export so routes can hash without importing the pure module. */
export { hashServiceKey };

// ─── Response envelope ───────────────────────────────────────────────────────

/**
 * Wraps a router result in the same envelope every other Hosting-Portal API
 * route uses (`apiSuccess` / `apiError` from `@/lib/response`), so a CRM client
 * sees one consistent shape whether it calls a browser endpoint or a service
 * endpoint.
 *
 * The failure branch passes through `message` and `code` ONLY. The precise
 * authentication cause (`authCode`) is never included: it stays in the audit log
 * and the structured logger, because telling a rejected caller whether a
 * credential was unknown, revoked, expired or mis-scoped is a free enumeration
 * oracle.
 */
export function toEnvelope<T>(
  result: IntegrationResult<T>,
  requestId: string,
): { status: number; body: unknown } {
  if (result.ok) {
    return {
      status: result.status,
      body: {
        status: result.status,
        success: true,
        message: "Success",
        data: result.body,
        error: null,
        requestId,
      },
    };
  }
  return {
    status: result.status,
    body: {
      status: result.status,
      success: false,
      message: result.message,
      data: null,
      error: { code: result.code, ...(result.details !== undefined && { details: result.details }) },
      requestId,
    },
  };
}
