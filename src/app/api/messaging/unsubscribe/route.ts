import { NextRequest, NextResponse } from "next/server";
import { unsubscribePilotEmail, unsubscribeTokenPattern } from "@/lib/messaging/control";

const headers = {
  "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy": "default-src 'none'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
};

/** Link previews and security scanners do not change subscription state. */
export function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token") ?? "";
  if (!unsubscribeTokenPattern.test(token)) return new NextResponse("Invalid unsubscribe link", { status: 400, headers });
  return new NextResponse(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Unsubscribe</title><main><h1>Unsubscribe from pilot email</h1><p>Confirm to stop future pilot email. An email already in flight cannot be recalled.</p><form method="post" action="/api/messaging/unsubscribe?token=${token}"><button type="submit" name="List-Unsubscribe" value="One-Click">Confirm unsubscribe</button></form></main></html>`, {
    headers: { ...headers, "Content-Type": "text/html; charset=utf-8" },
  });
}

/** The unguessable URL token grants only opt-out. Never consult ambient cookies. */
export async function POST(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token") ?? "";
  if (!unsubscribeTokenPattern.test(token)) return new NextResponse(null, { status: 400, headers });
  try {
    await unsubscribePilotEmail(token);
    return new NextResponse("Request received. If this link was valid, future pilot emails to that address are disabled.", {
      status: 200, headers: { ...headers, "Content-Type": "text/plain; charset=utf-8" },
    });
  } catch { return new NextResponse(null, { status: 503, headers }); }
}
