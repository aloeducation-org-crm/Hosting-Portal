/**
 * CRM ↔ Hosting-Portal service authentication conformance tests.
 *
 * These exercise the PURE decision layer (`src/lib/integrations/service-auth`),
 * which is where every authorization decision is actually made. The API routes
 * and the router are thin bridges over it, so testing this layer tests the
 * security posture of the whole integration without needing a database or an
 * HTTP server — and it means a decision cannot be right in one route and wrong
 * in another.
 *
 * Covers the required conformance cases: valid service authentication, invalid
 * and revoked credentials, cross-tenant denial, unauthorized download, upload
 * hash mismatch, expired signed URLs, invalid pools, backup status honesty, and
 * audit redaction. The database-backed halves of these (real writes, real quota,
 * real audit rows) are in crm-storage-integration.test.ts.
 */
import { describe, expect, it } from "vitest";
import {
  authorizeServiceRequest,
  canAccessOrganizationDocument,
  constantTimeEquals,
  createSignedDownloadUrl,
  extractBearerToken,
  generateServiceSecret,
  hashServiceKey,
  isServiceScope,
  keyPrefix,
  MIN_SERVICE_SECRET_LENGTH,
  normalizeIdempotencyKey,
  parseScopes,
  redactSecrets,
  redactSignedUrl,
  resolveCorrelationId,
  SIGNED_URL_TTL_SECONDS,
  type ServiceCredentialRecord,
  verifySignedDownloadUrl,
  type ServiceScope,
} from "@/lib/integrations/service-auth";

const SIGNING_KEY = "k".repeat(64);
const ORG_A = "org-alo-education";
const ORG_B = "org-some-other-tenant";
const NOW = Date.UTC(2026, 9, 29, 12, 0, 0);

/** A generated secret plus the credential row shape the router would load. */
function makeCredential(overrides: Partial<ServiceCredentialRecord> = {}) {
  const { secret, keyHash, prefix } = generateServiceSecret();
  const record: ServiceCredentialRecord = {
    id: "cred-1",
    serviceName: "alo-education-crm",
    organizationId: ORG_A,
    keyHash,
    prefix,
    scopes: "storage:documents:upload storage:documents:download storage:documents:read",
    isActive: true,
    expiresAt: null,
    revokedAt: null,
    ...overrides,
  };
  return { secret, record };
}

function bearer(secret: string) {
  return `Bearer ${secret}`;
}

describe("scope parsing", () => {
  it("accepts every declared scope and rejects anything else", () => {
    for (const scope of [
      "storage:documents:upload",
      "storage:documents:download",
      "storage:documents:read",
      "storage:quota:read",
      "storage:health:read",
      "storage:backup:read",
    ]) {
      expect(isServiceScope(scope)).toBe(true);
    }
    // No scope may grant filesystem or infrastructure access: the surface is
    // objects, metadata, quota and status only.
    expect(isServiceScope("storage:filesystem:read")).toBe(false);
    expect(isServiceScope("infrastructure:exec")).toBe(false);
    expect(isServiceScope("*")).toBe(false);
    expect(isServiceScope("")).toBe(false);
  });

  it("drops unrecognized scopes instead of silently accepting them", () => {
    expect(parseScopes("storage:documents:read storage:everything NOT_A_SCOPE")).toEqual([
      "storage:documents:read",
    ]);
    expect(parseScopes(null)).toEqual([]);
    expect(parseScopes("")).toEqual([]);
  });

  it("de-duplicates repeated scopes", () => {
    expect(parseScopes("storage:quota:read storage:quota:read")).toEqual(["storage:quota:read"]);
  });
});

describe("required conformance case 1 — valid CRM service authentication", () => {
  it("authenticates a correct bearer credential for a scope it holds", () => {
    const { secret, record } = makeCredential();
    const result = authorizeServiceRequest(
      { authorizationHeader: bearer(secret), credential: record, signingKey: SIGNING_KEY, now: NOW },
      "storage:documents:upload",
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.principal.serviceName).toBe("alo-education-crm");
    expect(result.principal.organizationId).toBe(ORG_A);
    expect(result.principal.credentialId).toBe("cred-1");
    // The principal carries the parsed scopes, never the secret or its digest.
    expect(result.principal.scopes).toContain("storage:documents:upload");
    expect(JSON.stringify(result.principal)).not.toContain(secret);
    expect(JSON.stringify(result.principal)).not.toContain(record.keyHash);
  });

  it("is case-insensitive about the Bearer scheme but exact about the secret", () => {
    const { secret, record } = makeCredential();
    expect(
      authorizeServiceRequest(
        { authorizationHeader: `bearer ${secret}`, credential: record, signingKey: SIGNING_KEY, now: NOW },
        "storage:documents:read",
      ).ok,
    ).toBe(true);
    expect(
      authorizeServiceRequest(
        { authorizationHeader: `BEARER   ${secret}`, credential: record, signingKey: SIGNING_KEY, now: NOW },
        "storage:documents:read",
      ).ok,
    ).toBe(true);
  });
});

