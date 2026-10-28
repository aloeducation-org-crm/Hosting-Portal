import { NextRequest, NextResponse } from "next/server";
import { statfs, existsSync } from "node:fs";
import { apiSuccess, apiError, type ApiResponse } from "@/lib/response";
import { requireSession, requireSuperAdmin, ROLES } from "@/lib/auth";
import { db } from "@/lib/db";
import { createAuditLog } from "@/lib/audit";
import {
  POOL_DEFINITIONS,
  getPoolDefinition,
} from "@/lib/storage-pools";

function handleErr(e: unknown): NextResponse {
  if (e && typeof e === "object" && "status" in e) {
    const a = e as ApiResponse;
    return NextResponse.json(a, { status: a.status });
  }
  return NextResponse.json(apiError("Internal server error"), { status: 500 });
}

interface PoolRow {
  id: string;
  name: string;
  bucketPath: string | null;
  quotaBytes: bigint | null;
  sizeBytes: bigint;
  objectCount: number;
  policy: string | null;
}

async function usageByPool(): Promise<Record<string, bigint>> {
  const rows = await db.documentFile.groupBy({
    by: ["poolKey"],
    _sum: { sizeBytes: true },
  });
  const out: Record<string, bigint> = {};
  for (const r of rows) out[r.poolKey] = r._sum.sizeBytes ?? 0n;
  return out;
}

function measureCapacity(root: string | null): Promise<{ totalBytes: number; freeBytes: number } | null> {
  if (!root) return Promise.resolve(null);
  return new Promise((resolve) => {
    statfs(root, (err, stats) => {
      if (err) return resolve(null);
      resolve({
        totalBytes: Number(stats.blocks) * Number(stats.bsize),
        freeBytes: Number(stats.bavail) * Number(stats.bsize),
      });
    });
  });
}

function serializePool(
  row: PoolRow,
  opts: { includeBackend: boolean; usage: bigint; capacity: { totalBytes: number; freeBytes: number } | null }
) {
  const def = getPoolDefinition(row.name);
  let meta: { label?: string; description?: string; categories?: string[] } = {};
  if (row.policy) {
    try {
      meta = JSON.parse(row.policy) as typeof meta;
    } catch {
      meta = {};
    }
  }
  const provisioned = Boolean(row.bucketPath);
  return {
    key: row.name,
    label: def?.label ?? meta.label ?? row.name,
    description: def?.description ?? meta.description ?? "",
    categories: def?.categories ?? meta.categories ?? [],
    manualUpload: def?.manualUpload ?? true,
    provisioned,
    provisionedReal: provisioned && existsSync(row.bucketPath!),
    // Capacity is only ever a real statfs measurement; null = not measured.
    capacity: opts.capacity,
    quotaBytes: row.quotaBytes !== null ? String(row.quotaBytes) : null,
    recordedUsageBytes: String(opts.usage),
    recordedObjectCount: row.objectCount,
    ...(opts.includeBackend ? { backendPath: row.bucketPath } : {}),
  };
}

