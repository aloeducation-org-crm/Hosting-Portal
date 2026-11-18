import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { listOrganizationChatMembers } from "@/lib/communications";
import { db } from "@/lib/db";
import { apiError, apiSuccess, type ApiResponse } from "@/lib/response";

function handleError(error: unknown): NextResponse {
  if (error && typeof error === "object" && "status" in error) {
    const response = error as ApiResponse;
    return NextResponse.json(response, { status: response.status });
  }
  return NextResponse.json(apiError("Internal server error"), { status: 500 });
}

/** GET /api/communications/members?organizationId=... */
export async function GET(request: NextRequest) {
  try {
    const actor = await requireSession(request);
    const organizationId = new URL(request.url).searchParams.get("organizationId")?.trim();
    if (!organizationId) {
      return NextResponse.json(
        apiError("organizationId is required", "VALIDATION_ERROR", undefined, 400),
        { status: 400 },
      );
    }
    const members = await listOrganizationChatMembers(db, actor, organizationId);
    return NextResponse.json(apiSuccess({ members }), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return handleError(error);
  }
}