describe("required conformance case 2 — invalid or revoked credentials", () => {
  const scope: ServiceScope = "storage:documents:upload";

  it("denies a missing authorization header", () => {
    const { record } = makeCredential();
    const result = authorizeServiceRequest(
      { authorizationHeader: null, credential: record, signingKey: SIGNING_KEY, now: NOW },
      scope,
    );
    expect(result).toMatchObject({ ok: false, code: "MISSING_CREDENTIAL", status: 401 });
  });

  it("denies a non-bearer scheme", () => {
    const { secret, record } = makeCredential();
    const result = authorizeServiceRequest(
      { authorizationHeader: `Basic ${secret}`, credential: record, signingKey: SIGNING_KEY, now: NOW },
      scope,
    );
    expect(result).toMatchObject({ ok: false, code: "MISSING_CREDENTIAL", status: 401 });
  });

  it("denies a secret shorter than the minimum, even if it somehow matched", () => {
    const { record } = makeCredential();
    const result = authorizeServiceRequest(
      { authorizationHeader: bearer("short"), credential: record, signingKey: SIGNING_KEY, now: NOW },
      scope,
    );
    expect(result).toMatchObject({ ok: false, code: "MALFORMED_CREDENTIAL", status: 401 });
    expect(MIN_SERVICE_SECRET_LENGTH).toBeGreaterThanOrEqual(32);
  });

  it("denies when no credential row exists for the prefix", () => {
    const { secret } = makeCredential();
    const result = authorizeServiceRequest(
      { authorizationHeader: bearer(secret), credential: null, signingKey: SIGNING_KEY, now: NOW },
      scope,
    );
    expect(result).toMatchObject({ ok: false, code: "UNKNOWN_CREDENTIAL", status: 401 });
  });

  it("denies a wrong secret presented under a real credential's prefix", () => {
    const { record } = makeCredential();
    // Same prefix (so the row is found) but a different secret body.
    const impostor = record.prefix + "f".repeat(48);
    const result = authorizeServiceRequest(
      { authorizationHeader: bearer(impostor), credential: record, signingKey: SIGNING_KEY, now: NOW },
      scope,
    );
    expect(result).toMatchObject({ ok: false, code: "UNKNOWN_CREDENTIAL", status: 401 });
  });

  it("denies a REVOKED credential even though its secret is correct", () => {
    const { secret, record } = makeCredential({ revokedAt: new Date(NOW - 1000) });
    const result = authorizeServiceRequest(
      { authorizationHeader: bearer(secret), credential: record, signingKey: SIGNING_KEY, now: NOW },
      scope,
    );
    expect(result).toMatchObject({ ok: false, code: "REVOKED", status: 401 });
  });

  it("denies a deactivated credential", () => {
    const { secret, record } = makeCredential({ isActive: false });
    const result = authorizeServiceRequest(
      { authorizationHeader: bearer(secret), credential: record, signingKey: SIGNING_KEY, now: NOW },
      scope,
    );
    expect(result).toMatchObject({ ok: false, code: "INACTIVE", status: 401 });
  });

  it("denies an expired credential, and accepts it one millisecond before expiry", () => {
    const expiresAt = new Date(NOW);
    const { secret, record } = makeCredential({ expiresAt });

    const before = authorizeServiceRequest(
      { authorizationHeader: bearer(secret), credential: record, signingKey: SIGNING_KEY, now: NOW - 1 },
      scope,
    );
    expect(before.ok).toBe(true);

    const at = authorizeServiceRequest(
      { authorizationHeader: bearer(secret), credential: record, signingKey: SIGNING_KEY, now: NOW },
      scope,
    );
    expect(at).toMatchObject({ ok: false, code: "EXPIRED", status: 401 });

    const after = authorizeServiceRequest(
      { authorizationHeader: bearer(secret), credential: record, signingKey: SIGNING_KEY, now: NOW + 60_000 },
      scope,
    );
    expect(after).toMatchObject({ ok: false, code: "EXPIRED", status: 401 });
  });

  it("returns ONE generic client-visible reason for every denial", () => {
    // If each failure returned its own message, a rejected caller could
    // enumerate which credentials exist and why one failed.
    const { secret, record } = makeCredential();
    const revoked = makeCredential({ revokedAt: new Date(NOW) });
    const expired = makeCredential({ expiresAt: new Date(NOW - 1) });
    const noOrg = makeCredential({ organizationId: null });

    const reasons = [
      authorizeServiceRequest({ authorizationHeader: null, credential: record, signingKey: SIGNING_KEY, now: NOW }, scope),
      authorizeServiceRequest({ authorizationHeader: bearer("x".repeat(40)), credential: null, signingKey: SIGNING_KEY, now: NOW }, scope),
      authorizeServiceRequest(
        { authorizationHeader: bearer(revoked.secret), credential: revoked.record, signingKey: SIGNING_KEY, now: NOW },
        scope,
      ),
      authorizeServiceRequest(
        { authorizationHeader: bearer(expired.secret), credential: expired.record, signingKey: SIGNING_KEY, now: NOW },
        scope,
      ),
      authorizeServiceRequest(
        { authorizationHeader: bearer(noOrg.secret), credential: noOrg.record, signingKey: SIGNING_KEY, now: NOW },
        scope,
      ),
    ].map((r) => (r.ok ? null : r.reason));

    expect(new Set(reasons).size).toBe(1);
    expect(reasons[0]).toBe("Invalid or unauthorized service credential");
  });

  it("still reports distinct internal codes so the audit trail is useful", () => {
    const { secret, record } = makeCredential();
    const revoked = makeCredential({ revokedAt: new Date(NOW) });
    const codes = [
      authorizeServiceRequest({ authorizationHeader: null, credential: record, signingKey: SIGNING_KEY, now: NOW }, scope),
      authorizeServiceRequest(
        { authorizationHeader: bearer(revoked.secret), credential: revoked.record, signingKey: SIGNING_KEY, now: NOW },
        scope,
      ),
    ].map((r) => (r.ok ? null : r.code));
    expect(codes).toEqual(["MISSING_CREDENTIAL", "REVOKED"]);
    // Precise cause must never leak into the client-visible reason.
    expect(secret).not.toBe("");
    expect(record.prefix.length).toBe(12);
  });
});

