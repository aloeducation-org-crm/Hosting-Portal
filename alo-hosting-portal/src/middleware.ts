import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";

const RATE_LIMIT = new Map<string, { count: number; resetAt: number }>();
const RATE_MAX = 100;
const RATE_WINDOW_MS = 60_000;

const LOGIN_RATE_LIMIT = new Map<string, { count: number; resetAt: number }>();
const LOGIN_RATE_MAX = 10;
const LOGIN_RATE_WINDOW_MS = 60_000;

const PUBLIC_PATHS = ['/api/auth', '/api/health', '/api/pricing', '/api/deploy/webhook', '/api/ai/chat'];
const LOGIN_PATH = '/api/auth/login';

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") || "unknown";
  const now = Date.now();

  if (pathname === LOGIN_PATH) {
    const loginEntry = LOGIN_RATE_LIMIT.get(ip);
    if (loginEntry && now < loginEntry.resetAt) {
      if (loginEntry.count >= LOGIN_RATE_MAX) {
        return NextResponse.json(
          { status: 429, success: false, message: "Too many login attempts.", error: { code: "RATE_LIMITED" }, requestId: "" },
          { status: 429 }
        );
      }
      loginEntry.count++;
    } else {
      LOGIN_RATE_LIMIT.set(ip, { count: 1, resetAt: now + LOGIN_RATE_WINDOW_MS });
    }
  }

  if (!PUBLIC_PATHS.some(p => pathname.startsWith(p))) {
    const entry = RATE_LIMIT.get(ip);
    if (entry && now < entry.resetAt) {
      if (entry.count >= RATE_MAX) {
        return NextResponse.json(
          { status: 429, success: false, message: "Too many requests", error: { code: "RATE_LIMITED" }, requestId: "" },
          { status: 429 }
        );
      }
      entry.count++;
    } else {
      RATE_LIMIT.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
    }
  }

  const response = NextResponse.next();
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("X-XSS-Protection", "1; mode=block");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  response.headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");

  if (pathname.startsWith("/dashboard")) {
    const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
    if (!token) {
      const loginUrl = new URL("/login", request.url);
      loginUrl.searchParams.set("callbackUrl", pathname);
      return NextResponse.redirect(loginUrl);
    }
  }

  if (pathname.startsWith("/api/") && !PUBLIC_PATHS.some(p => pathname.startsWith(p))) {
    const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
    if (!token) {
      return NextResponse.json(
        { status: 401, success: false, message: "Authentication required", error: { code: "UNAUTHORIZED" }, requestId: "" },
        { status: 401 }
      );
    }
  }

  return response;
}

export const config = {
  matcher: ["/dashboard/:path*", "/api/:path*"],
};