/**
 * GET /api/storage/pools — the six §12 logical pools with honest provisioning
 * and capacity states (measured vs not-provisioned). Backend paths are only
 * disclosed to staff roles.
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await requireSession(request);
    const rows = (await db.storageBucket.findMany({
      where: { kind: "pool" },
      orderBy: { name: "asc" },
    })) as unknown as PoolRow[];
    const usage = await usageByPool();
    const includeBackend =
      auth.role === ROLES.SUPER_ADMIN || auth.role === ROLES.ADMIN || auth.role === ROLES.DEVOPS;

    const pools = [];
    for (const row of rows) {
      // Host capacity is staff-only information; clients get quota/usage.
      const capacity = includeBackend ? await measureCapacity(row.bucketPath) : null;
      pools.push(
        serializePool(row, { includeBackend, usage: usage[row.name] ?? 0n, capacity })
      );
    }
    // Pools defined in code but not yet seeded are reported as missing rather
    // than silently omitted.
    const present = new Set(rows.map((r) => r.name));
    for (const def of POOL_DEFINITIONS) {
      if (!present.has(def.key)) {
        pools.push({
          key: def.key,
          label: def.label,
          description: def.description,
          categories: def.categories,
          manualUpload: def.manualUpload,
          provisioned: false,
          provisionedReal: false,
          capacity: null,
          quotaBytes: null,
          recordedUsageBytes: "0",
          recordedObjectCount: 0,
          missingRow: true,
        });
      }
    }
    return NextResponse.json(apiSuccess({ pools }));
  } catch (e) {
    return handleErr(e);
  }
}

/**
 * POST /api/storage/pools — configure a pool (backend path and/or quota).
 * Super-admin only, audited. Setting a backend path does not create or
 * format anything: it only tells the platform where the pool lives.
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await requireSuperAdmin(request);
    const body = (await request.json().catch(() => ({}))) as {
      key?: string;
      bucketPath?: string;
      quotaBytes?: string | number;
    };
    if (!body.key || !getPoolDefinition(body.key)) {
      return NextResponse.json(
        apiError("key must be a known pool key", "VALIDATION_ERROR", undefined, 400),
        { status: 400 }
      );
    }
    const data: Record<string, unknown> = {};
    if (body.bucketPath !== undefined) {
      const p = String(body.bucketPath);
      if (!p.startsWith("/") || p.includes("..") || p.includes("\0")) {
        return NextResponse.json(
          apiError("bucketPath must be an absolute path without '..'", "VALIDATION_ERROR", undefined, 400),
          { status: 400 }
        );
      }
      data.bucketPath = p;
    }
    if (body.quotaBytes !== undefined) {
      const q = typeof body.quotaBytes === "string" ? Number(body.quotaBytes) : body.quotaBytes;
      if (!Number.isFinite(q) || q <= 0 || !Number.isInteger(q)) {
        return NextResponse.json(
          apiError("quotaBytes must be a positive integer", "VALIDATION_ERROR", undefined, 400),
          { status: 400 }
        );
      }
      data.quotaBytes = BigInt(q);
    }
    if (Object.keys(data).length === 0) {
      return NextResponse.json(
        apiError("nothing to update (bucketPath or quotaBytes required)", "VALIDATION_ERROR", undefined, 400),
        { status: 400 }
      );
    }

    const existing = await db.storageBucket.findUnique({ where: { name: body.key } });
    if (existing && existing.kind !== "pool") {
      return NextResponse.json(
        apiError(`"${body.key}" collides with a storage bucket of the same name`, "CONFLICT", undefined, 409),
        { status: 409 }
      );
    }
    const def = getPoolDefinition(body.key)!;
    const policy = JSON.stringify({
      label: def.label,
      description: def.description,
      categories: def.categories,
      managedBy: "platform",
    });
    const row = existing
      ? await db.storageBucket.update({ where: { id: existing.id }, data: { ...data, policy } })
      : await db.storageBucket.create({
          data: {
            name: def.key,
            kind: "pool",
            provider: "local",
            isActive: true,
            policy,
            ...data,
          },
        });

    await createAuditLog({
      actorId: auth.id,
      actorEmail: auth.email,
      actorRole: auth.role,
      action: "STORAGE_POOL_CONFIGURED",
      resourceType: "StoragePool",
      resourceId: row.id,
      domain: "storage",
      result: "SUCCESS",
      metadata: {
        key: def.key,
        bucketPath: data.bucketPath ?? undefined,
        quotaBytes: data.quotaBytes !== undefined ? String(data.quotaBytes) : undefined,
      },
    });

    return NextResponse.json(
      apiSuccess({
        pool: serializePool(row as unknown as PoolRow, {
          includeBackend: true,
          usage: (await usageByPool())[def.key] ?? 0n,
          capacity: await measureCapacity((row as unknown as PoolRow).bucketPath),
        }),
      }),
      { status: 201 }
    );
  } catch (e) {
    return handleErr(e);
  }
}
