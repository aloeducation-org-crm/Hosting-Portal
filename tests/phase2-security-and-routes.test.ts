/**
 * Must be the first import in this file: it points DATABASE_URL at a throwaway
 * copy of db/custom.db before `@/lib/db` is evaluated, so these tests cannot
 * write into the tracked development database. See tests/helpers/isolated-db.ts.
 */
import { teardownIsolatedDb } from "./helpers/isolated-db";
import { afterEach, describe, expect, it, vi, afterAll } from "vitest";
import { NextRequest } from "next/server";
import { encode } from "next-auth/jwt";
import {
  assertWebsiteAccess,
  canAccessWebsite,
  verifyInternalSecretValue,
} from "@/lib/auth";
import { db } from "@/lib/db";
import { middleware } from "@/middleware";

const TEST_JWT_SECRET = "dev-secret-change-in-production";

const TEST_USERS: Record<string, { id: string; email: string; name: string; role: string }> = {
  "a@example.com": { id: "user-a", email: "a@example.com", name: "Tenant A", role: "CLIENT" },
  "b@example.com": { id: "user-b", email: "b@example.com", name: "Tenant B", role: "CLIENT" },
  "admin@example.com": { id: "admin-1", email: "admin@example.com", name: "Platform Admin", role: "ADMIN" },
};

function mockActiveUsers(): void {
  vi.spyOn(db.user, "findUnique").mockImplementation((async (args: { where?: { email?: string; id?: string } }) => {
    const email = args?.where?.email;
    const byEmail = email ? TEST_USERS[email] : undefined;
    const u =
      byEmail ??
      Object.values(TEST_USERS).find((candidate) => candidate.id === args?.where?.id);
    if (!u) return null;
    return {
      id: u.id,
      email: u.email,
      name: u.name,
      isActive: true,
      isLocked: false,
      role: {
        name: u.role,
        permissions: [
          { permission: { name: "LOGS_READ" } },
          { permission: { name: "SSL_MANAGE" } },
        ],
      },
    };
  }) as never);
}

async function makeAuthedRequest(
  url: string,
  user: { id: string; email: string; role: string },
  init?: { method?: string; body?: string; headers?: Record<string, string> },
): Promise<NextRequest> {
  process.env.NEXTAUTH_SECRET = TEST_JWT_SECRET;
  const token = await encode({
    secret: TEST_JWT_SECRET,
    token: {
      id: user.id,
      sub: user.id,
      email: user.email,
      role: user.role,
    },
  });

  const headers = new Headers(init?.headers);
  headers.set("cookie", `next-auth.session-token=${token}`);
  if (init?.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }

  return new NextRequest(url, {
    method: init?.method ?? "GET",
    headers,
    body: init?.body,
  });
}

describe("Phase 2: Website Tenant Isolation & Constant-Time Secret Verification", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("enforces strict owner or admin access in canAccessWebsite / assertWebsiteAccess", () => {
    const siteOwnedByB = { ownerId: "user-b" };
    const orphanSite = { ownerId: null };

    expect(canAccessWebsite({ id: "user-b", role: "CLIENT" }, siteOwnedByB)).toBe(true);
    expect(canAccessWebsite({ id: "admin-1", role: "ADMIN" }, siteOwnedByB)).toBe(true);
    expect(canAccessWebsite({ id: "super-1", role: "SUPER_ADMIN" }, orphanSite)).toBe(true);

    expect(canAccessWebsite({ id: "user-a", role: "CLIENT" }, siteOwnedByB)).toBe(false);
    expect(canAccessWebsite({ id: "reseller-a", role: "RESELLER" }, siteOwnedByB)).toBe(false);
    expect(canAccessWebsite({ id: "user-a", role: "CLIENT" }, orphanSite)).toBe(false);
    expect(canAccessWebsite({ id: "user-a", role: "CLIENT" }, null)).toBe(false);

    expect(() =>
      assertWebsiteAccess({ id: "user-a", role: "CLIENT" }, siteOwnedByB),
    ).toThrow();
  });

  it("verifies internal secrets in constant time and rejects weak or placeholder secrets", () => {
    const strongSecret = "9f8e7d6c5b4a39281726354453627180abcdef1234567890";

    expect(verifyInternalSecretValue(strongSecret, strongSecret)).toBe(true);
    expect(verifyInternalSecretValue(`${strongSecret}-wrong`, strongSecret)).toBe(false);
    expect(verifyInternalSecretValue("short-secret", "short-secret")).toBe(false);
    expect(
      verifyInternalSecretValue("change-me-in-production", "change-me-in-production"),
    ).toBe(false);
    expect(
      verifyInternalSecretValue(
        "alo-encryption-key-change-in-production-32b",
        "alo-encryption-key-change-in-production-32b",
      ),
    ).toBe(false);
    expect(verifyInternalSecretValue(null, strongSecret)).toBe(false);
    expect(verifyInternalSecretValue(strongSecret, undefined)).toBe(false);
  });
});

