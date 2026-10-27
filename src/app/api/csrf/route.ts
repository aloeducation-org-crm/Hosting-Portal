import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/response";
import { CSRF_COOKIE_NAME, csrfCookieAttributes, issueCsrfToken } from "@/lib/security/csrf";

/**
 * Issue (or rotate) this browser's CSRF cookie.
 *
 * Unauthenticated on purpose: a token must be obtainable *before* login, and it
 * carries no identity or authority — it only proves the request came from code
 * running on this origin. The response body deliberately does not contain the
 * token: the client reads the cookie, so the value never has to be rendered into
 * HTML or logged.
 */
export async function GET(request: NextRequest) {
  const issued = await issueCsrfToken();
  if (!issued) {
    // Fail closed: without a usable server secret we cannot bind a cookie value,
    // and issuing an unsigned token would let any cookie-writer forge one.
    return NextResponse.json(
      apiError("CSRF protection is not configured on this server", "CSRF_UNCONFIGURED", undefined, 503),
      { status: 503 },
    );
  }
  const secure = new URL(request.url).protocol === "https:" || request.headers.get("x-forwarded-proto") === "https";
  const response = NextResponse.json({ success: true, message: "CSRF cookie issued", data: { rotated: true } });
  response.cookies.set(CSRF_COOKIE_NAME, issued.cookieValue, csrfCookieAttributes(secure));
  return response;
}
