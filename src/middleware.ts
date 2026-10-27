import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { CSRF_COOKIE_NAME, CSRF_HEADER_NAME, hasSessionCookie, validateCsrf } from "@/lib/security/csrf";

const RATE_LIMIT = new Map<string, { count: number; resetAt: number }>();
const RATE_MAX_CLIENTS = 10_000;
const RATE_MAX = 100;
const RATE_WINDOW_MS = 60_000;

// Login & public mutation stricter rate limit
const LOGIN_RATE_LIMIT = new Map<string, { count: number; resetAt: number }>();
const LOGIN_RATE_MAX = 10;
const LOGIN_RATE_WINDOW_MS = 60_000;

// AI mutation/inference rate limit (per user or IP)
const AI_RATE_LIMIT = new Map<string, { count: number; resetAt: number }>();
const AI_RATE_MAX = 30;
const AI_RATE_WINDOW_MS = 60_000;
const STRICT_PUBLIC_PATHS = new Set([
  "/api/auth/login",
  "/api/auth/signup",
  "/api/auth/register",
  "/api/auth/mfa-challenge",
  "/api/contact",
  "/api/newsletter",
]);
let lastRateLimitCleanup = 0;

function applySecurityHeaders(target: NextResponse, corsOrigin: string | null, pathname: string): NextResponse {
  target.headers.set("X-Content-Type-Options", "nosniff");
  if (process.env.ALLOW_PREVIEW_EMBED !== "1") {
    target.headers.set("X-Frame-Options", "SAMEORIGIN");
  }
  target.headers.set("X-XSS-Protection", "1; mode=block");
  target.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  target.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  target.headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  target.headers.set("Cross-Origin-Opener-Policy", process.env.CROSS_ORIGIN_OPENER_POLICY || "same-origin");
  target.headers.set("Cross-Origin-Resource-Policy", process.env.CROSS_ORIGIN_RESOURCE_POLICY || "same-site");
  target.headers.set("X-Permitted-Cross-Domain-Policies", "none");
  if (corsOrigin && pathname.startsWith("/api/")) {
    target.headers.set("Access-Control-Allow-Origin", corsOrigin);
    target.headers.set("Access-Control-Allow-Credentials", "true");
    target.headers.set("Vary", "Origin");
  }
  return target;
}

function cleanupRateLimitState(now: number): void {
  if (now - lastRateLimitCleanup < 30_000) return;
  lastRateLimitCleanup = now;
  for (const [key, value] of RATE_LIMIT) {
    if (value.resetAt <= now) RATE_LIMIT.delete(key);
  }
  for (const [key, value] of LOGIN_RATE_LIMIT) {
    if (value.resetAt <= now) LOGIN_RATE_LIMIT.delete(key);
  }
  for (const [key, value] of AI_RATE_LIMIT) {
    if (value.resetAt <= now) AI_RATE_LIMIT.delete(key);
  }
  // Keep memory bounded if a burst creates many distinct client keys.
  while (RATE_LIMIT.size > RATE_MAX_CLIENTS) RATE_LIMIT.delete(RATE_LIMIT.keys().next().value!);
  while (LOGIN_RATE_LIMIT.size > RATE_MAX_CLIENTS) LOGIN_RATE_LIMIT.delete(LOGIN_RATE_LIMIT.keys().next().value!);
  while (AI_RATE_LIMIT.size > RATE_MAX_CLIENTS) AI_RATE_LIMIT.delete(AI_RATE_LIMIT.keys().next().value!);
}

const PUBLIC_API_PATHS = [
  "/api/auth",
  // Issues this browser's CSRF cookie. Must be reachable *before* login, and it
  // grants nothing: the value is an HMAC-bound random token with no identity.
  "/api/csrf",
  "/api/health",
  "/api/pricing",
  "/api/deploy/webhook",
  "/api/internal/sites/ssl-status",
  "/api/contact",
  "/api/newsletter",
  // GitHub webhooks are authenticated by HMAC-SHA256 signature, not a session.
  "/api/github/webhook",
  // OAuth callback is CSRF-protected by the one-time state cookie.
  "/api/github/callback",
];

