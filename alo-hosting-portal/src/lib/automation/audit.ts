import { prisma } from "@/lib/prisma";
import fs from "fs";
import path from "path";

export type AutomationStatus =
  | "PENDING"
  | "APPROVED"
  | "SUCCESS"
  | "FAILED"
  | "REJECTED";

const FALLBACK_LOG = path.join(
  process.env.TEMP_DIR || "/home/alamin/storage/temp",
  "automation-audit.log"
);

export async function logAutomationEvent(
  action: string,
  userId: string | null,
  details: Record<string, unknown>,
  status: AutomationStatus
) {
  const entry = JSON.stringify({
    timestamp: new Date().toISOString(),
    action,
    userId,
    status,
    details,
  });

  try {
    const data: any = {
      action,
      metadata,
    };
    if (data.details !== undefined) data.details = JSON.stringify(details);
    if (data.metadata !== undefined) data.metadata = JSON.stringify(details);

    const created = await (prisma.auditLog as any).create({ data });
    return created;
  } catch (err) {
    try {
      fs.mkdirSync(path.dirname(FALLBACK_LOG), { recursive: true });
      fs.appendFileSync(FALLBACK_LOG, entry + "\n");
    } catch {}
    console.error(
      "Audit DB write failed, used file fallback:",
      err instanceof Error ? err.message : err
    );
    return null;
  }
}
