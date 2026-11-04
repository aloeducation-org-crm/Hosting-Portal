import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { apiSuccess, apiError, type ApiResponse } from "@/lib/response";
import { isAdminRole, requireSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { sealSecretValue } from "@/lib/secret-store";

const bucketSchema = z.object({
  name: z.string().trim().min(3).max(63).regex(/^[a-z0-9][a-z0-9.-]*[a-z0-9]$/),
  provider: z.enum(["local", "s3", "gcs"]).default("local"),
  region: z.string().trim().max(80).nullable().optional(),
  accessKey: z.string().max(4096).nullable().optional(),
  secretKey: z.string().max(4096).nullable().optional(),
  endpoint: z.string().url().max(500).nullable().optional(),
  bucketPath: z.string().max(500).nullable().optional(),
  isActive: z.boolean().optional().default(true),
}).strict();

function handleErr(e: unknown): NextResponse {
  if (e && typeof e === "object" && "status" in e) {
    const a = e as ApiResponse;
    return NextResponse.json(a, { status: a.status });
  }
  if (e instanceof z.ZodError) {
    return NextResponse.json(apiError("Validation failed", "VALIDATION_ERROR", e.flatten(), 400), { status: 400 });
  }
  return NextResponse.json(apiError("Internal server error"), { status: 500 });
}

function storageRoot(): string {
  return path.resolve(process.env.STORAGE_BUCKET_BASE ?? path.join(process.cwd(), ".storage-buckets"));
}

function safeBucketPath(value: string | null | undefined): string | null {
  if (!value) return null;
  if (!path.isAbsolute(value) || value.includes("\0")) return null;
  const root = storageRoot();
  const resolved = path.resolve(value);
  return resolved === root || resolved.startsWith(root + path.sep) ? resolved : null;
}

/** Client-safe projection; JSON.stringify cannot serialize BigInt directly. */
function presentBucket(row: {
  id: string;
  name: string;
  provider: string;
  region: string | null;
  endpoint: string | null;
  bucketPath: string | null;
  sizeBytes: bigint;
  objectCount: number;
  isActive: boolean;
  kind: string;
  quotaBytes: bigint | null;
  userId: string | null;
  accessKey: string | null;
  secretKey: string | null;
  createdAt: Date;
  updatedAt: Date;
}, includePath: boolean) {
  return {
    id: row.id,
    name: row.name,
    provider: row.provider,
    region: row.region,
    endpoint: row.endpoint,
    ...(includePath ? { bucketPath: row.bucketPath } : {}),
    sizeBytes: row.sizeBytes.toString(),
    objectCount: row.objectCount,
    isActive: row.isActive,
    kind: row.kind,
    quotaBytes: row.quotaBytes?.toString() ?? null,
    userId: row.userId,
    hasAccessKey: Boolean(row.accessKey),
    hasSecretKey: Boolean(row.secretKey),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function GET(request: NextRequest) {
  try {
    const auth = await requireSession(request);
    const rows = await db.storageBucket.findMany({
      where: { kind: "bucket", ...(isAdminRole(auth.role) ? {} : { userId: auth.id }) },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    return NextResponse.json(apiSuccess(rows.map((row) => presentBucket(row, isAdminRole(auth.role)))));
  } catch (e) {
    return handleErr(e);
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireSession(request);
    const input = bucketSchema.parse(await request.json());
    const bucketPath = safeBucketPath(input.bucketPath);
    if (input.bucketPath && !bucketPath) {
      return NextResponse.json(apiError("bucketPath must be an absolute path within STORAGE_BUCKET_BASE", "VALIDATION_ERROR", undefined, 400), { status: 400 });
    }
    if (input.bucketPath && !isAdminRole(auth.role)) {
      return NextResponse.json(apiError("Only an administrator may configure a local bucket path", "FORBIDDEN", undefined, 403), { status: 403 });
    }
    const existing = await db.storageBucket.findUnique({ where: { name: input.name } });
    if (existing) return NextResponse.json(apiError("Bucket name already exists", "CONFLICT", undefined, 409), { status: 409 });

    const bucket = await db.storageBucket.create({
      data: {
        name: input.name,
        provider: input.provider,
        region: input.region || null,
        // Both access values are credentials. They must never be stored or
        // echoed plaintext; presence flags are all the client receives.
        accessKey: input.accessKey ? sealSecretValue(input.accessKey) : null,
        secretKey: input.secretKey ? sealSecretValue(input.secretKey) : null,
        endpoint: input.endpoint || null,
        bucketPath,
        isActive: input.isActive,
        kind: "bucket",
        userId: auth.id,
      },
    });
    await db.auditLog.create({
      data: {
        actorUserId: auth.id,
        actorEmail: auth.email,
        actorRole: auth.role,
        action: "STORAGE_BUCKET_CREATED",
        resourceType: "StorageBucket",
        resourceId: bucket.id,
        domain: "storage",
        result: "SUCCESS",
        metadata: { provider: bucket.provider, hasAccessKey: Boolean(bucket.accessKey), hasSecretKey: Boolean(bucket.secretKey) },
      },
    });
    return NextResponse.json(apiSuccess(presentBucket(bucket, isAdminRole(auth.role)), "Storage bucket created", 201), { status: 201 });
  } catch (e) {
    return handleErr(e);
  }
}
