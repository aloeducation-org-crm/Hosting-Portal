import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { apiSuccess, apiError, type ApiResponse } from "@/lib/response";
import { requireAdmin } from "@/lib/auth";
import { orchestrator } from "@/lib/orchestrator/orchestrator";

const schema = z.object({ reason: z.string().max(300).optional() });

function handleErr(e: unknown): NextResponse {
  if (e && typeof e === "object" && "status" in e) {
    const a = e as ApiResponse;
    return NextResponse.json(a, { status: a.status });
  }
  return NextResponse.json(apiError("Internal server error"), { status: 500 });
}

/** Cancel a job that has not reached a terminal state yet. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin(request);
    const { id } = await params;
    const parsed = schema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json(apiError("Validation failed", "VALIDATION_ERROR", parsed.error.flatten(), 400), { status: 400 });
    }
    const cancelled = await orchestrator.cancel(id, { id: admin.id, email: admin.email, role: admin.role }, parsed.data.reason ?? "Cancelled from the dashboard");
    if (!cancelled) {
      return NextResponse.json(apiError("Job is not in a cancellable state", "CONFLICT", undefined, 409), { status: 409 });
    }
    return NextResponse.json(apiSuccess({ jobId: id, status: "CANCELLED" }, "Job cancelled"));
  } catch (e) {
    return handleErr(e);
  }
}
