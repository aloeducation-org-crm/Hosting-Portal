/**
 * CSRF protection for authenticated browser mutations.
 *
 * The middleware previously rejected a mismatched `Origin` header **only when
 * the header was present**, so an Origin-less cross-site request walked straight
 * through, and same-origin checking alone is not sufficient CSRF protection.
 * These tests cover the replacement control end to end: a signed double-submit
 * cookie that must be echoed in a header, enforced after the session and role
 * guards so their own status codes still win.
 *
 * Also covered: the pre-authentication flows that must keep working without a
 * token, the non-browser credential paths that must stay exempt, and the
 * `/api/csrf` issuing route (which must not be httpOnly and must not echo the
 * token in its body).
 */
import { teardownIsolatedDb } from "./helpers/isolated-db";
import { afterAll, afterEach, describe, expect, it, beforeAll } from "vitest";
import { NextRequest } from "next/server";
import { encode } from "next-auth/jwt";
import {
  CSRF_COOKIE_NAME,
  CSRF_HEADER_NAME,
  csrfCookieAttributes,
  hasSessionCookie,
  issueCsrfToken,
  validateCsrf,
} from "@/lib/security/csrf";
import * as browserNames from "@/lib/security/csrf.browser";

const TEST_JWT_SECRET = "j".repeat(64);
const SESSION_COOKIE = "next-auth.session-token";

let middleware: typeof import("@/middleware").middleware;

// Set at module scope as well as in beforeAll: `src/lib/security/csrf.ts` reads
// the secret on each call, but the isolated-database helper and the middleware
// import both happen during module evaluation.
process.env.NEXTAUTH_SECRET = process.env.NEXTAUTH_SECRET || TEST_JWT_SECRET;
process.env.JWT_SECRET = process.env.JWT_SECRET || TEST_JWT_SECRET;
process.env.APP_ENCRYPTION_KEY = process.env.APP_ENCRYPTION_KEY || "a".repeat(64);

beforeAll(async () => {
  process.env.NEXTAUTH_SECRET = TEST_JWT_SECRET;
  process.env.JWT_SECRET = TEST_JWT_SECRET;
  process.env.APP_ENCRYPTION_KEY = "a".repeat(64);
  middleware = (await import("@/middleware")).middleware;
});

afterEach(() => {
  process.env.NEXTAUTH_SECRET = TEST_JWT_SECRET;
  process.env.JWT_SECRET = TEST_JWT_SECRET;
  process.env.APP_ENCRYPTION_KEY = "a".repeat(64);
});

async function sessionValue(user = { id: "u-1", email: "client@example.com", role: "CLIENT" }) {
  return await encode({ secret: TEST_JWT_SECRET, token: { id: user.id, sub: user.id, email: user.email, role: user.role } });
}

interface ReqOpts {
  method?: string;
  session?: string | null;
  csrfCookie?: string | null;
  csrfHeader?: string | null;
  origin?: string | null;
  headers?: Record<string, string>;
  body?: string;
}