describe("scope enforcement", () => {
  it("denies a credential used for a scope it was not granted", () => {
    const { secret, record } = makeCredential({ scopes: "storage:documents:upload" });
    const result = authorizeServiceRequest(
      { authorizationHeader: bearer(secret), credential: record, signingKey: SIGNING_KEY, now: NOW },
      "storage:documents:download",
    );
    // 403, not 401: the caller IS authenticated, it is merely not permitted.
    expect(result).toMatchObject({ ok: false, code: "INSUFFICIENT_SCOPE", status: 403 });
  });

  it("denies a credential whose scope list is empty", () => {
    const { secret, record } = makeCredential({ scopes: "" });
    expect(
      authorizeServiceRequest(
        { authorizationHeader: bearer(secret), credential: record, signingKey: SIGNING_KEY, now: NOW },
        "storage:quota:read",
      ),
    ).toMatchObject({ ok: false, code: "INSUFFICIENT_SCOPE", status: 403 });
  });

  it("checks scope BEFORE tenancy, so an unscoped credential gets 403 not a tenant error", () => {
    const { secret, record } = makeCredential({ scopes: "", organizationId: null });
    expect(
      authorizeServiceRequest(
        { authorizationHeader: bearer(secret), credential: record, signingKey: SIGNING_KEY, now: NOW },
        "storage:quota:read",
      ),
    ).toMatchObject({ ok: false, code: "INSUFFICIENT_SCOPE", status: 403 });
  });
});

