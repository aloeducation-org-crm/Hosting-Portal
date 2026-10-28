import { NextRequest, NextResponse } from "next/server";
import { randomUUID, createHash } from "node:crypto";
import { mkdir, writeFile, stat } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { apiSuccess, apiError, type ApiResponse } from "@/lib/response";
import { requireSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { createAuditLog } from "@/lib/audit";
import { env } from "@/lib/env";
import { validateFile } from "@/lib/storage";
import {
  POOL_KEYS,
  canAccessPool,
  validateUploadTarget,
  sanitizeFilename,
  buildStoragePath,
  resolveWithinRoot,
} from "@/lib/storage-pools";

function handleErr(e: unknown): NextResponse {
  if (e && typeof e === "object" && "status" in e) {
    const a = e as ApiResponse;
    return NextResponse.json(a, { status: a.status });
  }
  return NextResponse.json(apiError("Internal server error"), { status: 500 });
}

const listQuery = z.object({ poolKey: z.string().max(64).optional() });

function serializeDoc(row: {
  id: string;
  poolKey: string;
  ownerId: string | null;
  owner?: { email: string | null; name: string | null } | null;
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
    ownerId: row.ownerId,
    ownerEmail: row.owner?.email ?? null,
    category: row.category,
    filename: row.filename,
    sizeBytes: String(row.sizeBytes),
    sha256: row.sha256,
    version: row.version,
    contentType: row.contentType,
    createdAt: row.createdAt,
  };
}

/**
 * GET /api/storage/documents?poolKey=… — policy-filtered document metadata.
 * Staff see every row in an accessible pool (cross-owner reads are surfaced in
 * the UI and audited on download); CLIENT/RESELLER only ever see their own.
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await requireSession(request);
    const parsed = listQuery.safeParse({
      poolKey: request.nextUrl.searchParams.get("poolKey") ?? undefined,
    });
    if (!parsed.success) {
      return NextResponse.json(apiError("Invalid query", "VALIDATION_ERROR", undefined, 400), { status: 400 });
    }

    const orClauses: Array<{ poolKey: string; ownerId?: string | null }> = [];
    for (const key of POOL_KEYS) {
      if (parsed.data.poolKey && key !== parsed.data.poolKey) continue;
      const access = canAccessPool(auth, key, "read");
      if (!access.allowed) continue;
      orClauses.push(access.ownerScope ? { poolKey: key, ownerId: access.ownerScope } : { poolKey: key });
    }
    if (parsed.data.poolKey && orClauses.length === 0) {
      // Explicit pool the caller may not read — refuse instead of returning [].
      const access = canAccessPool(auth, parsed.data.poolKey, "read");
      return NextResponse.json(apiError(access.reason ?? "Access denied", "FORBIDDEN", undefined, 403), {
        status: 403,
      });
    }
    if (orClauses.length === 0) {
      return NextResponse.json(apiSuccess({ documents: [] }));
    }

    const rows = await db.documentFile.findMany({
      where: { OR: orClauses },
      include: { owner: { select: { email: true, name: true } } },
      orderBy: [{ filename: "asc" }, { version: "desc" }],
      take: 500,
    });
    return NextResponse.json(apiSuccess({ documents: rows.map(serializeDoc) }));
  } catch (e) {
    return handleErr(e);
  }
}

/**
 * POST /api/storage/documents — multipart upload into a pool.
 * Fields: poolKey, category, file. Enforces pool access, category↔pool match,
 * provisioning, quota, MIME allowlist and size cap before writing one file
 * inside the pool backend; records sha256 and audits the upload.
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await requireSession(request);

    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return NextResponse.json(
        apiError("Expected multipart form data with poolKey, category and file", "VALIDATION_ERROR", undefined, 400),
        { status: 400 }
      );
    }
    const poolKey = String(form.get("poolKey") ?? "");
    const category = String(form.get("category") ?? "");
    const file = form.get("file");

    const access = canAccessPool(auth, poolKey, "upload");
    if (!access.allowed) {
      return NextResponse.json(apiError(access.reason ?? "Access denied", "FORBIDDEN", undefined, 403), {
        status: 403,
      });
    }
    const targetError = validateUploadTarget(poolKey, category);
    if (targetError) {
      return NextResponse.json(apiError(targetError, "VALIDATION_ERROR", undefined, 400), { status: 400 });
    }
    if (!(file instanceof File)) {
      return NextResponse.json(apiError("file is required", "VALIDATION_ERROR", undefined, 400), { status: 400 });
    }

    const filename = sanitizeFilename(file.name || "file");
    const size = file.size;
    if (size <= 0) {
      return NextResponse.json(apiError("File is empty", "VALIDATION_ERROR", undefined, 400), { status: 400 });
    }
    const maxBytes = env.MAX_UPLOAD_SIZE_MB * 1024 * 1024;
    if (size > maxBytes) {
      return NextResponse.json(
        apiError(`File exceeds the ${env.MAX_UPLOAD_SIZE_MB}MB limit`, "PAYLOAD_TOO_LARGE", undefined, 413),
        { status: 413 }
      );
    }
    const mime = validateFile({ name: filename, size, type: file.type || "application/octet-stream" });
    if (!mime.valid) {
      return NextResponse.json(apiError(mime.error ?? "File type not allowed", "UNSUPPORTED_MEDIA", undefined, 415), {
        status: 415,
      });
    }

    const pool = await db.storageBucket.findFirst({ where: { name: poolKey, kind: "pool" } });
    if (!pool) {
      return NextResponse.json(apiError(`Pool ${poolKey} is not provisioned`, "NOT_FOUND", undefined, 404), {
        status: 404,
      });
    }
    if (!pool.bucketPath) {
      return NextResponse.json(
        apiError(
          `${poolKey} has no backend path configured — upload refused until an admin provisions it`,
          "POOL_NOT_PROVISIONED",
          undefined,
          409
        ),
        { status: 409 }
      );
    }

    const usedRow = await db.documentFile.aggregate({
      where: { poolKey },
      _sum: { sizeBytes: true },
    });
    const used = usedRow._sum.sizeBytes ?? 0n;
    if (pool.quotaBytes !== null && used + BigInt(size) > pool.quotaBytes) {
      return NextResponse.json(
        apiError(
          `Quota exceeded for ${poolKey}: ${String(used)} of ${String(pool.quotaBytes)} bytes already recorded`,
          "QUOTA_EXCEEDED",
          { recordedUsageBytes: String(used), quotaBytes: String(pool.quotaBytes), requestedBytes: size },
          413
        ),
        { status: 413 }
      );
    }

    // Version = max existing version for this owner+pool+category+filename, +1.
    const prior = await db.documentFile.aggregate({
      where: { poolKey, ownerId: auth.id, category, filename },
      _max: { version: true },
    });
    const version = (prior._max.version ?? 0) + 1;

    const id = randomUUID();
    const storagePath = buildStoragePath(auth.id, filename, id);
    const absolute = resolveWithinRoot(pool.bucketPath, storagePath);
    if (!absolute) {
      return NextResponse.json(apiError("Resolved storage path escaped the pool root", "VALIDATION_ERROR", undefined, 500), {
        status: 500,
      });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    await mkdir(path.dirname(absolute), { recursive: true });
    await writeFile(absolute, buffer);
    const written = await stat(absolute);
    if (written.size !== size) {
      return NextResponse.json(apiError("Written file failed size verification", "STORAGE_ERROR", undefined, 500), {
        status: 500,
      });
    }
    const sha256 = createHash("sha256").update(buffer).digest("hex");

    const row = await db.documentFile.create({
      data: {
        poolKey,
        ownerId: auth.id,
        organizationId: null,
        category,
        filename,
        storagePath,
        sizeBytes: BigInt(size),
        sha256,
        version,
        contentType: file.type || "application/octet-stream",
      },
    });
    await db.storageBucket
      .update({
        where: { id: pool.id },
        data: { sizeBytes: { increment: BigInt(size) }, objectCount: { increment: 1 } },
      })
      .catch(() => undefined);

    await createAuditLog({
      actorId: auth.id,
      actorEmail: auth.email,
      actorRole: auth.role,
      action: "DOCUMENT_UPLOADED",
      resourceType: "DocumentFile",
      resourceId: row.id,
      domain: "storage",
      result: "SUCCESS",
      metadata: { poolKey, category, filename, sizeBytes: size, sha256, version },
    });

    return NextResponse.json(
      apiSuccess({ document: serializeDoc({ ...row, owner: { email: auth.email, name: null } }) }),
      { status: 201 }
    );
  } catch (e) {
    return handleErr(e);
  }
}
