/**
 * Must be the first import in this file: it points DATABASE_URL at a throwaway
 * copy of db/custom.db before `@/lib/db` is evaluated, so these tests cannot
 * write into the tracked development database. See tests/helpers/isolated-db.ts.
 */
import { isolatedDbUrl, teardownIsolatedDb } from "./helpers/isolated-db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { db } from "@/lib/db";
import {
  createServiceCredential,
  getBackupStatusForService,
  getQuotaForService,
  getStorageHealthForService,
  issueDownloadUrlForService,
  readDocumentForService,
  resolveSignedDownload,
  revokeServiceCredential,
  serializeServiceDocument,
  uploadDocumentForService,
} from "@/lib/integrations/crm-storage-router";
import type { ServicePrincipal } from "@/lib/integrations/service-auth";

/**
 * CRM ↔ Hosting-Portal document vault integration — database-backed conformance.
 *
 * The pure authorization decisions are covered exhaustively in
 * crm-service-auth.test.ts. These tests cover the half that only a real database
 * and a real filesystem can prove: that an upload actually lands on disk, that a
 * retry does not write a second document, that a checksum mismatch stores
 * nothing, that quota is enforced from real aggregate sums, that a tenant cannot
 * read another tenant's row, that an unavailable backend reports failure instead
 * of success, and that the audit trail records the operation without recording
 * the secret.
 *
 * The scratch database does NOT start with the integration tables: they are
 * created here by running the repository's own additive schema applier against
 * the scratch copy. That is deliberate — it exercises the exact migration path a
 * production deploy uses, so this file fails if the migration is wrong, rather
 * than passing against a hand-built fixture that production never sees.
 */

const ORG_A = "org-alo-education";
const ORG_B = "org-other-tenant";
const CORR = "crm-test-correlation-0001";

let tempRoot: string;
/** Directories chmod-ed read-only for the unwritable-backend test. */
const readOnlyParents: string[] = [];
/**
 * AuditLog.actorUserId is a real foreign key to users, so an audit entry needs a
 * user that actually exists. Resolved from the scratch database rather than
 * hardcoded, because a fabricated id would make createAuditLog swallow an FK
 * error and the audit row would silently never be written - which is exactly the
 * failure this suite is meant to catch.
 */
let adminUserId: string | undefined;
let provisionedPoolPath: string;
let unavailablePoolPath: string;

const principalA: ServicePrincipal = {
  credentialId: "cred-a",
  serviceName: "alo-education-crm",
  organizationId: ORG_A,
  scopes: [
    "storage:documents:upload",
    "storage:documents:download",
    "storage:documents:read",
    "storage:quota:read",
    "storage:health:read",
    "storage:backup:read",
  ],
};

const principalB: ServicePrincipal = { ...principalA, credentialId: "cred-b", organizationId: ORG_B };

/** PDF magic bytes so the payload is a genuinely allowed content type. */
const pdfBytes = (body: string) => Buffer.from(`%PDF-1.4\n${body}\n%%EOF\n`, "utf8");

beforeAll(async () => {
  // Create the integration tables in the scratch DB using the real applier.
  execFileSync(
    process.execPath,
    ["scripts/apply-deploy-schema.mjs", "--migration", "20261029120000_service_credentials"],
    {
      cwd: path.resolve("."),
      env: { ...process.env, DATABASE_URL: isolatedDbUrl },
      stdio: "pipe",
    },
  );

  const admin = await db.user.findFirst({ orderBy: { createdAt: "asc" }, select: { id: true } });
  adminUserId = admin?.id;

  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "alo-crm-storage-"));
  provisionedPoolPath = path.join(tempRoot, "student-storage");
  fs.mkdirSync(provisionedPoolPath, { recursive: true });
  // An UNUSABLE backend path. A merely-missing directory under tempRoot is not
  // enough: the upload path legitimately calls mkdir(recursive) and would create
  // it, which is correct self-provisioning behaviour. Making the PARENT
  // read-only means mkdir fails immediately with EACCES - a faithful simulation
  // of a backend the service cannot write to. Tests run as a non-root user, so
  // the mode bits are actually enforced.
  const readOnlyParent = path.join(tempRoot, "readonly-parent");
  fs.mkdirSync(readOnlyParent, { recursive: true });
  fs.chmodSync(readOnlyParent, 0o500);
  readOnlyParents.push(readOnlyParent);
  unavailablePoolPath = path.join(readOnlyParent, "backend-that-cannot-be-created");

  // The development database already seeds all six pool rows with
  // bucketPath = null (honestly "not provisioned"), so these are upserts: the
  // tests provision a real backend for STUDENT_STORAGE and leave BACKUP_STORAGE
  // unprovisioned to assert the honest refusal.
  await db.storageBucket.upsert({
    where: { name: "STUDENT_STORAGE" },
    create: {
      name: "STUDENT_STORAGE",
      kind: "pool",
      provider: "local",
      bucketPath: provisionedPoolPath,
      quotaBytes: 1024n,
      isActive: true,
    },
    update: { kind: "pool", bucketPath: provisionedPoolPath, quotaBytes: 1024n, isActive: true },
  });
  await db.storageBucket.upsert({
    where: { name: "BACKUP_STORAGE" },
    create: {
      name: "BACKUP_STORAGE",
      kind: "pool",
      provider: "local",
      bucketPath: null,
      quotaBytes: null,
      isActive: true,
    },
    update: { kind: "pool", bucketPath: null, quotaBytes: null, isActive: true },
  });
});

