import { env } from "@/lib/env";

/**
 * Single source of truth for the NextAuth session cookie, so the custom
 * credentials login/signup routes, the edge gate (`src/proxy.ts` via
 * `getToken`), `getServerSession` (AuthHandler) and `requireSession` all
 * agree on the cookie name and flags.
 *
 * next-auth v4 chooses the cookie name from whether the deployment is served
 * over HTTPS: `secureCookie = NEXTAUTH_URL.startsWith("https://")` (unless
 * overridden). Without an explicit override, the custom routes used to set a
 * plain `next-auth.session-token` while every server-side reader expected
 * `__Secure-next-auth.session-token` in production — login returned 200 but
 * no session-gated page or API would ever accept the cookie. Deriving the
 * name and flags from the same rule here keeps the whole app consistent in
 * both plain-HTTP development and HTTPS production.
 */

const PLAIN_NAME = "next-auth.session-token";
const SECURE_NAME = "__Secure-next-auth.session-token";
const MAX_AGE_SECONDS = 86400; // 24h, matches session.maxAge and the custom JWTs

export function secureSessionCookiesEnabled(): boolean {
  const configured = process.env.NEXTAUTH_URL ?? env.NEXTAUTH_URL ?? "";
  return configured.startsWith("https://");
}

export function sessionCookieName(): string {
  return secureSessionCookiesEnabled() ? SECURE_NAME : PLAIN_NAME;
}

export function sessionCookieOptions(): {
  httpOnly: boolean;
  sameSite: "lax";
  path: string;
  maxAge: number;
  secure: boolean;
} {
  return {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: MAX_AGE_SECONDS,
    secure: secureSessionCookiesEnabled(),
  };
}