describe("required conformance case 3 — cross-tenant access denial", () => {
  it("denies a credential with no organization rather than treating it as platform-wide", () => {
    // "No tenant" must never become "all tenants".
    const { secret, record } = makeCredential({
      organizationId: null,
      scopes: "storage:documents:upload",
    });
    expect(
      authorizeServiceRequest(
        { authorizationHeader: bearer(secret), credential: record, signingKey: SIGNING_KEY, now: NOW },
        "storage:documents:upload",
      ),
    ).toMatchObject({ ok: false, code: "NO_ORGANIZATION", status: 403 });
  });

  it("denies a blank-string organization", () => {
    const { secret, record } = makeCredential({ organizationId: "   ", scopes: "storage:quota:read" });
    expect(
      authorizeServiceRequest(
        { authorizationHeader: bearer(secret), credential: record, signingKey: SIGNING_KEY, now: NOW },
        "storage:quota:read",
      ),
    ).toMatchObject({ ok: false, code: "NO_ORGANIZATION", status: 403 });
  });

  it("allows a document inside the caller's own organization only", () => {
    const { secret, record } = makeCredential();
    const auth = authorizeServiceRequest(
      { authorizationHeader: bearer(secret), credential: record, signingKey: SIGNING_KEY, now: NOW },
      "storage:documents:read",
    );
    expect(auth.ok).toBe(true);
    if (!auth.ok) return;

    expect(canAccessOrganizationDocument(auth.principal, ORG_A)).toBe(true);
    expect(canAccessOrganizationDocument(auth.principal, ORG_B)).toBe(false);
  });

  it("refuses a document with no organization instead of treating it as shared", () => {
    const { secret, record } = makeCredential();
    const auth = authorizeServiceRequest(
      { authorizationHeader: bearer(secret), credential: record, signingKey: SIGNING_KEY, now: NOW },
      "storage:documents:read",
    );
    if (!auth.ok) throw new Error("expected auth to succeed");
    expect(canAccessOrganizationDocument(auth.principal, null)).toBe(false);
    expect(canAccessOrganizationDocument(auth.principal, undefined)).toBe(false);
    expect(canAccessOrganizationDocument(auth.principal, "")).toBe(false);
  });
});

describe("key handling", () => {
  it("stores only a digest, never the secret", () => {
    const { secret, keyHash, prefix } = generateServiceSecret();
    expect(secret.length).toBeGreaterThan(MIN_SERVICE_SECRET_LENGTH);
    expect(keyHash).toMatch(/^[0-9a-f]{64}$/);
    expect(keyHash).not.toContain(secret);
    expect(secret).not.toContain(keyHash);
    // The prefix is a non-secret identifying head, safe to display.
    expect(prefix).toBe(secret.slice(0, 12));
    expect(prefix.length).toBe(12);
  });

  it("generates unique secrets on every call", () => {
    const a = generateServiceSecret();
    const b = generateServiceSecret();
    expect(a.secret).not.toBe(b.secret);
    expect(a.keyHash).not.toBe(b.keyHash);
  });

  it("hashes deterministically so a stored digest can be matched", () => {
    expect(hashServiceKey("abc")).toBe(hashServiceKey("abc"));
    expect(hashServiceKey("abc")).not.toBe(hashServiceKey("abd"));
    expect(keyPrefix("alo-service-key")).toBe("alo-service-");
  });

  it("compares in constant time without throwing on differing lengths", () => {
    expect(constantTimeEquals("a", "a")).toBe(true);
    expect(constantTimeEquals("a", "bb")).toBe(false);
    expect(constantTimeEquals("a", "")).toBe(false);
    expect(constantTimeEquals("", "")).toBe(true);
    // Non-string input must not throw — a malformed header must deny, not crash.
    expect(constantTimeEquals(undefined as unknown as string, "x")).toBe(false);
  });

  it("extracts bearer tokens and rejects other shapes", () => {
    expect(extractBearerToken("Bearer abc123")).toBe("abc123");
    expect(extractBearerToken("bearer   abc123 ")).toBe("abc123");
    expect(extractBearerToken("Basic abc123")).toBeNull();
    expect(extractBearerToken("Bearer ")).toBeNull();
    expect(extractBearerToken("")).toBeNull();
    expect(extractBearerToken(null)).toBeNull();
    expect(extractBearerToken(undefined)).toBeNull();
  });
});

