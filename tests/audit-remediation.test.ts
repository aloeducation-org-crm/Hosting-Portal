import crypto from "node:crypto";
import { describe, it, expect, beforeEach } from "vitest";
import { Secret, TOTP } from "otpauth";
import {
  createMfaChallengeToken,
  verifyMfaChallengeToken,
  sealMfaSecret,
  openMfaSecret,
  verifyUserMfaCode,
  sanitizeCallbackUrl,
} from "@/lib/mfa-challenge";
import { hashPassword } from "@/lib/password";
import { verifyStripeWebhookSignature } from "@/lib/stripe";
import { isMachineAuthenticatedApiPath } from "@/proxy";
import {
  checkRateLimit,
  resetRateLimits,
  getRateLimitBucketCount,
  MAX_RATE_LIMIT_BUCKETS,
} from "@/lib/rate-limit";
import { websiteTenantWhere } from "@/lib/tenant";
import nextConfig from "../next.config";

describe("Audit Remediation — MFA challenge, sealing & open-redirect protection", () => {
  it("issues and verifies a signed MFA challenge token and rejects tampering/expiry", () => {
    const now = Date.now();
    const token = createMfaChallengeToken("user-123", "ops@alolabs.net", {
      now,
      ttlMs: 300_000,
      secret: "unit-test-mfa-secret-key-0123456789",
    });
    const parsed = verifyMfaChallengeToken(token, {
      now: now + 10_000,
      secret: "unit-test-mfa-secret-key-0123456789",
    });
    expect(parsed).not.toBeNull();
    expect(parsed?.userId).toBe("user-123");
    expect(parsed?.email).toBe("ops@alolabs.net");

    // Expired token must be rejected
    expect(
      verifyMfaChallengeToken(token, {
        now: now + 400_000,
        secret: "unit-test-mfa-secret-key-0123456789",
      }),
    ).toBeNull();

    // Tampered payload must be rejected
    const [ver, payload, sig] = token.split(".");
    expect(
      verifyMfaChallengeToken(`${ver}.${payload}x.${sig}`, {
        now: now + 10_000,
        secret: "unit-test-mfa-secret-key-0123456789",
      }),
    ).toBeNull();
    expect(verifyMfaChallengeToken("not-a-token")).toBeNull();
  });

  it("verifies TOTP codes against sealed (enc:v1:) secrets and consumes single-use hashed backup codes", async () => {
    const rawSecret = new Secret({ size: 20 }).base32;
    const sealed = sealMfaSecret(rawSecret);
    expect(sealed.startsWith("enc:v1:")).toBe(true);
    expect(openMfaSecret(sealed)).toBe(rawSecret);

    const totp = new TOTP({
      issuer: "ALO Labs Hosting",
      label: "ops@alolabs.net",
      algorithm: "SHA1",
      digits: 6,
      period: 30,
      secret: rawSecret,
    });
    const liveCode = totp.generate();

    const [h1, h2] = await Promise.all([hashPassword("AAAA-1111"), hashPassword("BBBB-2222")]);
    const backupCodesJson = JSON.stringify([h1, h2]);

    const totpCheck = await verifyUserMfaCode({
      storedSecret: sealed,
      email: "ops@alolabs.net",
      code: liveCode,
      backupCodesJson,
    });
    expect(totpCheck.valid).toBe(true);
    expect(totpCheck.method).toBe("totp");

    const backupCheck = await verifyUserMfaCode({
      storedSecret: sealed,
      email: "ops@alolabs.net",
      code: "AAAA-1111",
      backupCodesJson,
    });
    expect(backupCheck.valid).toBe(true);
    expect(backupCheck.method).toBe("backup_code");
    expect(backupCheck.remainingBackupCodesJson).toBeTruthy();

    // Reusing consumed backup code must fail
    const replayCheck = await verifyUserMfaCode({
      storedSecret: sealed,
      email: "ops@alolabs.net",
      code: "AAAA-1111",
      backupCodesJson: backupCheck.remainingBackupCodesJson,
    });
    expect(replayCheck.valid).toBe(false);
  });

  it("blocks external, protocol-relative, and scheme-injection callback URLs", () => {
    expect(sanitizeCallbackUrl("/dashboard/sites?tab=1")).toBe("/dashboard/sites?tab=1");
    expect(sanitizeCallbackUrl("https://evil.example/phish")).toBe("/dashboard");
    expect(sanitizeCallbackUrl("//evil.example/phish")).toBe("/dashboard");
    expect(sanitizeCallbackUrl("/\\evil.example")).toBe("/dashboard");
    expect(sanitizeCallbackUrl("javascript:alert(1)")).toBe("/dashboard");
    expect(sanitizeCallbackUrl(null)).toBe("/dashboard");
  });
});

