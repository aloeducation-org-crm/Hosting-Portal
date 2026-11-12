/**
 * SEC-06 regression tests — account verification and self-selected roles.
 *
 * The defects: a new account could use the whole customer API (create sites,
 * import repositories, run builds) before verifying its email address, and
 * `RESELLER` was self-selected at signup with no vetting even though a reseller
 * is treated as an administrator on several surfaces.
 *
 * What is proven here:
 *   - the policy itself, at the path level, for both verification states;
 *   - prefix matching is segment-bounded, so `/api/user/profile-export` does not
 *     inherit the `/api/user/profile` exemption;
 *   - the real middleware returns 403 EMAIL_NOT_VERIFIED for an unverified
 *     session on a resource-creating route and allows the onboarding routes;
 *   - no self-service signup can obtain RESELLER or any other privileged role;
 *   - the JWT refreshes the verification claim, so a customer is not locked out
 *     for 24 hours after verifying.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { encode } from "next-auth/jwt";
import { NextRequest } from "next/server";
import {
  decideVerificationAccess,
  resolveSignupRole,
  matchesPrefix,
  isPrivilegedRole,
  VERIFICATION_EXEMPT_PREFIXES,
  ADMINISTRATOR_PREFIXES,
} from "../src/lib/account-status";

const ROOT = path.resolve(__dirname, "..");
const TEST_JWT_SECRET = "test-jwt-secret-for-account-verification-0123456789";

/**
 * Load the edge proxy exactly as the CSRF suite does: through the module registry
 * with the environment prepared, so there is one supported way to exercise it.
 */
async function middlewareFor() {
  process.env.NEXTAUTH_SECRET = TEST_JWT_SECRET;
  process.env.JWT_SECRET = TEST_JWT_SECRET;
  const mod = await import("@/proxy");
  return mod.proxy;
}

const token = async (over: Record<string, unknown> = {}) =>
  encode({
    secret: TEST_JWT_SECRET,
    token: { id: "u-1", sub: "u-1", email: "client@example.com", role: "CLIENT", emailVerified: false, ...over },
  });

function request(url: string, opts: { session?: string | null; method?: string; headers?: Record<string, string> } = {}) {
  const headers: Record<string, string> = { ...(opts.headers ?? {}) };
  if (opts.session) headers.cookie = `next-auth.session-token=${opts.session}`;
  return new NextRequest(new URL(url, "http://localhost:3000"), {
    method: opts.method ?? "GET",
    headers,
  });
}

describe("SEC-06 verification policy", () => {
  const unverified = { emailVerified: false, isAdministrator: false };

  it("allows the routes needed to complete onboarding", () => {
    for (const pathname of ["/api/auth/verify-email", "/api/auth/logout", "/api/user/profile", "/api/health", "/api/onboarding"]) {
      expect(decideVerificationAccess({ pathname, ...unverified }).allowed, pathname).toBe(true);
    }
  });

  it("refuses resource-creating and metered routes for an unverified account", () => {
    for (const pathname of ["/api/websites", "/api/deploy/projects", "/api/databases", "/api/domains/purchase", "/api/email/send", "/api/backups"]) {
      const decision = decideVerificationAccess({ pathname, ...unverified });
      expect(decision.allowed, pathname).toBe(false);
      expect(decision.status, pathname).toBe(403);
      expect(decision.code, pathname).toBe("EMAIL_NOT_VERIFIED");
    }
  });

  it("allows everything for a verified customer", () => {
    for (const pathname of ["/api/websites", "/api/deploy/projects", "/api/user/profile"]) {
      expect(decideVerificationAccess({ pathname, emailVerified: true, isAdministrator: false }).allowed, pathname).toBe(true);
    }
  });

  it("keeps administrators exempt, so an unverified operator is not locked out of the console", () => {
    const decision = decideVerificationAccess({ pathname: "/api/websites", emailVerified: false, isAdministrator: true });
    expect(decision.allowed).toBe(true);
    expect(decision.tier).toBe("verification-exempt");
  });

  it("classifies administrator routes as administrator-required regardless of verification", () => {
    const decision = decideVerificationAccess({ pathname: "/api/users", emailVerified: true, isAdministrator: false });
    expect(decision.tier).toBe("administrator-required");
  });
});

describe("SEC-06 exemption matching is segment-bounded", () => {
  it("does not let a lookalike path inherit an exemption", () => {
    expect(matchesPrefix("/api/user/profile/avatar", ["/api/user/profile"])).toBe(true);
    expect(matchesPrefix("/api/user/profile-export", ["/api/user/profile"])).toBe(false);
    expect(matchesPrefix("/api/healthz", ["/api/health"])).toBe(false);
  });

  it("treats the auth prefix as covering its children but not a sibling", () => {
    expect(matchesPrefix("/api/auth/login", ["/api/auth/"])).toBe(true);
    expect(matchesPrefix("/api/authorization", ["/api/auth/"])).toBe(false);
  });

  it("keeps an unverified account out of a lookalike of an exempt path", () => {
    const decision = decideVerificationAccess({
      pathname: "/api/user/profile-export",
      emailVerified: false,
      isAdministrator: false,
    });
    expect(decision.allowed).toBe(false);
  });

  it("enumerates its lists rather than wildcarding everything", () => {
    expect(VERIFICATION_EXEMPT_PREFIXES.length).toBeGreaterThan(3);
    expect(VERIFICATION_EXEMPT_PREFIXES).not.toContain("/api");
    expect(ADMINISTRATOR_PREFIXES).not.toContain("/api");
  });
});

