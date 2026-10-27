import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { apiSuccess, apiError, type ApiResponse } from "@/lib/response";
import { requireAdmin } from "@/lib/auth";
import { orchestrator } from "@/lib/orchestrator/orchestrator";

const schema = z.object({ note: z.string().max(300).optional() });

function handleErr(e: unknown): NextResponse {
  if (e && typeof e === "object" && "status" in e) {
    const a = e as ApiResponse;
    return NextResponse.json(a, { status: a.status });
  }
  return NextResponse.json(apiError("Internal server error"), { status: 500 });
}

/**
 * Requeue a dead-lettered job. Manual by design: a job that exhausted its retry
 * budget needs a human decision, not another automatic attempt.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin(request);
    const { id } = await params;
    const parsed = schema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json(apiError("Validation failed", "VALIDATION_ERROR", parsed.error.flatten(), 400), { status: 400 });
    }
    const ok = await orchestrator.requeueDeadLetter(id, { id: admin.id, email: admin.email, role: admin.role }, parsed.data.note);
    if (!ok) {
      return NextResponse.json(apiError("Only DEAD_LETTER jobs can be requeued", "CONFLICT", undefined, 409), { status: 409 });
    }
    return NextResponse.json(apiSuccess({ jobId: id, status: "QUEUED" }, "Job requeued"));
  } catch (e) {
    return handleErr(e);
  }
}
