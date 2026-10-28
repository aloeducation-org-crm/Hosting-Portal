import { NextRequest, NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import { apiError, type ApiResponse } from "@/lib/response";
import { requireSession, ROLES } from "@/lib/auth";
import { db } from "@/lib/db";
import { createAuditLog } from "@/lib/audit";
import { canAccessPool, resolveWithinRoot } from "@/lib/storage-pools";

function handleErr(e: unknown): NextResponse {
  if (e && typeof e === "object" && "status" in e) {
    const a = e as ApiResponse;
    return NextResponse.json(a, { status: a.status });
  }
  return NextResponse.json(apiError("Internal server error"), { status: 500 });
}

const STAFF = new Set<string>([ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.DEVOPS]);

/**
 * GET /api/storage/documents/[id]/content — authenticated download.
 * Ownership is enforced (scoped roles only reach their own rows), the file is
 * re-resolved inside the pool root, and EVERY read — including staff reading
 * somebody else's document — produces an audit entry.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireSession(request);
    const { id } = await params;

    const row = await db.documentFile.findUnique({ where: { id } });
    if (!row) {
      return NextResponse.json(apiError("Document not found", "NOT_FOUND", undefined, 404), { status: 404 });
    }
    const access = canAccessPool(auth, row.poolKey, "read");
    if (!access.allowed) {
      return NextResponse.json(apiError(access.reason ?? "Access denied", "FORBIDDEN", undefined, 403), {
        status: 403,
      });
    }
    if (access.ownerScope && row.ownerId !== access.ownerScope) {
      // Do not leak the existence of other users' documents.
      return NextResponse.json(apiError("Document not found", "NOT_FOUND", undefined, 404), { status: 404 });
    }

    const pool = await db.storageBucket.findFirst({ where: { name: row.poolKey, kind: "pool" } });
    if (!pool?.bucketPath) {
      return NextResponse.json(
        apiError(`${row.poolKey} has no backend path configured`, "POOL_NOT_PROVISIONED", undefined, 409),
        { status: 409 }
      );
    }
    const absolute = resolveWithinRoot(pool.bucketPath, row.storagePath);
    if (!absolute) {
      return NextResponse.json(apiError("Storage path escapes the pool root", "STORAGE_ERROR", undefined, 500), {
        status: 500,
      });
    }

    let bytes: Buffer;
    try {
      bytes = await readFile(absolute);
    } catch {
      return NextResponse.json(
        apiError("Stored file is missing on the backend (stale row)", "STORAGE_MISSING", undefined, 404),
        { status: 404 }
      );
    }

    const crossOwner = row.ownerId !== auth.id;
    await createAuditLog({
      actorId: auth.id,
      actorEmail: auth.email,
      actorRole: auth.role,
      action: "DOCUMENT_DOWNLOADED",
      resourceType: "DocumentFile",
      resourceId: row.id,
      domain: "storage",
      result: "SUCCESS",
      metadata: {
        poolKey: row.poolKey,
        category: row.category,
        filename: row.filename,
        ownerId: row.ownerId,
        crossOwnerRead: STAFF.has(auth.role) && crossOwner,
      },
    });

    const asciiName = row.filename.replace(/[^\x20-\x7e]/g, "_");
    return new NextResponse(new Uint8Array(bytes), {
      status: 200,
      headers: {
        "content-type": row.contentType,
        "content-length": String(bytes.length),
        "content-disposition": `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(row.filename)}`,
        "cache-control": "private, no-store",
        "x-content-sha256": row.sha256,
      },
    });
  } catch (e) {
    return handleErr(e);
  }
}