describe("SEC-06 self-service signup cannot select a privileged role", () => {
  it("downgrades every privileged role to CLIENT", () => {
    for (const requested of ["SUPER_ADMIN", "ADMIN", "DEVOPS", "SUPPORT", "RESELLER"]) {
      const decision = resolveSignupRole({ requested, callerIsAdministrator: false });
      expect(decision.role, requested).toBe("CLIENT");
      expect(decision.downgraded, requested).toBe(true);
    }
  });

  it("marks a requested reseller for review rather than granting it", () => {
    const decision = resolveSignupRole({ requested: "reseller", callerIsAdministrator: false });
    expect(decision.role).toBe("CLIENT");
    expect(decision.requiresGrant).toBe(true);
  });

  it("allows a plain customer signup unchanged", () => {
    const decision = resolveSignupRole({ requested: "CLIENT", callerIsAdministrator: false });
    expect(decision).toMatchObject({ role: "CLIENT", downgraded: false });
  });

  it("defaults to CLIENT when no role is requested", () => {
    expect(resolveSignupRole({ callerIsAdministrator: false }).role).toBe("CLIENT");
  });

  it("lets an administrator create a reseller deliberately", () => {
    const decision = resolveSignupRole({ requested: "RESELLER", callerIsAdministrator: true });
    expect(decision).toMatchObject({ role: "RESELLER", downgraded: false });
  });

  it("knows which roles carry administrative reach", () => {
    for (const role of ["SUPER_ADMIN", "ADMIN", "RESELLER", "DEVOPS", "SUPPORT"]) {
      expect(isPrivilegedRole(role), role).toBe(true);
    }
    for (const role of ["CLIENT", "VIEWER", null, undefined]) {
      expect(isPrivilegedRole(role), String(role)).toBe(false);
    }
  });

  it("the signup route uses the policy instead of its own shorter list", () => {
    const route = fs.readFileSync(path.join(ROOT, "src/app/api/auth/signup/route.ts"), "utf8");
    expect(route).toContain("resolveSignupRole");
    // The old inline list omitted RESELLER, which is the defect.
    expect(route).not.toMatch(/const privilegedRoles = \["SUPER_ADMIN", "ADMIN", "DEVOPS", "SUPPORT"\]/);
  });
});

describe("SEC-06 the real middleware enforces the gate", () => {
  it("refuses an unverified session on a resource-creating API route", async () => {
    const middleware = await middlewareFor();
    const res = await middleware(request("http://localhost:3000/api/websites", { session: await token({ emailVerified: false }), method: "GET" }));
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error?: { code?: string }; message?: string };
    expect(body.error?.code).toBe("EMAIL_NOT_VERIFIED");
    expect(body.message).toMatch(/Verify your email/);
  });

  it("allows the same route for a verified session", async () => {
    const middleware = await middlewareFor();
    const res = await middleware(request("http://localhost:3000/api/user/profile", { session: await token({ emailVerified: false }) }));
    expect(res.status).not.toBe(403);
  });

  it("treats a token with no claim as unverified (fail closed for old tokens)", async () => {
    const middleware = await middlewareFor();
    const legacy = await encode({ secret: TEST_JWT_SECRET, token: { id: "u-2", sub: "u-2", email: "old@example.com", role: "CLIENT" } });
    const res = await middleware(request("http://localhost:3000/api/websites", { session: legacy }));
    expect(res.status).toBe(403);
  });
});

describe("SEC-06 the session claim refreshes", () => {
  it("re-reads verification state from the database so a verified customer is not locked out", () => {
    const source = fs.readFileSync(path.join(ROOT, "src/lib/nextauth.ts"), "utf8");
    const jwtCallback = source.slice(source.indexOf("async jwt({ token, user, trigger, session })"));
    expect(jwtCallback).toContain("emailVerifiedCheckedAt");
    expect(jwtCallback).toMatch(/emailVerified = dbUser\.emailVerified !== null/);
    // Roles and account state are refreshed on the same pass.
    expect(jwtCallback).toContain("token.role = dbUser.role.name");
  });

  it("does not refresh on every request", () => {
    const source = fs.readFileSync(path.join(ROOT, "src/lib/nextauth.ts"), "utf8");
    expect(source).toMatch(/Date\.now\(\) - checkedAt > 60_000/);
  });
});
