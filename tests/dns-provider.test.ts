/**
 * Phase 5 — §8 provider-independent DNS: publication honesty.
 *
 * - local mode (default): records are panel-only and every write response
 *   says so; nothing is ever reported as published to a nameserver.
 * - executing modes without their credentials/engine: mutations are REFUSED
 *   (no row written) with the exact missing dependency named.
 * - /api/network/dns/status reports the mode truthfully.
 */
import "./helpers/isolated-db";
import { describe, it, expect, beforeEach, afterEach, afterAll } from "vitest";
import { NextRequest } from "next/server";
import { encode } from "next-auth/jwt";
import { db } from "@/lib/db";
import { teardownIsolatedDb } from "./helpers/isolated-db";

const TEST_JWT_SECRET = "dev-secret-change-in-production";
process.env.NEXTAUTH_SECRET = TEST_JWT_SECRET;

const base = "http://localhost:3000";
const ORIGINAL_MODE = process.env.DNS_PROVIDER_MODE;

async function sessionCookie(email: string, role: string, id: string): Promise<string> {
  process.env.NEXTAUTH_SECRET = TEST_JWT_SECRET;
  const token = await encode({
    token: { id, sub: id, email, role },
    secret: TEST_JWT_SECRET,
  });
  return `next-auth.session-token=${token}`;
}

