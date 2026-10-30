/**
 * Service-to-service authentication and authorization for the CRM ↔
 * Hosting-Portal document vault integration.
 *
 * This module is PURE: no database, no filesystem, no `next/server` import. All
 * decision logic lives here so it can be unit-tested exhaustively; the API
 * routes are thin bridges that fetch facts and call these functions. That
 * matches the existing convention in `src/lib/deploy/*` and
 * `src/lib/storage-pools.ts`.
 *
 * SECURITY POSTURE — fail closed. Every check defaults to denial:
 *   - An unset or too-short signing key denies, it never falls back to a
 *     permissive comparison.
 *   - A credential with no organization denies, because every vault operation
 *     is tenant-scoped and "no tenant" must not become "all tenants".
 *   - Authentication failures return ONE generic reason to the caller so a
 *     rejected client cannot enumerate which credentials exist or why one
 *     failed. The precise reason is returned separately for the audit log and
 *     structured logger, which are not client-visible.
 *
 * The credential secret is never stored and never logged: callers hold only its
 * sha256 digest, and `redactSecrets` strips key material from anything written
 * to an audit record or log line.
 */

import { createHash, createHmac, timingSafeEqual, randomBytes } from "node:crypto";

// ─── Scopes ──────────────────────────────────────────────────────────────────

/**
 * Every operation a service credential may perform is named by a scope.
 * Scopes are granted per credential and checked per request, so a credential
 * issued for uploads cannot be used to read documents, and a read-only
 * credential cannot reach infrastructure status endpoints.
 *
 * Deliberately NO scope grants filesystem access or privileged infrastructure
 * commands: the surface is object upload, object download, metadata, quota,
 * storage health and backup status. Nothing here can list a directory, resolve
 * an arbitrary path, or run a command on the host.
 */
export const SERVICE_SCOPES = [
  "storage:documents:upload",
  "storage:documents:download",
  "storage:documents:read",
  "storage:quota:read",
  "storage:health:read",
  "storage:backup:read",
] as const;

export type ServiceScope = (typeof SERVICE_SCOPES)[number];

const SCOPE_SET = new Set<string>(SERVICE_SCOPES);

export function isServiceScope(value: string): value is ServiceScope {
  return SCOPE_SET.has(value);
}

/** Parses a space-delimited scope list, dropping anything unrecognized. */
export function parseScopes(raw: string | null | undefined): ServiceScope[] {
  if (!raw) return [];
  return Array.from(
    new Set(
      raw
        .split(/[\s,]+/)
        .map((s) => s.trim())
        .filter((s): s is ServiceScope => isServiceScope(s)),
    ),
  );
}

// ─── Credential facts ────────────────────────────────────────────────────────

/**
 * The credential row as the router sees it. Shaped as an interface rather than
 * a Prisma type so this module stays dependency-light and testable without a
 * database.
 */
export interface ServiceCredentialRecord {
  id: string;
  serviceName: string;
  organizationId: string | null;
  keyHash: string;
  prefix: string;
  scopes: string;
  isActive: boolean;
  expiresAt: Date | null;
  revokedAt: Date | null;
}

/** Non-secret view of an authenticated service, safe to log and to return. */
export interface ServicePrincipal {
  credentialId: string;
  serviceName: string;
  organizationId: string;
  scopes: ServiceScope[];
}

export interface ServiceAuthFacts {
  /** Value of the `authorization` header, verbatim (may be undefined). */
  authorizationHeader?: string | null;
  /** Candidate credential row located by prefix, if any. */
  credential?: ServiceCredentialRecord | null;
  /** Server-side signing/verification key for download URLs. */
  signingKey?: string | null;
  /** Current time, injectable for deterministic expiry tests. */
  now?: number;
}

export type ServiceAuthResult =
  | { ok: true; principal: ServicePrincipal }
  | {
      ok: false;
      /** Client-visible. Always the same generic string for every denial. */
      reason: string;
      /** Precise cause. For audit log + structured logger only, never returned. */
      code: ServiceAuthFailureCode;
      status: 401 | 403 | 503;
    };

export type ServiceAuthFailureCode =
  | "MISSING_CREDENTIAL"
  | "MALFORMED_CREDENTIAL"
  | "UNKNOWN_CREDENTIAL"
  | "SIGNING_KEY_UNAVAILABLE"
  | "INACTIVE"
  | "REVOKED"
  | "EXPIRED"
  | "INSUFFICIENT_SCOPE"
  | "NO_ORGANIZATION";