describe("Phase 2: Internal Worker, Webhook & Monitoring Secret Hardening (SEC-05)", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  it("blocks unauthenticated calls to /api/operations/worker and /api/monitoring/collect", async () => {
    process.env.INTERNAL_SECRET = "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678";

    const workerRoute = await import("@/app/api/operations/worker/route");
    const workerRes = await workerRoute.POST(
      new NextRequest("http://localhost:3000/api/operations/worker", { method: "POST" }),
    );
    expect(workerRes.status).toBe(401);

    const wrongSecretRes = await workerRoute.GET(
      new NextRequest("http://localhost:3000/api/operations/worker", {
        headers: { "x-internal-secret": "forged-secret-value-000000000000" },
      }),
    );
    expect(wrongSecretRes.status).toBe(401);

    const collectRoute = await import("@/app/api/monitoring/collect/route");
    const collectRes = await collectRoute.POST(
      new NextRequest("http://localhost:3000/api/monitoring/collect", { method: "POST" }),
    );
    expect(collectRes.status).toBe(401);
  });

  it("fails closed on /api/deploy/webhook when DEPLOY_WEBHOOK_SECRET is missing or weak", async () => {
    delete process.env.DEPLOY_WEBHOOK_SECRET;
    delete process.env.INTERNAL_SECRET;
    const webhookRoute = await import("@/app/api/deploy/webhook/route");

    const unconfiguredRes = await webhookRoute.POST(
      new NextRequest("http://localhost:3000/api/deploy/webhook", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ websiteId: "site-1" }),
      }),
    );
    expect(unconfiguredRes.status).toBe(503);

    process.env.DEPLOY_WEBHOOK_SECRET = "valid-deploy-webhook-secret-99887766";
    const forgedRes = await webhookRoute.POST(
      new NextRequest("http://localhost:3000/api/deploy/webhook", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-webhook-secret": "wrong-secret",
        },
        body: JSON.stringify({ websiteId: "site-1" }),
      }),
    );
    expect(forgedRes.status).toBe(401);
  });
});

