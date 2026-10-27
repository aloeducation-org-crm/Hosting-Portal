import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { apiSuccess, apiError, type ApiResponse } from "@/lib/response";
import { requireAdmin } from "@/lib/auth";
import { approveAgentTask, rejectAgentTask } from "@/lib/agents/agent";

const schema = z.object({
  decision: z.enum(["approve", "reject"]).default("approve"),
  note: z.string().max(500).optional(),
});

function handleErr(e: unknown): NextResponse {
  if (e && typeof e === "object" && "status" in e) {
    const a = e as ApiResponse;
    return NextResponse.json(a, { status: a.status });
  }
  return NextResponse.json(apiError("Internal server error"), { status: 500 });
}

/**
 * Human approval gate for a single agent task.
 *
 * `service.restart`, `backup.database` and anything else the allowlist marks
 * PRIVILEGED or DESTRUCTIVE is dispatched ungated-but-unclaimable: `claimTask`
 * will not hand it to a host until a named administrator approves it here.
 * Admin-only (enforced twice: `requireAdmin` plus the middleware write guard on
 * `/api/agents`) and never reachable from the AI layer.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin(request);
    const { id } = await params;
    const parsed = schema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json(apiError("Validation failed", "VALIDATION_ERROR", parsed.error.flatten(), 400), { status: 400 });
    }
    const actor = { id: admin.id, email: admin.email, role: admin.role };

    if (parsed.data.decision === "reject") {
      const result = await rejectAgentTask(id, actor, parsed.data.note ?? "Rejected by an administrator");
      if (!result.ok) return NextResponse.json(apiError(result.reason, "CONFLICT", undefined, 409), { status: 409 });
      return NextResponse.json(apiSuccess({ taskId: id, status: "REFUSED" }, "Task rejected; it will never be dispatched"));
    }

    const result = await approveAgentTask(id, actor, parsed.data.note);
    if (!result.ok) return NextResponse.json(apiError(result.reason, "CONFLICT", undefined, 409), { status: 409 });
    return NextResponse.json(apiSuccess({ taskId: id, status: result.status }, "Task approved and claimable by the agent"));
  } catch (e) {
    return handleErr(e);
  }
}
