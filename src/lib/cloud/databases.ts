/** Cloud databases: local SQLite ownership plus honest agent-gated external DBs. */

import { createHash, randomBytes } from "node:crypto";
import { copyFile, mkdir, rename, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { createClient } from "@libsql/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { type AuthUser } from "@/lib/auth";
import { apiError } from "@/lib/response";
import { orchestrator } from "@/lib/orchestrator/orchestrator";
import "@/lib/orchestrator/workers";
import { canManageCloudProject, canViewCloudProject } from "./cloud-service";
import { cloudDataRoot, safeCloudSegment, sealCloudSecret } from "./foundation";
import { assertCloudResourceQuota, recordCloudUsageEvent } from "./usage";
import { slugifyCloudIdentifier } from "./catalog";

const createSchema = z.object({
  name: z.string().trim().min(2).max(80),
  slug: z.string().trim().min(2).max(48).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).optional(),
  engine: z.enum(["SQLITE_ISOLATED", "MARIADB", "POSTGRESQL"]),
  environment: z.enum(["development", "preview", "production"]).default("development"),
  storageLimitMb: z.number().int().min(16).max(65_536).default(512),
  maxConnections: z.number().int().min(1).max(500).default(20),
}).strict();

function databaseRoot(projectId: string): string {
  return path.join(cloudDataRoot(), "databases", safeCloudSegment(projectId));
}

function safeDatabasePath(projectId: string, stored: string): string | null {
  const root = path.resolve(databaseRoot(projectId));
  const candidate = path.resolve(stored);
  return candidate.startsWith(root + path.sep) ? candidate : null;
}

function randomPassword(): string {
  return `alodb_${randomBytes(30).toString("base64url")}`;
}

async function getProjectForView(actor: AuthUser, idOrSlug: string, manage: boolean) {
  const project = await db.cloudProject.findFirst({ where: { OR: [{ id: idOrSlug }, { slug: idOrSlug }] } });
  if (!project) throw apiError("Cloud Project not found", "NOT_FOUND", undefined, 404);
  const allowed = manage ? await canManageCloudProject(db, actor, project) : await canViewCloudProject(db, actor, project);
  if (!allowed) throw apiError("Forbidden to access this Cloud Project", "FORBIDDEN", undefined, 403);
  return project;
}

