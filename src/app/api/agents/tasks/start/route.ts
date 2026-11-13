import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { apiSuccess, apiError } from "@/lib/response";
import { startTask } from "@/lib/agents/agent";
import { requireAgent, parseBody } from "@/lib/agents/http";

const schema = z.object({ taskId: z.string().min(1).max(64) });

/**
 * Report that a claimed task has started executing.
 *
 * SEC-07: the task lifecycle had no RUNNING transition, so expiry could only
 * measure from `createdAt`. A long but healthy command therefore looked stale
 * while it was running. This endpoint gives RUNNING a start clock, and it is
 * also a claim check: an agent that gets `{ started: false }` must not execute,
 * because the control plane has already given up on that task (expired, or
 * re-claimed after a restart). Refusing there is what prevents a duplicate
 * execution of a destructive command.
 */
export async function POST(request: NextRequest) {
  const auth = await requireAgent(request);
  if (!auth.ok) {
    return NextResponse.json(apiError(auth.message, auth.code, undefined, auth.status), { status: auth.status });
  }
  const raw = parseBody(auth.body);
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(apiError("taskId is required", "VALIDATION_ERROR", undefined, 400), { status: 400 });
  }
  const started = await startTask(parsed.data.taskId, auth.agent.id);
  if (!started) {
    return NextResponse.json(
      apiSuccess(
        { started: false, reason: "Task is not in ASSIGNED state for this agent; do not execute it." },
        "Task not started",
      ),
    );
  }
  return NextResponse.json(apiSuccess({ started: true }, "Task started"));
}
