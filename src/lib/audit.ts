import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

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

/**
 * Best-effort file audit trail, preserved from the retired nested application's
 * src/lib/automation/audit.ts. The legacy module hardcoded /home/alamin/storage
 * and wrote a DB row through a different Prisma client. Here the path is
 * configurable, defaulting to the operator's backup dir or the OS temp dir, and
 * the DB write goes through the canonical client. A file-write failure never
 * blocks the API request or the database write.
 */
function fallbackAuditFile(): string {
  const configured = process.env.AUDIT_FALLBACK_FILE?.trim();
  if (configured) return configured;
  // TEMP_DIR and automation-audit.log are the retired nested module's exact
  // fallback contract; keep them working before using the canonical defaults.
  const tempDir = process.env.TEMP_DIR?.trim();
  if (tempDir) return path.join(tempDir, "automation-audit.log");
  const base = process.env.ALO_BACKUP_DIR?.trim() || os.tmpdir();
  return path.join(base, "alo-automation-audit.log");
}

async function appendFileAudit(entry: Record<string, unknown>): Promise<void> {
  try {
    const file = fallbackAuditFile();
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.appendFile(file, `${JSON.stringify(entry)}\n`, "utf8");
  } catch (error) {
    logger.warn({ error }, "file audit trail unavailable; continuing with DB audit");
  }
}

export async function createAuditLog(params: AuditParams): Promise<void> {
  const entry = {
    timestamp: new Date().toISOString(),
    action: params.action,
    actorEmail: params.actorEmail ?? null,
    actorRole: params.actorRole ?? null,
    resourceType: params.resourceType ?? null,
    resourceId: params.resourceId ?? null,
    result: params.result ?? null,
    requestId: params.requestId ?? null,
    errorCode: params.errorCode ?? null,
  };
  await appendFileAudit(entry);

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
    logger.error({ error, params }, "Failed to write audit log");
  }
}

export type AutomationStatus = "PENDING" | "APPROVED" | "SUCCESS" | "FAILED" | "REJECTED";

/** Compatibility API of the retired nested automation/audit.ts module. */
export async function logAutomationEvent(
  action: string,
  userId: string | null,
  details: Record<string, unknown>,
  status: AutomationStatus,
): Promise<void> {
  await createAuditLog({
    action,
    actorId: userId ?? undefined,
    result: status,
    metadata: details,
  });
}
