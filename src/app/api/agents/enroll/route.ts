import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { apiSuccess, apiError } from "@/lib/response";
import { checkRateLimit } from "@/lib/rate-limit";
import { enrollAgent } from "@/lib/agents/agent";

const schema = z.object({
  token: z.string().min(10).max(200),
  name: z.string().min(1).max(120).optional(),
  version: z.string().max(40).optional(),
  hostname: z.string().max(200).optional(),
});

function clientIp(request: NextRequest): string | undefined {
  const forwarded = request.headers.get("x-forwarded-for");
  return (forwarded?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || undefined);
}

/**
 * Agent self-enrollment: exchanges a short-lived, single-use token for the
 * agent's own credentials. Unauthenticated by design (the token *is* the
 * authentication), so it is rate-limited per IP and the token is consumed
 * atomically inside `enrollAgent`.
 */
export async function POST(request: NextRequest) {
  const ip = clientIp(request) ?? "unknown";
  const limit = checkRateLimit(`agent-enroll:${ip}`, { maxRequests: 10, windowMs: 10 * 60_000 });
  if (!limit.allowed) {
    return NextResponse.json(apiError("Too many enrollment attempts", "RATE_LIMITED", undefined, 429), { status: 429 });
  }

  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(apiError("token is required", "VALIDATION_ERROR", parsed.error.flatten(), 400), { status: 400 });
  }

  const result = await enrollAgent({ token: parsed.data.token, version: parsed.data.version, ip });
  if (!result.ok) {
    return NextResponse.json(apiError(result.reason, "ENROLLMENT_FAILED", undefined, 401), { status: 401 });
  }
  return NextResponse.json(apiSuccess(result, "Agent enrolled", 201), { status: 201 });
}
