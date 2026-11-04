/**
 * Cloud Foundation v2 — server-only shared controls.
 *
 * This module deliberately owns the safety-critical pieces used by every Cloud
 * surface: environment/secret lifecycle, project-member RBAC, worker
 * credentials and durable quota metering. It never returns a plaintext secret
 * to a browser response.
 */

import { createHash, randomBytes } from "node:crypto";
import path from "node:path";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { isAdminRole, type AuthUser } from "@/lib/auth";
import { apiError } from "@/lib/response";
import { openSecretValue, sealSecretValue } from "@/lib/secret-store";
import { constantTimeHexEquals, hashCloudSecret } from "./crypto-auth";
import { parseCloudScopes, type CloudProjectScope } from "./catalog";

type DbTx = Prisma.TransactionClient | typeof db;

export const CLOUD_ENVIRONMENT_SLUGS = ["development", "preview", "production"] as const;
export type CloudEnvironmentSlug = (typeof CLOUD_ENVIRONMENT_SLUGS)[number];

export const CLOUD_MEMBER_ROLES = ["OWNER", "ADMIN", "DEVELOPER", "VIEWER", "SERVICE"] as const;
export type CloudMemberRole = (typeof CLOUD_MEMBER_ROLES)[number];

const MANAGE_MEMBER_ROLES = new Set<CloudMemberRole>(["OWNER", "ADMIN"]);
const WRITE_MEMBER_ROLES = new Set<CloudMemberRole>(["OWNER", "ADMIN", "DEVELOPER"]);

export function isCloudEnvironmentSlug(value: string): value is CloudEnvironmentSlug {
  return (CLOUD_ENVIRONMENT_SLUGS as readonly string[]).includes(value);
}

export function isCloudMemberRole(value: string): value is CloudMemberRole {
  return (CLOUD_MEMBER_ROLES as readonly string[]).includes(value);
}

/** A safe root for Cloud-owned artifacts; no client path is ever joined into it. */
export function cloudDataRoot(): string {
  const configured = process.env.CLOUD_DATA_DIR?.trim();
  const root = configured || path.join(process.cwd(), ".cloud-data");
  return path.resolve(root);
}

export function safeCloudSegment(value: string, fallback = "resource"): string {
  const out = value.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 100);
  return out || fallback;
}

export function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