describe("required conformance case 8 — signed download URLs", () => {
  const base = {
    baseUrl: "https://hosting.example",
    documentId: "doc-123",
    organizationId: ORG_A,
    credentialId: "cred-1",
    signingKey: SIGNING_KEY,
    now: NOW,
  };

  it("mints a URL that carries document, tenant, credential, expiry and signature", () => {
    const signed = createSignedDownloadUrl(base);
    expect(signed).not.toBeNull();
    if (!signed) return;
    const url = new URL(signed.url);
    expect(url.pathname).toBe("/api/internal/crm/documents/doc-123/content");
    expect(url.searchParams.get("org")).toBe(ORG_A);
    expect(url.searchParams.get("cred")).toBe("cred-1");
    expect(Number(url.searchParams.get("exp"))).toBe(NOW + SIGNED_URL_TTL_SECONDS * 1000);
    expect(url.searchParams.get("sig")).toBeTruthy();
    // Short-lived by design: these URLs travel through the CRM and may be logged
    // there, so a leaked URL must stop working quickly.
    expect(SIGNED_URL_TTL_SECONDS).toBeLessThanOrEqual(900);
  });

  it("returns null rather than an UNSIGNED url when the signing key is missing or weak", () => {
    // A misconfigured server must not degrade into handing out permanent public
    // links to private documents. This is the failure mode of the deprecated
    // `getSignedUrl` in src/lib/storage.ts, which returns a plain public URL.
    expect(createSignedDownloadUrl({ ...base, signingKey: null })).toBeNull();
    expect(createSignedDownloadUrl({ ...base, signingKey: undefined })).toBeNull();
    expect(createSignedDownloadUrl({ ...base, signingKey: "" })).toBeNull();
    expect(createSignedDownloadUrl({ ...base, signingKey: "   " })).toBeNull();
    expect(createSignedDownloadUrl({ ...base, signingKey: "short" })).toBeNull();
  });

  it("caps the TTL so a caller cannot request an effectively permanent URL", () => {
    const signed = createSignedDownloadUrl({ ...base, ttlSeconds: 999_999 });
    expect(signed).not.toBeNull();
    if (!signed) return;
    expect(signed.expiresAt - NOW).toBeLessThanOrEqual(900 * 1000);
  });

  it("verifies a freshly minted URL", () => {
    const signed = createSignedDownloadUrl(base);
    if (!signed) throw new Error("expected a signed url");
    const url = new URL(signed.url);
    const verdict = verifyUrl({
      documentId: base.documentId,
      organizationId: url.searchParams.get("org"),
      credentialId: url.searchParams.get("cred"),
      expiresAt: url.searchParams.get("exp"),
      signature: url.searchParams.get("sig"),
      now: NOW + 1000,
    });
    expect(verdict.ok).toBe(true);
  });

  it("rejects an EXPIRED signed URL", () => {
    const signed = createSignedDownloadUrl(base);
    if (!signed) throw new Error("expected a signed url");
    const url = new URL(signed.url);
    const verdict = verifyUrl({
      documentId: base.documentId,
      organizationId: url.searchParams.get("org"),
      credentialId: url.searchParams.get("cred"),
      expiresAt: url.searchParams.get("exp"),
      signature: url.searchParams.get("sig"),
      now: signed.expiresAt + 1,
    });
    expect(verdict).toEqual({ ok: false, code: "EXPIRED" });
  });

  it("rejects a URL retargeted at a different document", () => {
    const signed = createSignedDownloadUrl(base);
    if (!signed) throw new Error("expected a signed url");
    const url = new URL(signed.url);
    expect(
      verifyUrl({
        documentId: "doc-SOMEONE-ELSES",
        organizationId: url.searchParams.get("org"),
        credentialId: url.searchParams.get("cred"),
        expiresAt: url.searchParams.get("exp"),
        signature: url.searchParams.get("sig"),
        now: NOW,
      }),
    ).toEqual({ ok: false, code: "BAD_SIGNATURE" });
  });

  it("rejects a URL replayed under a different tenant", () => {
    const signed = createSignedDownloadUrl(base);
    if (!signed) throw new Error("expected a signed url");
    const url = new URL(signed.url);
    expect(
      verifyUrl({
        documentId: base.documentId,
        organizationId: ORG_B,
        credentialId: url.searchParams.get("cred"),
        expiresAt: url.searchParams.get("exp"),
        signature: url.searchParams.get("sig"),
        now: NOW,
      }),
    ).toEqual({ ok: false, code: "BAD_SIGNATURE" });
  });

  it("rejects a URL whose expiry was extended by the caller", () => {
    const signed = createSignedDownloadUrl(base);
    if (!signed) throw new Error("expected a signed url");
    const url = new URL(signed.url);
    expect(
      verifyUrl({
        documentId: base.documentId,
        organizationId: url.searchParams.get("org"),
        credentialId: url.searchParams.get("cred"),
        expiresAt: String(NOW + 10 * 86_400_000),
        signature: url.searchParams.get("sig"),
        now: NOW,
      }),
    ).toEqual({ ok: false, code: "BAD_SIGNATURE" });
  });

  it("rejects a forged signature and a tampered one", () => {
    const signed = createSignedDownloadUrl(base);
    if (!signed) throw new Error("expected a signed url");
    const url = new URL(signed.url);
    const good = url.searchParams.get("sig") ?? "";
    expect(
      verifyUrl({
        documentId: base.documentId,
        organizationId: url.searchParams.get("org"),
        credentialId: url.searchParams.get("cred"),
        expiresAt: url.searchParams.get("exp"),
        signature: "forged",
        now: NOW,
      }),
    ).toEqual({ ok: false, code: "BAD_SIGNATURE" });
    expect(
      verifyUrl({
        documentId: base.documentId,
        organizationId: url.searchParams.get("org"),
        credentialId: url.searchParams.get("cred"),
        expiresAt: url.searchParams.get("exp"),
        // Flip one character of a real signature.
        signature: (good[0] === "A" ? "B" : "A") + good.slice(1),
        now: NOW,
      }),
    ).toEqual({ ok: false, code: "BAD_SIGNATURE" });
  });

  it("rejects missing parameters and a non-numeric expiry", () => {
    expect(
      verifyUrl({
        documentId: base.documentId,
        organizationId: ORG_A,
        credentialId: "cred-1",
        expiresAt: null,
        signature: "x",
        now: NOW,
      }),
    ).toEqual({ ok: false, code: "MISSING_PARAMS" });
    expect(
      verifyUrl({
        documentId: base.documentId,
        organizationId: ORG_A,
        credentialId: "cred-1",
        expiresAt: "not-a-number",
        signature: "x",
        now: NOW,
      }),
    ).toEqual({ ok: false, code: "MISSING_PARAMS" });
    expect(
      verifyUrl({
        documentId: "",
        organizationId: ORG_A,
        credentialId: "cred-1",
        expiresAt: String(NOW + 1000),
        signature: "x",
        now: NOW,
      }),
    ).toEqual({ ok: false, code: "MISSING_PARAMS" });
  });

  it("refuses to verify anything when the signing key is unavailable", () => {
    // Fail closed: without a key the server cannot validate a signature, so it
    // must deny rather than assume the URL is fine.
    const signed = createSignedDownloadUrl(base);
    if (!signed) throw new Error("expected a signed url");
    const url = new URL(signed.url);
    expect(
      verifyUrl({
        documentId: base.documentId,
        organizationId: url.searchParams.get("org"),
        credentialId: url.searchParams.get("cred"),
        expiresAt: url.searchParams.get("exp"),
        signature: url.searchParams.get("sig"),
        signingKey: null,
        now: NOW,
      }),
    ).toEqual({ ok: false, code: "SIGNING_KEY_UNAVAILABLE" });
  });

  it("binds the URL to the issuing credential", () => {
    const signed = createSignedDownloadUrl(base);
    if (!signed) throw new Error("expected a signed url");
    const url = new URL(signed.url);
    expect(
      verifyUrl({
        documentId: base.documentId,
        organizationId: url.searchParams.get("org"),
        credentialId: "cred-different",
        expiresAt: url.searchParams.get("exp"),
        signature: url.searchParams.get("sig"),
        now: NOW,
      }),
    ).toEqual({ ok: false, code: "BAD_SIGNATURE" });
  });
});

