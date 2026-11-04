/** Cloud usage ledger and quota enforcement. All writes are idempotent. */

import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { apiError } from "@/lib/response";

type DbTx = Prisma.TransactionClient | typeof db;

export const CLOUD_USAGE_METRICS = [
  "build_minutes",
  "function_exec_ms",
  "function_memory_mb_s",
  "database_storage_bytes",
  "storage_capacity_bytes",
  "storage_bandwidth_bytes",
  "deployment_count",
  "project_count",
] as const;
export type CloudUsageMetric = (typeof CLOUD_USAGE_METRICS)[number];

export function monthStart(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));
}

export function isCloudUsageMetric(value: string): value is CloudUsageMetric {
  return (CLOUD_USAGE_METRICS as readonly string[]).includes(value);
}

export async function getCloudQuota(tx: DbTx, projectId: string, actorId = "system") {
  return tx.cloudProjectQuota.upsert({
    where: { projectId },
    create: { projectId, updatedBy: actorId },
    update: {},
  });
}

export async function cloudUsageTotal(
  tx: DbTx,
  projectId: string,
  metric: CloudUsageMetric,
  from = monthStart(),
): Promise<number> {
  const aggregate = await tx.cloudUsageEvent.aggregate({
    where: { projectId, metric, recordedAt: { gte: from } },
    _sum: { quantity: true },
  });
  return aggregate._sum.quantity ?? 0;
}

/**
 * Meter exactly once. A racing duplicate returns the original event instead of
 * adding another billable increment.
 */
export async function recordCloudUsageEvent(
  tx: DbTx,
  input: {
    idempotencyKey: string;
    projectId: string;
    ownerId: string;
    metric: CloudUsageMetric;
    quantity: number;
    unit: string;
    referenceType?: string | null;
    referenceId?: string | null;
  },
): Promise<{ created: boolean; id: string }> {
  if (!input.idempotencyKey || input.idempotencyKey.length > 180) {
    throw apiError("Usage idempotency key is required", "VALIDATION_ERROR", undefined, 400);
  }
  if (!Number.isFinite(input.quantity) || input.quantity < 0 || input.quantity > 9e15) {
    throw apiError("Usage quantity must be a finite non-negative number", "VALIDATION_ERROR", undefined, 400);
  }
  const existing = await tx.cloudUsageEvent.findUnique({ where: { idempotencyKey: input.idempotencyKey }, select: { id: true } });
  if (existing) return { created: false, id: existing.id };
  try {
    const created = await tx.cloudUsageEvent.create({ data: input });
    return { created: true, id: created.id };
  } catch (error) {
    // Unique collision from concurrent callers: resolve rather than retrying a
    // second write, so a build/function can never be double-metered.
    const raced = await tx.cloudUsageEvent.findUnique({ where: { idempotencyKey: input.idempotencyKey }, select: { id: true } });
    if (raced) return { created: false, id: raced.id };
    throw error;
  }
}

interface QuotaLimit {
  limit: number;
  label: string;
}

function monthlyLimit(quota: Awaited<ReturnType<typeof getCloudQuota>>, metric: CloudUsageMetric): QuotaLimit | null {
  switch (metric) {
    case "build_minutes": return { limit: quota.maxBuildMinutesMonthly, label: "monthly build minutes" };
    case "function_exec_ms": return { limit: quota.maxFunctionExecMsMonthly, label: "monthly function execution milliseconds" };
    case "storage_bandwidth_bytes": return { limit: quota.maxStorageBandwidthBytes, label: "monthly storage bandwidth bytes" };
    case "deployment_count": return { limit: quota.maxDeploymentsMonthly, label: "monthly deployments" };
    default: return null;
  }
}

/** Refuse before an operation starts when a monthly quota would be crossed. */
export async function assertCloudMonthlyQuota(
  tx: DbTx,
  input: { projectId: string; metric: CloudUsageMetric; additional: number; actorId?: string },
): Promise<{ current: number; limit: number | null }> {
  const quota = await getCloudQuota(tx, input.projectId, input.actorId);
  const configured = monthlyLimit(quota, input.metric);
  if (!configured) return { current: await cloudUsageTotal(tx, input.projectId, input.metric), limit: null };
  const current = await cloudUsageTotal(tx, input.projectId, input.metric);
  if (quota.hardEnforce && current + input.additional > configured.limit) {
    throw apiError(
      `Cloud Project quota exceeded: ${configured.label}`,
      "CLOUD_QUOTA_EXCEEDED",
      { metric: input.metric, current, requested: input.additional, limit: configured.limit },
      429,
    );
  }
  return { current, limit: configured.limit };
}

export async function assertCloudResourceQuota(
  tx: DbTx,
  input: { projectId: string; resource: "functions" | "databases" | "buckets"; actorId?: string },
): Promise<void> {
  const quota = await getCloudQuota(tx, input.projectId, input.actorId);
  let count: number;
  let limit: number;
  if (input.resource === "functions") {
    count = await tx.cloudProjectFunction.count({ where: { projectId: input.projectId } });
    limit = quota.maxFunctions;
  } else if (input.resource === "databases") {
    count = await tx.cloudDatabaseInstance.count({
      where: { projectId: input.projectId, status: { not: "DELETED" } },
    });
    limit = quota.maxDatabases;
  } else {
    count = await tx.cloudStorageBucket.count({ where: { projectId: input.projectId } });
    limit = quota.maxBuckets;
  }
  if (quota.hardEnforce && count >= limit) {
    throw apiError(
      `Cloud Project quota exceeded: maximum ${input.resource}`,
      "CLOUD_QUOTA_EXCEEDED",
      { resource: input.resource, current: count, limit },
      429,
    );
  }
}

export async function assertCloudStorageCapacity(
  tx: DbTx,
  input: { projectId: string; currentBytes: number; additionalBytes: number; actorId?: string },
): Promise<void> {
  const quota = await getCloudQuota(tx, input.projectId, input.actorId);
  if (quota.hardEnforce && input.currentBytes + input.additionalBytes > quota.maxStorageBytes) {
    throw apiError(
      "Cloud Project storage quota exceeded",
      "CLOUD_QUOTA_EXCEEDED",
      { metric: "storage_capacity_bytes", current: input.currentBytes, requested: input.additionalBytes, limit: quota.maxStorageBytes },
      413,
    );
  }
}

export async function cloudUsageSnapshot(projectId: string) {
  const quota = await getCloudQuota(db, projectId);
  const since = monthStart();
  const metrics = await Promise.all(CLOUD_USAGE_METRICS.map(async (metric) => [metric, await cloudUsageTotal(db, projectId, metric, since)] as const));
  return {
    periodStart: since.toISOString(),
    totals: Object.fromEntries(metrics),
    quota: {
      planCode: quota.planCode,
      maxBuildMinutesMonthly: quota.maxBuildMinutesMonthly,
      maxFunctionExecMsMonthly: quota.maxFunctionExecMsMonthly,
      maxDatabaseBytes: quota.maxDatabaseBytes,
      maxStorageBytes: quota.maxStorageBytes,
      maxStorageBandwidthBytes: quota.maxStorageBandwidthBytes,
      maxDeploymentsMonthly: quota.maxDeploymentsMonthly,
      maxFunctions: quota.maxFunctions,
      maxDatabases: quota.maxDatabases,
      maxBuckets: quota.maxBuckets,
      hardEnforce: quota.hardEnforce,
    },
  };
}