function makeRequest(url: string, opts: ReqOpts = {}): NextRequest {
  const headers = new Headers(opts.headers);
  const cookies: string[] = [];
  // A session cookie is only attached when a real token value is supplied, so a
  // test cannot accidentally exercise the session guard instead of CSRF.
  if (opts.session) cookies.push(`${SESSION_COOKIE}=${opts.session}`);
  if (opts.csrfCookie) cookies.push(`${CSRF_COOKIE_NAME}=${opts.csrfCookie}`);
  if (cookies.length) headers.set("cookie", cookies.join("; "));
  if (opts.csrfHeader) headers.set(CSRF_HEADER_NAME, opts.csrfHeader);
  if (opts.origin) headers.set("origin", opts.origin);
  headers.set("host", new URL(url).host); // a browser always sends Host
  headers.set("x-real-ip", "198.51.100.7");
  if (opts.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  return new NextRequest(url, { method: opts.method ?? "POST", headers, body: opts.body });
}

/** A valid session cookie plus a matching CSRF cookie/header pair. */
async function authedWithToken(url: string, init: Omit<ReqOpts, "session" | "csrfCookie" | "csrfHeader"> = {}) {
  const issued = await issueCsrfToken();
  expect(issued).not.toBeNull();
  return makeRequest(url, {
    ...init,
    session: await sessionValue(),
    csrfCookie: issued!.cookieValue,
    csrfHeader: issued!.token,
  });
}

/** A valid session cookie and nothing else — the "no CSRF token" case. */
async function authedNoToken(url: string, init: Omit<ReqOpts, "session"> = {}) {
  return makeRequest(url, { ...init, session: await sessionValue() });
}

// ─── The primitive itself ────────────────────────────────────────────────────

describe("CSRF token issuing and validation", () => {
  it("issues a random token bound to an HMAC-signed cookie value", async () => {
    const a = await issueCsrfToken();
    const b = await issueCsrfToken();
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(a!.token).toMatch(/^[a-f0-9]{64}$/);
    expect(a!.cookieValue.startsWith(`${a!.token}.`)).toBe(true);
    expect(a!.cookieValue.split(".")[1]).toMatch(/^[a-f0-9]{64}$/);
    expect(a!.token).not.toBe(b!.token); // never reused
    expect((await validateCsrf(a!.cookieValue, a!.token)).ok).toBe(true);
  });

  it("rejects every malformed or forged combination with a specific reason", async () => {
    const good = (await issueCsrfToken())!;
    const otherSignature = (await issueCsrfToken())!.cookieValue.split(".")[1]!;
    const otherToken = (await issueCsrfToken())!.token;
    const cases: Array<[string | null | undefined, string | null | undefined, string]> = [
      [null, good.token, "missing-cookie"],
      [undefined, good.token, "missing-cookie"],
      [good.cookieValue, null, "missing-header"],
      [good.cookieValue, undefined, "missing-header"],
      ["nodothere", good.token, "malformed-cookie"],
      ["zzz.zzz", good.token, "malformed-cookie"],
      [`${"0".repeat(64)}.${"0".repeat(64)}`, "0".repeat(64), "bad-signature"],
      // A real token paired with somebody else's signature.
      [`${good.token}.${otherSignature}`, good.token, "bad-signature"],
      // A correctly signed cookie, but the header carries a different token.
      [good.cookieValue, otherToken, "mismatch"],
    ];
    for (const [cookie, header, reason] of cases) {
      const decision = await validateCsrf(cookie, header);
      expect(decision.ok, `cookie=${String(cookie)?.slice(0, 12)}… header=${String(header)?.slice(0, 12)}…`).toBe(false);
      expect(decision.reason).toBe(reason);
    }
  });

  it("fails closed when no usable server secret is configured", async () => {
    const saved = { ...process.env };
    try {
      delete process.env.CSRF_SECRET;
      delete process.env.APP_ENCRYPTION_KEY;
      process.env.NEXTAUTH_SECRET = "short";
      expect(await issueCsrfToken()).toBeNull();
      expect((await validateCsrf(`${"a".repeat(64)}.${"b".repeat(64)}`, "a".repeat(64))).ok).toBe(false);
    } finally {
      process.env = saved;
    }
  });

  it("issues a cookie that JavaScript can read, because that is what makes double-submit work", () => {
    const attrs = csrfCookieAttributes(true);
    expect(attrs.httpOnly).toBe(false);
    expect(attrs.sameSite).toBe("lax");
    expect(attrs.secure).toBe(true);
    expect(attrs.path).toBe("/");
    expect(attrs.maxAge).toBeGreaterThan(0);
    expect(csrfCookieAttributes(false).secure).toBe(false);
  });

  it("recognises the NextAuth session cookie in development and secure form", () => {
    expect(hasSessionCookie([SESSION_COOKIE])).toBe(true);
    expect(hasSessionCookie(["__Secure-next-auth.session-token"])).toBe(true);
    expect(hasSessionCookie(["other", "next-auth.session-token"])).toBe(true);
    expect(hasSessionCookie([CSRF_COOKIE_NAME, "alo-theme"])).toBe(false);
    expect(hasSessionCookie([])).toBe(false);
  });

  it("keeps the browser-safe constants identical to the server ones", () => {
    expect(browserNames.CSRF_COOKIE_NAME).toBe(CSRF_COOKIE_NAME);
    expect(browserNames.CSRF_HEADER_NAME).toBe(CSRF_HEADER_NAME);
  });
});

// ─── Enforcement in the middleware ───────────────────────────────────────────

describe("CSRF enforcement on authenticated API mutations", () => {
  it("rejects an authenticated mutation that carries no CSRF token at all", async () => {
    const res = await middleware(
      await authedNoToken("http://localhost:3000/api/websites"),
    );
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("CSRF_INVALID");
    // Cookie is checked before header: a cross-site request carries neither.
    expect(body.error.details.reason).toBe("missing-cookie");
  });

  it("rejects an authenticated mutation with the cookie but no header (a cross-site form cannot set headers)", async () => {
    const issued = (await issueCsrfToken())!;
    const res = await middleware(
      makeRequest("http://localhost:3000/api/websites", {
        session: await sessionValue(),
        csrfCookie: issued.cookieValue,
      }),
    );
    expect(res.status).toBe(403);
    expect((await res.json()).error.details.reason).toBe("missing-header");
  });

  it("rejects an authenticated mutation with the header but no cookie", async () => {
    const issued = (await issueCsrfToken())!;
    const res = await middleware(
      makeRequest("http://localhost:3000/api/websites", {
        session: await sessionValue(),
        csrfCookie: null,
        csrfHeader: issued.token,
      }),
    );
    expect(res.status).toBe(403);
    expect((await res.json()).error.details.reason).toBe("missing-cookie");
  });

  it("rejects a token whose cookie signature was forged, even though header and cookie agree", async () => {
    const issued = (await issueCsrfToken())!;
    const forged = `${issued.token}.${"f".repeat(64)}`;
    const res = await middleware(
      makeRequest("http://localhost:3000/api/websites", {
        session: await sessionValue(),
        csrfCookie: forged,
        csrfHeader: issued.token,
      }),
    );
    expect(res.status).toBe(403);
    expect((await res.json()).error.details.reason).toBe("bad-signature");
  });

  it("rejects a replayed token paired with a different cookie value", async () => {
    const stolen = (await issueCsrfToken())!;
    const res = await middleware(
      makeRequest("http://localhost:3000/api/websites", {
        session: await sessionValue(),
        csrfCookie: (await issueCsrfToken())!.cookieValue,
        csrfHeader: stolen.token,
      }),
    );
    expect(res.status).toBe(403);
    expect((await res.json()).error.details.reason).toBe("mismatch");
  });

  it("accepts an authenticated mutation carrying a valid token pair, with or without an Origin header", async () => {
    for (const origin of [null, "http://localhost:3000"]) {
      const res = await middleware(await authedWithToken("http://localhost:3000/api/websites", { origin }));
      expect(res.status, `origin=${origin}`).not.toBe(403);
    }
  });

  it("still rejects a cross-site Origin even when a valid token is presented", async () => {
    const res = await middleware(await authedWithToken("http://localhost:3000/api/websites", { origin: "https://evil.example" }));
    expect(res.status).toBe(403);
    expect((await res.json()).message).toContain("Origin not allowed");
  });

  it("covers every unsafe method, not only POST", async () => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      const res = await middleware(
        await authedNoToken("http://localhost:3000/api/websites", { method }),
      );
      expect(res.status, method).toBe(403);
      expect((await res.json()).error.code).toBe("CSRF_INVALID");
    }
  });

  it("does not require a token for safe methods", async () => {
    const res = await middleware(await authedNoToken("http://localhost:3000/api/websites", { method: "GET" }));
    expect(res.status).not.toBe(403);
  });

  it("keeps the admin role guard in front of CSRF on admin-only reads", async () => {
    const res = await middleware(
      await authedNoToken("http://localhost:3000/api/orchestrator/status", { method: "GET" }),
    );
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("FORBIDDEN");
  });

  it("leaves the session guard's 401 and the role guard's 403 in front of the CSRF check", async () => {
    // No session cookie at all: the session guard answers, not CSRF.
    const anonymous = await middleware(makeRequest("http://localhost:3000/api/websites", { session: null }));
    expect(anonymous.status).toBe(401);

    // A signed-in CLIENT hitting an admin-only write: the role guard answers.
    const client = await middleware(
      makeRequest("http://localhost:3000/api/users", { session: await sessionValue({ id: "u-2", role: "CLIENT" }) }),
    );
    expect(client.status).toBe(403);
    expect((await client.json()).error.code).toBe("FORBIDDEN");

    // An admin without a CSRF token is stopped by CSRF.
    const admin = await middleware(
      makeRequest("http://localhost:3000/api/users", {
        session: await sessionValue({ id: "u-3", email: "admin@example.com", role: "ADMIN" }),
      }),
    );
    expect(admin.status).toBe(403);
    expect((await admin.json()).error.code).toBe("CSRF_INVALID");
  });
});

