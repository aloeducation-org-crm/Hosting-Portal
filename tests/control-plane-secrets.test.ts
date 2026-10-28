/**
 * Control plane Phase 1 — secrets encryption at rest.
 *
 * Verifies the `secret-store` seal/open/mask contract and the
 * `/api/platform/secrets` route end to end against the isolated DB copy:
 * values are ciphertext in the database, masked (never returned in full) over
 * the API, legacy plaintext rows are lazily re-sealed, and creates are
 * audited.
 */
import "./helpers/isolated-db";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { NextRequest } from "next/server";
import { encode } from "next-auth/jwt";
import { db } from "@/lib/db";
import { teardownIsolatedDb } from "./helpers/isolated-db";
import {
  sealSecretValue,
  openSecretValue,
  maskSecretValue,
  needsSealing,
  SEALED_PREFIX,
} from "@/lib/secret-store";

const TEST_JWT_SECRET = "dev-secret-change-in-production";
process.env.NEXTAUTH_SECRET = TEST_JWT_SECRET;

type SessionUser = { id: string; email: string; role: string };

async function authedRequest(
  url: string,
  user: SessionUser,
  init: { method?: string; body?: string } = {}
): Promise<NextRequest> {
  process.env.NEXTAUTH_SECRET = TEST_JWT_SECRET;
  const token = await encode({
    token: { id: user.id, sub: user.id, email: user.email, role: user.role },
    secret: TEST_JWT_SECRET,
  });
  const headers = new Headers();
  headers.set("cookie", `next-auth.session-token=${token}`);
  if (init.body) headers.set("content-type", "application/json");
  return new NextRequest(url, { method: init.method ?? "GET", headers, body: init.body });
}

async function loadRoute() {
  return import("@/app/api/platform/secrets/route");
}

let adminUser: SessionUser;
const base = "http://localhost:3000";

beforeAll(async () => {
  const admin = await db.user.findFirst({ where: { email: "admin@alolabs.net" } });
  if (!admin) throw new Error("seeded admin user missing");
  adminUser = { id: admin.id, email: admin.email, role: admin.role };
});

afterAll(async () => {
  await teardownIsolatedDb();
});

describe("secret-store", () => {
  it("round-trips a sealed value", () => {
    const stored = sealSecretValue("super-secret-token-123");
    expect(stored.startsWith(SEALED_PREFIX)).toBe(true);
    expect(stored).not.toContain("super-secret-token-123");
    expect(openSecretValue(stored)).toBe("super-secret-token-123");
    expect(needsSealing(stored)).toBe(false);
  });

  it("is idempotent — sealing an already-sealed value does not double-encrypt", () => {
    const once = sealSecretValue("abc");
    expect(sealSecretValue(once)).toBe(once);
  });

  it("opens legacy plaintext rows unchanged", () => {
    expect(openSecretValue("legacy-plain-value")).toBe("legacy-plain-value");
    expect(needsSealing("legacy-plain-value")).toBe(true);
  });

  it("masks sealed values by plaintext prefix and never leaks the rest", () => {
    const masked = maskSecretValue(sealSecretValue("AKIA1234567890"));
    expect(masked).toBe("AKIA***");
    expect(masked).not.toContain("1234567890");
  });

  it("masks short and undecryptable values as ****", () => {
    expect(maskSecretValue(sealSecretValue("ab"))).toBe("****");
    expect(maskSecretValue(`${SEALED_PREFIX}garbage:payload:here`)).toBe("****");
  });
});

