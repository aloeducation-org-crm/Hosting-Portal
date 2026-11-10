import { afterEach, describe, expect, it } from "vitest";
import {
  sessionCookieName,
  sessionCookieOptions,
  secureSessionCookiesEnabled,
} from "@/lib/session-cookie";

/**
 * Regression guard for the production HTTPS login breakage: the custom login
 * and signup routes used to set a plain `next-auth.session-token` while every
 * server-side reader (`src/proxy.ts`, `getServerSession`, `requireSession`)
 * derived the cookie name from the HTTPS scheme and expected
 * `__Secure-next-auth.session-token`. Login returned 200 but no protected
 * page or API would ever accept the cookie.
 */
const ORIGINAL_NEXTAUTH_URL = process.env.NEXTAUTH_URL;

afterEach(() => {
  if (ORIGINAL_NEXTAUTH_URL === undefined) {
    delete process.env.NEXTAUTH_URL;
  } else {
    process.env.NEXTAUTH_URL = ORIGINAL_NEXTAUTH_URL;
  }
});

describe("session cookie convention", () => {
  it("uses the plain cookie in plain-HTTP development", () => {
    process.env.NEXTAUTH_URL = "http://localhost:3101";
    expect(secureSessionCookiesEnabled()).toBe(false);
    expect(sessionCookieName()).toBe("next-auth.session-token");
    expect(sessionCookieOptions()).toMatchObject({ secure: false, httpOnly: true, path: "/" });
  });

  it("uses the __Secure- cookie on HTTPS deployments (real hosting provider)", () => {
    process.env.NEXTAUTH_URL = "https://hosting.alolabs.net";
    expect(secureSessionCookiesEnabled()).toBe(true);
    expect(sessionCookieName()).toBe("__Secure-next-auth.session-token");
    const options = sessionCookieOptions();
    expect(options).toMatchObject({ secure: true, httpOnly: true, path: "/", sameSite: "lax" });
  });

  it("treats any non-HTTPS scheme (including loopback http) as plain", () => {
    process.env.NEXTAUTH_URL = "http://127.0.0.1:3051";
    expect(sessionCookieName()).toBe("next-auth.session-token");
  });
});