describe("paths that must stay exempt from browser CSRF control", () => {
  it("does not require a token before authentication, where there is no session authority to abuse", async () => {
    for (const path of ["/api/auth/login", "/api/auth/signup", "/api/auth/mfa-challenge", "/api/contact"]) {
      const res = await middleware(makeRequest(`http://localhost:3000${path}`, { session: null }));
      expect(res.status, path).not.toBe(403);
    }
  });

  it("still rate-limits the pre-authentication paths strictly", async () => {
    let last = 0;
    for (let i = 0; i < 12; i++) {
      const res = await middleware(makeRequest("http://localhost:3000/api/auth/login", { session: null, headers: { "x-real-ip": "203.0.113.9" } }));
      last = res.status;
    }
    expect(last).toBe(429);
  });

  it("does not require a token from the HMAC agent endpoints or the internal worker tick", async () => {
    for (const path of ["/api/agents/heartbeat", "/api/agents/tasks/claim", "/api/agents/tasks/result", "/api/orchestrator/run"]) {
      const res = await middleware(
        makeRequest(`http://localhost:3000${path}`, {
          session: await sessionValue(),
          headers: { "x-alo-agent-key": "alo_agt_x", "x-alo-signature": "s", "x-alo-timestamp": "1", "x-alo-nonce": "n" },
        }),
      );
      // Reaches the route (which then rejects the bad credential) instead of
      // being stopped by the browser CSRF control.
      expect(res.status, path).not.toBe(403);
    }
  });

  it("does not apply the browser control to non-API paths", async () => {
    const res = await middleware(await authedNoToken("http://localhost:3000/dashboard", { method: "POST" }));
    const body = (await res.clone().json().catch(() => ({}))) as { error?: { code?: string } };
    expect(body.error?.code).not.toBe("CSRF_INVALID");
  });
});

