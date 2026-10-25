import { describe, expect, it } from "vitest";
import {
  ROLES,
  ROLE_HIERARCHY,
  isAdminRole,
  isResellerRole,
  isClientRole,
} from "../src/lib/auth";
import {
  encryptSecret,
  decryptSecret,
  isEncryptedSecret,
} from "../src/lib/encryption";
import { checkRateLimit } from "../src/lib/rate-limit";
import {
  isAdminPath,
  isProtectedDashboardPath,
  canAccessRoute,
} from "../src/middleware";

describe("Phase 1: RBAC & Role Hierarchy", () => {
  it("defines ADMIN, RESELLER, CLIENT and enterprise roles with expected hierarchy", () => {
    expect(ROLE_HIERARCHY[ROLES.SUPER_ADMIN]).toBeGreaterThan(
      ROLE_HIERARCHY[ROLES.ADMIN]
    );
    expect(ROLE_HIERARCHY[ROLES.ADMIN]).toBeGreaterThan(
      ROLE_HIERARCHY[ROLES.RESELLER]
    );
    expect(ROLE_HIERARCHY[ROLES.RESELLER]).toBeGreaterThan(
      ROLE_HIERARCHY[ROLES.CLIENT]
    );
  });

  it("correctly identifies admin, reseller, and client roles", () => {
    expect(isAdminRole("SUPER_ADMIN")).toBe(true);
    expect(isAdminRole("ADMIN")).toBe(true);
    expect(isAdminRole("RESELLER")).toBe(false);
    expect(isAdminRole("CLIENT")).toBe(false);

    expect(isResellerRole("RESELLER")).toBe(true);
    expect(isResellerRole("ADMIN")).toBe(true);
    expect(isResellerRole("CLIENT")).toBe(false);

    expect(isClientRole("CLIENT")).toBe(true);
    expect(isClientRole("ADMIN")).toBe(false);
  });
});

describe("Phase 1: Middleware Route Access Control", () => {
  it("identifies admin-only paths accurately", () => {
    expect(isAdminPath("/users")).toBe(true);
    expect(isAdminPath("/servers")).toBe(true);
    expect(isAdminPath("/plans")).toBe(true);
    expect(isAdminPath("/audit")).toBe(true);
    expect(isAdminPath("/dashboard/users")).toBe(true);
    expect(isAdminPath("/dashboard/servers")).toBe(true);
    expect(isAdminPath("/dashboard/websites")).toBe(false);
    expect(isAdminPath("/sites")).toBe(false);
  });

  it("identifies protected dashboard paths accurately", () => {
    expect(isProtectedDashboardPath("/dashboard")).toBe(true);
    expect(isProtectedDashboardPath("/onboarding")).toBe(true);
    expect(isProtectedDashboardPath("/sites")).toBe(true);
    expect(isProtectedDashboardPath("/users")).toBe(true);
    expect(isProtectedDashboardPath("/login")).toBe(false);
    expect(isProtectedDashboardPath("/register")).toBe(false);
  });

  it("enforces Admin vs Client access rules", () => {
    expect(canAccessRoute("/users", "ADMIN")).toEqual({ allowed: true });
    expect(canAccessRoute("/servers", "SUPER_ADMIN")).toEqual({ allowed: true });

    const clientAttempt = canAccessRoute("/users", "CLIENT");
    expect(clientAttempt.allowed).toBe(false);
    expect(clientAttempt.reason).toBe("forbidden");

    const unauthAttempt = canAccessRoute("/dashboard", null);
    expect(unauthAttempt.allowed).toBe(false);
    expect(unauthAttempt.reason).toBe("unauthenticated");
  });
});

describe("Phase 1: AES-256-GCM Secret Encryption", () => {
  it("encrypts and decrypts secrets symmetrically", () => {
    const plain = "postgres://alo_admin:super-secret-password@127.0.0.1:5432/db";
    const encrypted = encryptSecret(plain);
    expect(encrypted).not.toBe(plain);
    expect(isEncryptedSecret(encrypted)).toBe(true);

    const decrypted = decryptSecret(encrypted);
    expect(decrypted).toBe(plain);
  });
});

describe("Phase 1: Rate Limiter", () => {
  it("allows requests within window and blocks when limit is exceeded", () => {
    const key = `test-rate-limit-${Date.now()}`;
    const first = checkRateLimit(key, { maxRequests: 2, windowMs: 10_000 });
    const second = checkRateLimit(key, { maxRequests: 2, windowMs: 10_000 });
    const third = checkRateLimit(key, { maxRequests: 2, windowMs: 10_000 });

    expect(first.allowed).toBe(true);
    expect(second.allowed).toBe(true);
    expect(third.allowed).toBe(false);
  });
});
