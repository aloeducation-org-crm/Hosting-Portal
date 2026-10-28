/**
 * Phase 2 — provider adapters for Server C (Hostinger) and Server D (cPanel).
 *
 * The contract under test is honesty: with no credentials in this environment
 * every provider must be `blocked` with an exact blocker, nothing may ever be
 * `connected` without a recorded live check, credentials must never leak into
 * status output or error strings, and the admin API must be gated.
 *
 * Live API round trips are NOT tested here (no credentials, no outbound path
 * to either provider from CI) — the HTTP plumbing is exercised with an
 * injected fetch, which is exactly how a real check will behave later.
 */
import "./helpers/isolated-db";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { NextRequest } from "next/server";
import { encode } from "next-auth/jwt";
import { db } from "@/lib/db";
import { teardownIsolatedDb } from "./helpers/isolated-db";
import { listProviderStatuses } from "@/lib/providers/registry";
import {
  hostingerStatus,
  verifyHostingerAccess,
  HOSTINGER_API_BASE,
  HOSTINGER_VERIFY_PATH,
} from "@/lib/providers/hostinger";
import {
  cpanelStatus,
  buildListMailboxesRequest,
  verifyCpanelAccess,
  validateMailboxInput,
} from "@/lib/providers/cpanel";
import { redactSecret } from "@/lib/providers/types";

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
  return new NextRequest(url, { method: init.method ?? "GET", headers, body: init.body });
}

let adminUser: SessionUser;

beforeAll(async () => {
  const admin = await db.user.findFirst({ where: { email: "admin@alolabs.net" } });
  if (!admin) throw new Error("seeded admin user missing");
  adminUser = { id: admin.id, email: admin.email, role: admin.role };
});

afterAll(async () => {
  await teardownIsolatedDb();
});

describe("provider status registry — honest states", () => {
  it("lists all three providers with no connection claimed", () => {
    const statuses = listProviderStatuses();
    expect(statuses.map((p) => p.id).sort()).toEqual(["cloudflare", "cpanel", "hostinger"]);
    for (const p of statuses) {
      expect(p.connected, `${p.id} must not claim connected without a live check`).toBe(false);
      expect(p.state, p.id).toBe("blocked"); // no credentials in this environment
      expect(p.blocker, p.id).toBeTruthy();
      expect(p.verifiedAt).toBeNull();
      expect(p.capabilities.length).toBeGreaterThan(0);
      expect(p.purpose.length).toBeGreaterThan(0);
    }
  });

  it("names the exact missing dependency for each provider", () => {
    const byId = Object.fromEntries(listProviderStatuses().map((p) => [p.id, p]));
    expect(byId.hostinger!.blocker).toContain("HOSTINGER_API_TOKEN");
    expect(byId.cpanel!.blocker).toContain("CPANEL_HOST");
    expect(byId.cpanel!.blocker).toContain("CPANEL_USER");
    expect(byId.cpanel!.blocker).toContain("CPANEL_TOKEN");
    expect(byId.cloudflare!.blocker).toContain("CLOUDFLARE_API_TOKEN");
  });

  it("never emits a simulated flag or credential material", () => {
    const json = JSON.stringify(listProviderStatuses());
    expect(json).not.toContain("simulated");
    // No credential-shaped JSON keys anywhere in the payload.
    expect(json).not.toContain('"token"');
    expect(json).not.toContain('"apiKey"');
    expect(json).not.toContain('"secret"');
  });

  it("moves to unverified — never connected — when a credential appears without a check", () => {
    expect(hostingerStatus(null).state).toBe("blocked");
    const withToken = hostingerStatus(null); // still null verifiedAt
    expect(withToken.connected).toBe(false);
    expect(cpanelStatus(null, { host: "https://cp.example.com", user: "alo", token: "tok" }).state).toBe(
      "unverified"
    );
    expect(cpanelStatus("2026-10-29T00:00:00.000Z", { host: "https://cp.example.com", user: "alo", token: "tok" }).state).toBe(
      "connected"
    );
    expect(cpanelStatus("2026-10-29T00:00:00.000Z").state).toBe("blocked"); // verifiedAt alone is not enough
  });
});