describe("Phase 2: Cross-Tenant IDOR, Path Traversal & SSRF Defenses (SEC-03..08)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("blocks cross-tenant DNS listing while permitting the website owner", async () => {
    mockActiveUsers();
    vi.spyOn(db.domain, "findUnique").mockResolvedValue({
      id: "dom-tenant-b",
      domain: "tenant-b.example.com",
      website: {
        id: "site-tenant-b",
        domain: "tenant-b.example.com",
        ownerId: "user-b",
      },
    } as never);
    vi.spyOn(db.dnsRecord, "findMany").mockResolvedValue([] as never);

    const dnsRoute = await import("@/app/api/network/dns/route");

    const attackerReq = await makeAuthedRequest(
      "http://localhost:3000/api/network/dns?domainId=dom-tenant-b",
      { id: "user-a", email: "a@example.com", role: "CLIENT" },
    );
    const attackerRes = await dnsRoute.GET(attackerReq);
    expect(attackerRes.status).toBe(403);

    const ownerReq = await makeAuthedRequest(
      "http://localhost:3000/api/network/dns?domainId=dom-tenant-b",
      { id: "user-b", email: "b@example.com", role: "CLIENT" },
    );
    const ownerRes = await dnsRoute.GET(ownerReq);
    expect(ownerRes.status).toBe(200);
  });

  it("blocks path-traversal domains and non-admin host-log reads in /api/logs/center", async () => {
    mockActiveUsers();
    const logsCenter = await import("@/app/api/logs/center/route");

    const traversalReq = await makeAuthedRequest(
      "http://localhost:3000/api/logs/center?source=caddy-access&domain=../../etc/passwd",
      { id: "admin-1", email: "admin@example.com", role: "ADMIN" },
    );
    const traversalRes = await logsCenter.GET(traversalReq);
    expect(traversalRes.status).toBe(400);

    const hostLogClientReq = await makeAuthedRequest(
      "http://localhost:3000/api/logs/center?source=application",
      { id: "user-a", email: "a@example.com", role: "CLIENT" },
    );
    const hostLogClientRes = await logsCenter.GET(hostLogClientReq);
    expect(hostLogClientRes.status).toBe(403);
  });

  it("requires auth and blocks loopback/internal targets in /api/ssl/check (SEC-08)", async () => {
    mockActiveUsers();
    const sslCheck = await import("@/app/api/ssl/check/route");

    const unauthRes = await sslCheck.GET(
      new NextRequest("http://localhost:3000/api/ssl/check?domain=example.com"),
    );
    expect(unauthRes.status).toBe(401);

    const loopbackReq = await makeAuthedRequest(
      "http://localhost:3000/api/ssl/check?domain=127.0.0.1",
      { id: "admin-1", email: "admin@example.com", role: "ADMIN" },
    );
    const loopbackRes = await sslCheck.GET(loopbackReq);
    expect(loopbackRes.status).toBe(400);

    const localhostReq = await makeAuthedRequest(
      "http://localhost:3000/api/ssl/check?domain=localhost",
      { id: "admin-1", email: "admin@example.com", role: "ADMIN" },
    );
    const localhostRes = await sslCheck.GET(localhostReq);
    expect(localhostRes.status).toBe(400);
  });

  it("requires authentication on /api/ai/prompts and /api/domains/suggestions", async () => {
    const promptsRoute = await import("@/app/api/ai/prompts/route");
    const promptsRes = await promptsRoute.GET(
      new NextRequest("http://localhost:3000/api/ai/prompts"),
    );
    expect(promptsRes.status).toBe(401);

    const domainsRoute = await import("@/app/api/domains/suggestions/route");
    const domainsRes = await domainsRoute.GET(
      new NextRequest("http://localhost:3000/api/domains/suggestions?q=alo"),
    );
    expect(domainsRes.status).toBe(401);
  });
});

