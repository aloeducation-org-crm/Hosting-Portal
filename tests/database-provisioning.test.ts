/**
 * Phase 4 — §11 database provisioning, honesty and authorization.
 *
 * The provisioning flow must call the real `alo-database-helper` and refuse
 * honestly when it is unavailable — no database row, no credentials and no
 * success audit may ever appear without a real helper round trip. This
 * environment intentionally has no helper installed, which lets the test pin
 * exactly that failure contract.
 */
import "./helpers/isolated-db";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { NextRequest } from "next/server";
import { encode } from "next-auth/jwt";
import { db } from "@/lib/db";
import { teardownIsolatedDb } from "./helpers/isolated-db";

const TEST_JWT_SECRET = "dev-secret-change-in-production";
process.env.NEXTAUTH_SECRET = TEST_JWT_SECRET;

type SessionUser = { id: string; email: string; role: string };
const base = "http://localhost:3000";

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
  return new NextRequest(url, { method: init.method ?? "POST", headers, body: init.body });
}

let admin: SessionUser;
let websiteId = "";

beforeAll(async () => {
  const a = await db.user.findFirst({ where: { email: "admin@alolabs.net" }, include: { role: true } });
  if (!a) throw new Error("seeded admin user missing");
  admin = { id: a.id, email: a.email, role: a.role.name };
  const site = await db.website.create({
    data: {
      name: "db-provision-test",
      domain: `dbtest-${Date.now()}.example.com`,
      runtime: "NEXTJS",
      ownerId: a.id,
    },
  });
  websiteId = site.id;
});

afterAll(async () => {
  await teardownIsolatedDb();
});

describe("POST /api/databases — authorization", () => {
  it("rejects unauthenticated requests", async () => {
    const route = await import("@/app/api/databases/route");
    const res = await route.POST(new NextRequest(`${base}/api/databases`));
    expect([401, 403]).toContain(res.status);
  });

  it("rejects an invalid engine/name with validation errors", async () => {
    const route = await import("@/app/api/databases/route");
    const res = await route.POST(
      await authedRequest(`${base}/api/databases`, admin, {
        method: "POST",
        body: JSON.stringify({ websiteId, engine: "MYSQL8X", name: "bad-name!" }),
      })
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("404s for a website that does not exist (never reaches the helper)", async () => {
    const route = await import("@/app/api/databases/route");
    const before = await db.databaseInstance.count();
    const res = await route.POST(
      await authedRequest(`${base}/api/databases`, admin, {
        method: "POST",
        body: JSON.stringify({
          websiteId: "00000000-0000-4000-8000-000000000000",
          engine: "MARIADB",
          name: "ghostdb",
        }),
      })
    );
    expect(res.status).toBe(404);
    expect(await db.databaseInstance.count()).toBe(before);
  });
});

describe("POST /api/databases — helper-driven provisioning honesty", () => {
  it("fails honestly when the helper is absent: no instance, no credentials, no success audit", async () => {
    const route = await import("@/app/api/databases/route");
    const name = `dbprobe${Date.now()}`;
    const beforeInstances = await db.databaseInstance.count();
    const res = await route.POST(
      await authedRequest(`${base}/api/databases`, admin, {
        method: "POST",
        body: JSON.stringify({ websiteId, engine: "MARIADB", name }),
      })
    );

    // In this environment /usr/local/sbin/alo-database-helper does not exist,
    // so the ONLY correct outcome is an explicit failure — never a fake 201.
    expect(res.status).toBe(500);
    const body = (await res.json()) as {
      error: { code: string; details?: { stderr?: string } };
      data?: unknown;
    };
    expect(body.error.code).toBe("DATABASE_ERROR");
    expect(body.data ?? null).toBeNull();
    expect(JSON.stringify(body)).not.toContain("password");

    expect(await db.databaseInstance.count()).toBe(beforeInstances);
    const audit = await db.auditLog.findFirst({
      where: { action: "DATABASE_CREATE", result: "SUCCESS" },
    });
    expect(audit).toBeNull(); // success is never recorded without a real helper run
  });
});

describe("GET /api/databases — listing", () => {
  it("returns a list to a permitted admin", async () => {
    const route = await import("@/app/api/databases/route");
    const res = await route.GET(await authedRequest(`${base}/api/databases`, admin));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: unknown };
    expect(Array.isArray(body.data)).toBe(true);
  });
});
