/**
 * Cloud Projects (Appwrite-style BaaS & Sites Workspace) — Server Persistence & RBAC
 *
 * Enforces:
 *   - Strict multi-tenant isolation (owner, organization OWNER/ADMIN/MEMBER, or platform admin)
 *   - Cross-tenant ownership checks before linking Websites, Databases, or Storage Buckets
 *   - One-time secret reveal on API key / webhook creation; SHA-256 hashes only in SQLite
 *   - Atomic `audit_logs` writes inside `db.$transaction` (mutations fail closed if audit fails)
 *   - Honest `REQUIRES_SETUP` state when additive tables are not yet migrated or when
 *     serverless function execution is inspected without an attached isolated runtime
 */

import { NextResponse } from "next/server";
import { ZodError } from "zod";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { apiError, type ApiResponse } from "@/lib/response";
import { isAdminRole, type AuthUser } from "@/lib/auth";
import { canManageCompany, canViewCompany } from "@/lib/app-center";
import { verifyReconstructionLedgerIntegrity } from "@/lib/ai/rea/reconstruction-ledger";
import {
  CLOUD_FUNCTION_RUNTIMES,
  CLOUD_PLATFORM_TYPES,
  CLOUD_PROJECT_SCOPES,
  CLOUD_REGIONS,
  CLOUD_SITE_FRAMEWORKS,
  CLOUD_STAGES,
  CLOUD_WEBHOOK_EVENTS,
  buildProjectOnboardingConfig,
  createCloudFunctionSchema,
  createCloudKeySchema,
  createCloudPlatformSchema,
  createCloudProjectSchema,
  createCloudWebhookSchema,
  evaluateCloudProjectPosture,
  getCloudFrameworkPreset,
  parseCloudScopes,
  slugifyCloudIdentifier,
  updateCloudProjectSchema,
  validatePlatformIdentifier,
  validateWebhookTargetUrl,
  type CloudProjectScope,
  type CloudStage,
} from "./catalog";
import {
  CLOUD_API_KEY_PREFIX_TAG,
  authenticateCloudProjectKey,
  extractCloudKeyHeaders,
  generateCloudApiKey,
  generateWebhookSigningSecret,
  redactCloudSecrets,
} from "./crypto-auth";

type DbTx = Prisma.TransactionClient | typeof db;

function isMissingCloudSchemaError(error: unknown): boolean {
  const text = error instanceof Error ? error.message : String(error ?? "");
  return /no such table:\s*(?:["`]?main["`]?\.)?["`]?cloud_project|table.*cloud_project.*does not exist/i.test(text);
}

export function cloudHttpError(error: unknown) {
  if (error instanceof ZodError) {
    const first = error.issues[0];
    const detail = first ? redactCloudSecrets(first.message) : "Validation failed";
    return NextResponse.json(
      apiError(detail, "VALIDATION_ERROR", error.issues.map((i) => ({ path: i.path.join("."), message: redactCloudSecrets(i.message) })), 400),
      { status: 400 },
    );
  }
  if (error instanceof SyntaxError) {
    return NextResponse.json(apiError("Invalid JSON request body", "VALIDATION_ERROR", undefined, 400), { status: 400 });
  }
  if (error && typeof error === "object" && "status" in error && typeof (error as ApiResponse).status === "number") {
    const resp = error as ApiResponse;
    return NextResponse.json(resp, { status: resp.status });
  }
  if (isMissingCloudSchemaError(error)) {
    return NextResponse.json(
      apiError(
        "Cloud Projects tables require additive schema setup. Run `DATABASE_URL=\"file:/path/to/alo.db\" node scripts/apply-deploy-schema.mjs`.",
        "CLOUD_SCHEMA_REQUIRES_SETUP",
        { migration: "20261102120000_cloud_baas_projects", setupState: "REQUIRES_SETUP" },
        503,
      ),
      { status: 503 },
    );
  }
  return NextResponse.json(
    apiError("Cloud Projects service error", "INTERNAL_ERROR", undefined, 500),
    { status: 500 },
  );
}

export async function readCloudJson(request: Request, maxBytes = 16_384): Promise<unknown> {
  const reader = request.body?.getReader();
  if (!reader) throw new SyntaxError("Request body is required");
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw apiError("Request body exceeds maximum size", "PAYLOAD_TOO_LARGE", undefined, 413);
      }
      chunks.push(Buffer.from(value));
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } finally {
    reader.releaseLock();
  }
}

// ─── Authorization & Resource Ownership ───────────────────────────────────────

export async function canViewCloudProject(
  client: DbTx,
  actor: { id: string; role: string },
  project: { ownerId: string; organizationId: string | null },
): Promise<boolean> {
  if (isAdminRole(actor.role)) return true;
  if (project.ownerId === actor.id) return true;
  if (project.organizationId) {
    return canViewCompany(client as never, actor, project.organizationId);
  }
  return false;
}

export async function canManageCloudProject(
  client: DbTx,
  actor: { id: string; role: string },
  project: { ownerId: string; organizationId: string | null },
): Promise<boolean> {
  if (isAdminRole(actor.role)) return true;
  if (project.ownerId === actor.id) return true;
  if (project.organizationId) {
    return canManageCompany(client as never, actor, project.organizationId);
  }
  return false;
}

