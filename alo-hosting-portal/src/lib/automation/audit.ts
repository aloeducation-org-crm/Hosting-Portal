import { prisma } from '@/lib/prisma';
import fs from 'fs';
import path from 'path';

export type AutomationStatus =
  | 'PENDING'
  | 'APPROVED'
  | 'SUCCESS'
  | 'FAILED'
  | 'REJECTED';

const FALLBACK_LOG = path.join(
  process.env.TEMP_DIR || '/home/alamin/storage/temp',
  'automation-audit.log',
);

export async function logAutomationEvent(
  action: string,
  userId: string | null,
  details: Record<string, unknown>,
  status: AutomationStatus,
) {
  const entry = {
    timestamp: new Date().toISOString(),
    action,
    userId,
    status,
    details,
  };

  // Always keep a file audit trail (never lose automation history)
  try {
    fs.mkdirSync(path.dirname(FALLBACK_LOG), { recursive: true });
    fs.appendFileSync(FALLBACK_LOG, JSON.stringify(entry) + '\n');
  } catch {}

  // Best-effort DB write — never throw into API request path
  try {
    const client = prisma as unknown as {
      auditLog?: { create: (args: { data: Record<string, unknown> }) => Promise<unknown> };
    };
    if (!client.auditLog?.create) return null;

    // Minimal payload that most AuditLog schemas accept
    const data: Record<string, unknown> = {
      action,
      details: JSON.stringify(details),
    };
    if (userId) data.userId = userId;
    if (status) data.status = status;

    return await client.auditLog.create({ data });
  } catch (err) {
    console.warn(
      '[audit] DB write skipped:',
      err instanceof Error ? err.message : String(err),
    );
    return null;
  }
}
