import { db } from '@/lib/db';
import { logger } from '@/lib/logger';

// ───B Types ─────────────────────────────────────────────────────────────────────

export type OperationStatus =
  | 'QUEUED'
  | 'RUNNING'
  | 'VERIFYING'
  | 'SUCCESS'
  | 'FAILED'
  | 'ROLLING_BACK'
  | 'ROLLED_BACK';

export type OperationType =
  | 'WEBSITE_CREATE'
  | 'SSL_ISSUE'
  | 'DATABASE_CREATE'
  | 'FIREWALL_ADD'
  | 'DOCKER_RUN'
  | 'SITE_SUSPEND'
  | 'SITE_RESUME';

export type ActorInfo = {
  id: string;
  email: string;
  role: string;
};

// ─── Enqueue ────────────────────────────────────────────────────────────────────

export async function enqueueOperation(
  type: string,
  input: Record<string, unknown>,
  actor: ActorInfo,
  options?: {
    resourceId?: string;
    resourceType?: string;
    priority?: number;
  },
) {
  const op = await db.operationJob.create({
    data: {
      websiteId: options?.resourceId ?? 'system',
      type,
      status: 'QUEUED',
      priority: options?.priority ?? 100,
      resourceId: options?.resourceId,
      resourceType: options?.resourceType,
      input: JSON.stringify(input),
      actorId: actor.id,
      actorEmail: actor.email,
      actorRole: actor.role,
    },
  });

  logger.info({ operationId: op.id, type, actorId: actor.id }, 'Operation enqueued');
  return op;
}

// ─── State Transitions ─────────────────────────────────────────────────────────

export async function startOperation(id: string) {
  const op = await db.operationJob.update({
    where: { id },
    data: {
      status: 'RUNNING',
      startedAt: new Date(),
      progress: 10,
    },
  });
  logger.info({ operationId: id }, 'Operation started');
  return op;
}

export async function completeOperation(id: string, output: Record<string, unknown>) {
  const op = await db.operationJob.update({
    where: { id },
    data: {
      status: 'SUCCESS',
      completedAt: new Date(),
      progress: 100,
      output: JSON.stringify(output),
    },
  });
  logger.info({ operationId: id }, 'Operation completed successfully');
  return op;
}

export async function failOperation(id: string, error: string) {
  const op = await db.operationJob.update({
    where: { id },
    data: {
      status: 'FAILED',
      completedAt: new Date(),
      error,
    },
  });
  logger.warn({ operationId: id, error }, 'Operation failed');
  return op;
}

export async function verifyOperation(
  id: string,
  verifyFn: () => Promise<{ success: boolean; error?: string }>,
) {
  await db.operationJob.update({
    where: { id },
    data: { status: 'VERIFYING', progress: 90 },
  });
  logger.info({ operationId: id }, 'Operation verifying');

  try {
    const result = await verifyFn();
    if (result.success) {
      return completeOperation(id, { verification: 'passed' });
    } else {
      return failOperation(id, result.error ?? 'Verification failed');
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return failOperation(id, `Verification error: ${msg}`);
  }
}

export async function rollbackOperation(
  id: string,
  rollbackFn: () => Promise<{ success: boolean; error?: string }>,
) {
  await db.operationJob.update({
    where: { id },
    data: { status: 'ROLLING_BACK', progress: 50 },
  });
  logger.info({ operationId: id }, 'Operation rolling back');

  try {
    const result = await rollbackFn();
    if (result.success) {
      const op = await db.operationJob.update({
        where: { id },
        data: { status: 'ROLLED_BACK', completedAt: new Date() },
      });
      logger.info({ operationId: id }, 'Operation rolled back');
      return op;
    } else {
      return failOperation(id, `Rollback failed: ${result.error ?? 'unknown'}`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return failOperation(id, `Rollback error: ${msg}`);
  }
}

// ─── Queries ───────────────────────────────────────────────────────────────────

export async function getPendingOperations(limit: number = 10) {
  return db.operationJob.findMany({
    where: { status: 'QUEUED' },
    orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
    take: limit,
  });
}

export async function getOperationById(id: string) {
  return db.operationJob.findUnique({
    where: { id },
    include: { auditLogs: { orderBy: { timestamp: 'desc' }, take: 20 } },
  });
}

export async function listOperations(params: {
  status?: string;
  type?: string;
  actorId?: string;
  page?: number;
  limit?: number;
  isSuperAdminOrDevops?: boolean;
  requestingUserId?: string;
}) {
  const { status, type, actorId, page = 1, limit = 20, isSuperAdminOrDevops, requestingUserId } = params;

  const where: Record<string, unknown> = {};
  if (status) where.status = status;
  if (type) where.type = type;
  if (actorId) where.actorId = actorId;
  if (!isSuperAdminOrDevops && requestingUserId) {
    where.actorId = requestingUserId;
  }

  const [total, operations] = await Promise.all([
    db.operationJob.count({ where }),
    db.operationJob.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
      include: { auditLogs: { orderBy: { timestamp: 'desc' }, take: 5 } },
    }),
  ]);

  return {
    total,
    page,
    limit,
    pages: Math.ceil(total / limit),
    data: operations,
  };
}

export async function retryOperation(id: string) {
  const existing = await db.operationJob.findUnique({ where: { id } });
  if (!existing) throw new Error('Operation not found');
  if (existing.status !== 'FAILED') {
    throw new Error(`Cannot retry operation in status: ${existing.status}`);
  }

  const op = await db.operationJob.update({
    where: { id },
    data: {
      status: 'QUEUED',
      progress: 0,
      error: null,
      output: null,
      startedAt: null,
      completedAt: null,
    },
  });

  logger.info({ operationId: id }, 'Operation re-queued for retry');
  return op;
}

export async function cancelOperation(id: string) {
  const existing = await db.operationJob.findUnique({ where: { id } });
  if (!existing) throw new Error('Operation not found');
  if (existing.status !== 'QUEUED') {
    throw new Error(`Cannot cancel operation in status: ${existing.status}`);
  }

  const op = await db.operationJob.update({
    where: { id },
    data: {
      status: 'FAILED',
      completedAt: new Date(),
      error: 'Cancelled by user',
    },
  });

  logger.info({ operationId: id }, 'Operation cancelled');
  return op;
}

export async function updateOperationProgress(id: string, progress: number) {
  return db.operationJob.update({
    where: { id },
    data: { progress: Math.min(100, Math.max(0, progress)) },
  });
}