// ─── The issuing route ───────────────────────────────────────────────────────

describe("GET /api/csrf", () => {
  it("sets a readable, SameSite=Lax cookie and never echoes the token in the body", async () => {
    const route = await import("@/app/api/csrf/route");
    const res = await route.GET(new NextRequest("https://panel.example.com/api/csrf"));
    expect(res.status).toBe(200);

    const setCookie = res.headers.getSetCookie().find((c) => c.startsWith(`${CSRF_COOKIE_NAME}=`));
    expect(setCookie).toBeDefined();
    expect(setCookie!.toLowerCase()).toContain("samesite=lax");
    expect(setCookie!.toLowerCase()).not.toContain("httponly");
    expect(setCookie).toContain("Secure"); // requested over https
    expect(setCookie).toContain("Path=/");

    const body = await res.text();
    const cookieValue = setCookie!.split(";")[0].slice(`${CSRF_COOKIE_NAME}=`.length);
    expect(cookieValue.split(".")).toHaveLength(2);
    expect(body).not.toContain(cookieValue.split(".")[0]); // the token itself is not rendered
    expect((await validateCsrf(decodeURIComponent(cookieValue), cookieValue.split(".")[0])).ok).toBe(true);
  });

  it("fails closed with 503 when no server secret is configured", async () => {
    const saved = { ...process.env };
    try {
      delete process.env.CSRF_SECRET;
      delete process.env.APP_ENCRYPTION_KEY;
      process.env.NEXTAUTH_SECRET = "short";
      const route = await import("@/app/api/csrf/route");
      const res = await route.GET(new NextRequest("http://localhost:3000/api/csrf"));
      expect(res.status).toBe(503);
      expect((await res.json()).error.code).toBe("CSRF_UNCONFIGURED");
    } finally {
      process.env = saved;
    }
  });

  it("is reachable through the middleware without a session", async () => {
    const res = await middleware(makeRequest("http://localhost:3000/api/csrf", { method: "GET" }));
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });
});

/** Delete this file's scratch database copy. */
afterAll(async () => {
  await teardownIsolatedDb();
});