describe("Phase 2: Newly Implemented Missing API Endpoints (API-MISSING-01..03)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("serves tenant-scoped application logs on GET /api/applications/[id]/logs", async () => {
    mockActiveUsers();
    const appLogsRoute = await import("@/app/api/applications/[id]/logs/route");

    const unauthRes = await appLogsRoute.GET(
      new NextRequest("http://localhost:3000/api/applications/app-1/logs"),
      { params: Promise.resolve({ id: "app-1" }) },
    );
    expect(unauthRes.status).toBe(401);

    vi.spyOn(db.application, "findUnique").mockResolvedValue({
      id: "app-1",
      name: "portal-web",
      type: "NODEJS",
      status: "RUNNING",
      port: 3001,
      userId: "user-b",
      websiteId: "site-b",
      createdAt: new Date("2026-10-26T00:00:00.000Z"),
      updatedAt: new Date("2026-10-26T01:00:00.000Z"),
      website: { id: "site-b", domain: "b.example.com", ownerId: "user-b" },
    } as never);
    vi.spyOn(db.deployment, "findMany").mockResolvedValue([] as never);

    const crossTenantReq = await makeAuthedRequest(
      "http://localhost:3000/api/applications/app-1/logs",
      { id: "user-a", email: "a@example.com", role: "CLIENT" },
    );
    const crossTenantRes = await appLogsRoute.GET(crossTenantReq, {
      params: Promise.resolve({ id: "app-1" }),
    });
    expect(crossTenantRes.status).toBe(403);

    const ownerReq = await makeAuthedRequest(
      "http://localhost:3000/api/applications/app-1/logs",
      { id: "user-b", email: "b@example.com", role: "CLIENT" },
    );
    const ownerRes = await appLogsRoute.GET(ownerReq, {
      params: Promise.resolve({ id: "app-1" }),
    });
    expect(ownerRes.status).toBe(200);
    const payload = await ownerRes.json();
    expect(payload.success).toBe(true);
    expect(typeof payload.data.logs).toBe("string");
    expect(payload.data.logs).toContain("portal-web");
  });

  it("enforces tenant isolation on PATCH /api/email/accounts/[id] and GET /api/ssl/[id]", async () => {
    mockActiveUsers();
    const emailByIdRoute = await import("@/app/api/email/accounts/[id]/route");
    vi.spyOn(db.emailAccount, "findUnique").mockResolvedValue({
      id: "mail-1",
      address: "hello@b.example.com",
      domain: "b.example.com",
      password: "hashed-password",
      quotaMb: 1024,
      usedMb: 12,
      isActive: true,
      forwardTo: null,
      autoReply: false,
      autoReplyMsg: null,
      createdAt: new Date(),
    } as never);
    vi.spyOn(db.domain, "findUnique").mockResolvedValue({
      id: "dom-b",
      domain: "b.example.com",
      website: { id: "site-b", domain: "b.example.com", ownerId: "user-b" },
    } as never);

    const crossEmailReq = await makeAuthedRequest(
      "http://localhost:3000/api/email/accounts/mail-1",
      { id: "user-a", email: "a@example.com", role: "CLIENT" },
      { method: "PATCH", body: JSON.stringify({ quotaMb: 2048 }) },
    );
    const crossEmailRes = await emailByIdRoute.PATCH(crossEmailReq, {
      params: Promise.resolve({ id: "mail-1" }),
    });
    expect(crossEmailRes.status).toBe(403);

    const sslByIdRoute = await import("@/app/api/ssl/[id]/route");
    vi.spyOn(db.sslCertificate, "findUnique").mockResolvedValue({
      id: "cert-1",
      domainId: "dom-b",
      domain: {
        id: "dom-b",
        domain: "b.example.com",
        website: { id: "site-b", domain: "b.example.com", ownerId: "user-b" },
      },
    } as never);

    const crossSslReq = await makeAuthedRequest(
      "http://localhost:3000/api/ssl/cert-1",
      { id: "user-a", email: "a@example.com", role: "CLIENT" },
    );
    const crossSslRes = await sslByIdRoute.GET(crossSslReq, {
      params: Promise.resolve({ id: "cert-1" }),
    });
    expect(crossSslRes.status).toBe(403);

    const ownerSslReq = await makeAuthedRequest(
      "http://localhost:3000/api/ssl/cert-1",
      { id: "user-b", email: "b@example.com", role: "CLIENT" },
    );
    const ownerSslRes = await sslByIdRoute.GET(ownerSslReq, {
      params: Promise.resolve({ id: "cert-1" }),
    });
    expect(ownerSslRes.status).toBe(200);
  });
});

describe("Phase 2: Middleware Security Headers & Public Form Rate Limiting (SEC-09)", () => {
  it("attaches hardened security headers even on 401 and 429 early-return responses", async () => {
    const unauthApiRes = await middleware(
      new NextRequest("http://localhost:3000/api/websites", {
        headers: { "x-real-ip": "198.51.100.41" },
      }),
    );
    expect(unauthApiRes.status).toBe(401);
    expect(unauthApiRes.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(unauthApiRes.headers.get("X-Frame-Options")).toBe("SAMEORIGIN");
    expect(unauthApiRes.headers.get("Strict-Transport-Security")).toContain("max-age=");
    expect(unauthApiRes.headers.get("Cross-Origin-Opener-Policy")).toBe("same-origin");

    const testIp = "198.51.100.99";
    let finalStatus = 200;
    for (let i = 0; i < 11; i++) {
      const res = await middleware(
        new NextRequest("http://localhost:3000/api/contact", {
          method: "POST",
          headers: { "x-real-ip": testIp },
        }),
      );
      finalStatus = res.status;
      if (i === 10) {
        expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
      }
    }
    expect(finalStatus).toBe(429);
  });
});

/** Delete this file's scratch database copy. */
afterAll(async () => {
  await teardownIsolatedDb();
});