/**
 * One generic client-visible message for every authentication failure. Reusing
 * a single string is the point: it stops a rejected caller distinguishing
 * "no such credential" from "revoked" from "expired" from "wrong secret".
 */
export const SERVICE_AUTH_DENIED = "Invalid or unauthorized service credential";

/** Minimum accepted secret length. Shorter secrets are refused outright. */
export const MIN_SERVICE_SECRET_LENGTH = 32;

/** Minimum signing key length; below this, signed URLs are refused. */
export const MIN_SIGNING_KEY_LENGTH = 32;

/** Non-secret head of a key stored alongside the digest for identification. */
export const KEY_PREFIX_LENGTH = 12;

// ─── Key handling ────────────────────────────────────────────────────────────

/** sha256 hex digest of a secret. This is what gets stored, never the secret. */
export function hashServiceKey(secret: string): string {
  return createHash("sha256").update(secret, "utf8").digest("hex");
}

/**
 * The stored prefix of a key. Used to locate the candidate row before the
 * timing-safe digest comparison, and safe to show support staff.
 */
export function keyPrefix(secret: string): string {
  return secret.slice(0, KEY_PREFIX_LENGTH);
}

/**
 * Generates a new service credential secret.
 *
 * Returns the plaintext exactly once — the caller persists only `keyHash` and
 * `prefix`, so the secret is unrecoverable afterwards and must be handed to the
 * service owner through a secure channel at creation time.
 */
export function generateServiceSecret(): { secret: string; keyHash: string; prefix: string } {
  // 32 random bytes → 64 hex chars, comfortably above MIN_SERVICE_SECRET_LENGTH.
  const secret = `alosvc_${randomBytes(32).toString("hex")}`;
  return { secret, keyHash: hashServiceKey(secret), prefix: keyPrefix(secret) };
}

/**
 * Constant-time comparison of two secrets.
 *
 * Compares sha256 digests rather than the raw strings so the comparison length
 * is fixed and independent of the input, which keeps `timingSafeEqual` from
 * throwing on mismatched lengths and avoids leaking length information. This is
 * the same construction `verifyInternalSecretValue` uses in `src/lib/auth.ts`.
 */
export function constantTimeEquals(a: string, b: string): boolean {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const left = createHash("sha256").update(a, "utf8").digest();
  const right = createHash("sha256").update(b, "utf8").digest();
  return timingSafeEqual(left, right);
}

// ─── Authentication ──────────────────────────────────────────────────────────

/**
 * Extracts a bearer token from an `authorization` header value.
 * Accepts only the `Bearer <token>` scheme; anything else is null.
 */
export function extractBearerToken(header: string | null | undefined): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (!match) return null;
  const token = match[1]?.trim();
  return token ? token : null;
}

function deny(code: ServiceAuthFailureCode, status: 401 | 403 | 503): ServiceAuthResult {
  return { ok: false, reason: SERVICE_AUTH_DENIED, code, status };
}

/**
 * Authenticates a service credential and authorizes it for one required scope.
 *
 * Order matters and is deliberate — cheapest and least revealing checks first,
 * and every branch denies:
 *   1. A bearer token must be present and well formed.
 *   2. A candidate credential must exist for that prefix.
 *   3. The secret digest must match in constant time.
 *   4. The credential must be active, unrevoked and unexpired.
 *   5. It must hold the required scope.
 *   6. It must be bound to an organization — no tenant, no access.
 *
 * Note that (3) runs before (4): a revoked or expired credential still has to
 * present the correct secret, so revocation cannot be probed by an attacker who
 * does not hold the key, and a leaked-but-revoked key is rejected on the same
 * generic message as any other failure.
 */