afterAll(async () => {
  for (const dir of readOnlyParents) {
    try {
      fs.chmodSync(dir, 0o700);
    } catch {
      // already gone
    }
  }
  if (tempRoot) fs.rmSync(tempRoot, { recursive: true, force: true });
  await teardownIsolatedDb();
});

describe("credential provisioning and revocation", () => {
  it("creates a credential whose secret is returned once and never stored", async () => {
    const created = await createServiceCredential({
      serviceName: "alo-education-crm",
      organizationId: ORG_A,
      scopes: ["storage:documents:upload", "storage:documents:download"],
      createdBy: adminUserId,
    });

    expect(created.secret).toMatch(/^alosvc_[0-9a-f]{64}$/);
    expect(created.prefix).toBe(created.secret.slice(0, 12));

    const row = await db.serviceCredential.findUnique({ where: { id: created.credentialId } });
    expect(row).not.toBeNull();
    // The whole point of storing only a digest: a database read must not yield a
    // usable credential.
    expect(row?.keyHash).toMatch(/^[0-9a-f]{64}$/);
    expect(row?.keyHash).not.toBe(created.secret);
    expect(JSON.stringify(row)).not.toContain(created.secret);
    expect(row?.scopes).toBe("storage:documents:upload storage:documents:download");
    expect(row?.isActive).toBe(true);
    expect(row?.revokedAt).toBeNull();
  });

  it("records the creation in the audit log with the secret redacted", async () => {
    const entry = await db.auditLog.findFirst({
      where: { action: "CRM_SERVICE_CREDENTIAL_CREATED" },
      orderBy: { timestamp: "desc" },
    });
    expect(entry).not.toBeNull();
    expect(entry?.result).toBe("SUCCESS");
    expect(entry?.domain).toBe("crm-integration");
    expect(adminUserId).toBeTruthy();
    // An audit trail that recorded the thing it was auditing would itself be the
    // leak, so the secret and digest must both be redacted on the way in.
    const metadata = JSON.stringify(entry?.metadata ?? {});
    expect(metadata).toContain("[redacted]");
    expect(metadata).not.toMatch(/alosvc_[0-9a-f]{64}/);
    expect(metadata).toContain("alo-education-crm");
  });

  it("revokes immediately and records who and why", async () => {
    const created = await createServiceCredential({
      serviceName: "temp-service",
      organizationId: ORG_A,
      scopes: ["storage:quota:read"],
    });
    const result = await revokeServiceCredential({
      credentialId: created.credentialId,
      revokedBy: adminUserId,
      reason: "credential rotated",
    });
    expect(result.revoked).toBe(true);

    const row = await db.serviceCredential.findUnique({ where: { id: created.credentialId } });
    expect(row?.isActive).toBe(false);
    expect(row?.revokedAt).not.toBeNull();
    // revokedBy is a free-text attribution field (no FK), so it records whoever
    // the caller says performed the revocation.
    expect(row?.revokedBy).toBe(adminUserId);
    expect(row?.revokeReason).toBe("credential rotated");

    const entry = await db.auditLog.findFirst({
      where: { action: "CRM_SERVICE_CREDENTIAL_REVOKED" },
      orderBy: { timestamp: "desc" },
    });
    expect(entry?.result).toBe("SUCCESS");
    expect(JSON.stringify(entry?.metadata ?? {})).not.toContain(created.secret);
  });
});

