import { db } from '@/lib/db';
import { logger } from '@/lib/logger';

interface AuditParams {
  actorId?: string;
  actorEmail?: string;
  actorRole?: string;
  action: string;
  resourceType?: string;
  resourceId?: string;
  domain?: string;
  result?: string;
  requestId?: string;
  ipAddress?: string;
  userAgent?: string;
  metadata?: unknown;
  errorCode?: string;
  durationMs?: number;
}

export async function createAuditLog(params: AuditParams): Promise<void> {
  try {
    await db.auditLog.create({
      data: {
        actorUserId: params.actorId,
        actorEmail: params.actorEmail,
        actorRole: params.actorRole,
        action: params.action,
        resourceType: params.resourceType,
        resourceId: params.resourceId,
        domain: params.domain,
        result: params.result,
        requestId: params.requestId,
        ipAddress: params.ipAddress,
        userAgent: params.userAgent,
        metadata: params.metadata ?? undefined,
        errorCode: params.errorCode,
        durationMs: params.durationMs,
      },
    });
  } catch (error) {
    logger.error({ error, params }, 'Failed to write audit log');
  }
}
