/** Versioned configuration profiles. Secrets are references, never values. */
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { db } from "@/lib/db";
import { createAuditLog } from "@/lib/audit";
import { deployConfigSchema } from "@/lib/deploy/config";
import type { JobActor } from "./contracts";

const reference = z.object({ envName: z.string().regex(/^[A-Z][A-Z0-9_]{1,63}$/).optional(), secretId: z.string().min(1).max(100).optional() }).refine((v) => Boolean(v.envName || v.secretId), "credential reference required");
export const profileConfigSchemas = {
  node: z.object({ agentId: z.string().min(1), region: z.string().max(100).default("default"), maxConcurrency: z.number().int().min(1).max(64).default(2), publicIp: z.ipv4().optional() }).strict(),
  github: z.object({ connectionId: z.string().min(1), credential: reference }).strict(),
  dns: z.object({ provider: z.enum(["cloudflare"]), zoneId: z.string().min(1), credential: reference }).strict(),
  runtime: z.object({ framework: z.string().min(1), config: deployConfigSchema }).strict(),
  database: z.object({ engine: z.enum(["SQLITE_ISOLATED", "MARIADB", "POSTGRESQL"]), hostRef: reference, credential: reference, backupVerified: z.boolean().default(false) }).strict(),
};
export type ProfileKind = keyof typeof profileConfigSchemas;

export function validateProfileConfig(kind: string, config: unknown) {
  const schema = profileConfigSchemas[kind as ProfileKind];
  if (!schema) throw new Error(`Unsupported profile kind: ${kind}`);
  return schema.parse(config);
}

export async function createProfile(input: { key: string; name: string; kind: ProfileKind; framework?: string; ownerId?: string; config: unknown; changeNote?: string }, actor: JobActor) {
  const config = validateProfileConfig(input.kind, input.config);
  const checksum = createHash("sha256").update(JSON.stringify(config)).digest("hex");
  const profile = await db.automationProfile.upsert({ where: { key: input.key }, create: { key: input.key, name: input.name, kind: input.kind, framework: input.framework, ownerId: input.ownerId, createdById: actor.id === "system" ? null : actor.id }, update: {} });
  if (profile.kind !== input.kind) throw new Error("Profile kind is immutable");
  const latest = await db.automationProfileVersion.findFirst({ where: { profileId: profile.id }, orderBy: { version: "desc" } });
  const version = await db.automationProfileVersion.create({ data: { profileId: profile.id, version: (latest?.version ?? 0) + 1, config: JSON.stringify(config), checksum, changeNote: input.changeNote } });
  await createAuditLog({ actorId: actor.id === "system" ? undefined : actor.id, actorEmail: actor.email, actorRole: actor.role, action: "AUTOMATION_PROFILE_VERSION_CREATED", resourceType: "AutomationProfileVersion", resourceId: version.id, result: "VALIDATED", metadata: { key: profile.key, version: version.version, checksum } });
  return { profile, version };
}

/** Select a verified immutable version; never silently fall back to an unverified one. */
export async function activeProfile(key: string) {
  const profile = await db.automationProfile.findUnique({ where: { key } });
  if (!profile?.activeVersion) return null;
  return db.automationProfileVersion.findUnique({ where: { profileId_version: { profileId: profile.id, version: profile.activeVersion }, status: "VERIFIED" } });
}

export async function verifyProfile(versionId: string, actor: JobActor, requestId?: string) {
  const version = await db.automationProfileVersion.findUnique({ where: { id: versionId } });
  if (!version) throw new Error("Profile version not found");
  const { orchestrator } = await import("./orchestrator");
  // A failed reference check can be retried after the operator supplies the
  // credential. Each explicit verification request gets its own durable job;
  // requestId still collapses a double-click/network retry of the same request.
  const job = await orchestrator.enqueue({ kind: "WORKFLOW_STEP", type: "verify-profile", input: { action: "verify-profile", versionId }, actor, resourceId: versionId, resourceType: "AutomationProfileVersion", idempotencyKey: `profile-verify:${versionId}:${requestId ?? randomUUID()}`, lockKey: `profile:${versionId}` });
  await db.automationProfileVersion.update({ where: { id: versionId }, data: { verificationJobId: job.jobId, status: "VERIFYING", verificationError: null } });
  return job;
}

export async function syncProfileVerification(versionId: string, jobStatus: string, error: string | null, jobId?: string, actorId?: string | null) {
  const version = await db.automationProfileVersion.findUnique({ where: { id: versionId } });
  if (!version || (jobId && version.verificationJobId !== jobId)) return;
  const status = jobStatus === "SUCCESS" ? "VERIFIED" : ["FAILED", "DEAD_LETTER", "CANCELLED"].includes(jobStatus) ? "FAILED" : "VERIFYING";
  await db.automationProfileVersion.update({ where: { id: versionId }, data: { status, verificationError: error, ...(status === "VERIFIED" ? { verifiedAt: new Date(), verifiedById: actorId ?? null } : {}) } });
  if (status === "VERIFIED") await db.automationProfile.update({ where: { id: version.profileId }, data: { activeVersion: version.version } });
}

export async function rollbackProfile(profileId: string, version: number, actor: JobActor) {
  const target = await db.automationProfileVersion.findUnique({ where: { profileId_version: { profileId, version }, status: "VERIFIED" } });
  if (!target) throw new Error("Rollback target must be a previously verified version");
  const profile = await db.automationProfile.update({ where: { id: profileId }, data: { activeVersion: version } });
  await createAuditLog({ actorId: actor.id === "system" ? undefined : actor.id, actorEmail: actor.email, actorRole: actor.role, action: "AUTOMATION_PROFILE_ROLLED_BACK", resourceType: "AutomationProfile", resourceId: profileId, result: "SUCCESS", metadata: { version } });
  return { profile, activeVersion: version };
}

/** Repair verification state if a process died between job completion and sync. */
export async function reconcileProfileVerifications(): Promise<number> {
  const versions = await db.automationProfileVersion.findMany({ where: { status: "VERIFYING", verificationJobId: { not: null } }, take: 100 });
  for (const version of versions) {
    const job = await db.operationJob.findUnique({ where: { id: version.verificationJobId! }, select: { status: true, error: true, actorId: true } });
    if (job) await syncProfileVerification(version.id, job.status, job.error, version.verificationJobId!, job.actorId);
  }
  return versions.length;
}
