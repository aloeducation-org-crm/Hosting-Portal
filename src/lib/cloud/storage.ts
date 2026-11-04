/** Project-scoped Cloud object storage with path guards, quotas and HMAC URLs. */

import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { db } from "@/lib/db";
import type { AuthUser } from "@/lib/auth";
import { apiError } from "@/lib/response";
import { canManageCloudProject, canViewCloudProject } from "./cloud-service";
import { cloudDataRoot, parseJsonStringArray, safeCloudSegment } from "./foundation";
import { assertCloudResourceQuota, assertCloudStorageCapacity, recordCloudUsageEvent } from "./usage";
import { slugifyCloudIdentifier } from "./catalog";
import { resolveWithinRoot, sanitizeFilename } from "@/lib/storage-pools";

const DEFAULT_ALLOWED_TYPES = new Set([
  "application/octet-stream", "application/json", "application/pdf", "application/zip", "text/plain", "text/csv",
  "image/jpeg", "image/png", "image/gif", "image/webp", "video/mp4", "audio/mpeg",
]);

const createBucketSchema = z.object({
  name: z.string().trim().min(2).max(80),
  slug: z.string().trim().min(2).max(48).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).optional(),
  visibility: z.enum(["private", "public"]).default("private"),
  allowedMimeTypes: z.array(z.string().trim().min(1).max(128)).max(50).default([]),
  maxFileSizeBytes: z.number().int().min(1).max(250 * 1024 * 1024).default(25 * 1024 * 1024),
  quotaBytes: z.number().int().min(1).max(2_147_483_647).default(512 * 1024 * 1024),
  lifecycleDeleteDays: z.number().int().min(1).max(3650).nullable().optional(),
  versioningEnabled: z.boolean().default(false),
}).strict();

function objectRoot(projectId: string, bucketId: string): string {
  return path.join(cloudDataRoot(), "objects", safeCloudSegment(projectId), safeCloudSegment(bucketId));
}

function safeObjectKey(raw: string): string | null {
  const key = raw.trim().replace(/\\/g, "/");
  if (!key || key.length > 512 || key.startsWith("/") || key.includes("\0")) return null;
  if (key.split("/").some((part) => !part || part === "." || part === "..")) return null;
  return /^[A-Za-z0-9!._/@+=,-]+(?:\/[A-Za-z0-9!._@+=,-]+)*$/.test(key) ? key : null;
}

async function projectFor(actor: AuthUser, idOrSlug: string, manage: boolean) {
  const project = await db.cloudProject.findFirst({ where: { OR: [{ id: idOrSlug }, { slug: idOrSlug }] } });
  if (!project) throw apiError("Cloud Project not found", "NOT_FOUND", undefined, 404);
  const allowed = manage ? await canManageCloudProject(db, actor, project) : await canViewCloudProject(db, actor, project);
  if (!allowed) throw apiError("Forbidden to access this Cloud Project", "FORBIDDEN", undefined, 403);
  return project;
}

function presentBucket(row: {
  id: string; projectId: string; slug: string; name: string; visibility: string; allowedMimeTypes: string; maxFileSizeBytes: number; quotaBytes: number; usedBytes: number; objectCount: number; lifecycleDeleteDays: number | null; versioningEnabled: boolean; createdBy: string; createdAt: Date; updatedAt: Date;
}) {
  return {
    id: row.id, projectId: row.projectId, slug: row.slug, name: row.name, visibility: row.visibility,
    allowedMimeTypes: parseJsonStringArray(row.allowedMimeTypes), maxFileSizeBytes: row.maxFileSizeBytes,
    quotaBytes: row.quotaBytes, usedBytes: row.usedBytes, objectCount: row.objectCount,
    lifecycleDeleteDays: row.lifecycleDeleteDays, versioningEnabled: row.versioningEnabled, createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
  };
}

