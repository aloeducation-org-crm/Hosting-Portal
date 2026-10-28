import { NextRequest, NextResponse } from "next/server";
import { unlink } from "node:fs/promises";
import { apiError, apiSuccess, type ApiResponse } from "@/lib/response";
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
 * DELETE /api/storage/documents/[id] — staff-only, fully audited.
 *
 * Spec section 16 requires impact awareness for deletions: the audit entry
 * records exactly what was removed (pool, path, size, hash) so it can be
 * reconstructed from a backup if the decision was wrong. The route itself
 * never touches anything outside the pool backend.
 */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireSession(request);
    const { id } = await params;

    if (!STAFF.has(auth.role)) {
      return NextResponse.json(
        apiError("Document deletion is staff-only (retention is managed centrally)", "FORBIDDEN", undefined, 403),
        { status: 403 }
      );
    }

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

    const pool = await db.storageBucket.findFirst({ where: { name: row.poolKey, kind: "pool" } });
    if (pool?.bucketPath) {
      const absolute = resolveWithinRoot(pool.bucketPath, row.storagePath);
      if (absolute) {
        await unlink(absolute).catch(() => undefined); // missing file: still drop the row, honestly
      }
    }
    await db.documentFile.delete({ where: { id: row.id } });
    await db.storageBucket
      .update({
        where: { name: row.poolKey },
        data: {
          sizeBytes: { decrement: row.sizeBytes },
          objectCount: { decrement: 1 },
        },
      })
      .catch(() => undefined);

    await createAuditLog({
      actorId: auth.id,
      actorEmail: auth.email,
      actorRole: auth.role,
      action: "DOCUMENT_DELETED",
      resourceType: "DocumentFile",
      resourceId: row.id,
      domain: "storage",
      result: "SUCCESS",
      metadata: {
        poolKey: row.poolKey,
        category: row.category,
        filename: row.filename,
        sizeBytes: String(row.sizeBytes),
        sha256: row.sha256,
        storagePath: row.storagePath,
      },
    });

    return NextResponse.json(apiSuccess({ deleted: row.id }));
  } catch (e) {
    return handleErr(e);
  }
}
