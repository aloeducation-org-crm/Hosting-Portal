import { NextRequest, NextResponse } from "next/server";
import { verifyInternalSecretValue } from "@/lib/auth";
import { createAuditLog } from "@/lib/audit";

/**
 * Bearer-authenticated cron trigger.
 *
 * Preserved from the retired nested application (which exposed this as
 * /api/automation/cron). The canonical /api/cron route is a session-guarded
 * cron *management* API; this endpoint is the machine-to-machine trigger that
 * external schedulers call with CRON_SECRET. It intentionally delegates work to
 * /api/operations/worker so no duplicate scheduler logic is introduced.
 */
export async function GET(req: NextRequest) {
  const header = req.headers.get("authorization");
  const supplied = header?.startsWith("Bearer ") ? header.slice(7).trim() : null;
  const expected = process.env.CRON_SECRET;

  if (!verifyInternalSecretValue(supplied, expected)) {
    return NextResponse.json(
      { success: false, error: "Unauthorized cron trigger" },
      { status: 401 },
    );
  }

  await createAuditLog({
    action: "automation.cron.trigger",
    result: "SUCCESS",
    requestId: req.headers.get("x-request-id") ?? undefined,
    metadata: { userAgent: req.headers.get("user-agent") ?? undefined },
  });

  return NextResponse.json({
    success: true,
    message: "Cron trigger authenticated; delegate scheduled tasks via /api/operations/worker",
    timestamp: new Date().toISOString(),
  });
}
