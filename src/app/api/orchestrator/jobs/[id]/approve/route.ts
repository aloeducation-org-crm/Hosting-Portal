import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { apiSuccess, apiError, type ApiResponse } from "@/lib/response";
import { requireAdmin } from "@/lib/auth";
import { orchestrator } from "@/lib/orchestrator/orchestrator";

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
 * Human approval gate.
 *
 * This endpoint is deliberately admin-only and deliberately not reachable from
 * the AI layer: an assistant can prepare a rollback plan or explain a failure,
 * but a named human must press approve before a PRIVILEGED or DESTRUCTIVE job
 * runs. The approval is written to the audit log with the actor's identity.
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
      const result = await orchestrator.reject(id, actor, parsed.data.note ?? "Rejected by an administrator");
      if (!result.ok) return NextResponse.json(apiError(result.reason ?? "Could not reject", "CONFLICT", undefined, 409), { status: 409 });
      return NextResponse.json(apiSuccess({ jobId: id, status: "FAILED" }, "Job rejected"));
    }

    const result = await orchestrator.approve(id, actor, parsed.data.note);
    if (!result.ok) return NextResponse.json(apiError(result.reason, "CONFLICT", undefined, 409), { status: 409 });
    return NextResponse.json(apiSuccess({ jobId: id, status: result.status }, "Job approved and queued"));
  } catch (e) {
    return handleErr(e);
  }
}