export function parseJsonObject(raw: string | null | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

export function parseJsonStringArray(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

export function normaliseCloudSecretKey(value: string): string | null {
  const key = value.trim();
  return /^[A-Z_][A-Z0-9_]{0,127}$/.test(key) ? key : null;
}

/**
 * Seed every project with the three actual deployment environments. Repeated
 * calls are intentional and idempotent, which also repairs projects created
 * before Cloud Foundation v2 without a destructive migration.
 */
export async function ensureCloudFoundation(tx: DbTx, projectId: string, actorId: string): Promise<void> {
  const defaults: Array<{ slug: CloudEnvironmentSlug; name: string; branchPattern: string; isProtected: boolean; requireApproval: boolean }> = [
    { slug: "development", name: "Development", branchPattern: "develop", isProtected: false, requireApproval: false },
    { slug: "preview", name: "Preview", branchPattern: "*", isProtected: false, requireApproval: false },
    { slug: "production", name: "Production", branchPattern: "main", isProtected: true, requireApproval: true },
  ];
  for (const item of defaults) {
    await tx.cloudEnvironment.upsert({
      where: { projectId_slug: { projectId, slug: item.slug } },
      create: { projectId, ...item },
      update: {},
    });
  }
  await tx.cloudProjectQuota.upsert({
    where: { projectId },
    create: { projectId, updatedBy: actorId },
    update: {},
  });
}

export async function requireCloudEnvironment(tx: DbTx, projectId: string, slug: string): Promise<void> {
  if (!isCloudEnvironmentSlug(slug)) {
    throw apiError("Environment must be development, preview, or production", "VALIDATION_ERROR", undefined, 400);
  }
  const row = await tx.cloudEnvironment.findUnique({ where: { projectId_slug: { projectId, slug } }, select: { id: true } });
  if (!row) throw apiError("Cloud environment not found", "NOT_FOUND", undefined, 404);
}

export function presentCloudSecret(row: {
  id: string;
  projectId: string;
  environmentSlug: string;
  key: string;
  isSecret: boolean;
  currentVersion: number;
  accessScope: string;
  rotatedAt: Date | null;
  updatedBy: string;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: row.id,
    projectId: row.projectId,
    environmentSlug: row.environmentSlug,
    key: row.key,
    isSecret: row.isSecret,
    currentVersion: row.currentVersion,
    accessScope: row.accessScope,
    rotatedAt: row.rotatedAt?.toISOString() ?? null,
    updatedBy: row.updatedBy,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    value: row.isSecret ? "********" : "[managed]",
  };
}

/**
 * Persist a versioned AES-256-GCM secret. `plaintext` is deliberately accepted
 * only in this server-only function and is never copied into an audit record.
 */
export async function sealCloudSecret(
  tx: DbTx,
  input: {
    projectId: string;
    environmentSlug: string;
    key: string;
    plaintext: string;
    isSecret?: boolean;
    accessScope?: "build_and_runtime" | "runtime_only" | "functions_only";
    actorId: string;
    reason?: string;
  },
) {
  const key = normaliseCloudSecretKey(input.key);
  if (!key) throw apiError("Secret key must be an uppercase environment identifier", "VALIDATION_ERROR", undefined, 400);
  if (input.plaintext.length > 64_000) throw apiError("Secret value is too large", "PAYLOAD_TOO_LARGE", undefined, 413);
  await requireCloudEnvironment(tx, input.projectId, input.environmentSlug);
  const sealedValue = sealSecretValue(input.plaintext);
  const checksumSha256 = sha256(input.plaintext);
  const existing = await tx.cloudSecret.findUnique({
    where: { projectId_environmentSlug_key: { projectId: input.projectId, environmentSlug: input.environmentSlug, key } },
  });

  if (!existing) {
    const row = await tx.cloudSecret.create({
      data: {
        projectId: input.projectId,
        environmentSlug: input.environmentSlug,
        key,
        sealedValue,
        isSecret: input.isSecret ?? true,
        currentVersion: 1,
        accessScope: input.accessScope ?? "build_and_runtime",
        updatedBy: input.actorId,
        versions: {
          create: {
            version: 1,
            sealedValue,
            checksumSha256,
            createdBy: input.actorId,
            reason: input.reason?.slice(0, 240) ?? "created",
          },
        },
      },
    });
    return row;
  }

  const nextVersion = existing.currentVersion + 1;
  const row = await tx.cloudSecret.update({
    where: { id: existing.id },
    data: {
      sealedValue,
      isSecret: input.isSecret ?? existing.isSecret,
      accessScope: input.accessScope ?? existing.accessScope,
      currentVersion: nextVersion,
      rotatedAt: new Date(),
      updatedBy: input.actorId,
      versions: {
        create: {
          version: nextVersion,
          sealedValue,
          checksumSha256,
          createdBy: input.actorId,
          reason: input.reason?.slice(0, 240) ?? "rotated",
        },
      },
    },
  });
  return row;
}

/**
 * Opens build/runtime values only in a trusted worker process. Do not call this
 * from a route that serializes its output. Corrupt ciphertext fails closed.
 */
export async function openCloudEnvironmentSecrets(
  tx: DbTx,
  projectId: string,
  environmentSlug: CloudEnvironmentSlug,
  usage: "build" | "runtime" | "functions",
): Promise<Record<string, string>> {
  const allowedScopes = usage === "functions"
    ? new Set(["build_and_runtime", "functions_only"])
    : usage === "build"
      ? new Set(["build_and_runtime"])
      : new Set(["build_and_runtime", "runtime_only"]);
  const rows = await tx.cloudSecret.findMany({
    where: { projectId, environmentSlug, accessScope: { in: [...allowedScopes] } },
    select: { key: true, sealedValue: true },
  });
  const values: Record<string, string> = {};
  for (const row of rows) {
    try {
      values[row.key] = openSecretValue(row.sealedValue);
    } catch {
      // A broken secret must never silently become empty and alter a build.
      throw apiError(`Cloud secret ${row.key} cannot be decrypted`, "SECRET_UNAVAILABLE", undefined, 503);
    }
  }
  return values;
}

export interface CloudMemberDecision {
  role: CloudMemberRole | "PLATFORM_ADMIN" | null;
  scopes: CloudProjectScope[];
  expiresAt: Date | null;
}

/** Resolve a direct project role. Organization membership is intentionally not a substitute for an explicit project role here. */
export async function cloudProjectMemberDecision(
  tx: DbTx,
  actor: { id: string; role: string },
  project: { id: string; ownerId: string },
): Promise<CloudMemberDecision> {
  if (isAdminRole(actor.role)) return { role: "PLATFORM_ADMIN", scopes: [], expiresAt: null };
  if (project.ownerId === actor.id) return { role: "OWNER", scopes: [], expiresAt: null };
  const member = await tx.cloudProjectMember.findUnique({
    where: { projectId_userId: { projectId: project.id, userId: actor.id } },
  }).catch(() => null);
  if (!member || (member.expiresAt && member.expiresAt.getTime() <= Date.now()) || !isCloudMemberRole(member.role)) {
    return { role: null, scopes: [], expiresAt: member?.expiresAt ?? null };
  }
  return { role: member.role, scopes: parseCloudScopes(member.scopes), expiresAt: member.expiresAt };
}

/**
 * Checks direct project RBAC after the normal owner/organization policy. A
 * SERVICE member may only do exactly the scopes it was granted.
 */
export function memberAllows(decision: CloudMemberDecision, action: "view" | "write" | "manage-members" | "delete", neededScope?: CloudProjectScope): boolean {
  if (decision.role === "PLATFORM_ADMIN" || decision.role === "OWNER") return true;
  if (!decision.role) return false;
  if (action === "view") return decision.role === "VIEWER" || WRITE_MEMBER_ROLES.has(decision.role) || Boolean(neededScope && decision.scopes.includes(neededScope));
  if (action === "manage-members" || action === "delete") return MANAGE_MEMBER_ROLES.has(decision.role);
  if (decision.role === "SERVICE") return Boolean(neededScope && decision.scopes.includes(neededScope));
  return WRITE_MEMBER_ROLES.has(decision.role) && (!neededScope || decision.scopes.length === 0 || decision.scopes.includes(neededScope));
}

export function generateCloudWorkerCredential(): { workerKey: string; secret: string; secretHash: string; secretPrefix: string } {
  const workerKey = `worker_${randomBytes(12).toString("hex")}`;
  const secret = `alowkr_${randomBytes(32).toString("hex")}`;
  return { workerKey, secret, secretHash: hashCloudSecret(secret), secretPrefix: secret.slice(0, 16) };
}

export function workerCapabilities(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const raw = value as Record<string, unknown>;
  const runtimeProbes = raw.runtimeProbes;
  const normalizedProbes: Record<string, { executable: boolean; version?: string; checkedAt: string }> = {};
  if (runtimeProbes && typeof runtimeProbes === "object" && !Array.isArray(runtimeProbes)) {
    for (const [runtime, probe] of Object.entries(runtimeProbes as Record<string, unknown>)) {
      if (!["node-22", "python-3.11", "python-3.12", "bun-1.4", "deno-2.1", "go-1.23", "php-8.4"].includes(runtime)) continue;
      if (!probe || typeof probe !== "object" || Array.isArray(probe)) continue;
      const p = probe as Record<string, unknown>;
      normalizedProbes[runtime] = {
        executable: p.executable === true,
        ...(typeof p.version === "string" ? { version: p.version.slice(0, 80) } : {}),
        checkedAt: typeof p.checkedAt === "string" ? p.checkedAt.slice(0, 40) : new Date().toISOString(),
      };
    }
  }
  return { runtimeProbes: normalizedProbes };
}

export async function cloudRuntimeIsVerified(runtime: string, maxAgeMs = 120_000): Promise<boolean> {
  // Only the reviewed runtimes may ever be executable. A worker claiming that
  // Bun/Deno/Go/PHP exists does not widen the platform's execution policy.
  if (!["node-22", "python-3.11", "python-3.12"].includes(runtime)) return false;
  const since = new Date(Date.now() - maxAgeMs);
  const nodes = await db.cloudWorkerNode.findMany({
    where: { status: "ONLINE", lastHeartbeatAt: { gte: since } },
    select: { capabilities: true },
    take: 50,
  });
  return nodes.some((node) => {
    const caps = parseJsonObject(node.capabilities);
    const probes = caps.runtimeProbes;
    if (!probes || typeof probes !== "object" || Array.isArray(probes)) return false;
    const probe = (probes as Record<string, unknown>)[runtime];
    return Boolean(probe && typeof probe === "object" && !Array.isArray(probe) && (probe as Record<string, unknown>).executable === true);
  });
}

export function authenticateCloudWorker(node: { workerSecretHash: string | null; workerKey: string }, presentedSecret: string | null): boolean {
  if (!presentedSecret || !node.workerSecretHash || presentedSecret.length > 256) return false;
  return constantTimeHexEquals(hashCloudSecret(presentedSecret), node.workerSecretHash);
}
