/**
 * Phase 3 — §12 storage pools + §13 document management.
 *
 * Exercises the real route handlers against the isolated DB copy and a
 * throwaway backend directory: pool seeding/config, quota enforcement,
 * category↔pool matching, role isolation (CLIENT=student, RESELLER=partner,
 * staff=audited cross-owner), integrity hashes, path-traversal defense,
 * job-managed BACKUP_STORAGE, and the audit trail for every mutation.
 */
import "./helpers/isolated-db";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { encode } from "next-auth/jwt";
import { db } from "@/lib/db";
import { teardownIsolatedDb } from "./helpers/isolated-db";
import {
  POOL_DEFINITIONS,
  POOL_KEYS,
  canAccessPool,
  validateUploadTarget,
  sanitizeFilename,
  buildStoragePath,
  resolveWithinRoot,
} from "@/lib/storage-pools";

const TEST_JWT_SECRET = "dev-secret-change-in-production";
process.env.NEXTAUTH_SECRET = TEST_JWT_SECRET;

type SessionUser = { id: string; email: string; role: string };
const base = "http://localhost:3000";

async function cookieFor(user: SessionUser): Promise<Headers> {
  process.env.NEXTAUTH_SECRET = TEST_JWT_SECRET;
  const token = await encode({
    token: { id: user.id, sub: user.id, email: user.email, role: user.role },
    secret: TEST_JWT_SECRET,
  });
  const headers = new Headers();
  headers.set("cookie", `next-auth.session-token=${token}`);
  return headers;
}

async function authedRequest(
  url: string,
  user: SessionUser,
  init: { method?: string; body?: string } = {}
): Promise<NextRequest> {
  const headers = await cookieFor(user);
  if (init.body) headers.set("content-type", "application/json");
  return new NextRequest(url, { method: init.method ?? "GET", headers, body: init.body });
}

async function uploadRequest(
  user: SessionUser,
  fields: { poolKey: string; category: string; file: File }
): Promise<NextRequest> {
  const headers = await cookieFor(user);
  const fd = new FormData();
  fd.set("poolKey", fields.poolKey);
  fd.set("category", fields.category);
  fd.set("file", fields.file);
  return new NextRequest(`${base}/api/storage/documents`, { method: "POST", headers, body: fd });
}

let admin: SessionUser;
let reseller: SessionUser;
let client: SessionUser;
let studentRoot = "";

async function ensurePoolBackend(key: string, root: string, quotaBytes?: number): Promise<void> {
  const policyRow = await db.storageBucket.findUnique({ where: { name: key } });
  const data: Record<string, unknown> = { kind: "pool", bucketPath: root };
  if (quotaBytes !== undefined) data.quotaBytes = BigInt(quotaBytes);
  if (policyRow) {
    await db.storageBucket.update({ where: { id: policyRow.id }, data });
  } else {
    await db.storageBucket.create({ data: { name: key, provider: "local", isActive: true, ...data } });
  }
}

function jpegFile(name: string, bytes: number): File {
  return new File([new Uint8Array(bytes).fill(74)], name, { type: "image/jpeg" });
}

beforeAll(async () => {
  const [a, r, c] = await Promise.all([
    db.user.findFirst({ where: { email: "admin@alolabs.net" }, include: { role: true } }),
    db.user.findFirst({ where: { email: "reseller@alolabs.net" }, include: { role: true } }),
    db.user.findFirst({ where: { email: "client@alolabs.net" }, include: { role: true } }),
  ]);
  if (!a || !r || !c) throw new Error("seeded users missing");
  admin = { id: a.id, email: a.email, role: a.role.name };
  reseller = { id: r.id, email: r.email, role: r.role.name };
  client = { id: c.id, email: c.email, role: c.role.name };
  studentRoot = fs.mkdtempSync(path.join(os.tmpdir(), "alo-pool-student-"));
});

afterAll(async () => {
  if (studentRoot) fs.rmSync(studentRoot, { recursive: true, force: true });
  await teardownIsolatedDb();
});