describe("Hostinger adapter", () => {
  it("refuses the access check without a token and names the variable", async () => {
    const res = await verifyHostingerAccess({ token: "" });
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("NOT_CONFIGURED");
    expect(res.message).toContain("HOSTINGER_API_TOKEN");
    expect(res.virtualMachineCount).toBeUndefined();
  });

  it("uses the documented base URL and Bearer auth", async () => {
    expect(HOSTINGER_API_BASE).toBe("https://developers.hostinger.com");
    expect(HOSTINGER_VERIFY_PATH).toBe("/api/vps/v1/virtual-machines");
    let seen: { url: string; auth: string } | null = null;
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      seen = {
        url: String(url),
        auth: String((init?.headers as Record<string, string>)?.Authorization ?? ""),
      };
      return new Response(JSON.stringify({ data: [{ id: 1 }, { id: 2 }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;
    const res = await verifyHostingerAccess({ token: "hpt_test_token", fetchImpl });
    expect(res.ok).toBe(true);
    expect(res.virtualMachineCount).toBe(2);
    expect(seen!.url).toBe(`${HOSTINGER_API_BASE}${HOSTINGER_VERIFY_PATH}`);
    expect(seen!.auth).toBe("Bearer hpt_test_token");
  });

  it("reports HTTP failures honestly and redacts the token", async () => {
    const fetchImpl = (async () =>
      new Response("unauthorized", { status: 401, statusText: "Unauthorized" })) as unknown as typeof fetch;
    const res = await verifyHostingerAccess({ token: "hpt_super_secret", fetchImpl });
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("HTTP_ERROR");
    expect(res.message).toContain("401");
    expect(res.message).not.toContain("hpt_super_secret");
  });

  it("redacts the token from network errors", async () => {
    const fetchImpl = (async () => {
      throw new Error("connection refused while sending Bearer hpt_leaky_value");
    }) as unknown as typeof fetch;
    const res = await verifyHostingerAccess({ token: "hpt_leaky_value", fetchImpl });
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("NETWORK_ERROR");
    expect(res.message).not.toContain("hpt_leaky_value");
    expect(res.message).toContain("[redacted]");
  });
});

describe("cPanel adapter", () => {
  it("refuses without credentials and names every missing variable", async () => {
    const res = await verifyCpanelAccess({ config: { host: "", user: "", token: "" } });
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("NOT_CONFIGURED");
    expect(res.message).toContain("CPANEL_HOST");
    expect(res.message).toContain("CPANEL_USER");
    expect(res.message).toContain("CPANEL_TOKEN");
  });

  it("builds the UAPI request with the token only in the Authorization header", () => {
    expect(buildListMailboxesRequest({ host: "", user: "alo", token: "t" })).toBeNull();
    const req = buildListMailboxesRequest({
      host: "cp.aloeducation.com",
      user: "aloedu",
      token: "cptoken123",
    });
    expect(req).not.toBeNull();
    expect(req!.url).toBe("https://cp.aloeducation.com:2083/execute/Email/list_pops");
    expect(req!.url).not.toContain("cptoken123");
    expect(req!.headers.Authorization).toBe("cpanel aloedu:cptoken123");
    // Scheme is respected when the operator supplies one.
    const https = buildListMailboxesRequest({
      host: "https://cp.example.com:2083/",
      user: "u",
      token: "t",
    });
    expect(https!.url).toBe("https://cp.example.com:2083/execute/Email/list_pops");
  });

  it("verifies a real round trip only when configured (injected fetch)", async () => {
    const cfg = { host: "cp.example.com", user: "alo", token: "tok" };
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ data: [{ email: "a@aloeducation.com" }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })) as unknown as typeof fetch;
    const res = await verifyCpanelAccess({ config: cfg, fetchImpl });
    expect(res.ok).toBe(true);
    expect(res.mailboxCount).toBe(1);
    expect(res.checkedAt).toBeTruthy();
  });

  it("keeps passwords/tokens out of HTTP failure messages", async () => {
    const cfg = { host: "cp.example.com", user: "alo", token: "supersecrettoken" };
    const fetchImpl = (async () => {
      throw new Error("tls handshake failed for supersecrettoken");
    }) as unknown as typeof fetch;
    const res = await verifyCpanelAccess({ config: cfg, fetchImpl });
    expect(res.ok).toBe(false);
    expect(res.message).not.toContain("supersecrettoken");
  });

  it("validates mailbox writes before anything is sent", () => {
    expect(validateMailboxInput({ domain: "aloeducation.com", localPart: "admissions", quotaMb: 500 })).toBeNull();
    expect(validateMailboxInput({ domain: "not a domain", localPart: "x" })).toContain("domain");
    expect(validateMailboxInput({ domain: "aloeducation.com", localPart: "bad name!" })).toContain("localPart");
    expect(validateMailboxInput({ domain: "aloeducation.com", localPart: "ok", quotaMb: 0 })).toContain("quotaMb");
    expect(validateMailboxInput({ domain: "aloeducation.com", localPart: "ok", quotaMb: 1.5 })).toContain("quotaMb");
  });

  it("redactSecret removes every occurrence", () => {
    expect(redactSecret("using s3cr3t-value here and s3cr3t-value again", "s3cr3t-value")).toBe(
      "using [redacted] here and [redacted] again"
    );
    expect(redactSecret("nothing here", "")).toBe("nothing here");
  });
});

describe("/api/providers — admin gate + honest payload", () => {
  it("rejects unauthenticated requests", async () => {
    const route = await import("@/app/api/providers/route");
    const res = await route.GET(new NextRequest(`${base}/api/providers`));
    expect([401, 403]).toContain(res.status);
  });

  it("returns the honest registry to a super admin", async () => {
    const route = await import("@/app/api/providers/route");
    const res = await route.GET(await authedRequest(`${base}/api/providers`, adminUser));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { providers: Array<Record<string, unknown>> } };
    expect(body.data.providers).toHaveLength(3);
    for (const p of body.data.providers) {
      expect(p.connected).toBe(false);
      expect(p.blocker).toBeTruthy();
    }
  });

  it("POST validates the provider name", async () => {
    const route = await import("@/app/api/providers/route");
    const bad = await route.POST(
      await authedRequest(`${base}/api/providers`, adminUser, {
        method: "POST",
        body: JSON.stringify({ provider: "digitalocean" }),
      })
    );
    expect(bad.status).toBe(400);
  });

  it("POST /verify without credentials reports the precise blocker, not success", async () => {
    const route = await import("@/app/api/providers/route");
    const res = await route.POST(
      await authedRequest(`${base}/api/providers`, adminUser, {
        method: "POST",
        body: JSON.stringify({ provider: "hostinger" }),
      })
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { provider: string; result: { ok: boolean; reason?: string; message: string } };
    };
    expect(body.data.provider).toBe("hostinger");
    expect(body.data.result.ok).toBe(false);
    expect(body.data.result.reason).toBe("NOT_CONFIGURED");
    expect(body.data.result.message).toContain("HOSTINGER_API_TOKEN");
  });
});
