import { type NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { getStaticHostingStatus, requestStaticSite, staticRequest } from "@/lib/hosting/static-control";
import { logger } from "@/lib/logger";
import { apiError, apiSuccess, type ApiResponse } from "@/lib/response";

export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store" };

function onError(error: unknown) {
  if (error && typeof error === "object" && "status" in error && typeof error.status === "number") {
    return NextResponse.json(error as ApiResponse, { status: error.status, headers });
  }
  logger.error("Managed static hosting request failed");
  return NextResponse.json(apiError("Could not process this hosting request.", "INTERNAL_ERROR"), { status: 500, headers });
}

export async function GET(request: NextRequest) {
  try {
    const user = await requireSession(request);
    return NextResponse.json(apiSuccess(await getStaticHostingStatus(user, request.nextUrl.searchParams.get("scope") === "all")), { headers });
  } catch (error) { return onError(error); }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireSession(request);
    const parsed = staticRequest.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(apiError("Enter a public GitHub repository, managed hostname and active plan, and confirm publication.",
        "VALIDATION_ERROR", parsed.error.flatten(), 400), { status: 400, headers });
    }
    const site = await requestStaticSite(user, parsed.data);
    // No network request, shell, filesystem write or deploy in the HTTP process.
    return NextResponse.json(apiSuccess({ id: site.id, hostname: site.hostname, jobId: site.initialJobId }, "Deployment request recorded", 202), { status: 202, headers });
  } catch (error) { return onError(error); }
}