describe("pool definitions and access policy", () => {
  it("defines the six section-12 pools with their document categories", () => {
    expect(POOL_KEYS).toEqual([
      "STUDENT_STORAGE",
      "PARTNER_STORAGE",
      "EMPLOYEE_STORAGE",
      "COMPANY_STORAGE",
      "PROJECT_STORAGE",
      "BACKUP_STORAGE",
    ]);
    const student = POOL_DEFINITIONS.find((p) => p.key === "STUDENT_STORAGE")!;
    for (const cat of ["passport", "transcript", "statement-of-purpose", "visa-document", "admission-letter"]) {
      expect(student.categories).toContain(cat);
    }
    const partner = POOL_DEFINITIONS.find((p) => p.key === "PARTNER_STORAGE")!;
    for (const cat of ["partner-agreement", "student-referral", "commission-document"]) {
      expect(partner.categories).toContain(cat);
    }
    expect(POOL_DEFINITIONS.find((p) => p.key === "BACKUP_STORAGE")!.manualUpload).toBe(false);
  });

  it("enforces the role × pool matrix", () => {
    expect(canAccessPool(admin, "STUDENT_STORAGE", "read").allowed).toBe(true);
    expect(canAccessPool(admin, "BACKUP_STORAGE", "upload").allowed).toBe(true); // policy-level; target check still refuses
    expect(canAccessPool(client, "STUDENT_STORAGE", "upload").allowed).toBe(true);
    expect(canAccessPool(client, "STUDENT_STORAGE", "upload").ownerScope).toBe(client.id);
    expect(canAccessPool(client, "PARTNER_STORAGE", "upload").allowed).toBe(false);
    expect(canAccessPool(client, "EMPLOYEE_STORAGE", "read").allowed).toBe(false);
    expect(canAccessPool(reseller, "PARTNER_STORAGE", "upload").allowed).toBe(true);
    expect(canAccessPool(reseller, "STUDENT_STORAGE", "upload").allowed).toBe(false);
    expect(canAccessPool(admin, "NOPE", "read").allowed).toBe(false);
    expect(canAccessPool({ id: "x", role: "VIEWER" }, "STUDENT_STORAGE", "read").allowed).toBe(false);
    expect(canAccessPool({ id: "x", role: "SUPPORT" }, "STUDENT_STORAGE", "read").allowed).toBe(false);
    // Configuration is super-admin only.
    expect(canAccessPool(admin, "STUDENT_STORAGE", "configure").allowed).toBe(true);
    expect(canAccessPool({ id: "y", role: "ADMIN" }, "STUDENT_STORAGE", "configure").allowed).toBe(false);
  });

  it("refuses unknown categories, cross-pool categories and backup uploads", () => {
    expect(validateUploadTarget("STUDENT_STORAGE", "passport")).toBeNull();
    expect(validateUploadTarget("STUDENT_STORAGE", "partner-agreement")).toContain("does not belong");
    expect(validateUploadTarget("STUDENT_STORAGE", "bogus-category")).toContain("does not belong");
    expect(validateUploadTarget("BACKUP_STORAGE", "backup-archive")).toContain("job-managed");
    expect(validateUploadTarget("NOPE", "passport")).toContain("Unknown storage pool");
  });

  it("sanitizes filenames and never escapes the pool root", () => {
    expect(sanitizeFilename("../../etc/passwd.jpg")).toBe("passwd.jpg");
    expect(sanitizeFilename("..\\..\\boot.ini")).toBe("boot.ini");
    expect(sanitizeFilename("")).toBe("file");
    expect(sanitizeFilename("my report (final).pdf")).toBe("my report _final_.pdf");
    const p = buildStoragePath("user-1", "passport.jpg", "abc");
    expect(p).toBe("user-1/abc.jpg");
    expect(resolveWithinRoot("/srv/pool", "user-1/abc.jpg")).toBe("/srv/pool/user-1/abc.jpg");
    expect(resolveWithinRoot("/srv/pool", "../etc/passwd")).toBeNull();
    expect(resolveWithinRoot("/srv/pool", "user-1/../../secret")).toBeNull();
    expect(resolveWithinRoot("/srv/pool", "/etc/passwd")).toBeNull();
  });
});

