import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { apiSuccess, apiError } from "@/lib/response";
import { recordTaskResult } from "@/lib/agents/agent";
import { requireAgent, parseBody } from "@/lib/agents/http";
import { db } from "@/lib/db";

const schema = z.object({
  taskId: z.string().min(1).max(64),
  status: z.enum(["SUCCEEDED", "FAILED", "REFUSED"]),
  exitCode: z.number().int().min(-128).max(4096).nullish(),
  result: z.unknown().optional(),
  logs: z.string().max(60_000).optional(),
  error: z.string().max(4000).optional(),
  refuseReason: z.string().max(1000).optional(),
  durationMs: z.number().int().min(0).max(86_400_000).optional(),
});

/** Accept a signed task result. Only the agent that owns the task may report it. */
export async function POST(request: NextRequest) {
  const auth = await requireAgent(request);
  if (!auth.ok) {
    return NextResponse.json(apiError(auth.message, auth.code, undefined, auth.status), { status: auth.status });
  }

  const raw = parseBody(auth.body);
  if (raw === null) {
    return NextResponse.json(apiError("Request body is not valid JSON", "VALIDATION_ERROR", undefined, 400), { status: 400 });
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(apiError("Task result failed validation", "VALIDATION_ERROR", parsed.error.flatten(), 400), { status: 400 });
  }

  const task = await db.agentTask.findUnique({ where: { id: parsed.data.taskId } });
  if (!task) return NextResponse.json(apiError("Unknown task", "NOT_FOUND", undefined, 404), { status: 404 });
  // Tenant/ownership isolation: an agent cannot report somebody else's task.
  if (task.agentId !== auth.agent.id) {
    return NextResponse.json(apiError("This task belongs to another agent", "FORBIDDEN", undefined, 403), { status: 403 });
  }
  if (task.status === "SUCCEEDED" || task.status === "FAILED" || task.status === "REFUSED") {
    return NextResponse.json(apiSuccess({ taskId: task.id, status: task.status, duplicate: true }, "Result already recorded"));
  }

  const updated = await recordTaskResult(task.id, {
    status: parsed.data.status,
    exitCode: parsed.data.exitCode ?? null,
    result: parsed.data.result,
    logs: parsed.data.logs,
    error: parsed.data.error,
    refuseReason: parsed.data.refuseReason,
  });

  return NextResponse.json(apiSuccess({ taskId: updated.id, status: updated.status }, "Result recorded"));
}