/**
 * Endpoints authenticated by something other than a user session:
 *   - `/api/agents/enroll`          → short-lived single-use enrollment token
 *   - `/api/agents/heartbeat|tasks` → per-agent HMAC over the exact request body
 *   - `/api/orchestrator/run`       → INTERNAL_SECRET (worker tick)
 *
 * They are exempt from the *session* guard only. They still pass through the
 * IP rate limiter and the security headers below, and each route re-verifies its
 * own credential before doing anything.
 */
const HMAC_AUTHENTICATED_API_PATHS = [
  "/api/agents/enroll",
  "/api/agents/heartbeat",
  "/api/agents/tasks/claim",
  "/api/agents/tasks/result",
  "/api/orchestrator/run",
];

const ADMIN_UI_PREFIXES = [
  "/admin",
  "/users",
  "/servers",
  "/plans",
  "/audit",
  "/infrastructure",
  "/dashboard/users",
  "/dashboard/servers",
  "/dashboard/plans",
  "/dashboard/audit",
  "/dashboard/infrastructure",
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
  "/deployments",
];

const ADMIN_API_PREFIXES = [
  "/api/users",
  "/api/servers/reconcile",
  "/api/security/lockout",
  "/api/security/audit-export",
  "/api/orchestrator",
  "/api/agents/enrollment-tokens",
  "/api/infrastructure",
];

/**
 * Method-specific admin guards. `/api/agents` is shared: GET serves the AI-agent
 * catalogue to any signed-in user, while POST dispatches a task to a managed
 * Linux host and must be admin-only. Listing the prefix in ADMIN_API_PREFIXES
 * would break the catalogue, so the write is guarded here instead.
 */
const ADMIN_API_WRITE_PREFIXES = ["/api/agents"];

const ADMIN_ROLES = new Set(["SUPER_ADMIN", "ADMIN"]);

const UNSAFE_JWT_SECRETS = new Set([
  "",
  "dev-secret-change-in-production",
  "generate-with-openssl-rand-hex-32",
]);

/**
 * Resolve the NextAuth JWT secret for middleware verification.
 * In production, a missing or placeholder secret fails closed (returns null)
 * rather than falling back to a publicly known string.
 */
