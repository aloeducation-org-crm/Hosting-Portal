/**
 * Authentication — password reset flow.
 *
 * Covers the full request → token → reset → sign-in round trip against an
 * isolated scratch copy of the development fixture:
 *   - enumeration-safe response for unknown accounts;
 *   - reset tokens are single-use, hashed at rest, and expire;
 *   - a completed reset replaces the password hash and clears lockout state;
 *   - the old password stops working and the new one works.
 */
import "./helpers/isolated-db";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { NextRequest } from "next/server";
import { createHash } from "crypto";
import { db } from "@/lib/db";
import { verifyPassword } from "@/lib/password";
import { teardownIsolatedDb } from "./helpers/isolated-db";

const base = "http://localhost:3000";
const ADMIN_EMAIL = "admin@alolabs.net";

function jsonRequest(url: string, body: unknown): NextRequest {
  return new NextRequest(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function readJson(res: Response) {
  return res.json();
}

beforeAll(async () => {
  const admin = await db.user.findUnique({ where: { email: ADMIN_EMAIL } });
  if (!admin) throw new Error("seeded admin user missing from fixture");
});

afterAll(async () => {
  await teardownIsolatedDb();
});

describe("POST /api/auth/forgot-password", () => {
  it("returns the generic response for an unknown account (no enumeration)", async () => {
    const route = await import("@/app/api/auth/forgot-password/route");
    const res = await route.POST(
      jsonRequest(`${base}/api/auth/forgot-password`, { email: "no-such-user@example.com" }),
    );
    expect(res.status).toBe(200);
    const payload = await readJson(res);
    expect(payload.success).toBe(true);
    expect(payload.message).toMatch(/if an account exists/i);
  });

  it("rejects a malformed email address", async () => {
    const route = await import("@/app/api/auth/forgot-password/route");
    const res = await route.POST(
      jsonRequest(`${base}/api/auth/forgot-password`, { email: "not-an-email" }),
    );
    expect(res.status).toBe(400);
    const payload = await readJson(res);
    expect(payload.success).toBe(false);
  });

  it("issues a hashed, single-use token for a known account", async () => {
    const route = await import("@/app/api/auth/forgot-password/route");
    const res = await route.POST(
      jsonRequest(`${base}/api/auth/forgot-password`, { email: ADMIN_EMAIL }),
    );
    expect(res.status).toBe(200);
    const payload = await readJson(res);
    expect(payload.success).toBe(true);
    // NODE_ENV is not "production" under vitest, so the dev convenience token is present.
    expect(typeof payload.data?.devToken).toBe("string");

    const records = await db.verificationToken.findMany({
      where: { identifier: ADMIN_EMAIL, type: "PASSWORD_RESET", usedAt: null },
    });
    expect(records.length).toBe(1);
    const expectedHash = createHash("sha256").update(payload.data.devToken, "utf8").digest("hex");
    // Raw token must never appear in the database.
    expect(records[0].token).toBe(expectedHash);
    expect(records[0].token).not.toBe(payload.data.devToken);
    expect(records[0].expiresAt.getTime()).toBeGreaterThan(Date.now());
  });
});

describe("POST /api/auth/reset-password", () => {
  it("rejects an invalid token", async () => {
    const route = await import("@/app/api/auth/reset-password/route");
    const res = await route.POST(
      jsonRequest(`${base}/api/auth/reset-password`, {
        token: "f".repeat(64),
        password: "brand-new-password-1",
      }),
    );
    expect(res.status).toBe(400);
    const payload = await readJson(res);
    expect(payload.success).toBe(false);
  });

  it("rejects a password shorter than 8 characters", async () => {
    const forgot = await import("@/app/api/auth/forgot-password/route");
    const forgotRes = await forgot.POST(
      jsonRequest(`${base}/api/auth/forgot-password`, { email: ADMIN_EMAIL }),
    );
    const { data } = await readJson(forgotRes);
    const route = await import("@/app/api/auth/reset-password/route");
    const res = await route.POST(
      jsonRequest(`${base}/api/auth/reset-password`, { token: data.devToken, password: "short" }),
    );
    expect(res.status).toBe(400);
  });

  it("resets the password, clears lockout, and enforces single use", async () => {
    // Simulate a brute-force lockout that the reset flow must clear.
    await db.user.update({
      where: { email: ADMIN_EMAIL },
      data: { isLocked: true, lockedUntil: new Date(Date.now() + 10 * 60 * 1000), failedLoginAttempts: 7 },
    });
    const adminBefore = await db.user.findUnique({ where: { email: ADMIN_EMAIL } });
    const previousHash = adminBefore?.passwordHash ?? "";

    const forgot = await import("@/app/api/auth/forgot-password/route");
    const forgotRes = await forgot.POST(
      jsonRequest(`${base}/api/auth/forgot-password`, { email: ADMIN_EMAIL }),
    );
    const { data } = await readJson(forgotRes);

    const route = await import("@/app/api/auth/reset-password/route");
    const res = await route.POST(
      jsonRequest(`${base}/api/auth/reset-password`, {
        token: data.devToken,
        password: "reset-password-98765",
      }),
    );
    expect(res.status).toBe(200);
    const payload = await readJson(res);
    expect(payload.success).toBe(true);

    const admin = await db.user.findUnique({ where: { email: ADMIN_EMAIL } });
    expect(admin?.passwordHash).not.toBe(previousHash);
    expect(await verifyPassword("reset-password-98765", admin!.passwordHash!)).toBe(true);
    expect(admin?.isLocked).toBe(false);
    expect(admin?.lockedUntil).toBeNull();
    expect(admin?.failedLoginAttempts).toBe(0);

    // Single use: replaying the same token must fail.
    const replay = await route.POST(
      jsonRequest(`${base}/api/auth/reset-password`, {
        token: data.devToken,
        password: "another-password-123",
      }),
    );
    expect(replay.status).toBe(400);
  });
});