function presentObject(row: {
  id: string; bucketId: string; projectId: string; objectKey: string; mimeType: string; sizeBytes: number; checksumSha256: string; metadataJson: string; expiresAt: Date | null; uploadedBy: string; deletedAt: Date | null; createdAt: Date; updatedAt: Date;
}) {
  let metadata: Record<string, unknown> = {};
  try { const parsed = JSON.parse(row.metadataJson); if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) metadata = parsed; } catch { /* corrupt metadata stays empty */ }
  return {
    id: row.id, bucketId: row.bucketId, projectId: row.projectId, objectKey: row.objectKey,
    mimeType: row.mimeType, sizeBytes: row.sizeBytes, checksumSha256: row.checksumSha256,
    metadata, expiresAt: row.expiresAt?.toISOString() ?? null, uploadedBy: row.uploadedBy,
    deletedAt: row.deletedAt?.toISOString() ?? null, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listCloudStorageBuckets(actor: AuthUser, idOrSlug: string) {
  const project = await projectFor(actor, idOrSlug, false);
  const rows = await db.cloudStorageBucket.findMany({ where: { projectId: project.id }, orderBy: { createdAt: "desc" } });
  return rows.map(presentBucket);
}

export async function createCloudStorageBucket(actor: AuthUser, idOrSlug: string, rawInput: unknown) {
  const input = createBucketSchema.parse(rawInput);
  const slug = input.slug ?? slugifyCloudIdentifier(input.name);
  if (!slug || slug.length < 2) throw apiError("Bucket name must contain at least two alphanumeric characters", "VALIDATION_ERROR", undefined, 400);
  const project = await projectFor(actor, idOrSlug, true);
  return db.$transaction(async (tx) => {
    await assertCloudResourceQuota(tx, { projectId: project.id, resource: "buckets", actorId: actor.id });
    const duplicate = await tx.cloudStorageBucket.findUnique({ where: { projectId_slug: { projectId: project.id, slug } }, select: { id: true } });
    if (duplicate) throw apiError("A Cloud Storage bucket with that slug already exists", "SLUG_CONFLICT", undefined, 409);
    const row = await tx.cloudStorageBucket.create({
      data: { projectId: project.id, slug, name: input.name, visibility: input.visibility, allowedMimeTypes: JSON.stringify([...new Set(input.allowedMimeTypes)]), maxFileSizeBytes: input.maxFileSizeBytes, quotaBytes: input.quotaBytes, lifecycleDeleteDays: input.lifecycleDeleteDays ?? null, versioningEnabled: input.versioningEnabled, createdBy: actor.id },
    });
    await tx.auditLog.create({ data: { actorUserId: actor.id, actorEmail: actor.email, actorRole: actor.role, action: "CLOUD_STORAGE_BUCKET_CREATED", resourceType: "CloudStorageBucket", resourceId: row.id, domain: "cloud-baas", result: "SUCCESS", metadata: { projectId: project.id, slug, visibility: row.visibility } } });
    return presentBucket(row);
  });
}

export async function listCloudStorageObjects(actor: AuthUser, idOrSlug: string, bucketId: string) {
  const project = await projectFor(actor, idOrSlug, false);
  const bucket = await db.cloudStorageBucket.findFirst({ where: { id: bucketId, projectId: project.id } });
  if (!bucket) throw apiError("Cloud Storage bucket not found", "NOT_FOUND", undefined, 404);
  const rows = await db.cloudStorageObject.findMany({ where: { bucketId: bucket.id, deletedAt: null }, orderBy: { createdAt: "desc" }, take: 500 });
  return { bucket: presentBucket(bucket), objects: rows.map(presentObject) };
}

export async function uploadCloudStorageObject(
  actor: AuthUser,
  idOrSlug: string,
  bucketId: string,
  input: { objectKey: string; file: File; metadata?: unknown; expiresAt?: string | null },
) {
  const project = await projectFor(actor, idOrSlug, true);
  const bucket = await db.cloudStorageBucket.findFirst({ where: { id: bucketId, projectId: project.id } });
  if (!bucket) throw apiError("Cloud Storage bucket not found", "NOT_FOUND", undefined, 404);
  const objectKey = safeObjectKey(input.objectKey || sanitizeFilename(input.file.name));
  if (!objectKey) throw apiError("Object key is invalid or escapes the bucket", "INVALID_OBJECT_KEY", undefined, 400);
  if (!input.file || input.file.size <= 0) throw apiError("Upload file is empty", "VALIDATION_ERROR", undefined, 400);
  if (input.file.size > bucket.maxFileSizeBytes) throw apiError("File exceeds the bucket file-size limit", "FILE_TOO_LARGE", { maxFileSizeBytes: bucket.maxFileSizeBytes }, 413);
  const permitted = parseJsonStringArray(bucket.allowedMimeTypes);
  const mimeType = input.file.type || "application/octet-stream";
  if ((permitted.length ? !permitted.includes(mimeType) : !DEFAULT_ALLOWED_TYPES.has(mimeType))) {
    throw apiError("File MIME type is not allowed for this bucket", "MIME_TYPE_NOT_ALLOWED", { mimeType }, 415);
  }
  const expiresAt = input.expiresAt ? new Date(input.expiresAt) : null;
  if (expiresAt && (!Number.isFinite(expiresAt.getTime()) || expiresAt.getTime() <= Date.now())) throw apiError("expiresAt must be a future ISO date", "VALIDATION_ERROR", undefined, 400);
  const metadata = input.metadata && typeof input.metadata === "object" && !Array.isArray(input.metadata) ? input.metadata : {};
  const metadataJson = JSON.stringify(metadata);
  if (metadataJson.length > 8_000) throw apiError("Object metadata is too large", "PAYLOAD_TOO_LARGE", undefined, 413);

  const buffer = Buffer.from(await input.file.arrayBuffer());
  const checksumSha256 = createHash("sha256").update(buffer).digest("hex");
  const root = objectRoot(project.id, bucket.id);
  const rel = `${safeCloudSegment(actor.id)}/${randomBytes(18).toString("hex")}-${sanitizeFilename(path.posix.basename(objectKey))}`;
  const destination = resolveWithinRoot(root, rel);
  if (!destination) throw apiError("Object path is invalid", "INVALID_OBJECT_KEY", undefined, 400);
  await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
  const temp = `${destination}.upload-${randomBytes(6).toString("hex")}.tmp`;
  await writeFile(temp, buffer, { mode: 0o600 });

  try {
    const object = await db.$transaction(async (tx) => {
      const lockedBucket = await tx.cloudStorageBucket.findFirst({ where: { id: bucket.id, projectId: project.id } });
      if (!lockedBucket) throw apiError("Cloud Storage bucket not found", "NOT_FOUND", undefined, 404);
      const existing = await tx.cloudStorageObject.findFirst({ where: { bucketId: bucket.id, objectKey, deletedAt: null }, select: { id: true } });
      if (existing) throw apiError("An active object already uses this key", "OBJECT_KEY_CONFLICT", undefined, 409);
      if (lockedBucket.usedBytes + buffer.byteLength > lockedBucket.quotaBytes) {
        throw apiError("Bucket storage quota exceeded", "CLOUD_QUOTA_EXCEEDED", { current: lockedBucket.usedBytes, requested: buffer.byteLength, limit: lockedBucket.quotaBytes }, 413);
      }
      const projectTotal = await tx.cloudStorageBucket.aggregate({ where: { projectId: project.id }, _sum: { usedBytes: true } });
      await assertCloudStorageCapacity(tx, { projectId: project.id, currentBytes: projectTotal._sum.usedBytes ?? 0, additionalBytes: buffer.byteLength, actorId: actor.id });
      const created = await tx.cloudStorageObject.create({ data: { bucketId: bucket.id, projectId: project.id, objectKey, storageRelPath: rel, mimeType, sizeBytes: buffer.byteLength, checksumSha256, metadataJson, expiresAt, uploadedBy: actor.id } });
      await tx.cloudStorageBucket.update({ where: { id: bucket.id }, data: { usedBytes: { increment: buffer.byteLength }, objectCount: { increment: 1 } } });
      await recordCloudUsageEvent(tx, { idempotencyKey: `storage-capacity:${created.id}`, projectId: project.id, ownerId: project.ownerId, metric: "storage_capacity_bytes", quantity: buffer.byteLength, unit: "byte", referenceType: "CloudStorageObject", referenceId: created.id });
      await tx.auditLog.create({ data: { actorUserId: actor.id, actorEmail: actor.email, actorRole: actor.role, action: "CLOUD_STORAGE_OBJECT_UPLOADED", resourceType: "CloudStorageObject", resourceId: created.id, domain: "cloud-baas", result: "SUCCESS", metadata: { projectId: project.id, bucketId: bucket.id, objectKey, sizeBytes: buffer.byteLength, checksumSha256 } } });
      return created;
    });
    await rename(temp, destination);
    return presentObject(object);
  } catch (error) {
    await rm(temp, { force: true }).catch(() => {});
    throw error;
  }
}

function signingKey(): Buffer {
  return createHash("sha256").update(process.env.APP_ENCRYPTION_KEY || "cloud-storage-signing-key-unconfigured").digest();
}

function signature(payload: string): string {
  return createHmac("sha256", signingKey()).update(payload).digest("hex");
}

export async function issueCloudObjectSignedUrl(actor: AuthUser, idOrSlug: string, bucketId: string, objectId: string, expiresInSeconds = 300, baseUrl?: string) {
  const project = await projectFor(actor, idOrSlug, false);
  const object = await db.cloudStorageObject.findFirst({ where: { id: objectId, bucketId, projectId: project.id, deletedAt: null } });
  if (!object) throw apiError("Cloud Storage object not found", "NOT_FOUND", undefined, 404);
  const ttl = Math.max(1, Math.min(Math.floor(expiresInSeconds), 3600));
  const expires = Math.floor(Date.now() / 1000) + ttl;
  const payload = `${object.id}.${object.bucketId}.${expires}`;
  const sig = signature(payload);
  const base = (baseUrl ?? process.env.APP_URL ?? "").replace(/\/$/, "");
  const pathname = `/api/cloud/v1/storage/${encodeURIComponent(object.bucketId)}/objects/${encodeURIComponent(object.id)}`;
  return { expiresAt: new Date(expires * 1000).toISOString(), url: `${base}${pathname}?expires=${expires}&sig=${sig}` };
}

function validSignedAccess(object: { id: string; bucketId: string }, expiresRaw: string | null, sig: string | null): boolean {
  const expires = Number(expiresRaw);
  if (!Number.isInteger(expires) || !sig || expires < Math.floor(Date.now() / 1000) || expires > Math.floor(Date.now() / 1000) + 3601 || !/^[a-f0-9]{64}$/i.test(sig)) return false;
  const expected = signature(`${object.id}.${object.bucketId}.${expires}`);
  const left = Buffer.from(sig, "hex");
  const right = Buffer.from(expected, "hex");
  return left.length === right.length && timingSafeEqual(left, right);
}

export async function readCloudStorageObject(params: { bucketId: string; objectId: string; signedExpires?: string | null; signedSignature?: string | null; actor?: AuthUser | null; expectedProjectRef?: string | null }) {
  const object = await db.cloudStorageObject.findFirst({ where: { id: params.objectId, bucketId: params.bucketId, deletedAt: null }, include: { bucket: true, project: true } });
  if (!object || (params.expectedProjectRef && object.project.id !== params.expectedProjectRef && object.project.slug !== params.expectedProjectRef)) throw apiError("Cloud Storage object not found", "NOT_FOUND", undefined, 404);
  const signed = validSignedAccess(object, params.signedExpires ?? null, params.signedSignature ?? null);
  if (!signed && object.bucket.visibility !== "public") {
    if (!params.actor || !(await canViewCloudProject(db, params.actor, object.project))) throw apiError("Forbidden to read Cloud Storage object", "FORBIDDEN", undefined, 403);
  }
  const root = objectRoot(object.projectId, object.bucketId);
  const filePath = resolveWithinRoot(root, object.storageRelPath);
  if (!filePath) throw apiError("Object storage path is invalid", "OBJECT_PATH_INVALID", undefined, 500);
  let content: Buffer;
  try { content = await (await import("node:fs/promises")).readFile(filePath); } catch { throw apiError("Object artifact is unavailable", "OBJECT_UNAVAILABLE", undefined, 404); }
  const digest = createHash("sha256").update(content).digest("hex");
  if (digest !== object.checksumSha256) throw apiError("Object checksum verification failed", "OBJECT_CHECKSUM_MISMATCH", undefined, 409);
  await recordCloudUsageEvent(db, { idempotencyKey: `storage-bandwidth:${object.id}:${Date.now()}:${randomBytes(4).toString("hex")}`, projectId: object.projectId, ownerId: object.project.ownerId, metric: "storage_bandwidth_bytes", quantity: content.byteLength, unit: "byte", referenceType: "CloudStorageObject", referenceId: object.id }).catch(() => {});
  return { object, content };
}

export async function deleteCloudStorageObject(actor: AuthUser, idOrSlug: string, bucketId: string, objectId: string) {
  const project = await projectFor(actor, idOrSlug, true);
  const object = await db.cloudStorageObject.findFirst({ where: { id: objectId, bucketId, projectId: project.id, deletedAt: null }, include: { bucket: true } });
  if (!object) throw apiError("Cloud Storage object not found", "NOT_FOUND", undefined, 404);
  const root = objectRoot(project.id, object.bucketId);
  const filePath = resolveWithinRoot(root, object.storageRelPath);
  await db.$transaction(async (tx) => {
    await tx.cloudStorageObject.update({ where: { id: object.id }, data: { deletedAt: new Date() } });
    await tx.cloudStorageBucket.update({ where: { id: object.bucketId }, data: { usedBytes: { decrement: object.sizeBytes }, objectCount: { decrement: 1 } } });
    await tx.auditLog.create({ data: { actorUserId: actor.id, actorEmail: actor.email, actorRole: actor.role, action: "CLOUD_STORAGE_OBJECT_DELETED", resourceType: "CloudStorageObject", resourceId: object.id, domain: "cloud-baas", result: "SUCCESS", metadata: { projectId: project.id, bucketId, objectKey: object.objectKey } } });
  });
  if (filePath) await rm(filePath, { force: true }).catch(() => {});
  return { deleted: true, id: object.id };
}

/** Background lifecycle cleanup. Only rows past expiry or the configured age are removed. */
export async function cleanupCloudStorageLifecycle(now = new Date()): Promise<{ deleted: number }> {
  const buckets = await db.cloudStorageBucket.findMany({ where: { lifecycleDeleteDays: { not: null } }, select: { id: true, projectId: true, lifecycleDeleteDays: true } });
  let deleted = 0;
  for (const bucket of buckets) {
    const cutoff = new Date(now.getTime() - (bucket.lifecycleDeleteDays ?? 0) * 86_400_000);
    const objects = await db.cloudStorageObject.findMany({ where: { bucketId: bucket.id, deletedAt: null, OR: [{ expiresAt: { lte: now } }, { createdAt: { lte: cutoff } }] }, take: 100 });
    for (const object of objects) {
      const root = objectRoot(bucket.projectId, bucket.id);
      const filePath = resolveWithinRoot(root, object.storageRelPath);
      await db.$transaction(async (tx) => {
        await tx.cloudStorageObject.update({ where: { id: object.id }, data: { deletedAt: now } });
        await tx.cloudStorageBucket.update({ where: { id: bucket.id }, data: { usedBytes: { decrement: object.sizeBytes }, objectCount: { decrement: 1 } } });
      });
      if (filePath) await rm(filePath, { force: true }).catch(() => {});
      deleted++;
    }
  }
  return { deleted };
}