async function resolveProjectOrThrow(client: DbTx, idOrSlug: string) {
  const project = await client.cloudProject.findFirst({
    where: { OR: [{ id: idOrSlug }, { slug: idOrSlug }] },
  });
  if (!project) {
    throw apiError("Cloud Project not found", "NOT_FOUND", undefined, 404);
  }
  return project;
}

async function verifyLinkedResourcesAccess(
  client: DbTx,
  actor: AuthUser,
  links: {
    organizationId?: string | null;
    linkedWebsiteId?: string | null;
    linkedDatabaseId?: string | null;
    linkedBucketId?: string | null;
  },
) {
  if (links.organizationId) {
    const org = await client.organization.findUnique({
      where: { id: links.organizationId },
      select: { id: true },
    });
    if (!org) throw apiError("Organization not found", "NOT_FOUND", undefined, 404);
    const allowed = await canManageCompany(client as never, actor, links.organizationId);
    if (!allowed) {
      throw apiError("Insufficient permissions for the selected organization", "FORBIDDEN", undefined, 403);
    }
  }

  if (links.linkedWebsiteId) {
    const site = await client.website.findFirst({
      where: { id: links.linkedWebsiteId, deletedAt: null },
      select: { id: true, ownerId: true, organizationId: true },
    });
    if (!site) throw apiError("Linked site not found", "NOT_FOUND", undefined, 404);
    if (!isAdminRole(actor.role) && site.ownerId !== actor.id) {
      const orgOk = site.organizationId ? await canManageCompany(client as never, actor, site.organizationId) : false;
      if (!orgOk) throw apiError("Forbidden to link another tenant's site", "FORBIDDEN", undefined, 403);
    }
  }

  if (links.linkedDatabaseId) {
    const instance = await client.databaseInstance.findFirst({
      where: { id: links.linkedDatabaseId, deletedAt: null },
      select: {
        id: true,
        website: { select: { ownerId: true, organizationId: true } },
      },
    });
    if (!instance) throw apiError("Linked database instance not found", "NOT_FOUND", undefined, 404);
    if (!isAdminRole(actor.role) && instance.website.ownerId !== actor.id) {
      const orgOk = instance.website.organizationId
        ? await canManageCompany(client as never, actor, instance.website.organizationId)
        : false;
      if (!orgOk) throw apiError("Forbidden to link another tenant's database", "FORBIDDEN", undefined, 403);
    }
  }

  if (links.linkedBucketId) {
    const bucket = await client.storageBucket.findFirst({
      where: { id: links.linkedBucketId, kind: "bucket" },
      select: { id: true, userId: true },
    });
    if (!bucket) throw apiError("Linked storage bucket not found", "NOT_FOUND", undefined, 404);
    if (!isAdminRole(actor.role) && bucket.userId !== actor.id) {
      throw apiError("Forbidden to link another tenant's storage bucket", "FORBIDDEN", undefined, 403);
    }
  }
}

// ─── Safe Client Projections (Never Expose Hashes or Secrets) ─────────────────

