import { type NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { UUID } from "@/lib/hosting/static-config";
import { requestStaticHttpsCheck } from "@/lib/hosting/static-control";
import { apiError, apiSuccess, type ApiResponse } from "@/lib/response";

export const runtime = "nodejs";
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireSession(request);
    const { id } = await params;
    if (!UUID.test(id)) return NextResponse.json(apiError("Static site not found.", "NOT_FOUND", undefined, 404), { status: 404 });
    const job = await requestStaticHttpsCheck(user, id);
    return NextResponse.json(apiSuccess({ jobId: job.jobId }, "HTTPS verification queued", 202), { status: 202 });
  } catch (error) {
    if (error && typeof error === "object" && "status" in error && typeof error.status === "number") {
      return NextResponse.json(error as ApiResponse, { status: error.status });
    }
    return NextResponse.json(apiError("Could not queue HTTPS verification."), { status: 500 });
  }
}
