import { NextRequest, NextResponse } from "next/server";
import { apiSuccess, apiError, type ApiResponse } from "@/lib/response";
import { requireAdmin } from "@/lib/auth";
import { revokeAgent } from "@/lib/agents/agent";

function handleErr(e: unknown): NextResponse {
  if (e && typeof e === "object" && "status" in e) {
    const a = e as ApiResponse;
    return NextResponse.json(a, { status: a.status });
  }
  return NextResponse.json(apiError("Internal server error"), { status: 500 });
}

/** Revoke an agent. Its key stops authenticating on the next request. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin(request);
    const { id } = await params;
    const result = await revokeAgent(id, { id: admin.id, email: admin.email, role: admin.role });
    if (!result.ok) return NextResponse.json(apiError(result.reason, "CONFLICT", undefined, 409), { status: 409 });
    return NextResponse.json(apiSuccess({ agentId: id, status: "revoked" }, "Agent revoked"));
  } catch (e) {
    return handleErr(e);
  }
}
