import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { UUID } from "@/lib/hosting/static-config";
import { requestStaticWithdrawal } from "@/lib/hosting/static-control";
import { apiError, apiSuccess, type ApiResponse } from "@/lib/response";

export const runtime = "nodejs";
const confirmation = z.strictObject({ confirmHostname: z.string().max(253) });

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireSession(request);
    const { id } = await params;
    if (!UUID.test(id)) return NextResponse.json(apiError("Static site not found.", "NOT_FOUND", undefined, 404), { status: 404 });
    const parsed = confirmation.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json(apiError("Confirm the exact hostname before withdrawing the release.", "CONFIRMATION_REQUIRED", undefined, 400), { status: 400 });
    const job = await requestStaticWithdrawal(user, id, parsed.data.confirmHostname);
    return NextResponse.json(apiSuccess({ jobId: job.jobId }, "Withdrawal queued; no files will be deleted", 202), { status: 202 });
  } catch (error) {
    if (error && typeof error === "object" && "status" in error && typeof error.status === "number") {
      return NextResponse.json(error as ApiResponse, { status: error.status });
    }
    return NextResponse.json(apiError("Could not queue static site withdrawal."), { status: 500 });
  }
}