export function resolveMiddlewareJwtSecret(
  envSource: Record<string, string | undefined> = process.env,
): string | null {
  const configured = envSource.NEXTAUTH_SECRET?.trim() ?? "";
  if (envSource.NODE_ENV === "production") {
    return UNSAFE_JWT_SECRETS.has(configured) ? null : configured;
  }
  return configured || "dev-secret-change-in-production";
}

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
  const origin = request.headers.get("origin");
  const corsOrigins = (process.env.CORS_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const requestHost = ((request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? "").split(",")[0] ?? "").trim();
  const requestProtocol = ((request.headers.get("x-forwarded-proto") ?? request.nextUrl.protocol).split(",")[0] ?? "").trim().replace(/:$/, "");
  let originHost = "";
  let originProto = "";
  if (origin) {
    try {
      const parsedOrigin = new URL(origin);
      originHost = parsedOrigin.host;
      originProto = parsedOrigin.protocol.replace(/:$/, "");
    } catch {
      originHost = "";
    }
  }
  const sameOrigin =
    !!origin &&
    (`${requestProtocol}://${requestHost}` === origin ||
      (!!requestHost && originHost === requestHost && (originProto === "https" || originProto === requestProtocol)));
  const corsOrigin = origin && (sameOrigin || corsOrigins.includes(origin)) ? origin : null;

  // No wildcard origins are allowed. A configured origin must match exactly.
  if (pathname.startsWith("/api/") && origin && !corsOrigin) {
    return applySecurityHeaders(
      NextResponse.json({ success: false, message: "Origin not allowed" }, { status: 403 }),
      corsOrigin,
      pathname
    );
  }
  if (request.method === "OPTIONS" && pathname.startsWith("/api/")) {
    const preflight = applySecurityHeaders(new NextResponse(null, { status: 204 }), corsOrigin, pathname);
    if (corsOrigin) {
      preflight.headers.set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
      preflight.headers.set("Access-Control-Allow-Headers", "Authorization, Content-Type, X-Request-ID");
    }
    return preflight;
  }

  // --- Rate limiting (applies to ALL requests) ---
  // Nginx/Caddy are configured to overwrite X-Real-IP from the actual peer.
  // Do not trust the client-controlled leftmost X-Forwarded-For value for limits.
  const ip = request.headers.get("x-real-ip")?.trim() || "unknown";
  const now = Date.now();
  cleanupRateLimitState(now);

  // Stricter rate limit for auth & public form endpoints
  if (STRICT_PUBLIC_PATHS.has(pathname)) {
    const bucketKey = `${ip}:${pathname}`;
    const loginEntry = LOGIN_RATE_LIMIT.get(bucketKey);
    if (loginEntry && now < loginEntry.resetAt) {
      if (loginEntry.count >= LOGIN_RATE_MAX) {
        return applySecurityHeaders(
          NextResponse.json(
            {
              status: 429,
              success: false,
              message: "Too many attempts. Try again later.",
              data: null,
              error: { code: "RATE_LIMITED" },
              requestId: "",
            },
            { status: 429 }
          ),
          corsOrigin,
          pathname
        );
      }
      loginEntry.count++;
    } else {
      LOGIN_RATE_LIMIT.set(bucketKey, { count: 1, resetAt: now + LOGIN_RATE_WINDOW_MS });
    }
  }

  // General rate limiting
  if (!PUBLIC_API_PATHS.some((p) => pathname.startsWith(p))) {
    const entry = RATE_LIMIT.get(ip);
    if (entry && now < entry.resetAt) {
      if (entry.count >= RATE_MAX) {
        return applySecurityHeaders(
          NextResponse.json(
            {
              status: 429,
              success: false,
              message: "Too many requests",
              data: null,
              error: { code: "RATE_LIMITED" },
              requestId: "",
            },
            { status: 429 }
          ),
          corsOrigin,
          pathname
        );
      }
      entry.count++;
    } else {
      RATE_LIMIT.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
    }
  }

  // --- Security headers (on ALL responses) ---
  const response = applySecurityHeaders(NextResponse.next(), corsOrigin, pathname);

  // --- Authentication & Role Guard for Protected UI Paths ---
  const jwtSecret = resolveMiddlewareJwtSecret();

  if (isProtectedDashboardPath(pathname)) {
    const token = jwtSecret
      ? await getToken({
          req: request,
          secret: jwtSecret,
        })
      : null;

    if (!token) {
      const loginUrl = new URL("/login", request.url);
      loginUrl.searchParams.set("callbackUrl", pathname);
      return applySecurityHeaders(NextResponse.redirect(loginUrl), corsOrigin, pathname);
    }

    const userRole = (token.role as string | undefined) || "CLIENT";
    const access = canAccessRoute(pathname, userRole);

    if (!access.allowed && access.reason === "forbidden") {
      const fallbackUrl = new URL("/dashboard", request.url);
      fallbackUrl.searchParams.set("error", "forbidden");
      return applySecurityHeaders(NextResponse.redirect(fallbackUrl), corsOrigin, pathname);
    }

    response.headers.set("x-user-role", userRole);
  }

  // --- API Authentication & Admin Guard ---
  if (
    pathname.startsWith("/api/") &&
    !PUBLIC_API_PATHS.some((p) => pathname.startsWith(p)) &&
    !HMAC_AUTHENTICATED_API_PATHS.some((p) => pathname.startsWith(p))
  ) {
    if (!jwtSecret) {
      return applySecurityHeaders(
        NextResponse.json(
          {
            status: 503,
            success: false,
            message: "Authentication subsystem misconfigured",
            data: null,
            error: { code: "AUTH_MISCONFIGURED" },
            requestId: "",
          },
          { status: 503 }
        ),
        corsOrigin,
        pathname
      );
    }

    const token = await getToken({
      req: request,
      secret: jwtSecret,
    });

    if (!token) {
      return applySecurityHeaders(
        NextResponse.json(
          {
            status: 401,
            success: false,
            message: "Authentication required",
            data: null,
            error: { code: "UNAUTHORIZED" },
            requestId: "",
          },
          { status: 401 }
        ),
        corsOrigin,
        pathname
      );
    }

    const userRole = (token.role as string | undefined) || "CLIENT";
    const needsAdmin =
      ADMIN_API_PREFIXES.some((p) => pathname.startsWith(p)) ||
      (request.method !== "GET" && ADMIN_API_WRITE_PREFIXES.some((p) => pathname.startsWith(p)));
    if (needsAdmin && !ADMIN_ROLES.has(userRole)) {
      return applySecurityHeaders(
        NextResponse.json(
          {
            status: 403,
            success: false,
            message: "Administrator role required",
            data: null,
            error: { code: "FORBIDDEN" },
            requestId: "",
          },
          { status: 403 }
        ),
        corsOrigin,
        pathname
      );
    }

    if (request.method === "POST" && pathname.startsWith("/api/ai/")) {
      const aiKey = `${String(token.sub || ip)}:ai`;
      const aiEntry = AI_RATE_LIMIT.get(aiKey);
      if (aiEntry && now < aiEntry.resetAt) {
        if (aiEntry.count >= AI_RATE_MAX) {
          return applySecurityHeaders(
            NextResponse.json(
              {
                status: 429,
                success: false,
                message: "AI request rate limit exceeded. Please wait before retrying.",
                data: null,
                error: { code: "RATE_LIMITED" },
                requestId: "",
              },
              { status: 429 }
            ),
            corsOrigin,
            pathname
          );
        }
        aiEntry.count++;
      } else {
        AI_RATE_LIMIT.set(aiKey, { count: 1, resetAt: now + AI_RATE_WINDOW_MS });
      }
    }
  }

  // --- CSRF protection for authenticated browser mutations ---
  // Placed last on purpose: rate limiting, the session guard and the role guard
  // each return their own precise status first (429 / 401 / 403), so this check
  // only ever sees a request that is already allowed to be here.
  //
  // The Origin comparison above remains as defence in depth, but it cannot be
  // the whole control: it only fires when an Origin header is present, and a
  // cross-site request can be made without one. The token below is what actually
  // binds a mutation to code running on this origin.
  if (
    pathname.startsWith("/api/") &&
    request.method !== "GET" &&
    request.method !== "HEAD" &&
    request.method !== "OPTIONS" &&
    // Non-browser credentials: per-agent HMAC, or INTERNAL_SECRET for the worker
    // tick. Neither uses cookies, so neither is CSRF-able, and each route
    // re-verifies its own credential.
    !HMAC_AUTHENTICATED_API_PATHS.some((p) => pathname.startsWith(p)) &&
    // CSRF is an attack on ambient session authority. With no session cookie
    // there is none to abuse, so pre-authentication flows (login, signup, email
    // verification, MFA challenge, NextAuth's own callback) are not required to
    // carry a token; they are rate-limited more strictly instead.
    hasSessionCookie(request.cookies.getAll().map((c) => c.name))
  ) {
    const decision = await validateCsrf(request.cookies.get(CSRF_COOKIE_NAME)?.value, request.headers.get(CSRF_HEADER_NAME));
    if (!decision.ok) {
      return applySecurityHeaders(
        NextResponse.json(
          {
            status: 403,
            success: false,
            message: "CSRF validation failed. Reload the page and try again.",
            data: null,
            error: { code: "CSRF_INVALID", details: { reason: decision.reason } },
            requestId: "",
          },
          { status: 403 }
        ),
        corsOrigin,
        pathname
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
    "/deployments/:path*",
    "/infrastructure/:path*",
    "/api/:path*",
  ],
};