function jsonReq(url: string, cookie: string, method: string, body?: unknown): NextRequest {
  const headers = new Headers({ cookie });
  if (body !== undefined) headers.set("content-type", "application/json");
  return new NextRequest(url, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
}

let adminCookie = "";
let domainId = "";

afterAll(async () => {
  await teardownIsolatedDb();
});

beforeAll(async () => {
  const a = await db.user.findFirst({ where: { email: "admin@alolabs.net" }, include: { role: true } });
  if (!a) throw new Error("seeded admin missing");
  adminCookie = await sessionCookie(a.email, a.role.name, a.id);

  const site = await db.website.findFirst({ where: { ownerId: a.id } });
  const w = site ?? (await db.website.create({
    data: { name: "dns-test", domain: `dnstest-${Date.now()}.example.com`, runtime: "NEXTJS", ownerId: a.id },
  }));
  const dom = await db.domain.create({
    data: {
      domain: `dnsrec-${Date.now()}-${Math.floor(Math.random() * 1e6)}.example.com`,
      websiteId: w.id,
      nameservers: JSON.stringify(["ns1.example.com"]),
    },
  });
  domainId = dom.id;
});

beforeEach(async () => {
  const a = await db.user.findFirst({ where: { email: "admin@alolabs.net" }, include: { role: true } });
  if (!a) throw new Error("seeded admin missing");
  adminCookie = await sessionCookie(a.email, a.role.name, a.id);
});

afterEach(() => {
  if (ORIGINAL_MODE === undefined) delete process.env.DNS_PROVIDER_MODE;
  else process.env.DNS_PROVIDER_MODE = ORIGINAL_MODE;
});

describe("DNS provider modes (lib)", () => {
  it("defaults to local and refuses unknown modes safely", async () => {
    const { currentDnsMode, dnsPublicationState } = await import("@/lib/dns-provider");
    delete process.env.DNS_PROVIDER_MODE;
    expect(currentDnsMode()).toBe("local");
    process.env.DNS_PROVIDER_MODE = "definitely-not-a-mode";
    expect(currentDnsMode()).toBe("local"); // unknown falls back to non-executing mode
    const st = dnsPublicationState("local");
    expect(st.executes).toBe(false);
    expect(st.state).toBe("panel-only");
    expect(st.blocker).toMatch(/NOT published/);
  });

  it("publish in local mode succeeds without executing anywhere", async () => {
    const { publishDnsRecord, deleteDnsGate } = await import("@/lib/dns-provider");
    const res = await publishDnsRecord({ type: "A", name: "@", value: "1.2.3.4" }, "local");
    expect(res.ok).toBe(true);
    expect(res.executed).toBe(false);
    expect(res.note).toMatch(/NOT published/);
    const del = deleteDnsGate("local");
    expect(del.ok).toBe(true);
    expect(del.executed).toBe(false);
  });

  it("cloudflare mode without credentials blocks with the exact variables named", async () => {
    const { publishDnsRecord, dnsPublicationState, deleteDnsGate } = await import("@/lib/dns-provider");
    const st = dnsPublicationState("cloudflare");
    expect(st.state).toBe("blocked");
    expect(st.blocker).toContain("CLOUDFLARE_API_TOKEN");
    expect(st.blocker).toContain("CLOUDFLARE_ZONE_ID");
    const res = await publishDnsRecord({ type: "A", name: "@", value: "1.2.3.4" }, "cloudflare");
    expect(res.ok).toBe(false);
    expect(res.executed).toBe(false);
    expect(res.code).toBe("DNS_PROVIDER_BLOCKED");
    const del = deleteDnsGate("cloudflare");
    expect(del.ok).toBe(false);
  });

  it("powerdns and registrar modes refuse with their own blockers", async () => {
    const { publishDnsRecord, deleteDnsGate } = await import("@/lib/dns-provider");
    const pdns = await publishDnsRecord({ type: "A", name: "@", value: "1.2.3.4" }, "powerdns");
    expect(pdns.ok).toBe(false);
    expect(pdns.code).toBe("DNS_PROVIDER_BLOCKED");
    expect(pdns.note).toContain("POWERDNS_API_URL");
    const reg = await publishDnsRecord({ type: "A", name: "@", value: "1.2.3.4" }, "registrar");
    expect(reg.ok).toBe(false);
    expect(reg.note).toContain("REGISTRAR_API_TOKEN");
    expect(deleteDnsGate("powerdns").ok).toBe(false);
    expect(deleteDnsGate("registrar").ok).toBe(false);
  });
});

describe("GET /api/network/dns/status", () => {
  it("requires a session", async () => {
    const route = await import("@/app/api/network/dns/status/route");
    const res = await route.GET(new NextRequest(`${base}/api/network/dns/status`));
    expect(res.status).toBe(401);
  });

  it("reports the current mode honestly", async () => {
    const route = await import("@/app/api/network/dns/status/route");
    process.env.DNS_PROVIDER_MODE = "powerdns";
    const res = await route.GET(new NextRequest(`${base}/api/network/dns/status`, { headers: { cookie: adminCookie } }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { mode: string; state: string; supportedModes: string[]; lastLivePublishAt: string | null };
    };
    expect(body.data.mode).toBe("powerdns");
    expect(body.data.state).toBe("blocked");
    expect(body.data.supportedModes).toEqual(["local", "cloudflare", "powerdns", "registrar"]);
    expect(body.data.lastLivePublishAt).toBeNull();
  });
});

describe("DNS mutations obey the publication gate", () => {
  it("local mode: creates the record and answers with publication.executed=false", async () => {
    const route = await import("@/app/api/network/dns/route");
    process.env.DNS_PROVIDER_MODE = "local";
    const res = await route.POST(
      jsonReq(`${base}/api/network/dns`, adminCookie, "POST", {
        domainId,
        type: "A",
        name: "@",
        value: "10.0.0.9",
        ttl: 300,
      })
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { id: string; publication: { executed: boolean; note: string } } };
    expect(body.data.publication.executed).toBe(false);
    expect(body.data.publication.note).toMatch(/NOT published/);
    const row = await db.dnsRecord.findUnique({ where: { id: body.data.id } });
    expect(row?.value).toBe("10.0.0.9");
  });

  it("powerdns mode: refuses the write — no row is persisted", async () => {
    const route = await import("@/app/api/network/dns/route");
    process.env.DNS_PROVIDER_MODE = "powerdns";
    const before = await db.dnsRecord.count({ where: { domainId } });
    const res = await route.POST(
      jsonReq(`${base}/api/network/dns`, adminCookie, "POST", {
        domainId,
        type: "A",
        name: "refused",
        value: "10.0.0.10",
      })
    );
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { code: string }; message: string };
    expect(body.error.code).toBe("DNS_PROVIDER_BLOCKED");
    expect(body.message).toContain("POWERDNS");
    expect(await db.dnsRecord.count({ where: { domainId } })).toBe(before);
  });

  it("refuses deletion in an executing mode", async () => {
    const route = await import("@/app/api/network/dns/[id]/route");
    const existing = await db.dnsRecord.findFirst({ where: { domainId } });
    if (!existing) throw new Error("expected a record from the local-mode test");
    process.env.DNS_PROVIDER_MODE = "cloudflare";
    const res = await route.DELETE(
      jsonReq(`${base}/api/network/dns/${existing.id}`, adminCookie, "DELETE"),
      { params: Promise.resolve({ id: existing.id }) }
    );
    expect(res.status).toBe(409);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("DNS_PROVIDER_BLOCKED");
    expect(await db.dnsRecord.findUnique({ where: { id: existing.id } })).not.toBeNull();
  });

  it("deletes in local mode with an explicit panel-only publication note", async () => {
    const route = await import("@/app/api/network/dns/[id]/route");
    const existing = await db.dnsRecord.findFirst({ where: { domainId } });
    if (!existing) throw new Error("expected a record");
    process.env.DNS_PROVIDER_MODE = "local";
    const res = await route.DELETE(
      jsonReq(`${base}/api/network/dns/${existing.id}`, adminCookie, "DELETE"),
      { params: Promise.resolve({ id: existing.id }) }
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean; publication: { executed: boolean } };
    expect(body.success).toBe(true);
    expect(body.publication.executed).toBe(false);
    expect(await db.dnsRecord.findUnique({ where: { id: existing.id } })).toBeNull();
  });
});