export function authorizeServiceRequest(
  facts: ServiceAuthFacts,
  requiredScope: ServiceScope,
): ServiceAuthResult {
  const token = extractBearerToken(facts.authorizationHeader);
  if (!token) return deny("MISSING_CREDENTIAL", 401);
  if (token.length < MIN_SERVICE_SECRET_LENGTH) return deny("MALFORMED_CREDENTIAL", 401);

  const credential = facts.credential ?? null;
  if (!credential) return deny("UNKNOWN_CREDENTIAL", 401);

  // Prefix must agree before we spend a digest comparison, and the stored
  // digest must match exactly.
  if (keyPrefix(token) !== credential.prefix) return deny("UNKNOWN_CREDENTIAL", 401);
  if (!constantTimeEquals(hashServiceKey(token), credential.keyHash)) {
    return deny("UNKNOWN_CREDENTIAL", 401);
  }

  if (credential.revokedAt) return deny("REVOKED", 401);
  if (!credential.isActive) return deny("INACTIVE", 401);

  const now = facts.now ?? Date.now();
  if (credential.expiresAt && credential.expiresAt.getTime() <= now) {
    return deny("EXPIRED", 401);
  }

  const granted = parseScopes(credential.scopes);
  if (!granted.includes(requiredScope)) return deny("INSUFFICIENT_SCOPE", 403);

  // Fail closed on tenancy: a credential with no organization has no tenant to
  // act within, and must never be treated as platform-wide.
  if (!credential.organizationId || credential.organizationId.trim().length === 0) {
    return deny("NO_ORGANIZATION", 403);
  }

  return {
    ok: true,
    principal: {
      credentialId: credential.id,
      serviceName: credential.serviceName,
      organizationId: credential.organizationId,
      scopes: granted,
    },
  };
}

/**
 * Whether a principal may act on a document belonging to `documentOrgId`.
 *
 * Object-level authorization: a service can only reach documents inside its own
 * organization. A document with no organization is refused rather than treated
 * as shared, because "unscoped" must not become "world-readable" to a machine
 * caller.
 */
export function canAccessOrganizationDocument(
  principal: ServicePrincipal,
  documentOrgId: string | null | undefined,
): boolean {
  if (!documentOrgId) return false;
  return documentOrgId === principal.organizationId;
}

// ─── Signed download URLs ────────────────────────────────────────────────────

/**
 * Default signed-URL lifetime. Short, because these URLs travel through the CRM
 * and may be logged there; a leaked URL must stop working quickly.
 */
export const SIGNED_URL_TTL_SECONDS = 300;

export const MAX_SIGNED_URL_TTL_SECONDS = 900;

export interface SignedUrlPayload {
  documentId: string;
  organizationId: string;
  credentialId: string;
  expiresAt: number; // epoch ms
}

/**
 * Computes the HMAC signature over a signed-URL payload.
 *
 * The signature binds the document, the tenant, the issuing credential and the
 * expiry into one value, so a URL minted for one document cannot be rewritten to
 * point at another, and a URL minted under one credential cannot be replayed
 * under a different tenant.
 */
export function signPayload(payload: SignedUrlPayload, signingKey: string): string {
  const canonical = [
    payload.documentId,
    payload.organizationId,
    payload.credentialId,
    String(payload.expiresAt),
  ].join("\n");
  return createHmac("sha256", signingKey).update(canonical, "utf8").digest("base64url");
}

/**
 * Mints a short-lived signed download URL.
 *
 * Returns null — never a URL — when the signing key is missing or too short, so
 * a misconfigured deployment cannot silently degrade into handing out
 * unguessable-but-unsigned links. `src/lib/storage.ts#getSignedUrl` is the
 * cautionary example: it is marked deprecated precisely because it returns a
 * plain public URL while its name promises signing. This function does sign.
 */
export function createSignedDownloadUrl(params: {
  baseUrl: string;
  documentId: string;
  organizationId: string;
  credentialId: string;
  signingKey: string | null | undefined;
  now?: number;
  ttlSeconds?: number;
}): { url: string; expiresAt: number } | null {
  const key = params.signingKey?.trim() ?? "";
  if (key.length < MIN_SIGNING_KEY_LENGTH) return null;

  const ttl = Math.min(
    Math.max(1, params.ttlSeconds ?? SIGNED_URL_TTL_SECONDS),
    MAX_SIGNED_URL_TTL_SECONDS,
  );
  const now = params.now ?? Date.now();
  const expiresAt = now + ttl * 1000;

  const payload: SignedUrlPayload = {
    documentId: params.documentId,
    organizationId: params.organizationId,
    credentialId: params.credentialId,
    expiresAt,
  };
  const signature = signPayload(payload, key);

  const url = new URL(`/api/internal/crm/documents/${encodeURIComponent(params.documentId)}/content`, params.baseUrl);
  url.searchParams.set("org", params.organizationId);
  url.searchParams.set("cred", params.credentialId);
  url.searchParams.set("exp", String(expiresAt));
  url.searchParams.set("sig", signature);
  return { url: url.toString(), expiresAt };
}

export type SignedUrlVerdict =
  | { ok: true; payload: SignedUrlPayload }
  | { ok: false; code: "MISSING_PARAMS" | "SIGNING_KEY_UNAVAILABLE" | "BAD_SIGNATURE" | "EXPIRED" };