function safeParseJsonArray(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

export function presentCloudKey(row: {
  id: string;
  projectId: string;
  name: string;
  prefix: string;
  scopes: string;
  expiresAt: Date | null;
  revokedAt: Date | null;
  lastUsedAt: Date | null;
  createdBy: string;
  createdAt: Date;
}) {
  const expired = Boolean(!row.revokedAt && row.expiresAt && row.expiresAt.getTime() <= Date.now());
  return {
    id: row.id,
    projectId: row.projectId,
    name: row.name,
    prefix: row.prefix,
    scopes: parseCloudScopes(row.scopes),
    status: row.revokedAt ? ("REVOKED" as const) : expired ? ("EXPIRED" as const) : ("ACTIVE" as const),
    expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
    revokedAt: row.revokedAt ? row.revokedAt.toISOString() : null,
    lastUsedAt: row.lastUsedAt ? row.lastUsedAt.toISOString() : null,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
  };
}

export function presentCloudWebhook(row: {
  id: string;
  projectId: string;
  name: string;
  url: string;
  events: string;
  signingKeyPrefix: string;
  enabled: boolean;
  tlsVerify: boolean;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: row.id,
    projectId: row.projectId,
    name: row.name,
    url: row.url,
    events: safeParseJsonArray(row.events),
    signingKeyPrefix: row.signingKeyPrefix,
    enabled: row.enabled,
    tlsVerify: row.tlsVerify,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function presentCloudFunction(row: {
  id: string;
  projectId: string;
  slug: string;
  name: string;
  runtime: string;
  entrypoint: string;
  commands: string | null;
  events: string;
  schedule: string | null;
  timeoutSeconds: number;
  enabled: boolean;
  executionState: string;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: row.id,
    projectId: row.projectId,
    slug: row.slug,
    name: row.name,
    runtime: row.runtime,
    entrypoint: row.entrypoint,
    commands: row.commands,
    events: safeParseJsonArray(row.events),
    schedule: row.schedule,
    timeoutSeconds: row.timeoutSeconds,
    enabled: row.enabled,
    executionState: "REQUIRES_SETUP" as const,
    executable: false as const,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// ─── Service Operations ───────────────────────────────────────────────────────

export async function listCloudWorkspace(actor: AuthUser) {
  const admin = isAdminRole(actor.role);
  const memberships = admin
    ? []
    : await db.membership.findMany({
        where: { userId: actor.id },
        select: { organizationId: true },
      });
  const ownedOrgs = admin
    ? []
    : await db.organization.findMany({
        where: { ownerId: actor.id },
        select: { id: true },
      });
  const orgIds = Array.from(
    new Set([...memberships.map((m) => m.organizationId), ...ownedOrgs.map((o) => o.id)]),
  );

  const projects = await db.cloudProject.findMany({
    where: admin
      ? {}
      : {
          OR: [
            { ownerId: actor.id },
            ...(orgIds.length > 0 ? [{ organizationId: { in: orgIds } }] : []),
          ],
        },
    include: {
      _count: {
        select: { keys: true, platforms: true, webhooks: true, functions: true },
      },
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  const [organizations, websites, databases, buckets] = await Promise.all([
    db.organization.findMany({
      where: admin
        ? {}
        : {
            OR: [{ ownerId: actor.id }, ...(orgIds.length > 0 ? [{ id: { in: orgIds } }] : [])],
          },
      select: { id: true, name: true, slug: true },
      orderBy: { name: "asc" },
      take: 100,
    }),
    db.website.findMany({
      where: admin
        ? { deletedAt: null }
        : {
            deletedAt: null,
            OR: [
              { ownerId: actor.id },
              ...(orgIds.length > 0 ? [{ organizationId: { in: orgIds } }] : []),
            ],
          },
      select: { id: true, name: true, domain: true, runtime: true, status: true },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
    db.databaseInstance.findMany({
      where: admin
        ? { deletedAt: null }
        : {
            deletedAt: null,
            website: {
              OR: [
                { ownerId: actor.id },
                ...(orgIds.length > 0 ? [{ organizationId: { in: orgIds } }] : []),
              ],
            },
          },
      select: { id: true, name: true, engine: true, host: true, port: true },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
    db.storageBucket.findMany({
      where: admin ? { kind: "bucket" } : { kind: "bucket", userId: actor.id },
      select: { id: true, name: true, provider: true, region: true, objectCount: true, sizeBytes: true, isActive: true },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
  ]);

  const reaLedger = verifyReconstructionLedgerIntegrity();

  return {
    setupState: "AVAILABLE" as const,
    projects: projects.map((p) => ({
      ...p,
      createdAt: p.createdAt.toISOString(),
      updatedAt: p.updatedAt.toISOString(),
      counts: p._count,
    })),
    linkable: {
      organizations,
      websites,
      databases,
      buckets: buckets.map((b) => ({
        ...b,
        sizeBytes: Number(b.sizeBytes),
      })),
    },
    catalog: {
      regions: CLOUD_REGIONS,
      stages: CLOUD_STAGES,
      frameworks: CLOUD_SITE_FRAMEWORKS,
      scopes: CLOUD_PROJECT_SCOPES,
      platformTypes: CLOUD_PLATFORM_TYPES,
      webhookEvents: CLOUD_WEBHOOK_EVENTS,
      functionRuntimes: CLOUD_FUNCTION_RUNTIMES,
    },
    reaReconstruction: reaLedger,
  };
}

export async function createCloudProject(actor: AuthUser, rawInput: unknown) {
  const input = createCloudProjectSchema.parse(rawInput);
  const slug = input.slug ?? slugifyCloudIdentifier(input.name);
  if (!slug || slug.length < 2) {
    throw apiError("Project name must contain at least 2 alphanumeric characters", "VALIDATION_ERROR", undefined, 400);
  }

  const preset = getCloudFrameworkPreset(input.frameworkPreset, input.renderingMode);
  const renderingMode = input.renderingMode ?? preset?.adapter.mode ?? "ssr";
  const installCommand = input.installCommand ?? preset?.adapter.installCommand ?? "npm ci";
  const buildCommand = input.buildCommand ?? preset?.adapter.buildCommand ?? "npm run build";
  const outputDirectory = input.outputDirectory ?? preset?.adapter.outputDirectory ?? "./.next";

  return db.$transaction(async (tx) => {
    await verifyLinkedResourcesAccess(tx, actor, {
      organizationId: input.organizationId ?? null,
      linkedWebsiteId: input.linkedWebsiteId ?? null,
      linkedDatabaseId: input.linkedDatabaseId ?? null,
      linkedBucketId: input.linkedBucketId ?? null,
    });

    const existing = await tx.cloudProject.findUnique({ where: { slug }, select: { id: true } });
    if (existing) {
      throw apiError(`A Cloud Project with slug "${slug}" already exists`, "SLUG_CONFLICT", undefined, 409);
    }

    const project = await tx.cloudProject.create({
      data: {
        slug,
        name: input.name,
        description: input.description ?? null,
        organizationId: input.organizationId ?? null,
        ownerId: actor.id,
        region: input.region,
        stage: input.stage,
        frameworkPreset: input.frameworkPreset,
        renderingMode,
        installCommand,
        buildCommand,
        outputDirectory,
        linkedWebsiteId: input.linkedWebsiteId ?? null,
        linkedDatabaseId: input.linkedDatabaseId ?? null,
        linkedBucketId: input.linkedBucketId ?? null,
      },
    });

    await tx.auditLog.create({
      data: {
        actorUserId: actor.id,
        actorEmail: actor.email,
        actorRole: actor.role,
        action: "CLOUD_PROJECT_CREATED",
        resourceType: "CloudProject",
        resourceId: project.id,
        domain: "cloud-baas",
        result: "SUCCESS",
        metadata: {
          slug: project.slug,
          stage: project.stage,
          frameworkPreset: project.frameworkPreset,
          organizationId: project.organizationId,
        },
      },
    });

    return {
      ...project,
      createdAt: project.createdAt.toISOString(),
      updatedAt: project.updatedAt.toISOString(),
    };
  });
}

export async function getCloudProjectWorkspace(actor: AuthUser, idOrSlug: string, origin: string) {
  const project = await db.cloudProject.findFirst({
    where: { OR: [{ id: idOrSlug }, { slug: idOrSlug }] },
    include: {
      keys: { orderBy: { createdAt: "desc" } },
      platforms: { orderBy: { createdAt: "desc" } },
      webhooks: { orderBy: { createdAt: "desc" } },
      functions: { orderBy: { createdAt: "desc" } },
    },
  });
  if (!project) {
    throw apiError("Cloud Project not found", "NOT_FOUND", undefined, 404);
  }
  if (!(await canViewCloudProject(db, actor, project))) {
    throw apiError("Forbidden to view this Cloud Project", "FORBIDDEN", undefined, 403);
  }

  const canManage = await canManageCloudProject(db, actor, project);

  const [linkedWebsite, linkedDatabase, linkedBucket] = await Promise.all([
    project.linkedWebsiteId
      ? db.website.findFirst({
          where: { id: project.linkedWebsiteId, deletedAt: null },
          select: {
            id: true,
            name: true,
            domain: true,
            runtime: true,
            status: true,
            gitRepo: true,
            gitBranch: true,
            healthStatus: true,
            domains: { select: { domain: true, sslEnabled: true, sslStatus: true }, take: 5 },
            deployments: {
              select: { id: true, status: true, commitHash: true, verifiedCommitSha: true, createdAt: true },
              orderBy: { createdAt: "desc" },
              take: 3,
            },
          },
        })
      : Promise.resolve(null),
    project.linkedDatabaseId
      ? db.databaseInstance.findFirst({
          where: { id: project.linkedDatabaseId, deletedAt: null },
          select: { id: true, name: true, engine: true, host: true, port: true, username: true },
        })
      : Promise.resolve(null),
    project.linkedBucketId
      ? db.storageBucket.findFirst({
          where: { id: project.linkedBucketId, kind: "bucket" },
          select: { id: true, name: true, provider: true, region: true, objectCount: true, sizeBytes: true, isActive: true, policy: true },
        })
      : Promise.resolve(null),
  ]);

  const keys = project.keys.map(presentCloudKey);
  const webhooks = project.webhooks.map(presentCloudWebhook);
  const functions = project.functions.map(presentCloudFunction);
  const platforms = project.platforms.map((p) => ({
    id: p.id,
    projectId: p.projectId,
    name: p.name,
    type: p.type,
    identifier: p.identifier,
    enabled: p.enabled,
    createdBy: p.createdBy,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  }));

  const sslEnabled = linkedWebsite
    ? linkedWebsite.domains.length > 0 && linkedWebsite.domains.some((d) => d.sslEnabled)
    : undefined;

  let bucketPublic = false;
  if (linkedBucket?.policy) {
    try {
      const parsed = JSON.parse(linkedBucket.policy) as { public?: boolean };
      bucketPublic = parsed.public === true;
    } catch {
      bucketPublic = false;
    }
  }

  const advisor = evaluateCloudProjectPosture({
    stage: project.stage,
    linkedWebsite: linkedWebsite
      ? { id: linkedWebsite.id, domain: linkedWebsite.domain, sslEnabled, status: linkedWebsite.status }
      : null,
    linkedDatabase: linkedDatabase ? { id: linkedDatabase.id, name: linkedDatabase.name } : null,
    linkedBucket: linkedBucket ? { id: linkedBucket.id, name: linkedBucket.name, isPublic: bucketPublic } : null,
    keys,
    platforms,
    webhooks,
    functions,
  });

  const onboarding = buildProjectOnboardingConfig({
    projectId: project.id,
    projectSlug: project.slug,
    origin,
    frameworkPreset: project.frameworkPreset,
  });

  return {
    canManage,
    project: {
      id: project.id,
      slug: project.slug,
      name: project.name,
      description: project.description,
      organizationId: project.organizationId,
      ownerId: project.ownerId,
      region: project.region,
      stage: project.stage,
      frameworkPreset: project.frameworkPreset,
      renderingMode: project.renderingMode,
      installCommand: project.installCommand,
      buildCommand: project.buildCommand,
      outputDirectory: project.outputDirectory,
      linkedWebsiteId: project.linkedWebsiteId,
      linkedDatabaseId: project.linkedDatabaseId,
      linkedBucketId: project.linkedBucketId,
      status: project.status,
      createdAt: project.createdAt.toISOString(),
      updatedAt: project.updatedAt.toISOString(),
    },
    linkedResources: {
      website: linkedWebsite
        ? {
            ...linkedWebsite,
            sslEnabled: Boolean(sslEnabled),
            deployments: linkedWebsite.deployments.map((d) => ({
              id: d.id,
              status: d.status,
              commitSha: d.verifiedCommitSha ?? d.commitHash ?? null,
              branch: linkedWebsite.gitBranch,
              createdAt: d.createdAt.toISOString(),
            })),
          }
        : null,
      database: linkedDatabase,
      bucket: linkedBucket
        ? {
            id: linkedBucket.id,
            name: linkedBucket.name,
            provider: linkedBucket.provider,
            region: linkedBucket.region,
            objectCount: linkedBucket.objectCount,
            sizeBytes: Number(linkedBucket.sizeBytes),
            isActive: linkedBucket.isActive,
          }
        : null,
    },
    keys,
    platforms,
    webhooks,
    functions,
    advisor,
    onboarding,
    reaReconstruction: verifyReconstructionLedgerIntegrity(),
  };
}

export async function updateCloudProject(actor: AuthUser, idOrSlug: string, rawInput: unknown) {
  const input = updateCloudProjectSchema.parse(rawInput);

  return db.$transaction(async (tx) => {
    const project = await resolveProjectOrThrow(tx, idOrSlug);
    if (!(await canManageCloudProject(tx, actor, project))) {
      throw apiError("Forbidden to modify this Cloud Project", "FORBIDDEN", undefined, 403);
    }

    await verifyLinkedResourcesAccess(tx, actor, {
      linkedWebsiteId: input.linkedWebsiteId ?? undefined,
      linkedDatabaseId: input.linkedDatabaseId ?? undefined,
      linkedBucketId: input.linkedBucketId ?? undefined,
    });

    if (input.stage === "production") {
      const localhostPlatforms = await tx.cloudProjectPlatform.count({
        where: { projectId: project.id, identifier: "localhost", enabled: true },
      });
      if (localhostPlatforms > 0) {
        throw apiError(
          "Remove or disable localhost platforms before promoting a Cloud Project to production.",
          "LOCALHOST_PLATFORM_IN_PRODUCTION",
          undefined,
          422,
        );
      }
    }

    const updated = await tx.cloudProject.update({
      where: { id: project.id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.stage !== undefined ? { stage: input.stage } : {}),
        ...(input.region !== undefined ? { region: input.region } : {}),
        ...(input.frameworkPreset !== undefined ? { frameworkPreset: input.frameworkPreset } : {}),
        ...(input.renderingMode !== undefined ? { renderingMode: input.renderingMode } : {}),
        ...(input.installCommand !== undefined ? { installCommand: input.installCommand } : {}),
        ...(input.buildCommand !== undefined ? { buildCommand: input.buildCommand } : {}),
        ...(input.outputDirectory !== undefined ? { outputDirectory: input.outputDirectory } : {}),
        ...(input.linkedWebsiteId !== undefined ? { linkedWebsiteId: input.linkedWebsiteId } : {}),
        ...(input.linkedDatabaseId !== undefined ? { linkedDatabaseId: input.linkedDatabaseId } : {}),
        ...(input.linkedBucketId !== undefined ? { linkedBucketId: input.linkedBucketId } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
      },
    });

    await tx.auditLog.create({
      data: {
        actorUserId: actor.id,
        actorEmail: actor.email,
        actorRole: actor.role,
        action: "CLOUD_PROJECT_UPDATED",
        resourceType: "CloudProject",
        resourceId: project.id,
        domain: "cloud-baas",
        result: "SUCCESS",
        metadata: { slug: updated.slug, stage: updated.stage, status: updated.status },
      },
    });

    return {
      ...updated,
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString(),
    };
  });
}

export async function deleteCloudProject(actor: AuthUser, idOrSlug: string) {
  return db.$transaction(async (tx) => {
    const project = await resolveProjectOrThrow(tx, idOrSlug);
    if (!(await canManageCloudProject(tx, actor, project))) {
      throw apiError("Forbidden to delete this Cloud Project", "FORBIDDEN", undefined, 403);
    }

    await tx.cloudProject.delete({ where: { id: project.id } });
    await tx.auditLog.create({
      data: {
        actorUserId: actor.id,
        actorEmail: actor.email,
        actorRole: actor.role,
        action: "CLOUD_PROJECT_DELETED",
        resourceType: "CloudProject",
        resourceId: project.id,
        domain: "cloud-baas",
        result: "SUCCESS",
        metadata: { slug: project.slug },
      },
    });
    return { deleted: true, id: project.id, slug: project.slug };
  });
}

export async function issueCloudProjectKey(actor: AuthUser, idOrSlug: string, rawInput: unknown) {
  const input = createCloudKeySchema.parse(rawInput);
  const scopes = parseCloudScopes(input.scopes);
  if (scopes.length === 0) {
    throw apiError("At least one valid scope is required", "VALIDATION_ERROR", undefined, 400);
  }
  const { secret, prefix, keyHash } = generateCloudApiKey();
  const expiresAt = input.expiresInDays
    ? new Date(Date.now() + input.expiresInDays * 86_400_000)
    : null;

  return db.$transaction(async (tx) => {
    const project = await resolveProjectOrThrow(tx, idOrSlug);
    if (!(await canManageCloudProject(tx, actor, project))) {
      throw apiError("Forbidden to issue API keys for this project", "FORBIDDEN", undefined, 403);
    }

    const row = await tx.cloudProjectKey.create({
      data: {
        projectId: project.id,
        name: input.name,
        prefix,
        keyHash,
        scopes: scopes.join(" "),
        expiresAt,
        createdBy: actor.id,
      },
    });

    await tx.auditLog.create({
      data: {
        actorUserId: actor.id,
        actorEmail: actor.email,
        actorRole: actor.role,
        action: "CLOUD_KEY_ISSUED",
        resourceType: "CloudProjectKey",
        resourceId: row.id,
        domain: "cloud-baas",
        result: "SUCCESS",
        metadata: { projectId: project.id, prefix, scopes, expiresAt: expiresAt?.toISOString() ?? null },
      },
    });

    return {
      key: presentCloudKey(row),
      /** Returned ONCE at creation time; never stored in plaintext or re-displayed. */
      secret,
    };
  });
}

export async function revokeCloudProjectKey(actor: AuthUser, idOrSlug: string, keyId: string) {
  return db.$transaction(async (tx) => {
    const project = await resolveProjectOrThrow(tx, idOrSlug);
    if (!(await canManageCloudProject(tx, actor, project))) {
      throw apiError("Forbidden to revoke API keys for this project", "FORBIDDEN", undefined, 403);
    }
    const existing = await tx.cloudProjectKey.findFirst({
      where: { id: keyId, projectId: project.id },
    });
    if (!existing) {
      throw apiError("API key not found in this project", "NOT_FOUND", undefined, 404);
    }
    if (existing.revokedAt) {
      return presentCloudKey(existing);
    }
    const revoked = await tx.cloudProjectKey.update({
      where: { id: existing.id },
      data: { revokedAt: new Date() },
    });
    await tx.auditLog.create({
      data: {
        actorUserId: actor.id,
        actorEmail: actor.email,
        actorRole: actor.role,
        action: "CLOUD_KEY_REVOKED",
        resourceType: "CloudProjectKey",
        resourceId: revoked.id,
        domain: "cloud-baas",
        result: "SUCCESS",
        metadata: { projectId: project.id, prefix: revoked.prefix },
      },
    });
    return presentCloudKey(revoked);
  });
}

export async function registerCloudPlatform(actor: AuthUser, idOrSlug: string, rawInput: unknown) {
  const input = createCloudPlatformSchema.parse(rawInput);

  return db.$transaction(async (tx) => {
    const project = await resolveProjectOrThrow(tx, idOrSlug);
    if (!(await canManageCloudProject(tx, actor, project))) {
      throw apiError("Forbidden to register platforms for this project", "FORBIDDEN", undefined, 403);
    }
    const validated = validatePlatformIdentifier(
      input.type,
      input.identifier,
      project.stage as CloudStage,
    );
    if (!validated.ok) {
      throw apiError(validated.reason, "VALIDATION_ERROR", undefined, 400);
    }

    const dup = await tx.cloudProjectPlatform.findUnique({
      where: {
        projectId_type_identifier: {
          projectId: project.id,
          type: input.type,
          identifier: validated.normalized,
        },
      },
      select: { id: true },
    });
    if (dup) {
      throw apiError("This platform origin or bundle ID is already registered", "PLATFORM_CONFLICT", undefined, 409);
    }

    const row = await tx.cloudProjectPlatform.create({
      data: {
        projectId: project.id,
        name: input.name,
        type: input.type,
        identifier: validated.normalized,
        createdBy: actor.id,
      },
    });

    await tx.auditLog.create({
      data: {
        actorUserId: actor.id,
        actorEmail: actor.email,
        actorRole: actor.role,
        action: "CLOUD_PLATFORM_REGISTERED",
        resourceType: "CloudProjectPlatform",
        resourceId: row.id,
        domain: "cloud-baas",
        result: "SUCCESS",
        metadata: { projectId: project.id, type: row.type, identifier: row.identifier },
      },
    });

    return {
      ...row,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  });
}

export async function removeCloudPlatform(actor: AuthUser, idOrSlug: string, platformId: string) {
  return db.$transaction(async (tx) => {
    const project = await resolveProjectOrThrow(tx, idOrSlug);
    if (!(await canManageCloudProject(tx, actor, project))) {
      throw apiError("Forbidden to remove platforms from this project", "FORBIDDEN", undefined, 403);
    }
    const existing = await tx.cloudProjectPlatform.findFirst({
      where: { id: platformId, projectId: project.id },
    });
    if (!existing) throw apiError("Platform not found", "NOT_FOUND", undefined, 404);
    await tx.cloudProjectPlatform.delete({ where: { id: existing.id } });
    await tx.auditLog.create({
      data: {
        actorUserId: actor.id,
        actorEmail: actor.email,
        actorRole: actor.role,
        action: "CLOUD_PLATFORM_REMOVED",
        resourceType: "CloudProjectPlatform",
        resourceId: existing.id,
        domain: "cloud-baas",
        result: "SUCCESS",
        metadata: { projectId: project.id, type: existing.type, identifier: existing.identifier },
      },
    });
    return { deleted: true, id: existing.id };
  });
}

export async function createCloudWebhook(actor: AuthUser, idOrSlug: string, rawInput: unknown) {
  const input = createCloudWebhookSchema.parse(rawInput);
  const urlCheck = validateWebhookTargetUrl(input.url);
  if (!urlCheck.ok) {
    throw apiError(urlCheck.reason, "VALIDATION_ERROR", undefined, 400);
  }
  const uniqueEvents = Array.from(new Set(input.events));
  const { signingSecret, signingKeyPrefix, signingKeyHash } = generateWebhookSigningSecret();

  return db.$transaction(async (tx) => {
    const project = await resolveProjectOrThrow(tx, idOrSlug);
    if (!(await canManageCloudProject(tx, actor, project))) {
      throw apiError("Forbidden to create webhooks for this project", "FORBIDDEN", undefined, 403);
    }

    const row = await tx.cloudProjectWebhook.create({
      data: {
        projectId: project.id,
        name: input.name,
        url: urlCheck.normalized,
        events: JSON.stringify(uniqueEvents),
        signingKeyHash,
        signingKeyPrefix,
        tlsVerify: input.tlsVerify,
        createdBy: actor.id,
      },
    });

    await tx.auditLog.create({
      data: {
        actorUserId: actor.id,
        actorEmail: actor.email,
        actorRole: actor.role,
        action: "CLOUD_WEBHOOK_CREATED",
        resourceType: "CloudProjectWebhook",
        resourceId: row.id,
        domain: "cloud-baas",
        result: "SUCCESS",
        metadata: {
          projectId: project.id,
          urlHost: new URL(urlCheck.normalized).hostname,
          events: uniqueEvents,
          signingKeyPrefix,
        },
      },
    });

    return {
      webhook: presentCloudWebhook(row),
      /** Returned ONCE at creation time for HMAC verification (`X-ALO-Webhook-Signature`). */
      signingSecret,
    };
  });
}

export async function removeCloudWebhook(actor: AuthUser, idOrSlug: string, webhookId: string) {
  return db.$transaction(async (tx) => {
    const project = await resolveProjectOrThrow(tx, idOrSlug);
    if (!(await canManageCloudProject(tx, actor, project))) {
      throw apiError("Forbidden to remove webhooks from this project", "FORBIDDEN", undefined, 403);
    }
    const existing = await tx.cloudProjectWebhook.findFirst({
      where: { id: webhookId, projectId: project.id },
    });
    if (!existing) throw apiError("Webhook not found", "NOT_FOUND", undefined, 404);
    await tx.cloudProjectWebhook.delete({ where: { id: existing.id } });
    await tx.auditLog.create({
      data: {
        actorUserId: actor.id,
        actorEmail: actor.email,
        actorRole: actor.role,
        action: "CLOUD_WEBHOOK_REMOVED",
        resourceType: "CloudProjectWebhook",
        resourceId: existing.id,
        domain: "cloud-baas",
        result: "SUCCESS",
        metadata: { projectId: project.id, signingKeyPrefix: existing.signingKeyPrefix },
      },
    });
    return { deleted: true, id: existing.id };
  });
}

export async function createCloudFunction(actor: AuthUser, idOrSlug: string, rawInput: unknown) {
  const input = createCloudFunctionSchema.parse(rawInput);
  const slug = input.slug ?? slugifyCloudIdentifier(input.name);
  if (!slug || slug.length < 2) {
    throw apiError("Function name must contain at least 2 alphanumeric characters", "VALIDATION_ERROR", undefined, 400);
  }
  const uniqueEvents = Array.from(new Set(input.events));

  return db.$transaction(async (tx) => {
    const project = await resolveProjectOrThrow(tx, idOrSlug);
    if (!(await canManageCloudProject(tx, actor, project))) {
      throw apiError("Forbidden to create functions for this project", "FORBIDDEN", undefined, 403);
    }

    const dup = await tx.cloudProjectFunction.findUnique({
      where: { projectId_slug: { projectId: project.id, slug } },
      select: { id: true },
    });
    if (dup) {
      throw apiError(`A function with slug "${slug}" already exists in this project`, "SLUG_CONFLICT", undefined, 409);
    }

    const row = await tx.cloudProjectFunction.create({
      data: {
        projectId: project.id,
        slug,
        name: input.name,
        runtime: input.runtime,
        entrypoint: input.entrypoint,
        commands: input.commands ?? null,
        events: JSON.stringify(uniqueEvents),
        schedule: input.schedule ?? null,
        timeoutSeconds: input.timeoutSeconds,
        executionState: "REQUIRES_SETUP",
        createdBy: actor.id,
      },
    });

    await tx.auditLog.create({
      data: {
        actorUserId: actor.id,
        actorEmail: actor.email,
        actorRole: actor.role,
        action: "CLOUD_FUNCTION_CREATED",
        resourceType: "CloudProjectFunction",
        resourceId: row.id,
        domain: "cloud-baas",
        result: "SUCCESS",
        metadata: {
          projectId: project.id,
          slug: row.slug,
          runtime: row.runtime,
          executionState: "REQUIRES_SETUP",
        },
      },
    });

    return presentCloudFunction(row);
  });
}

export async function removeCloudFunction(actor: AuthUser, idOrSlug: string, functionId: string) {
  return db.$transaction(async (tx) => {
    const project = await resolveProjectOrThrow(tx, idOrSlug);
    if (!(await canManageCloudProject(tx, actor, project))) {
      throw apiError("Forbidden to remove functions from this project", "FORBIDDEN", undefined, 403);
    }
    const existing = await tx.cloudProjectFunction.findFirst({
      where: { id: functionId, projectId: project.id },
    });
    if (!existing) throw apiError("Function not found", "NOT_FOUND", undefined, 404);
    await tx.cloudProjectFunction.delete({ where: { id: existing.id } });
    await tx.auditLog.create({
      data: {
        actorUserId: actor.id,
        actorEmail: actor.email,
        actorRole: actor.role,
        action: "CLOUD_FUNCTION_REMOVED",
        resourceType: "CloudProjectFunction",
        resourceId: existing.id,
        domain: "cloud-baas",
        result: "SUCCESS",
        metadata: { projectId: project.id, slug: existing.slug },
      },
    });
    return { deleted: true, id: existing.id };
  });
}

// ─── Machine-Authenticated `/api/cloud/v1/health` Verification ────────────────

export async function verifyMachineProjectHealth(
  headers: Headers,
  requiredAnyOfScopes: readonly CloudProjectScope[] = ["health.read", "project.read"],
) {
  const { projectRef, rawKey } = extractCloudKeyHeaders(headers);
  let candidate = null;

  if (rawKey && rawKey.startsWith(CLOUD_API_KEY_PREFIX_TAG) && rawKey.length >= 18) {
    const prefix = rawKey.slice(0, 18);
    const matches = await db.cloudProjectKey.findMany({
      where: { prefix },
      include: {
        project: {
          select: {
            id: true,
            slug: true,
            name: true,
            stage: true,
            region: true,
            status: true,
            frameworkPreset: true,
            linkedWebsiteId: true,
            linkedDatabaseId: true,
            linkedBucketId: true,
          },
        },
      },
      take: 5,
    });
    for (const row of matches) {
      const check = authenticateCloudProjectKey({
        projectRef,
        rawKey,
        candidate: {
          id: row.id,
          projectId: row.project.id,
          projectSlug: row.project.slug,
          projectStatus: row.project.status,
          keyHash: row.keyHash,
          prefix: row.prefix,
          scopes: row.scopes,
          expiresAt: row.expiresAt,
          revokedAt: row.revokedAt,
        },
        anyOfScopes: requiredAnyOfScopes,
      });
      if (check.ok) {
        await db.cloudProjectKey.update({
          where: { id: row.id },
          data: { lastUsedAt: new Date() },
        });
        const [site, database, bucket, fnCount] = await Promise.all([
          row.project.linkedWebsiteId
            ? db.website.findFirst({
                where: { id: row.project.linkedWebsiteId, deletedAt: null },
                select: { domain: true, status: true, healthStatus: true },
              })
            : Promise.resolve(null),
          row.project.linkedDatabaseId
            ? db.databaseInstance.findFirst({
                where: { id: row.project.linkedDatabaseId, deletedAt: null },
                select: { name: true, engine: true },
              })
            : Promise.resolve(null),
          row.project.linkedBucketId
            ? db.storageBucket.findFirst({
                where: { id: row.project.linkedBucketId, kind: "bucket" },
                select: { name: true, provider: true, isActive: true },
              })
            : Promise.resolve(null),
          db.cloudProjectFunction.count({ where: { projectId: row.project.id } }),
        ]);

        return {
          ok: true as const,
          data: {
            status: "pass" as const,
            checkedAt: new Date().toISOString(),
            project: {
              id: row.project.id,
              slug: row.project.slug,
              name: row.project.name,
              stage: row.project.stage,
              region: row.project.region,
              frameworkPreset: row.project.frameworkPreset,
            },
            key: {
              id: row.id,
              prefix: row.prefix,
              grantedScopes: check.grantedScopes,
            },
            services: {
              sites: site
                ? { state: "LINKED" as const, domain: site.domain, status: site.status, healthStatus: site.healthStatus ?? "not measured" }
                : { state: "UNLINKED" as const },
              databases: database
                ? { state: "LINKED" as const, name: database.name, engine: database.engine }
                : { state: "UNLINKED" as const },
              storage: bucket
                ? { state: "LINKED" as const, name: bucket.name, provider: bucket.provider, active: bucket.isActive }
                : { state: "UNLINKED" as const },
              functions: {
                definedCount: fnCount,
                executionState: "REQUIRES_SETUP" as const,
              },
            },
          },
        };
      }
      candidate = row;
    }
  }

  const failed = authenticateCloudProjectKey({
    projectRef,
    rawKey,
    candidate: candidate
      ? {
          id: candidate.id,
          projectId: candidate.project.id,
          projectSlug: candidate.project.slug,
          projectStatus: candidate.project.status,
          keyHash: candidate.keyHash,
          prefix: candidate.prefix,
          scopes: candidate.scopes,
          expiresAt: candidate.expiresAt,
          revokedAt: candidate.revokedAt,
        }
      : null,
    anyOfScopes: requiredAnyOfScopes,
  });

  if (failed.ok) {
    throw apiError("Unexpected authentication branch", "INTERNAL_ERROR", undefined, 500);
  }
  throw apiError(failed.message, failed.code, undefined, failed.status);
}