describe("GET/POST /api/platform/secrets", () => {
  it("rejects unauthenticated requests with 401", async () => {
    const route = await loadRoute();
    const req = new NextRequest(`${base}/api/platform/secrets`);
    expect((await route.GET(req)).status).toBe(401);
    expect((await route.POST(req)).status).toBe(401);
  });

  it("stores the value as ciphertext at rest and returns only a mask", async () => {
    const route = await loadRoute();
    const name = `cp-secret-${Date.now()}`;
    const res = await route.POST(
      await authedRequest(`${base}/api/platform/secrets`, adminUser, {
        method: "POST",
        body: JSON.stringify({ name, value: "control-plane-plaintext-value" }),
      })
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string; name: string; value: string };
    expect(body.value).toBe("cont***");
    expect(body.value).not.toContain("control-plane-plaintext-value");

    const row = await db.secret.findUnique({ where: { id: body.id } });
    expect(row).not.toBeNull();
    expect(row!.value.startsWith(SEALED_PREFIX)).toBe(true);
    expect(row!.value).not.toContain("control-plane-plaintext-value");
    expect(openSecretValue(row!.value)).toBe("control-plane-plaintext-value");

    // Created secrets are audited.
    const audit = await db.auditLog.findFirst({
      where: { action: "SECRET_CREATED", resourceId: body.id },
    });
    expect(audit).not.toBeNull();
    expect(audit!.result).toBe("SUCCESS");
  });

  it("masks on GET and never returns a full value", async () => {
    const route = await loadRoute();
    const res = await route.GET(
      await authedRequest(`${base}/api/platform/secrets`, adminUser)
    );
    expect(res.status).toBe(200);
    const rows = (await res.json()) as Array<{ name: string; value: string }>;
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r.value).toMatch(/^(\*\*\*\*|[A-Za-z0-9._-]{4}\*\*\*)$/);
    }
  });

  it("lazily re-seals legacy plaintext rows on read", async () => {
    const route = await loadRoute();
    const legacy = await db.secret.create({
      data: {
        userId: adminUser.id,
        name: `legacy-${Date.now()}`,
        value: "legacy-plaintext-secret",
        type: "generic",
      },
    });
    expect(needsSealing(legacy.value)).toBe(true);

    const res = await route.GET(
      await authedRequest(`${base}/api/platform/secrets`, adminUser)
    );
    expect(res.status).toBe(200);

    const updated = await db.secret.findUnique({ where: { id: legacy.id } });
    expect(updated!.value.startsWith(SEALED_PREFIX)).toBe(true);
    expect(openSecretValue(updated!.value)).toBe("legacy-plaintext-secret");

    const rows = (await res.json()) as Array<{ id: string; value: string }>;
    const masked = rows.find((r) => r.id === legacy.id);
    expect(masked).toBeDefined();
    expect(masked!.value).toBe("lega***");
  });

  it("rejects missing name/value and oversized values", async () => {
    const route = await loadRoute();
    const bad1 = await route.POST(
      await authedRequest(`${base}/api/platform/secrets`, adminUser, {
        method: "POST",
        body: JSON.stringify({ name: "x" }),
      })
    );
    expect(bad1.status).toBe(400);
    const bad2 = await route.POST(
      await authedRequest(`${base}/api/platform/secrets`, adminUser, {
        method: "POST",
        body: JSON.stringify({ name: "x", value: "y".repeat(8001) }),
      })
    );
    expect(bad2.status).toBe(400);
  });
});

describe("POST /api/platform/webhooks — signing secret sealed at rest", () => {
  it("stores the signing secret as ciphertext and never returns it", async () => {
    const route = await import("@/app/api/platform/webhooks/route");
    const res = await route.POST(
      await authedRequest(`${base}/api/platform/webhooks`, adminUser, {
        method: "POST",
        body: JSON.stringify({
          name: `hook-${Date.now()}`,
          url: "https://example.com/alo-hook",
          secret: "whsec_signing_plaintext",
          events: ["deploy.finished"],
        }),
      })
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).not.toHaveProperty("secret");
    expect(body.hasSecret).toBe(true);

    const row = await db.webhook.findUnique({ where: { id: String(body.id) } });
    expect(row!.secret).not.toBeNull();
    expect(row!.secret!.startsWith(SEALED_PREFIX)).toBe(true);
    expect(row!.secret).not.toContain("whsec_signing_plaintext");
    expect(openSecretValue(row!.secret!)).toBe("whsec_signing_plaintext");
  });
});