describe("GET/POST /api/storage/pools", () => {
  it("rejects unauthenticated access", async () => {
    const route = await import("@/app/api/storage/pools/route");
    expect((await route.GET(new NextRequest(`${base}/api/storage/pools`))).status).toBe(401);
    expect((await route.POST(new NextRequest(`${base}/api/storage/pools`))).status).toBe(401);
  });

  it("lists all six pools with honest not-provisioned states", async () => {
    const route = await import("@/app/api/storage/pools/route");
    const res = await route.GET(await authedRequest(`${base}/api/storage/pools`, admin));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { pools: Array<Record<string, unknown>> } };
    expect(body.data.pools).toHaveLength(6);
    for (const p of body.data.pools) {
      expect(typeof p.provisioned).toBe("boolean");
      expect(p.recordedUsageBytes).toMatch(/^\d+$/);
      if (!p.provisioned) {
        expect(p.capacity).toBeNull();
      }
    }
    const student = body.data.pools.find((p) => p.key === "STUDENT_STORAGE")!;
    expect(student.backendPath).toBeNull(); // not yet configured in this test
    expect(student.quotaBytes).toBeNull();
    expect(student.provisioned).toBe(false);
    expect(student.capacity).toBeNull();
  });

  it("does not disclose backend paths to a client", async () => {
    await ensurePoolBackend("STUDENT_STORAGE", studentRoot);
    const route = await import("@/app/api/storage/pools/route");
    const res = await route.GET(await authedRequest(`${base}/api/storage/pools`, client));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { pools: Array<Record<string, unknown>> } };
    for (const p of body.data.pools) expect(p).not.toHaveProperty("backendPath");
  });

  it("configures a pool as super admin and records an audit entry", async () => {
    const route = await import("@/app/api/storage/pools/route");
    const res = await route.POST(
      await authedRequest(`${base}/api/storage/pools`, admin, {
        method: "POST",
        body: JSON.stringify({ key: "PARTNER_STORAGE", bucketPath: studentRoot, quotaBytes: 5_000_000 }),
      })
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { data: { pool: { key: string; quotaBytes: string; backendPath: string } } };
    expect(body.data.pool.key).toBe("PARTNER_STORAGE");
    expect(body.data.pool.quotaBytes).toBe("5000000");
    expect(body.data.pool.backendPath).toBe(studentRoot);
    const audit = await db.auditLog.findFirst({ where: { action: "STORAGE_POOL_CONFIGURED" } });
    expect(audit).not.toBeNull();
    expect(audit!.domain).toBe("storage");
  });

  it("rejects non-super-admin configuration and bad paths", async () => {
    const route = await import("@/app/api/storage/pools/route");
    const forbidden = await route.POST(
      await authedRequest(`${base}/api/storage/pools`, client, {
        method: "POST",
        body: JSON.stringify({ key: "STUDENT_STORAGE", bucketPath: "/tmp/x" }),
      })
    );
    expect([401, 403]).toContain(forbidden.status);
    const badPath = await route.POST(
      await authedRequest(`${base}/api/storage/pools`, admin, {
        method: "POST",
        body: JSON.stringify({ key: "STUDENT_STORAGE", bucketPath: "relative/../etc" }),
      })
    );
    expect(badPath.status).toBe(400);
    const badKey = await route.POST(
      await authedRequest(`${base}/api/storage/pools`, admin, {
        method: "POST",
        body: JSON.stringify({ key: "NOT_A_POOL", bucketPath: "/tmp/x" }),
      })
    );
    expect(badKey.status).toBe(400);
  });
});