function presentDatabase(row: {
  id: string;
  projectId: string;
  slug: string;
  name: string;
  engine: string;
  environmentSlug: string;
  status: string;
  host: string | null;
  port: number | null;
  databaseName: string;
  username: string;
  credentialVersion: number;
  maxConnections: number;
  storageLimitMb: number;
  storageUsedBytes: number;
  healthStatus: string;
  lastHealthCheckAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: row.id,
    projectId: row.projectId,
    slug: row.slug,
    name: row.name,
    engine: row.engine,
    environment: row.environmentSlug,
    status: row.status,
    host: row.host,
    port: row.port,
    databaseName: row.databaseName,
    username: row.username,
    credentialVersion: row.credentialVersion,
    maxConnections: row.maxConnections,
    storageLimitMb: row.storageLimitMb,
    storageUsedBytes: row.storageUsedBytes,
    healthStatus: row.healthStatus,
    lastHealthCheckAt: row.lastHealthCheckAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listCloudDatabases(actor: AuthUser, idOrSlug: string) {
  const project = await getProjectForView(actor, idOrSlug, false);
  const rows = await db.cloudDatabaseInstance.findMany({ where: { projectId: project.id }, orderBy: { createdAt: "desc" } });
  return rows.map(presentDatabase);
}

export async function createCloudDatabase(actor: AuthUser, idOrSlug: string, rawInput: unknown) {
  const input = createSchema.parse(rawInput);
  const slug = input.slug ?? slugifyCloudIdentifier(input.name);
  if (!slug || slug.length < 2) throw apiError("Database name must include at least two alphanumeric characters", "VALIDATION_ERROR", undefined, 400);
  const project = await getProjectForView(actor, idOrSlug, true);

  return db.$transaction(async (tx) => {
    await assertCloudResourceQuota(tx, { projectId: project.id, resource: "databases", actorId: actor.id });
    const existing = await tx.cloudDatabaseInstance.findUnique({ where: { projectId_slug: { projectId: project.id, slug } }, select: { id: true } });
    if (existing) throw apiError("A Cloud Database with that slug already exists", "SLUG_CONFLICT", undefined, 409);
    const password = randomPassword();
    const row = await tx.cloudDatabaseInstance.create({
      data: {
        projectId: project.id,
        slug,
        name: input.name,
        engine: input.engine,
        environmentSlug: input.environment,
        status: input.engine === "SQLITE_ISOLATED" ? "PROVISIONING" : "REQUIRES_INFRASTRUCTURE",
        databaseName: slug.replace(/-/g, "_"),
        username: `u_${slug.replace(/-/g, "_").slice(0, 50)}`,
        passwordSealed: "", // filled by sealCloudSecret-compatible envelope below
        maxConnections: input.maxConnections,
        storageLimitMb: input.storageLimitMb,
        createdBy: actor.id,
      },
    });
    // Database credentials are sealed with the same versioned AES-GCM envelope
    // used by Cloud env values, but are never copied into CloudSecret rows.
    const { sealSecretValue } = await import("@/lib/secret-store");
    const sealed = sealSecretValue(password);
    const updated = await tx.cloudDatabaseInstance.update({ where: { id: row.id }, data: { passwordSealed: sealed } });
    await tx.auditLog.create({
      data: {
        actorUserId: actor.id,
        actorEmail: actor.email,
        actorRole: actor.role,
        action: "CLOUD_DATABASE_REQUESTED",
        resourceType: "CloudDatabaseInstance",
        resourceId: row.id,
        domain: "cloud-baas",
        result: input.engine === "SQLITE_ISOLATED" ? "PROVISIONING" : "REQUIRES_INFRASTRUCTURE",
        metadata: { projectId: project.id, engine: input.engine, environment: input.environment, slug },
      },
    });
    return { project, database: updated, plaintextPassword: password };
  }).then(async ({ project: txProject, database, plaintextPassword }) => {
    if (input.engine === "SQLITE_ISOLATED") {
      const root = databaseRoot(txProject.id);
      const filePath = path.join(root, `${safeCloudSegment(database.slug)}.sqlite`);
      try {
        await mkdir(root, { recursive: true, mode: 0o700 });
        const client = createClient({ url: `file:${filePath}` });
        await client.execute("PRAGMA journal_mode=WAL");
        await client.execute("CREATE TABLE IF NOT EXISTS _alo_cloud_database_meta (created_at TEXT NOT NULL)");
        await client.execute("INSERT INTO _alo_cloud_database_meta (created_at) VALUES (CURRENT_TIMESTAMP)");
        client.close();
        const fileStat = await stat(filePath);
        const completed = await db.cloudDatabaseInstance.update({
          where: { id: database.id },
          data: { isolatedFilePath: filePath, status: "AVAILABLE", healthStatus: "HEALTHY", lastHealthCheckAt: new Date(), storageUsedBytes: Math.min(fileStat.size, 2_147_483_647) },
        });
        await recordCloudUsageEvent(db, {
          idempotencyKey: `database-storage:${completed.id}:create`,
          projectId: txProject.id,
          ownerId: txProject.ownerId,
          metric: "database_storage_bytes",
          quantity: fileStat.size,
          unit: "byte",
          referenceType: "CloudDatabaseInstance",
          referenceId: completed.id,
        });
        return { database: presentDatabase(completed), password: plaintextPassword, setupState: "AVAILABLE" as const };
      } catch (error) {
        await db.cloudDatabaseInstance.update({ where: { id: database.id }, data: { status: "ERROR", healthStatus: "UNVERIFIED" } }).catch(() => {});
        throw apiError(`SQLite isolated database provisioning failed: ${error instanceof Error ? error.message : "unknown error"}`, "DATABASE_PROVISION_FAILED", undefined, 503);
      }
    }

    // MariaDB/PostgreSQL require an enrolled agent. Persist a truthful blocked
    // resource and an approval-gated job rather than pretending credentials
    // magically provisioned a remote database.
    const job = await orchestrator.enqueue({
      kind: "DATABASE_OPS",
      type: "CLOUD_DATABASE_PROVISION",
      input: { action: "provision", instanceId: database.id, notes: `Cloud ${input.engine} database ${database.slug}` },
      lockKey: `cloud-db:${txProject.id}`,
      resourceType: "CloudDatabaseInstance",
      resourceId: database.id,
      idempotencyKey: `cloud-db-provision:${database.id}`,
      requiresApproval: true,
      actor,
    });
    return {
      database: presentDatabase(database),
      password: plaintextPassword,
      setupState: "REQUIRES_INFRASTRUCTURE" as const,
      job,
    };
  });
}

export async function rotateCloudDatabaseCredential(actor: AuthUser, idOrSlug: string, databaseId: string) {
  const project = await getProjectForView(actor, idOrSlug, true);
  return db.$transaction(async (tx) => {
    const database = await tx.cloudDatabaseInstance.findFirst({ where: { id: databaseId, projectId: project.id } });
    if (!database) throw apiError("Cloud database not found", "NOT_FOUND", undefined, 404);
    const password = randomPassword();
    const { sealSecretValue } = await import("@/lib/secret-store");
    const row = await tx.cloudDatabaseInstance.update({
      where: { id: database.id },
      data: { passwordSealed: sealSecretValue(password), credentialVersion: { increment: 1 } },
    });
    await tx.auditLog.create({ data: { actorUserId: actor.id, actorEmail: actor.email, actorRole: actor.role, action: "CLOUD_DATABASE_CREDENTIAL_ROTATED", resourceType: "CloudDatabaseInstance", resourceId: row.id, domain: "cloud-baas", result: "SUCCESS", metadata: { projectId: project.id, credentialVersion: row.credentialVersion } } });
    return { database: presentDatabase(row), password };
  });
}

export async function createCloudDatabaseBackup(actor: AuthUser, idOrSlug: string, databaseId: string) {
  const project = await getProjectForView(actor, idOrSlug, true);
  const database = await db.cloudDatabaseInstance.findFirst({ where: { id: databaseId, projectId: project.id } });
  if (!database) throw apiError("Cloud database not found", "NOT_FOUND", undefined, 404);
  if (database.engine !== "SQLITE_ISOLATED" || !database.isolatedFilePath) {
    throw apiError("This database needs an agent-backed backup job", "REQUIRES_INFRASTRUCTURE", undefined, 409);
  }
  const source = safeDatabasePath(project.id, database.isolatedFilePath);
  if (!source) throw apiError("Database storage path is invalid", "DATABASE_PATH_INVALID", undefined, 500);
  const backupDir = path.join(cloudDataRoot(), "database-backups", safeCloudSegment(project.id), safeCloudSegment(database.id));
  await mkdir(backupDir, { recursive: true, mode: 0o700 });
  const suffix = `${Date.now()}-${randomBytes(6).toString("hex")}`;
  const temp = path.join(backupDir, `${suffix}.tmp`);
  const archivePath = path.join(backupDir, `${suffix}.sqlite`);
  await copyFile(source, temp);
  const contents = await (await import("node:fs/promises")).readFile(temp);
  const checksumSha256 = createHash("sha256").update(contents).digest("hex");
  await rename(temp, archivePath);
  const sizeBytes = Math.min(contents.byteLength, 2_147_483_647);
  const backup = await db.cloudDatabaseBackup.create({
    data: { databaseId: database.id, projectId: project.id, archivePath, sizeBytes, checksumSha256, credentialVersion: database.credentialVersion, createdBy: actor.id },
  });
  await db.auditLog.create({ data: { actorUserId: actor.id, actorEmail: actor.email, actorRole: actor.role, action: "CLOUD_DATABASE_BACKUP_CREATED", resourceType: "CloudDatabaseBackup", resourceId: backup.id, domain: "cloud-baas", result: "SUCCESS", metadata: { projectId: project.id, databaseId: database.id, checksumSha256, sizeBytes } } });
  return { id: backup.id, databaseId: backup.databaseId, checksumSha256, sizeBytes, status: backup.status, createdAt: backup.createdAt.toISOString() };
}

export async function requestCloudDatabaseRestore(actor: AuthUser, idOrSlug: string, databaseId: string, backupId: string) {
  const project = await getProjectForView(actor, idOrSlug, true);
  const [database, backup] = await Promise.all([
    db.cloudDatabaseInstance.findFirst({ where: { id: databaseId, projectId: project.id } }),
    db.cloudDatabaseBackup.findFirst({ where: { id: backupId, databaseId, projectId: project.id } }),
  ]);
  if (!database || !backup) throw apiError("Cloud database backup not found", "NOT_FOUND", undefined, 404);
  if (database.engine !== "SQLITE_ISOLATED") throw apiError("Remote database restores require an enrolled agent", "REQUIRES_INFRASTRUCTURE", undefined, 409);
  const job = await orchestrator.enqueue({
    kind: "BACKUP_RESTORE",
    type: "CLOUD_SQLITE_RESTORE",
    input: { action: "cloud-sqlite-restore", databaseId, cloudBackupId: backup.id },
    lockKey: `cloud-db:${project.id}:${databaseId}`,
    resourceType: "CloudDatabaseInstance",
    resourceId: databaseId,
    idempotencyKey: `cloud-db-restore:${databaseId}:${backup.id}:${Date.now()}`,
    requiresApproval: true,
    actor,
  });
  await db.auditLog.create({ data: { actorUserId: actor.id, actorEmail: actor.email, actorRole: actor.role, action: "CLOUD_DATABASE_RESTORE_REQUESTED", resourceType: "CloudDatabaseBackup", resourceId: backup.id, domain: "cloud-baas", result: "WAITING_APPROVAL", metadata: { projectId: project.id, databaseId, jobId: job.jobId } } });
  return { job, approvalRequired: true };
}

/** Called only by the approved BACKUP_RESTORE worker. */
export async function restoreCloudSqliteDatabase(databaseId: string, backupId: string) {
  const [database, backup] = await Promise.all([
    db.cloudDatabaseInstance.findUnique({ where: { id: databaseId } }),
    db.cloudDatabaseBackup.findUnique({ where: { id: backupId } }),
  ]);
  if (!database || !backup || backup.databaseId !== database.id || database.engine !== "SQLITE_ISOLATED") {
    throw new Error("Cloud SQLite restore target is invalid");
  }
  const destination = database.isolatedFilePath ? safeDatabasePath(database.projectId, database.isolatedFilePath) : null;
  const archive = safeDatabasePath(database.projectId, backup.archivePath.replace(path.join(cloudDataRoot(), "database-backups"), path.join(cloudDataRoot(), "databases"))) ?? backup.archivePath;
  // archive lives under cloudDataRoot, explicitly require that containment too.
  const allowedBackupRoot = path.resolve(path.join(cloudDataRoot(), "database-backups", safeCloudSegment(database.projectId)));
  if (!destination || !path.resolve(backup.archivePath).startsWith(allowedBackupRoot + path.sep)) throw new Error("Cloud SQLite restore path is invalid");
  const buf = await (await import("node:fs/promises")).readFile(backup.archivePath);
  const digest = createHash("sha256").update(buf).digest("hex");
  if (digest !== backup.checksumSha256) throw new Error("Cloud SQLite backup checksum mismatch");
  const temp = `${destination}.restore-${randomBytes(6).toString("hex")}.tmp`;
  await copyFile(backup.archivePath, temp);
  await rename(temp, destination);
  const fileStat = await stat(destination);
  await db.$transaction(async (tx) => {
    await tx.cloudDatabaseInstance.update({ where: { id: database.id }, data: { status: "AVAILABLE", storageUsedBytes: Math.min(fileStat.size, 2_147_483_647), healthStatus: "HEALTHY", lastHealthCheckAt: new Date() } });
    await tx.cloudDatabaseBackup.update({ where: { id: backup.id }, data: { status: "RESTORED", restoredCount: { increment: 1 }, lastRestoredAt: new Date() } });
  });
  return { databaseId, backupId, checksumSha256: digest, sizeBytes: fileStat.size };
}
