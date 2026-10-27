import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { apiSuccess, apiError, type ApiResponse } from "@/lib/response";
import { requireAdmin } from "@/lib/auth";
import { createEnrollmentToken, AGENT_SCOPES, ENROLLMENT_TTL_MS } from "@/lib/agents/agent";
import { allowlistCatalogue, DEFAULT_AGENT_CAPABILITIES } from "@/lib/agents/allowlist";
import { db } from "@/lib/db";

const createSchema = z.object({
  agentName: z.string().min(2).max(120),
  serverId: z.string().uuid().optional(),
  scopes: z.array(z.enum(AGENT_SCOPES)).max(AGENT_SCOPES.length).optional(),
  capabilities: z.array(z.string().max(64)).max(60).optional(),
});

function handleErr(e: unknown): NextResponse {
  if (e && typeof e === "object" && "status" in e) {
    const a = e as ApiResponse;
    return NextResponse.json(a, { status: a.status });
  }
  return NextResponse.json(apiError("Internal server error"), { status: 500 });
}

/**
 * GET  — list enrollment tokens (never the plaintext; it is not stored) and the
 *        allowlist so the UI can offer only commands the platform will run.
 * POST — mint a single-use, short-lived token. Admin only.
 */
export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request);
    const tokens = await db.agentEnrollmentToken.findMany({
      orderBy: { createdAt: "desc" },
      take: 50,
      select: {
        id: true,
        prefix: true,
        agentName: true,
        serverId: true,
        scopes: true,
        capabilities: true,
        expiresAt: true,
        usedAt: true,
        createdAt: true,
      },
    });
    const now = Date.now();
    return NextResponse.json(
      apiSuccess({
        tokens: tokens.map((t) => ({
          ...t,
          state: t.usedAt ? "used" : t.expiresAt.getTime() < now ? "expired" : "active",
        })),
        allowlist: allowlistCatalogue(),
        defaultCapabilities: DEFAULT_AGENT_CAPABILITIES,
        scopes: AGENT_SCOPES,
        ttlMs: ENROLLMENT_TTL_MS,
      }),
    );
  } catch (e) {
    return handleErr(e);
  }
}

export async function POST(request: NextRequest) {
  try {
    const admin = await requireAdmin(request);
    const parsed = createSchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json(apiError("Validation failed", "VALIDATION_ERROR", parsed.error.flatten(), 400), { status: 400 });
    }
    const result = await createEnrollmentToken({
      agentName: parsed.data.agentName,
      serverId: parsed.data.serverId ?? null,
      scopes: parsed.data.scopes,
      capabilities: parsed.data.capabilities,
      actor: { id: admin.id, email: admin.email, role: admin.role },
    });
    // The plaintext token is returned exactly once; only its hash is stored.
    return NextResponse.json(apiSuccess(result, "Enrollment token created — show it once, it cannot be retrieved again", 201), { status: 201 });
  } catch (e) {
    return handleErr(e);
  }
}