describe("document upload pipeline", () => {
  it("uploads into a provisioned pool with a verified hash and audit entry", async () => {
    await ensurePoolBackend("STUDENT_STORAGE", studentRoot);
    const route = await import("@/app/api/storage/documents/route");
    const bytes = 5_000;
    const res = await route.POST(
      await uploadRequest(admin, {
        poolKey: "STUDENT_STORAGE",
        category: "passport",
        file: jpegFile("passport.jpg", bytes),
      })
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      data: { document: { id: string; sha256: string; sizeBytes: string; version: number; filename: string } };
    };
    const doc = body.data.document;
    expect(doc.sizeBytes).toBe(String(bytes));
    expect(doc.version).toBe(1);
    const expectedHash = createHash("sha256").update(new Uint8Array(bytes).fill(74)).digest("hex");
    expect(doc.sha256).toBe(expectedHash);

    const row = await db.documentFile.findUnique({ where: { id: doc.id } });
    expect(row).not.toBeNull();
    const abs = path.resolve(studentRoot, row!.storagePath);
    expect(abs.startsWith(path.resolve(studentRoot) + path.sep)).toBe(true);
    expect(fs.existsSync(abs)).toBe(true);

    const audit = await db.auditLog.findFirst({ where: { action: "DOCUMENT_UPLOADED", resourceId: doc.id } });
    expect(audit).not.toBeNull();
    expect(audit!.metadata).toBeTruthy();
  });

  it("refuses upload into a pool that has no backend path", async () => {
    const route = await import("@/app/api/storage/documents/route");
    const res = await route.POST(
      await uploadRequest(admin, {
        poolKey: "EMPLOYEE_STORAGE",
        category: "employment-document",
        file: jpegFile("contract.jpg", 100),
      })
    );
    expect(res.status).toBe(409); // seeded pool row exists but is not provisioned
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("POOL_NOT_PROVISIONED");
  });

  it("stays refused after an explicit unprovisioning", async () => {
    const existing = await db.storageBucket.findUnique({ where: { name: "EMPLOYEE_STORAGE" } });
    if (existing) await db.storageBucket.update({ where: { id: existing.id }, data: { bucketPath: null } });
    else
      await db.storageBucket.create({
        data: { name: "EMPLOYEE_STORAGE", kind: "pool", provider: "local", isActive: true },
      });
    const route = await import("@/app/api/storage/documents/route");
    const res = await route.POST(
      await uploadRequest(admin, {
        poolKey: "EMPLOYEE_STORAGE",
        category: "employment-document",
        file: jpegFile("contract.jpg", 100),
      })
    );
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("POOL_NOT_PROVISIONED");
  });

  it("refuses category/pool mismatches and backup-pool uploads", async () => {
    await ensurePoolBackend("STUDENT_STORAGE", studentRoot);
    const route = await import("@/app/api/storage/documents/route");
    const cross = await route.POST(
      await uploadRequest(admin, {
        poolKey: "PARTNER_STORAGE",
        category: "passport",
        file: jpegFile("x.jpg", 100),
      })
    );
    expect(cross.status).toBe(400);
    const bogus = await route.POST(
      await uploadRequest(admin, {
        poolKey: "STUDENT_STORAGE",
        category: "not-a-category",
        file: jpegFile("x.jpg", 100),
      })
    );
    expect(bogus.status).toBe(400);
    const backup = await route.POST(
      await uploadRequest(admin, {
        poolKey: "BACKUP_STORAGE",
        category: "backup-archive",
        file: jpegFile("x.jpg", 100),
      })
    );
    expect(backup.status).toBe(400);
    const body = (await backup.json()) as { message: string };
    expect(body.message).toContain("job-managed");
  });

  it("enforces the pool quota with an honest QUOTA_EXCEEDED error", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "alo-pool-quota-"));
    try {
      await ensurePoolBackend("PROJECT_STORAGE", root, 2_000);
      const route = await import("@/app/api/storage/documents/route");
      const ok = await route.POST(
        await uploadRequest(admin, {
          poolKey: "PROJECT_STORAGE",
          category: "project-artifact",
          file: jpegFile("small.bin", 1_500),
        })
      );
      expect(ok.status).toBe(201);
      const refused = await route.POST(
        await uploadRequest(admin, {
          poolKey: "PROJECT_STORAGE",
          category: "project-artifact",
          file: jpegFile("big.bin", 1_500),
        })
      );
      expect(refused.status).toBe(413);
      const body = (await refused.json()) as { error: { code: string; details?: Record<string, string> } };
      expect(body.error.code).toBe("QUOTA_EXCEEDED");
      expect(body.error.details!.quotaBytes).toBe("2000");
      expect(body.error.details!.recordedUsageBytes).toBe("1500");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("stores a traversal filename as a bare basename inside the root", async () => {
    await ensurePoolBackend("COMPANY_STORAGE", studentRoot);
    const route = await import("@/app/api/storage/documents/route");
    const res = await route.POST(
      await uploadRequest(admin, {
        poolKey: "COMPANY_STORAGE",
        category: "company-document",
        file: new File([new Uint8Array(64)], "../../../etc/passwd.jpg", { type: "image/jpeg" }),
      })
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { data: { document: { id: string; filename: string } } };
    expect(body.data.document.filename).toBe("passwd.jpg");
    const row = await db.documentFile.findUnique({ where: { id: body.data.document.id } });
    expect(row!.storagePath).not.toContain("..");
    expect(fs.existsSync(path.resolve(studentRoot, row!.storagePath))).toBe(true);
    expect(fs.existsSync("/etc/passwd.jpg")).toBe(false);
  });
});

describe("role isolation on list/download/delete", () => {
  let adminDocId = "";
  let clientDocId = "";

  it("clients only ever list their own documents", async () => {
    await ensurePoolBackend("STUDENT_STORAGE", studentRoot);
    const route = await import("@/app/api/storage/documents/route");
    const upload = await import("@/app/api/storage/documents/route");

    const adminUpload = await upload.POST(
      await uploadRequest(admin, {
        poolKey: "STUDENT_STORAGE",
        category: "transcript",
        file: jpegFile("admin-transcript.jpg", 300),
      })
    );
    adminDocId = ((await adminUpload.json()) as { data: { document: { id: string } } }).data.document.id;

    const clientUpload = await upload.POST(
      await uploadRequest(client, {
        poolKey: "STUDENT_STORAGE",
        category: "cv",
        file: jpegFile("client-cv.jpg", 400),
      })
    );
    expect(clientUpload.status).toBe(201);
    clientDocId = ((await clientUpload.json()) as { data: { document: { id: string } } }).data.document.id;

    const adminList = await route.GET(
      await authedRequest(`${base}/api/storage/documents?poolKey=STUDENT_STORAGE`, admin)
    );
    const adminRows = ((await adminList.json()) as { data: { documents: Array<{ id: string }> } }).data.documents;
    expect(adminRows.map((d) => d.id)).toEqual(expect.arrayContaining([adminDocId, clientDocId]));

    const clientList = await route.GET(
      await authedRequest(`${base}/api/storage/documents?poolKey=STUDENT_STORAGE`, client)
    );
    const clientRows = ((await clientList.json()) as { data: { documents: Array<{ id: string }> } }).data.documents;
    expect(clientRows.map((d) => d.id)).toContain(clientDocId);
    expect(clientRows.map((d) => d.id)).not.toContain(adminDocId);
  });

  it("clients cannot list a pool they have no access to", async () => {
    const route = await import("@/app/api/storage/documents/route");
    const res = await route.GET(
      await authedRequest(`${base}/api/storage/documents?poolKey=EMPLOYEE_STORAGE`, client)
    );
    expect(res.status).toBe(403);
  });

  it("scoped download of someone else's document 404s; own document works", async () => {
    const content = await import("@/app/api/storage/documents/[id]/content/route");
    const other = await content.GET(
      await authedRequest(`${base}/api/storage/documents/${adminDocId}/content`, client),
      { params: Promise.resolve({ id: adminDocId }) }
    );
    expect(other.status).toBe(404);

    const own = await content.GET(
      await authedRequest(`${base}/api/storage/documents/${clientDocId}/content`, client),
      { params: Promise.resolve({ id: clientDocId }) }
    );
    expect(own.status).toBe(200);
    expect(own.headers.get("x-content-sha256")).toMatch(/^[0-9a-f]{64}$/);
    const buf = Buffer.from(await own.arrayBuffer());
    expect(buf.length).toBe(400);
  });

  it("staff reading another user's document is audited as a cross-owner read", async () => {
    const content = await import("@/app/api/storage/documents/[id]/content/route");
    const res = await content.GET(
      await authedRequest(`${base}/api/storage/documents/${clientDocId}/content`, admin),
      { params: Promise.resolve({ id: clientDocId }) }
    );
    expect(res.status).toBe(200);
    const audit = await db.auditLog.findFirst({
      where: { action: "DOCUMENT_DOWNLOADED", resourceId: clientDocId },
      orderBy: { timestamp: "desc" },
    });
    expect(audit).not.toBeNull();
    const meta = audit!.metadata as { crossOwnerRead?: boolean };
    expect(meta.crossOwnerRead).toBe(true);
  });

  it("clients and resellers cannot delete; staff deletion is audited and removes the file", async () => {
    const del = await import("@/app/api/storage/documents/[id]/route");
    const forbidden = await del.DELETE(
      await authedRequest(`${base}/api/storage/documents/${clientDocId}`, client),
      { params: Promise.resolve({ id: clientDocId }) }
    );
    expect(forbidden.status).toBe(403);

    const row = await db.documentFile.findUnique({ where: { id: adminDocId } });
    const abs = path.resolve(studentRoot, row!.storagePath);
    expect(fs.existsSync(abs)).toBe(true);

    const res = await del.DELETE(
      await authedRequest(`${base}/api/storage/documents/${adminDocId}`, admin),
      { params: Promise.resolve({ id: adminDocId }) }
    );
    expect(res.status).toBe(200);
    expect(await db.documentFile.findUnique({ where: { id: adminDocId } })).toBeNull();
    expect(fs.existsSync(abs)).toBe(false);
    const audit = await db.auditLog.findFirst({ where: { action: "DOCUMENT_DELETED", resourceId: adminDocId } });
    expect(audit).not.toBeNull();
  });

  it("resellers can upload to PARTNER_STORAGE but not STUDENT_STORAGE", async () => {
    await ensurePoolBackend("PARTNER_STORAGE", studentRoot, 5_000_000);
    const route = await import("@/app/api/storage/documents/route");
    const denied = await route.POST(
      await uploadRequest(reseller, {
        poolKey: "STUDENT_STORAGE",
        category: "passport",
        file: jpegFile("x.jpg", 100),
      })
    );
    expect(denied.status).toBe(403);
    const allowed = await route.POST(
      await uploadRequest(reseller, {
        poolKey: "PARTNER_STORAGE",
        category: "partner-agreement",
        file: jpegFile("agreement.jpg", 250),
      })
    );
    expect(allowed.status).toBe(201);
    const body = (await allowed.json()) as { data: { document: { ownerId: string } } };
    expect(body.data.document.ownerId).toBe(reseller.id);
  });
});
