import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";

const RATE_LIMIT = new Map<string, { count: number; resetAt: number }>();
const RATE_MAX = 100;
const RATE_WINDOW_MS = 60_000;

// Login-specific stricter rate limit
const LOGIN_RATE_LIMIT = new Map<string, { count: number; resetAt: number }>();
const LOGIN_RATE_MAX = 10;
const LOGIN_RATE_WINDOW_MS = 60_000;

const PUBLIC_API_PATHS = [
  "/api/auth",
  "/api/health",
  "/api/pricing",
  "/api/deploy/webhook",
  "/api/contact",
  "/api/newsletter",
];

const ADMIN_UI_PREFIXES = [
  "/admin",
  "/users",
  "/servers",
  "/plans",
  "/audit",
  "/dashboard/users",
  "/dashboard/servers",
  "/dashboard/plans",
  "/dashboard/audit",
];

const DASHBOARD_UI_PREFIXES = [
  "/dashboard",
  "/sites",
  "/databases",
  "/storage",
  "/ai",
  "/billing",
  "/settings",
  "/onboarding",
];

const ADMIN_API_PREFIXES = [
  "/api/users",
  "/api/servers/reconcile",
  "/api/security/lockout",
  "/api/security/audit-export",
];

const ADMIN_ROLES = new Set(["SUPER_ADMIN", "ADMIN"]);

export function isAdminPath(pathname: string): boolean {
  return ADMIN_UI_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
}

export function isProtectedDashboardPath(pathname: string): boolean {
  return (
    isAdminPath(pathname) ||
    DASHBOARD_UI_PREFIXES.some(
      (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
    )
  );
}

export function canAccessRoute(
  pathname: string,
  role?: string | null
): { allowed: boolean; reason?: "unauthenticated" | "forbidden" } {
  if (!role) {
    return { allowed: false, reason: "unauthenticated" };
  }
  if (isAdminPath(pathname) && !ADMIN_ROLES.has(role)) {
    return { allowed: false, reason: "forbidden" };
  }
  return { allowed: true };
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // --- Rate limiting (applies to ALL requests) ---
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown";

  const now = Date.now();

  // Stricter rate limit for login endpoint
  if (pathname === "/api/auth/login") {
    const loginEntry = LOGIN_RATE_LIMIT.get(ip);
    if (loginEntry && now < loginEntry.resetAt) {
      if (loginEntry.count >= LOGIN_RATE_MAX) {
        return NextResponse.json(
          {
            status: 429,
            success: false,
            message: "Too many login attempts. Try again later.",
            data: null,
            error: { code: "RATE_LIMITED" },
            requestId: "",
          },
          { status: 429 }
        );
      }
      loginEntry.count++;
    } else {
      LOGIN_RATE_LIMIT.set(ip, { count: 1, resetAt: now + LOGIN_RATE_WINDOW_MS });
    }
  }

  // General rate limiting
  if (!PUBLIC_API_PATHS.some((p) => pathname.startsWith(p))) {
    const entry = RATE_LIMIT.get(ip);
    if (entry && now < entry.resetAt) {
      if (entry.count >= RATE_MAX) {
        return NextResponse.json(
          {
            status: 429,
            success: false,
            message: "Too many requests",
            data: null,
            error: { code: "RATE_LIMITED" },
            requestId: "",
          },
          { status: 429 }
        );
      }
      entry.count++;
    } else {
      RATE_LIMIT.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
    }
  }

  // --- Security headers (on ALL responses) ---
  const response = NextResponse.next();
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-XSS-Protection", "1; mode=block");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=()"
  );
  response.headers.set(
    "Strict-Transport-Security",
    "max-age=31536000; includeSubDomains"
  );

  // --- Authentication & Role Guard for Protected UI Paths ---
  if (isProtectedDashboardPath(pathname)) {
    const token = await getToken({
      req: request,
      secret: process.env.NEXTAUTH_SECRET || "dev-secret-change-in-production",
    });

    if (!token) {
      const loginUrl = new URL("/login", request.url);
      loginUrl.searchParams.set("callbackUrl", pathname);
      return NextResponse.redirect(loginUrl);
    }

    const userRole = (token.role as string | undefined) || "CLIENT";
    const access = canAccessRoute(pathname, userRole);

    if (!access.allowed && access.reason === "forbidden") {
      const fallbackUrl = new URL("/dashboard", request.url);
      fallbackUrl.searchParams.set("error", "forbidden");
      return NextResponse.redirect(fallbackUrl);
    }

    response.headers.set("x-user-role", userRole);
  }

  // --- API Authentication & Admin Guard ---
  if (
    pathname.startsWith("/api/") &&
    !PUBLIC_API_PATHS.some((p) => pathname.startsWith(p))
  ) {
    const token = await getToken({
      req: request,
      secret: process.env.NEXTAUTH_SECRET || "dev-secret-change-in-production",
    });

    if (!token) {
      return NextResponse.json(
        {
          status: 401,
          success: false,
          message: "Authentication required",
          data: null,
          error: { code: "UNAUTHORIZED" },
          requestId: "",
        },
        { status: 401 }
      );
    }

    const userRole = (token.role as string | undefined) || "CLIENT";
    if (
      ADMIN_API_PREFIXES.some((p) => pathname.startsWith(p)) &&
      !ADMIN_ROLES.has(userRole)
    ) {
      return NextResponse.json(
        {
          status: 403,
          success: false,
          message: "Administrator role required",
          data: null,
          error: { code: "FORBIDDEN" },
          requestId: "",
        },
        { status: 403 }
      );
    }
  }

  return response;
}

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/admin/:path*",
    "/users/:path*",
    "/servers/:path*",
    "/plans/:path*",
    "/audit/:path*",
    "/sites/:path*",
    "/databases/:path*",
    "/storage/:path*",
    "/ai/:path*",
    "/billing/:path*",
    "/settings/:path*",
    "/onboarding/:path*",
    "/api/:path*",
  ],
};
