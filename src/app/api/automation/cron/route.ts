import { NextRequest, NextResponse } from "next/server";
import { verifyInternalSecretValue } from "@/lib/auth";
import { createAuditLog } from "@/lib/audit";
import { apiSuccess, apiError } from "@/lib/response";
import { runAutomationTick } from "@/lib/orchestrator/engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Bearer-authenticated scheduler trigger. Executes real central-engine work. */
export async function GET(req: NextRequest) {
  const header = req.headers.get("authorization");
  const supplied = header?.startsWith("Bearer ") ? header.slice(7).trim() : req.headers.get("x-internal-secret");
  const expected = process.env.CRON_SECRET || process.env.INTERNAL_SECRET;
  if (!expected || !verifyInternalSecretValue(supplied, expected)) {
    return NextResponse.json(apiError("Unauthorized cron trigger", "UNAUTHORIZED", undefined, 401), { status: 401 });
  }
  try {
    const result = await runAutomationTick({ workerId: `cron-${process.pid}`, maxJobs: Math.min(Number(req.nextUrl.searchParams.get("max") ?? 5) || 5, 25) });
    await createAuditLog({ action: "AUTOMATION_CRON_TICK", result: "SUCCESS", requestId: req.headers.get("x-request-id") ?? undefined, metadata: { ran: result.ran.length, scheduled: result.scheduled.length, recovered: result.recovered.jobIds.length } });
    return NextResponse.json(apiSuccess(result));
  } catch (error) {
    await createAuditLog({ action: "AUTOMATION_CRON_TICK", result: "FAILED", metadata: { error: error instanceof Error ? error.message.slice(0, 300) : "unknown" } });
    return NextResponse.json(apiError("Automation tick failed", "AUTOMATION_TICK_FAILED", undefined, 500), { status: 500 });
  }
}

export const POST = GET;