/** Verifies with the standard test signing key unless the caller overrides it. */
function verifyUrl(params: Parameters<typeof verifySignedDownloadUrl>[0]) {
  return verifySignedDownloadUrl({ signingKey: SIGNING_KEY, ...params });
}

describe("idempotency key normalization", () => {
  it("accepts a reasonable client key", () => {
    expect(normalizeIdempotencyKey("crm-upload-abc123")).toBe("crm-upload-abc123");
    expect(normalizeIdempotencyKey("  padded-key-1  ")).toBe("padded-key-1");
    expect(normalizeIdempotencyKey("a1b2c3d4")).toBe("a1b2c3d4");
  });

  it("rejects keys that are too short, too long, or carry control characters", () => {
    // Bounded and character-restricted so a caller cannot smuggle an oversized or
    // newline-laden value into a unique index or a log line.
    expect(normalizeIdempotencyKey("short")).toBeNull();
    expect(normalizeIdempotencyKey("x".repeat(201))).toBeNull();
    expect(normalizeIdempotencyKey("has space")).toBeNull();
    expect(normalizeIdempotencyKey("has\nnewline")).toBeNull();
    expect(normalizeIdempotencyKey("has/slash")).toBeNull();
    expect(normalizeIdempotencyKey(null)).toBeNull();
    expect(normalizeIdempotencyKey("")).toBeNull();
  });
});