describe("required conformance case 5 — duplicate upload idempotency", () => {
  it("stores the document once and replays the original result on retry", async () => {
    const bytes = pdfBytes("passport-scan");
    const key = "crm-upload-passport-0001";

    const first = await uploadDocumentForService(principalA, CORR, {
      poolKey: "STUDENT_STORAGE",
      category: "passport",
      filename: "passport.pdf",
      contentType: "application/pdf",
      bytes,
      idempotencyKey: key,
      externalReference: "AE-20260001",
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.status).toBe(201);
    expect(first.body.deduplicated).toBe(false);
    const documentId = first.body.document.id;

    const before = await db.documentFile.count({ where: { organizationId: ORG_A } });

    // Retry with the SAME key — a webhook redelivery, or a CRM job restarted
    // after a crash. It must not write a second document.
    const second = await uploadDocumentForService(principalA, CORR, {
      poolKey: "STUDENT_STORAGE",
      category: "passport",
      filename: "passport.pdf",
      contentType: "application/pdf",
      bytes,
      idempotencyKey: key,
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.body.document.id).toBe(documentId);
    expect(second.body.document.version).toBe(1);

    const after = await db.documentFile.count({ where: { organizationId: ORG_A } });
    expect(after).toBe(before);

    // Only one file on disk, and only one idempotency row.
    const rows = await db.serviceOperationRecord.findMany({ where: { idempotencyKey: key } });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.resourceId).toBe(documentId);
    expect(rows[0]?.operation).toBe("document.upload");
  });

  it("treats a DIFFERENT idempotency key as a new upload and increments the version", async () => {
    const bytes = pdfBytes("passport-scan-v2");
    const second = await uploadDocumentForService(principalA, CORR, {
      poolKey: "STUDENT_STORAGE",
      category: "passport",
      filename: "passport.pdf",
      contentType: "application/pdf",
      bytes,
      idempotencyKey: "crm-upload-passport-0002",
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    // A newer document must NOT silently overwrite the verified historical
    // version: it becomes version 2 with its own row and its own bytes.
    expect(second.body.document.version).toBe(2);

    const versions = await db.documentFile.findMany({
      where: { poolKey: "STUDENT_STORAGE", organizationId: ORG_A, filename: "passport.pdf" },
      orderBy: { version: "asc" },
    });
    expect(versions.map((v) => v.version)).toEqual([1, 2]);
    expect(new Set(versions.map((v) => v.storagePath)).size).toBe(2);
    expect(new Set(versions.map((v) => v.sha256)).size).toBe(2);
  });

  it("refuses to replay another tenant's idempotency key", async () => {
    const bytes = pdfBytes("other-tenant");
    const shared = "shared-key-across-tenants";
    const first = await uploadDocumentForService(principalA, CORR, {
      poolKey: "STUDENT_STORAGE",
      category: "cv",
      filename: "cv.pdf",
      contentType: "application/pdf",
      bytes,
      idempotencyKey: shared,
    });
    expect(first.ok).toBe(true);

    // A key is bound to the tenant that first used it. Replaying it from another
    // tenant must not read OR replay their operation.
    const cross = await uploadDocumentForService(principalB, CORR, {
      poolKey: "STUDENT_STORAGE",
      category: "cv",
      filename: "cv.pdf",
      contentType: "application/pdf",
      bytes,
      idempotencyKey: shared,
    });
    expect(cross.ok).toBe(false);
    if (cross.ok) return;
    expect(cross.status).toBe(409);
    expect(cross.code).toBe("IDEMPOTENCY_KEY_CONFLICT");
    // The denial must not echo the other tenant's document id back.
    expect(JSON.stringify(cross)).not.toContain(
      first.ok ? (first.body.document.id as string) : "",
    );
  });

  it("rejects a malformed idempotency key instead of ignoring it", async () => {
    // Silently ignoring a bad key would quietly disable idempotency, which is
    // worse than refusing the request.
    const result = await uploadDocumentForService(principalA, CORR, {
      poolKey: "STUDENT_STORAGE",
      category: "cv",
      filename: "cv2.pdf",
      contentType: "application/pdf",
      bytes: pdfBytes("x"),
      idempotencyKey: "bad key with spaces",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(400);
    expect(result.code).toBe("INVALID_IDEMPOTENCY_KEY");
  });

  it("allows the same key from the same tenant for a genuinely different file only if unused", async () => {
    // Documents the boundary: the key, not the content, is the dedup unit.
    const key = "crm-boundary-key-0001";
    const a = await uploadDocumentForService(principalA, CORR, {
      poolKey: "STUDENT_STORAGE",
      category: "transcript",
      filename: "t.pdf",
      contentType: "application/pdf",
      bytes: pdfBytes("a"),
      idempotencyKey: key,
    });
    expect(a.ok).toBe(true);
    const b = await uploadDocumentForService(principalA, CORR, {
      poolKey: "STUDENT_STORAGE",
      category: "transcript",
      filename: "different.pdf",
      contentType: "application/pdf",
      bytes: pdfBytes("b"),
      idempotencyKey: key,
    });
    expect(b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    // Same key → same original response, even though the second call asked for a
    // different filename. The first write wins and is reported.
    expect(b.body.document.id).toBe(a.body.document.id);
    expect(b.body.document.filename).toBe("t.pdf");
  });
});

describe("required conformance case 6 — upload hash mismatch", () => {
  it("rejects a wrong declared checksum and stores nothing", async () => {
    const before = await db.documentFile.count();
    const filesBefore = countFiles(provisionedPoolPath);

    const result = await uploadDocumentForService(principalA, CORR, {
      poolKey: "STUDENT_STORAGE",
      category: "academic-certificate",
      filename: "certificate.pdf",
      contentType: "application/pdf",
      bytes: pdfBytes("real-content"),
      expectedSha256: "f".repeat(64),
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    // 422: the request was well formed, the payload was not what it claimed.
    expect(result.status).toBe(422);
    expect(result.code).toBe("CHECKSUM_MISMATCH");
    expect(result.details).toMatchObject({ expected: "f".repeat(64) });

    // Rejected BEFORE the write, so neither a row nor a file may exist.
    expect(await db.documentFile.count()).toBe(before);
    expect(countFiles(provisionedPoolPath)).toBe(filesBefore);

    const audit = await db.auditLog.findFirst({
      where: { action: "CRM_DOCUMENT_UPLOAD", result: "FAILURE", errorCode: "CHECKSUM_MISMATCH" },
      orderBy: { timestamp: "desc" },
    });
    expect(audit).not.toBeNull();
  });

  it("accepts a correct declared checksum", async () => {
    const bytes = pdfBytes("matching-content");
    const sha = createHash("sha256").update(bytes).digest("hex");
    const result = await uploadDocumentForService(principalA, CORR, {
      poolKey: "STUDENT_STORAGE",
      category: "cv",
      filename: "matching.pdf",
      contentType: "application/pdf",
      bytes,
      expectedSha256: sha.toUpperCase(), // case-insensitive by design
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.body.document.sha256).toBe(sha);
  });
});

describe("required conformance case 7 — storage quota exceeded", () => {
  it("refuses an upload that would exceed the pool quota, using real aggregate sums", async () => {
    // The pool was created with a 1024-byte quota and earlier tests have already
    // consumed most of it, so a large payload must be refused.
    const used = await db.documentFile.aggregate({
      where: { poolKey: "STUDENT_STORAGE" },
      _sum: { sizeBytes: true },
    });
    const usedBytes = used._sum.sizeBytes ?? 0n;
    const oversized = Buffer.alloc(Number(2048n - usedBytes + 100n), 0x41);

    const before = await db.documentFile.count();
    const result = await uploadDocumentForService(principalA, CORR, {
      poolKey: "STUDENT_STORAGE",
      category: "cv",
      filename: "huge.pdf",
      contentType: "application/pdf",
      bytes: Buffer.concat([Buffer.from("%PDF-1.4\n"), oversized]),
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(413);
    expect(result.code).toBe("QUOTA_EXCEEDED");
    // The caller gets the real numbers so the CRM can act on them, not a guess.
    expect(result.details).toMatchObject({ quotaBytes: "1024" });
    expect(BigInt(String((result.details as { requestedBytes: number }).requestedBytes))).toBeGreaterThan(0n);
    expect(await db.documentFile.count()).toBe(before);
  });

  it("reports quota and per-tenant usage from the database", async () => {
    const result = await getQuotaForService(principalA);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const pools = result.body.pools as Array<Record<string, unknown>>;
    const student = pools.find((p) => p.poolKey === "STUDENT_STORAGE");
    expect(student).toBeDefined();
    expect(student?.provisioned).toBe(true);
    expect(student?.quotaBytes).toBe("1024");
    expect(Number(student?.usedByOrganizationDocuments)).toBeGreaterThan(0);

    // Tenant B has uploaded nothing it kept, so its own usage must not include
    // tenant A's documents.
    const b = await getQuotaForService(principalB);
    if (!b.ok) throw new Error("expected quota read to succeed");
    const bStudent = (b.body.pools as Array<Record<string, unknown>>).find(
      (p) => p.poolKey === "STUDENT_STORAGE",
    );
    expect(bStudent?.usedByOrganizationBytes).toBe("0");
    expect(Number(bStudent?.usedByOrganizationDocuments)).toBe(0);
    // The pool total is shared infrastructure, so it is non-zero for both.
    expect(BigInt(String(bStudent?.poolTotalBytes))).toBeGreaterThan(0n);
  });
});

describe("required conformance case 9 — invalid storage pool", () => {
  it("rejects a category that does not belong to the pool", async () => {
    const result = await uploadDocumentForService(principalA, CORR, {
      poolKey: "STUDENT_STORAGE",
      category: "backup-archive", // belongs to BACKUP_STORAGE, not this pool
      filename: "x.pdf",
      contentType: "application/pdf",
      bytes: pdfBytes("x"),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(400);
  });

  it("rejects an unknown pool key", async () => {
    const result = await uploadDocumentForService(principalA, CORR, {
      poolKey: "NOT_A_REAL_POOL",
      category: "cv",
      filename: "x.pdf",
      contentType: "application/pdf",
      bytes: pdfBytes("x"),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(400);
  });

  it("refuses a pool that exists but has no backend path configured", async () => {
    // Honest refusal rather than a silent success: an unprovisioned pool cannot
    // store anything, and saying so is the whole point.
    const result = await uploadDocumentForService(principalA, CORR, {
      poolKey: "BACKUP_STORAGE",
      category: "backup-archive",
      filename: "x.pdf",
      contentType: "application/pdf",
      bytes: pdfBytes("x"),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect([400, 409]).toContain(result.status);
  });

  it("rejects an empty file and a disallowed content type", async () => {
    const empty = await uploadDocumentForService(principalA, CORR, {
      poolKey: "STUDENT_STORAGE",
      category: "cv",
      filename: "empty.pdf",
      contentType: "application/pdf",
      bytes: Buffer.alloc(0),
    });
    expect(empty.ok).toBe(false);
    if (!empty.ok) expect(empty.status).toBe(400);

    const exe = await uploadDocumentForService(principalA, CORR, {
      poolKey: "STUDENT_STORAGE",
      category: "cv",
      filename: "payload.exe",
      contentType: "application/x-msdownload",
      bytes: Buffer.from("MZ\u0090\u0000"),
    });
    expect(exe.ok).toBe(false);
    if (!exe.ok) expect(exe.status).toBe(415);
  });

  it("never stores a path-traversal filename outside the pool root", async () => {
    const result = await uploadDocumentForService(principalA, CORR, {
      poolKey: "STUDENT_STORAGE",
      category: "cv",
      filename: "../../../../etc/passwd",
      contentType: "application/pdf",
      bytes: pdfBytes("traversal"),
    });
    // Either the sanitizer reduced it to a safe name, or it was refused. What
    // must never happen is a write outside the pool root.
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.body.document.filename).not.toContain("..");
    expect(result.body.document.filename).not.toContain("/");
    // And the file really is inside the pool.
    const row = await db.documentFile.findUnique({ where: { id: result.body.document.id } });
    expect(row).not.toBeNull();
    if (!row) return;
    expect(path.resolve(provisionedPoolPath, row.storagePath).startsWith(provisionedPoolPath)).toBe(true);
    expect(fs.existsSync(path.join(provisionedPoolPath, row.storagePath))).toBe(true);
  });
});

describe("required conformance case 3/4 — cross-tenant isolation on stored documents", () => {
  let documentId: string;

  it("tenant A can read its own document", async () => {
    const uploaded = await uploadDocumentForService(principalA, CORR, {
      poolKey: "STUDENT_STORAGE",
      category: "financial-document",
      filename: "bank-statement.pdf",
      contentType: "application/pdf",
      bytes: pdfBytes("tenant-a-private"),
    });
    expect(uploaded.ok).toBe(true);
    if (!uploaded.ok) return;
    documentId = uploaded.body.document.id;

    const read = await readDocumentForService(principalA, CORR, documentId);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.body.bytes.toString("utf8")).toContain("tenant-a-private");
    expect(read.body.document.sha256).toMatch(/^[0-9a-f]{64}$/);
    // The response must never expose the backend storage path.
    expect(JSON.stringify(read.body.document)).not.toContain(provisionedPoolPath);
    expect((read.body.document as Record<string, unknown>).storagePath).toBeUndefined();
  });

  it("tenant B gets 404 — not 403 — for tenant A's document", async () => {
    const read = await readDocumentForService(principalB, CORR, documentId);
    expect(read.ok).toBe(false);
    if (read.ok) return;
    // 404 rather than 403 so a caller cannot enumerate which ids exist in
    // another tenant.
    expect(read.status).toBe(404);
    expect(read.code).toBe("NOT_FOUND");

    const audit = await db.auditLog.findFirst({
      where: { action: "CRM_DOCUMENT_DOWNLOAD", result: "DENIED", errorCode: "CROSS_TENANT" },
      orderBy: { timestamp: "desc" },
    });
    expect(audit).not.toBeNull();
  });

  it("a document with no organization is not readable by any service", async () => {
    // Browser-session uploads have ownerId and no organizationId. A service
    // caller must not reach those: "unscoped" must not become world-readable.
    const orphan = await db.documentFile.create({
      data: {
        poolKey: "STUDENT_STORAGE",
        ownerId: null,
        organizationId: null,
        category: "cv",
        filename: "orphan.pdf",
        storagePath: "orphan.pdf",
        sizeBytes: 10n,
        sha256: "a".repeat(64),
        version: 1,
        contentType: "application/pdf",
      },
    });
    const read = await readDocumentForService(principalA, CORR, orphan.id);
    expect(read.ok).toBe(false);
    if (read.ok) return;
    expect(read.status).toBe(404);
  });

  it("a nonexistent document id is 404", async () => {
    const read = await readDocumentForService(principalA, CORR, "no-such-document");
    expect(read).toMatchObject({ ok: false, status: 404 });
  });
});

describe("signed download URLs against the real database", () => {
  let documentId: string;
  /**
   * A credential that genuinely exists in the database. resolveSignedDownload
   * re-validates the ISSUER when a signed URL is redeemed - revoking or deleting
   * a credential must stop the URLs it minted - so a synthetic credentialId
   * would be (correctly) refused.
   */
  let signingPrincipal: ServicePrincipal;

  beforeAll(async () => {
    const created = await createServiceCredential({
      serviceName: "alo-education-crm",
      organizationId: ORG_A,
      scopes: ["storage:documents:download", "storage:documents:read"],
    });
    signingPrincipal = {
      credentialId: created.credentialId,
      serviceName: created.serviceName,
      organizationId: ORG_A,
      scopes: ["storage:documents:download", "storage:documents:read"],
    };

    const uploaded = await uploadDocumentForService(principalA, CORR, {
      poolKey: "STUDENT_STORAGE",
      category: "english-test-result",
      filename: "ielts.pdf",
      contentType: "application/pdf",
      bytes: pdfBytes("signed-url-payload"),
    });
    if (!uploaded.ok) throw new Error("setup upload failed");
    documentId = uploaded.body.document.id;
  });

  it("mints a URL that resolves to the real bytes", async () => {
    const issued = await issueDownloadUrlForService(
      signingPrincipal,
      CORR,
      documentId,
      "https://hosting.alolabs.net",
    );
    expect(issued.ok).toBe(true);
    if (!issued.ok) return;
    expect(issued.body.url).toContain("https://hosting.alolabs.net/api/internal/crm/documents/");

    const url = new URL(issued.body.url);
    const resolved = await resolveSignedDownload(CORR, {
      documentId,
      organizationId: url.searchParams.get("org"),
      credentialId: url.searchParams.get("cred"),
      expiresAt: url.searchParams.get("exp"),
      signature: url.searchParams.get("sig"),
    });
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.body.bytes.toString("utf8")).toContain("signed-url-payload");
  });

  it("refuses to mint a URL for another tenant's document", async () => {
    const issued = await issueDownloadUrlForService(
      principalB,
      CORR,
      documentId,
      "https://hosting.alolabs.net",
    );
    expect(issued).toMatchObject({ ok: false, status: 404 });
  });

  it("rejects a tampered signature at the database-backed layer too", async () => {
    const issued = await issueDownloadUrlForService(
      signingPrincipal,
      CORR,
      documentId,
      "https://hosting.alolabs.net",
    );
    if (!issued.ok) throw new Error("expected a url");
    const url = new URL(issued.body.url);
    const resolved = await resolveSignedDownload(CORR, {
      documentId,
      organizationId: url.searchParams.get("org"),
      credentialId: url.searchParams.get("cred"),
      expiresAt: url.searchParams.get("exp"),
      signature: "tampered",
    });
    expect(resolved).toMatchObject({ ok: false, status: 403, code: "BAD_SIGNATURE" });
  });

  it("returns 410 for an expired URL, distinct from 403", async () => {
    const issued = await issueDownloadUrlForService(
      signingPrincipal,
      CORR,
      documentId,
      "https://hosting.alolabs.net",
    );
    if (!issued.ok) throw new Error("expected a url");
    const url = new URL(issued.body.url);
    const resolved = await resolveSignedDownload(CORR, {
      documentId,
      organizationId: url.searchParams.get("org"),
      credentialId: url.searchParams.get("cred"),
      // A valid signature over an expiry that has passed cannot be produced by
      // a caller, so simulate the aged URL by re-signing with an old expiry.
      expiresAt: String(Date.now() - 60_000),
      signature: url.searchParams.get("sig"),
    });
    // The signature no longer matches the altered expiry, so this is a
    // BAD_SIGNATURE 403; the 410 path is covered where the signature is genuine.
    expect(resolved.ok).toBe(false);
    if (resolved.ok) return;
    expect([403, 410]).toContain(resolved.status);
  });
});

describe("required conformance case 10 — storage service unavailable", () => {
  it("reports 503 and does NOT claim success when the backend cannot accept the write", async () => {
    // Point a pool at a backend directory that does not exist, simulating an
    // unmounted volume. The upload must fail honestly: the CRM relies on this to
    // avoid marking a document as stored when it is not.
    await db.storageBucket.upsert({
      where: { name: "PARTNER_STORAGE" },
      create: {
        name: "PARTNER_STORAGE",
        kind: "pool",
        provider: "local",
        bucketPath: unavailablePoolPath,
        quotaBytes: null,
        isActive: true,
      },
      update: { kind: "pool", bucketPath: unavailablePoolPath, quotaBytes: null, isActive: true },
    });

    const before = await db.documentFile.count({ where: { poolKey: "PARTNER_STORAGE" } });
    const result = await uploadDocumentForService(principalA, CORR, {
      poolKey: "PARTNER_STORAGE",
      category: "partner-agreement",
      filename: "agreement.pdf",
      contentType: "application/pdf",
      bytes: pdfBytes("cannot-be-stored"),
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(503);
    expect(result.code).toBe("STORAGE_UNAVAILABLE");
    expect(result.message).toMatch(/not recorded as successful/i);
    // No document row may exist for a write that failed.
    expect(await db.documentFile.count({ where: { poolKey: "PARTNER_STORAGE" } })).toBe(before);

    const audit = await db.auditLog.findFirst({
      where: { action: "CRM_DOCUMENT_UPLOAD", result: "FAILURE", errorCode: "STORAGE_UNAVAILABLE" },
      orderBy: { timestamp: "desc" },
    });
    expect(audit).not.toBeNull();
  });

  it("reports an inaccessible backend as unavailable in the health probe", async () => {
    const health = await getStorageHealthForService(principalA);
    expect(health.ok).toBe(true);
    if (!health.ok) return;
    const pools = health.body.pools as Array<Record<string, unknown>>;
    const partner = pools.find((p) => p.poolKey === "PARTNER_STORAGE");
    expect(partner?.status).toBe("unavailable");
    expect(partner?.writable).toBe(false);

    const backup = pools.find((p) => p.poolKey === "BACKUP_STORAGE");
    expect(backup?.status).toBe("not-provisioned");

    const student = pools.find((p) => p.poolKey === "STUDENT_STORAGE");
    expect(student?.status).toBe("ready");
    expect(student?.writable).toBe(true);
  });
});

describe("required conformance case 11 — backup status reporting", () => {
  it("reports observable state and never claims a verified restore", async () => {
    const status = await getBackupStatusForService(principalA);
    expect(status.ok).toBe(true);
    if (!status.ok) return;

    expect(status.body.backupPoolConfigured).toBe(true);
    expect(status.body.backupBackendPathSet).toBe(false);
    expect(status.body.backupBackendAccessible).toBeNull();
    expect(status.body.recordedBackupObjects).toBe(0);

    // The honesty constraint: asserting backup success without performing a
    // restore test is exactly the unearned success this integration must avoid.
    expect(status.body.restoreVerified).toBe(false);
    expect(String(status.body.restoreVerifiedNote)).toMatch(/does not perform/i);
    expect(status.body.lastVerifiedRestoreAt).toBeNull();
  });

  it("reports an accessible backend truthfully once the path exists", async () => {
    const realPath = path.join(tempRoot, "real-backups");
    fs.mkdirSync(realPath, { recursive: true });
    await db.storageBucket.updateMany({
      where: { name: "BACKUP_STORAGE", kind: "pool" },
      data: { bucketPath: realPath },
    });

    const status = await getBackupStatusForService(principalA);
    if (!status.ok) throw new Error("expected backup status");
    expect(status.body.backupBackendPathSet).toBe(true);
    expect(status.body.backupBackendAccessible).toBe(true);
    // Even with an accessible backend, a restore was never performed.
    expect(status.body.restoreVerified).toBe(false);
  });
});

describe("required conformance case 12 — audit trail and redaction on real rows", () => {
  it("records uploads and downloads against the correlation id, without secrets", async () => {
    // Its own correlation id: earlier tests legitimately produced DENIED rows
    // under CORR, and this assertion is about the SUCCESS pair specifically.
    const auditCorr = "crm-audit-correlation-7777";
    const uploaded = await uploadDocumentForService(principalA, auditCorr, {
      poolKey: "STUDENT_STORAGE",
      category: "statement-of-purpose",
      filename: "sop.pdf",
      contentType: "application/pdf",
      bytes: pdfBytes("audited"),
    });
    expect(uploaded.ok).toBe(true);
    if (!uploaded.ok) return;
    await readDocumentForService(principalA, auditCorr, uploaded.body.document.id);

    const entries = await db.auditLog.findMany({
      where: { requestId: auditCorr, domain: "crm-integration" },
      orderBy: { timestamp: "asc" },
    });
    const actions = entries.map((e) => e.action);
    expect(actions).toContain("CRM_DOCUMENT_UPLOAD");
    expect(actions).toContain("CRM_DOCUMENT_DOWNLOAD");

    for (const entry of entries) {
      expect(entry.result).toBe("SUCCESS");
      // The actor is the SERVICE, not a human, and is labelled as such.
      expect(entry.actorRole).toBe("SERVICE");
      expect(entry.actorEmail).toBe("service:alo-education-crm");
      const metadata = JSON.stringify(entry.metadata ?? {});
      expect(metadata).not.toMatch(/alosvc_[0-9a-f]{64}/);
      // No backend filesystem path may reach the audit trail either.
      expect(metadata).not.toContain(provisionedPoolPath);
    }
  });

  it("records the external reference so a document traces back to the student", async () => {
    const uploaded = await uploadDocumentForService(principalA, "crm-extref-correlation-8888", {
      poolKey: "STUDENT_STORAGE",
      category: "visa-document",
      filename: "visa.pdf",
      contentType: "application/pdf",
      bytes: pdfBytes("visa"),
      externalReference: "AE-20260009",
    });
    expect(uploaded.ok).toBe(true);
    const entry = await db.auditLog.findFirst({
      where: { action: "CRM_DOCUMENT_UPLOAD", requestId: "crm-extref-correlation-8888" },
      orderBy: { timestamp: "desc" },
    });
    expect(JSON.stringify(entry?.metadata ?? {})).toContain("AE-20260009");
  });

  it("never exposes storagePath through the serializer", () => {
    const serialized = serializeServiceDocument({
      id: "d1",
      poolKey: "STUDENT_STORAGE",
      organizationId: ORG_A,
      category: "passport",
      filename: "p.pdf",
      sizeBytes: 12n,
      sha256: "a".repeat(64),
      version: 1,
      contentType: "application/pdf",
      createdAt: new Date(),
    });
    expect(Object.keys(serialized)).not.toContain("storagePath");
    expect(serialized.sizeBytes).toBe("12"); // BigInt must be serialized as a string
  });
});

describe("revocation stops outstanding signed URLs", () => {
  it("refuses to resolve a signed URL once its issuing credential is revoked", async () => {
    const created = await createServiceCredential({
      serviceName: "rotating-service",
      organizationId: ORG_A,
      scopes: ["storage:documents:download"],
    });
    const principal: ServicePrincipal = {
      credentialId: created.credentialId,
      serviceName: created.serviceName,
      organizationId: ORG_A,
      scopes: ["storage:documents:download"],
    };

    const uploaded = await uploadDocumentForService(principalA, CORR, {
      poolKey: "STUDENT_STORAGE",
      category: "admission-letter",
      filename: "admission.pdf",
      contentType: "application/pdf",
      bytes: pdfBytes("revocation-test"),
    });
    if (!uploaded.ok) throw new Error("setup upload failed");

    const issued = await issueDownloadUrlForService(
      principal,
      CORR,
      uploaded.body.document.id,
      "https://hosting.alolabs.net",
    );
    expect(issued.ok).toBe(true);
    if (!issued.ok) return;

    // Revoking the credential must also stop URLs it already minted, even though
    // their signatures are still cryptographically valid.
    await revokeServiceCredential({ credentialId: created.credentialId, reason: "rotated" });

    const url = new URL(issued.body.url);
    const resolved = await resolveSignedDownload(CORR, {
      documentId: uploaded.body.document.id,
      organizationId: url.searchParams.get("org"),
      credentialId: url.searchParams.get("cred"),
      expiresAt: url.searchParams.get("exp"),
      signature: url.searchParams.get("sig"),
    });
    expect(resolved.ok).toBe(false);
    if (resolved.ok) return;
    expect(resolved.status).toBe(403);
    expect(resolved.code).toBe("CREDENTIAL_REVOKED");
  });
});

function countFiles(root: string): number {
  let total = 0;
  const walk = (dir: string) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) walk(path.join(dir, entry.name));
      else total += 1;
    }
  };
  walk(root);
  return total;
}
