import { NextRequest, NextResponse } from "next/server";
import { apiSuccess, apiError, type ApiResponse } from "@/lib/response";
import { requireSession } from "@/lib/auth";
import { orchestrator } from "@/lib/orchestrator/orchestrator";

function handleErr(e: unknown): NextResponse {
  if (e && typeof e === "object" && "status" in e) {
    const a = e as ApiResponse;
    return NextResponse.json(a, { status: a.status });
  }
  return NextResponse.json(apiError("Internal server error"), { status: 500 });
}

/** Full job detail: state, attempts, lease, approval, result and progress events. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireSession(request);
    const { id } = await params;
    const job = await orchestrator.status(id);
    if (!job) return NextResponse.json(apiError("Job not found", "NOT_FOUND", undefined, 404), { status: 404 });
    return NextResponse.json(apiSuccess(job));
  } catch (e) {
    return handleErr(e);
  }
}