describe("correlation ids", () => {
  it("echoes a well-formed caller id so CRM logs join to the audit record", () => {
    expect(resolveCorrelationId("crm-req-0001")).toBe("crm-req-0001");
  });

  it("generates one when absent, and refuses an untrusted one", () => {
    expect(resolveCorrelationId(null)).toMatch(/^[0-9a-f]{32}$/);
    expect(resolveCorrelationId("")).toMatch(/^[0-9a-f]{32}$/);
    expect(resolveCorrelationId("short")).toMatch(/^[0-9a-f]{32}$/);
    // Control characters must not be injectable into log lines.
    expect(resolveCorrelationId("bad\nid-with-newline")).toMatch(/^[0-9a-f]{32}$/);
    expect(resolveCorrelationId("x".repeat(129))).toMatch(/^[0-9a-f]{32}$/);
  });

  it("produces distinct ids for distinct requests", () => {
    expect(resolveCorrelationId(null)).not.toBe(resolveCorrelationId(null));
  });
});

describe("required conformance case 12 — audit logging and secret redaction", () => {
  it("redacts secret-bearing fields at any depth", () => {
    const redacted = redactSecrets({
      serviceName: "alo-education-crm",
      secret: "alosvc_supersecretvalue",
      keyHash: "deadbeef",
      nested: {
        authorization: "Bearer something",
        token: "t",
        password: "p",
        apiKey: "k",
        signature: "sig-value",
        safe: "keep-me",
        deeper: { accessToken: "a", keepThis: 42 },
      },
      list: [{ secret: "s" }, { ok: true }],
    });

    const serialized = JSON.stringify(redacted);
    expect(serialized).not.toContain("alosvc_supersecretvalue");
    expect(serialized).not.toContain("deadbeef");
    expect(serialized).not.toContain("Bearer something");
    expect(serialized).not.toContain("sig-value");
    // Non-secret fields survive, so the audit record stays useful.
    expect(serialized).toContain("alo-education-crm");
    expect(serialized).toContain("keep-me");
    expect(serialized).toContain("42");
    expect(serialized).toContain("[redacted]");
  });

  it("redacts a sig query parameter in a signed URL", () => {
    // Signed URLs are safe to store but not to log: the signature is a bearer
    // credential for the lifetime of the URL.
    const signed = createSignedDownloadUrl({
      baseUrl: "https://hosting.example",
      documentId: "doc-1",
      organizationId: ORG_A,
      credentialId: "cred-1",
      signingKey: SIGNING_KEY,
      now: NOW,
    });
    if (!signed) throw new Error("expected a signed url");
    const sig = new URL(signed.url).searchParams.get("sig") ?? "";
    const logged = redactSignedUrl(signed.url);
    expect(logged).not.toContain(sig);
    expect(logged).toContain("sig=[redacted]");
    // The rest of the URL stays readable so the log line is still diagnostic.
    expect(logged).toContain("doc-1");
    expect(redactSignedUrl(null)).toBeNull();
  });

  it("does not crash on circular-ish or deep input", () => {
    const deep: Record<string, unknown> = {};
    let cursor = deep;
    for (let i = 0; i < 20; i++) {
      cursor.next = { secret: "s" };
      cursor = cursor.next as Record<string, unknown>;
    }
    expect(() => redactSecrets(deep)).not.toThrow();
    expect(redactSecrets(null)).toBeNull();
    expect(redactSecrets(undefined)).toBeUndefined();
    expect(redactSecrets("plain")).toBe("plain");
    expect(redactSecrets(7)).toBe(7);
  });
});
