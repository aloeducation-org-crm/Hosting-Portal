import { NextRequest, NextResponse } from "next/server";
import { apiSuccess, apiError, type ApiResponse } from "@/lib/response";
import { requireAdmin } from "@/lib/auth";
import { rotateAgentSecret } from "@/lib/agents/agent";

function handleErr(e: unknown): NextResponse {
  if (e && typeof e === "object" && "status" in e) {
    const a = e as ApiResponse;
    return NextResponse.json(a, { status: a.status });
  }
  return NextResponse.json(apiError("Internal server error"), { status: 500 });
}

/**
 * Rotate an agent's signing secret. The old secret stops working immediately.
 * The `:slug` segment carries the server agent's id here (AI-agent routes
 * carry a slug); one param name per level is a Next.js constraint.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const admin = await requireAdmin(request);
    const { slug: id } = await params;
    const result = await rotateAgentSecret(id, { id: admin.id, email: admin.email, role: admin.role });
    if (!result.ok) return NextResponse.json(apiError(result.reason, "NOT_FOUND", undefined, 404), { status: 404 });
    // Shown once; the panel stores only the encrypted copy.
    return NextResponse.json(apiSuccess({ secret: result.secret }, "Secret rotated — copy it now, it is not stored in plaintext"));
  } catch (e) {
    return handleErr(e);
  }
}
