import { NextRequest, NextResponse } from "next/server";
import { handleGitHubWebhook } from "@/lib/deploy/webhook";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GitHub App / repository webhook endpoint. Verifies HMAC before parsing. */
export async function POST(request: NextRequest) {
  const raw = await request.text();
  const result = await handleGitHubWebhook(raw, request.headers);
  return NextResponse.json(result.body, {
    status: result.status,
    headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });
}

export async function GET() {
  return NextResponse.json({ error: "Use POST" }, { status: 405, headers: { Allow: "POST" } });
}