/**
 * Verifies a signed download URL.
 *
 * Checks the signature first and expiry second, both fail closed. The signature
 * is recomputed over the parameters actually presented, so tampering with any of
 * them — the document id, the tenant, the credential or the expiry — invalidates
 * it. Expiry is compared against an injectable clock so tests can age a URL
 * deterministically instead of sleeping.
 */
export function verifySignedDownloadUrl(params: {
  documentId: string;
  organizationId?: string | null;
  credentialId?: string | null;
  expiresAt?: string | null;
  signature?: string | null;
  signingKey: string | null | undefined;
  now?: number;
}): SignedUrlVerdict {
  const key = params.signingKey?.trim() ?? "";
  if (key.length < MIN_SIGNING_KEY_LENGTH) return { ok: false, code: "SIGNING_KEY_UNAVAILABLE" };

  if (!params.documentId || !params.organizationId || !params.credentialId || !params.expiresAt || !params.signature) {
    return { ok: false, code: "MISSING_PARAMS" };
  }

  const expiresAt = Number(params.expiresAt);
  if (!Number.isFinite(expiresAt) || expiresAt <= 0) return { ok: false, code: "MISSING_PARAMS" };

  const payload: SignedUrlPayload = {
    documentId: params.documentId,
    organizationId: params.organizationId,
    credentialId: params.credentialId,
    expiresAt,
  };

  const expected = signPayload(payload, key);
  // Compare digests so differing base64url lengths cannot throw.
  if (!constantTimeEquals(expected, params.signature)) return { ok: false, code: "BAD_SIGNATURE" };

  const now = params.now ?? Date.now();
  if (expiresAt <= now) return { ok: false, code: "EXPIRED" };

  return { ok: true, payload };
}

// ─── Idempotency ─────────────────────────────────────────────────────────────

/**
 * Normalizes a client-supplied idempotency key.
 *
 * Bounded and trimmed so a caller cannot smuggle an oversized or newline-laden
 * value into a unique index. Returns null for anything unusable, letting the
 * route treat "no key supplied" differently from "bad key supplied".
 */
export function normalizeIdempotencyKey(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const key = raw.trim();
  if (key.length < 8 || key.length > 200) return null;
  if (!/^[\w.\-:]+$/.test(key)) return null;
  return key;
}

// ─── Correlation ─────────────────────────────────────────────────────────────

/**
 * Resolves the correlation id for a request: the caller's `x-request-id` when it
 * is well formed, otherwise a freshly generated one.
 *
 * Echoing a caller-supplied id is what makes a CRM-side log line joinable to the
 * Hosting-Portal audit record for the same operation. It is validated rather
 * than trusted so a hostile caller cannot inject control characters into logs.
 */
export function resolveCorrelationId(header: string | null | undefined): string {
  const supplied = header?.trim();
  if (supplied && supplied.length >= 8 && supplied.length <= 128 && /^[\w.\-:]+$/.test(supplied)) {
    return supplied;
  }
  return randomBytes(16).toString("hex");
}

// ─── Redaction ───────────────────────────────────────────────────────────────

/**
 * Field names whose values must never reach an audit record or a log line.
 */
const SECRET_FIELD_PATTERN =
  /(secret|password|passwd|token|authorization|credential|apikey|api_key|signature|sig|keyHash|accessKey|privateKey)/i;

/**
 * Recursively redacts secret-bearing fields from a value destined for an audit
 * log, a structured log line, or an error response.
 *
 * This exists because the integration handles credentials and signed URLs, and
 * an audit trail that recorded the thing it was auditing would itself become the
 * leak. Applied on the way IN to `createAuditLog`, not left to each call site to
 * remember.
 */
export function redactSecrets<T>(value: T, depth = 0): T {
  if (depth > 8) return "[redacted:depth]" as unknown as T;
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return value as T;
  if (typeof value !== "object") return value;

  if (Array.isArray(value)) {
    return value.map((item) => redactSecrets(item, depth + 1)) as unknown as T;
  }

  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (SECRET_FIELD_PATTERN.test(key)) {
      out[key] = "[redacted]";
      continue;
    }
    out[key] = redactSecrets(item, depth + 1);
  }
  return out as unknown as T;
}

/**
 * Strips a `sig` query parameter from a URL string, for logging.
 * Signed URLs are safe to store but not to log: the signature is a bearer
 * credential for the lifetime of the URL.
 */
export function redactSignedUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  return url.replace(/([?&]sig=)[^&]*/i, "$1[redacted]");
}