describe("Audit Remediation — Stripe webhook signature verification", () => {
  const secret1 = "whsec_test_primary_secret_0123456789abcdef";
  const secret2 = "whsec_test_rotated_secret_fedcba9876543210";
  const payload = JSON.stringify({ id: "evt_123", type: "checkout.session.completed" });

  function sign(body: string, secret: string, ts: number): string {
    const mac = crypto.createHmac("sha256", secret).update(`${ts}.${body}`, "utf8").digest("hex");
    return `t=${ts},v1=${mac}`;
  }

  it("accepts valid signatures and supports secret rotation", () => {
    const now = Math.floor(Date.now() / 1000);
    expect(
      verifyStripeWebhookSignature(payload, sign(payload, secret1, now), [secret1, secret2], { nowSeconds: now }).ok,
    ).toBe(true);
    expect(
      verifyStripeWebhookSignature(payload, sign(payload, secret2, now), [secret1, secret2], { nowSeconds: now }).ok,
    ).toBe(true);
  });

  it("fails closed when secret is unset, signature is tampered, or timestamp is replayed", () => {
    const now = Math.floor(Date.now() / 1000);
    expect(verifyStripeWebhookSignature(payload, sign(payload, secret1, now), []).ok).toBe(false);
    expect(
      verifyStripeWebhookSignature(`${payload} `, sign(payload, secret1, now), [secret1], { nowSeconds: now }).ok,
    ).toBe(false);
    expect(
      verifyStripeWebhookSignature(payload, sign(payload, secret1, now - 600), [secret1], { nowSeconds: now }).reason,
    ).toBe("SIGNATURE_TIMESTAMP_OUT_OF_RANGE");
  });
});

describe("Audit Remediation — Proxy M2M routes, bounded rate limiter & storefront redirects", () => {
  beforeEach(() => {
    resetRateLimits();
  });

  it("recognizes HMAC/webhook machine-authenticated paths in src/proxy.ts", () => {
    expect(isMachineAuthenticatedApiPath("/api/agents/tasks/start")).toBe(true);
    expect(isMachineAuthenticatedApiPath("/api/cloud/workers/register")).toBe(true);
    expect(isMachineAuthenticatedApiPath("/api/cloud/workers/heartbeat")).toBe(true);
    expect(isMachineAuthenticatedApiPath("/api/internal/crm/sync")).toBe(true);
    expect(isMachineAuthenticatedApiPath("/api/billing/webhook")).toBe(true);
    expect(isMachineAuthenticatedApiPath("/api/users")).toBe(false);
  });

  it("bounds in-memory rate-limit buckets to prevent OOM under IP flooding", () => {
    for (let i = 0; i < MAX_RATE_LIMIT_BUCKETS + 250; i += 1) {
      checkRateLimit(`flood-ip-${i}`, { maxRequests: 10, windowMs: 60_000 });
    }
    expect(getRateLimitBucketCount()).toBeLessThanOrEqual(MAX_RATE_LIMIT_BUCKETS);
  });

  it("redirects retired storefront routes including /hosting/vps and /pricing", async () => {
    const redirects = nextConfig.redirects ? await nextConfig.redirects() : [];
    const sources = redirects.map((r) => r.source);
    expect(sources).toContain("/pricing");
    expect(sources).toContain("/hosting");
    expect(sources).toContain("/hosting/:path*");
    expect(sources).toContain("/domains");
    expect(sources).toContain("/email");
    expect(sources).toContain("/ssl");
    expect(sources).toContain("/support");
  });

  it("builds strict tenant filters for non-admin vs platform-admin scopes", () => {
    expect(
      websiteTenantWhere({
        userId: "u1",
        isPlatformAdmin: false,
        organizationIds: ["org-alo-edu"],
        activeOrganizationId: "org-alo-edu",
      }),
    ).toEqual({
      OR: [
        { organizationId: "org-alo-edu" },
        { ownerId: "u1", organizationId: null },
      ],
    });
    expect(
      websiteTenantWhere({
        userId: "admin1",
        isPlatformAdmin: true,
        organizationIds: [],
        activeOrganizationId: null,
      }),
    ).toEqual({});
  });
});
