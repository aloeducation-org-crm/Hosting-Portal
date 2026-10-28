/**
 * Software Factory — Industry System Registry, Service Catalog and the
 * enquiry → CRM pipeline.
 *
 * Harness mirrors tests/app-center.test.ts: isolated DB copy first, real
 * seeded users, next-auth JWT cookies for route handlers, and an applier
 * end-to-end check on a throwaway database copy.
 */
import "./helpers/isolated-db";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { NextRequest } from "next/server";
import { encode } from "next-auth/jwt";
import { db } from "@/lib/db";
import { teardownIsolatedDb } from "./helpers/isolated-db";
import {
  INDUSTRY_DEFINITIONS,
} from "@/lib/factory/industry-definitions";
import {
  SERVICE_DEFINITIONS,
  SERVICE_INDUSTRY_MAPPINGS,
} from "@/lib/factory/service-definitions";
import {
  createIndustrySchema,
  createServiceSchema,
  SERVICE_CATEGORIES,
  listPublishedIndustries,
  getPublishedIndustry,
  listPublishedServices,
  listServicesForIndustry,
} from "@/lib/factory/catalog";
import {
  isProtectedDashboardPath,
  isAdminPath,
  config as middlewareConfig,
} from "@/middleware";

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

/** Public (unauthenticated) request — for endpoints on PUBLIC_API_PATHS. */
function publicRequest(url: string, init: { method?: string; body?: string } = {}): NextRequest {
  const headers = new Headers();
  if (init.body) headers.set("content-type", "application/json");
  return new NextRequest(url, { method: init.method ?? "GET", headers, body: init.body });
}

function ctx(id: string) {
  return { params: Promise.resolve({ id }) };
}

let adminUser: SessionUser;
let clientUser: SessionUser;

beforeAll(async () => {
  const [admin, client] = await Promise.all([
    db.user.findUnique({ where: { email: "admin@alolabs.net" }, include: { role: true } }),
    db.user.findUnique({ where: { email: "client@alolabs.net" }, include: { role: true } }),
  ]);
  if (!admin?.role || !client?.role) throw new Error("seeded users missing");
  adminUser = { id: admin.id, email: admin.email, role: admin.role.name };
  clientUser = { id: client.id, email: client.email, role: client.role.name };
});

afterAll(async () => {
  await teardownIsolatedDb();
});

describe("Software Factory migration contract", () => {
  it("is additive-only: CREATE/INDEX IF NOT EXISTS and nullable ADD COLUMN", async () => {
    const sql = await fs.readFile(
      path.join(__dirname, "../prisma/migrations/20261028130000_software_factory/migration.sql"),
      "utf8"
    );
    const statements = sql
      .split("\n")
      .filter((l) => !l.trim().startsWith("--"))
      .join("\n")
      .split(";")
      .map((s) => s.trim())
      .filter(Boolean);

    expect(statements.length).toBeGreaterThanOrEqual(10);
    for (const statement of statements) {
      const additive =
        /^CREATE (TABLE|UNIQUE INDEX|INDEX) IF NOT EXISTS /i.test(statement) ||
        /^ALTER TABLE "contacts" ADD COLUMN "[a-z]+"/i.test(statement);
      expect(additive, `non-additive statement: ${statement.slice(0, 90)}`).toBe(true);
      expect(statement).not.toMatch(
        /^\s*(DROP\s|DELETE\s|TRUNCATE|ALTER\s+TABLE\s+"[a-z]+"\s+(DROP|RENAME|ALTER)|UPDATE\s|INSERT\s)/im
      );
    }
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS "industry_systems"');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS "service_catalog"');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS "service_industries"');
  });

  it("is registered as ADDITIVE in the deploy applier", async () => {
    const source = await fs.readFile(path.join(__dirname, "../scripts/apply-deploy-schema.mjs"), "utf8");
    expect(source).toContain('{ name: "20261028130000_software_factory", kind: "ADDITIVE" }');
  });

  it("the applier recreates the tables when they are missing (end-to-end)", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "factory-applier-"));
    const dbPath = path.join(tmpDir, "test.db");
    await fs.copyFile(path.join(__dirname, "../db/custom.db"), dbPath);

    const { DatabaseSync } = await import("node:sqlite");
    const probe = new DatabaseSync(dbPath);
    probe.exec('DROP TABLE IF EXISTS "service_industries"');
    probe.exec('DROP TABLE IF EXISTS "service_catalog"');
    probe.exec('DROP TABLE IF EXISTS "industry_systems"');
    probe.close();

    const out = execFileSync(
      process.execPath,
      [path.join(__dirname, "../scripts/apply-deploy-schema.mjs")],
      {
        cwd: path.join(__dirname, ".."),
        env: { ...process.env, DATABASE_URL: `file:${dbPath}` },
        encoding: "utf8",
        timeout: 120_000,
      }
    );
    const jsonText = out.slice(out.indexOf("{"), out.lastIndexOf("}") + 1);
    const result = JSON.parse(jsonText) as { ok: boolean; migrations?: string[] };

    expect(result.ok).toBe(true);
    expect(JSON.stringify(result.migrations ?? [])).toContain("20261028130000_software_factory");

    const verify = new DatabaseSync(dbPath);
    const tables = verify
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('industry_systems','service_catalog','service_industries')"
      )
      .all() as Array<{ name: string }>;
    expect(tables.map((t) => t.name).sort()).toEqual([
      "industry_systems",
      "service_catalog",
      "service_industries",
    ]);
    const idx = verify
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='index' AND name = 'service_industries_serviceId_industryId_key'"
      )
      .all();
    expect(idx.length).toBe(1);
    const cols = (verify.prepare("PRAGMA table_info(contacts)").all() as Array<{ name: string }>).map(
      (c) => c.name
    );
    for (const col of ["source", "industry", "service", "status"]) expect(cols).toContain(col);
    verify.close();
    await fs.rm(tmpDir, { recursive: true, force: true });
  }, 130_000);
});

describe("Industry content integrity", () => {
  it("defines exactly 20 distinct industry families with complete landing content", () => {
    expect(INDUSTRY_DEFINITIONS).toHaveLength(20);
    const slugs = INDUSTRY_DEFINITIONS.map((i) => i.slug);
    expect(new Set(slugs).size).toBe(20);
    expect(new Set(INDUSTRY_DEFINITIONS.map((i) => i.name)).size).toBe(20);
    expect(new Set(INDUSTRY_DEFINITIONS.map((i) => i.order)).size).toBe(20);

    for (const ind of INDUSTRY_DEFINITIONS) {
      expect(ind.slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(ind.modules.length, `${ind.slug} modules`).toBeGreaterThanOrEqual(8);
      expect(ind.features.length, `${ind.slug} features`).toBeGreaterThanOrEqual(3);
      expect(ind.challenges.length, `${ind.slug} challenges`).toBeGreaterThanOrEqual(3);
      expect(ind.workflow.length, `${ind.slug} workflow`).toBeGreaterThanOrEqual(4);
      expect(ind.faqs.length, `${ind.slug} faqs`).toBeGreaterThanOrEqual(3);
      expect(ind.reports.length, `${ind.slug} reports`).toBeGreaterThanOrEqual(3);
      expect(ind.modules.some((m) => m.mandatory), `${ind.slug} mandatory`).toBe(true);
      const keys = ind.modules.map((m) => m.key);
      expect(new Set(keys).size, `${ind.slug} module keys`).toBe(keys.length);
      const parsed = createIndustrySchema.safeParse({ ...ind, status: "published" });
      expect(parsed.success, `${ind.slug} schema: ${JSON.stringify(parsed.success ? null : parsed.error.issues[0])}`).toBe(true);
    }
  });

  it("published registry rows match the content definitions", async () => {
    const rows = await db.industrySystem.findMany({ orderBy: { order: "asc" } });
    expect(rows).toHaveLength(20);
    expect(rows.every((r) => r.status === "published")).toBe(true);
    expect(new Set(rows.map((r) => r.slug)).size).toBe(20);
    const education = rows.find((r) => r.slug === "education-consultancy");
    expect(education).toBeTruthy();
    expect(Array.isArray(education!.modules)).toBe(true);
    expect((education!.modules as unknown[]).length).toBeGreaterThanOrEqual(8);
  });
});

describe("Service catalog integrity", () => {
  it("defines 75 honest, quotation-priced services with unique slugs", () => {
    expect(SERVICE_DEFINITIONS.length).toBeGreaterThanOrEqual(70);
    const slugs = SERVICE_DEFINITIONS.map((s) => s.slug);
    expect(new Set(slugs).size).toBe(slugs.length);

    const schemaKeys = Object.keys(createServiceSchema.shape);
    for (const forbidden of ["price", "prices", "amount", "cost", "fee"]) {
      expect(schemaKeys).not.toContain(forbidden);
    }

    for (const svc of SERVICE_DEFINITIONS) {
      expect(SERVICE_CATEGORIES).toContain(svc.category);
      expect(svc.deliverables.length).toBeGreaterThanOrEqual(1);
      expect(svc.summary.length).toBeGreaterThan(10);
      const parsed = createServiceSchema.safeParse({ ...svc, status: "published" });
      expect(parsed.success, `${svc.slug}: ${JSON.stringify(parsed.success ? null : parsed.error.issues[0])}`).toBe(true);
      if (svc.category === "seo") {
        expect(
          svc.exclusions.some((x) => /guarantee|ranking/i.test(x)),
          `${svc.slug} must carry a no-guarantee exclusion`
        ).toBe(true);
      }
      if (svc.slug.startsWith("whatsapp-")) {
        expect(svc.prerequisites.length + svc.exclusions.length).toBeGreaterThan(0);
      }
    }
  });

  it("maps every one of the 20 industries to services, including the §9 examples", () => {
    const serviceSlugs = new Set(SERVICE_DEFINITIONS.map((s) => s.slug));
    const industrySlugs = new Set(INDUSTRY_DEFINITIONS.map((i) => i.slug));
    expect(SERVICE_INDUSTRY_MAPPINGS.length).toBeGreaterThanOrEqual(120);

    for (const map of SERVICE_INDUSTRY_MAPPINGS) {
      expect(serviceSlugs.has(map.service), `unknown service ${map.service}`).toBe(true);
      expect(industrySlugs.has(map.industry), `unknown industry ${map.industry}`).toBe(true);
      expect(["core", "recommended", "optional"]).toContain(map.relation);
    }

    for (const ind of INDUSTRY_DEFINITIONS) {
      const count = SERVICE_INDUSTRY_MAPPINGS.filter((m) => m.industry === ind.slug).length;
      expect(count, `${ind.slug} has no services`).toBeGreaterThanOrEqual(4);
    }

    const has = (service: string, industry: string, relation: string) =>
      SERVICE_INDUSTRY_MAPPINGS.some(
        (m) => m.service === service && m.industry === industry && m.relation === relation
      );
    expect(has("crm-implementation", "education-consultancy", "core")).toBe(true);
    expect(has("industry-website-development", "school-management", "core")).toBe(true);
    expect(has("industry-website-development", "hospital-management", "core")).toBe(true);
    expect(has("whatsapp-enquiry-capture", "real-estate", "core")).toBe(true);
    expect(has("ecommerce-development", "ecommerce", "core")).toBe(true);
    expect(has("client-portal-development", "software-digital-agency", "core")).toBe(true);
  });

  it("seeded catalog rows are complete and quotation-priced", async () => {
    const count = await db.serviceDefinition.count();
    expect(count).toBe(SERVICE_DEFINITIONS.length);
    const rows = await db.serviceDefinition.findMany();
    expect(rows.every((r) => r.priceMode === "quotation")).toBe(true);
    expect(rows.every((r) => Array.isArray(r.deliverables) && (r.deliverables as unknown[]).length >= 1)).toBe(true);
    const mappings = await db.serviceIndustry.count();
    expect(mappings).toBe(SERVICE_INDUSTRY_MAPPINGS.length);
  });
});

describe("Read helpers (public pages)", () => {
  it("lists 20 published industries in order and fetches one by slug", async () => {
    const rows = await listPublishedIndustries(db);
    expect(rows).toHaveLength(20);
    expect(rows[0]!.slug).toBe("education-consultancy");
    expect(await getPublishedIndustry(db, "hospital-management")).toBeTruthy();
    expect(await getPublishedIndustry(db, "does-not-exist")).toBeNull();
  });

  it("lists published services and per-industry mappings with relations", async () => {
    const services = await listPublishedServices(db);
    expect(services.length).toBe(SERVICE_DEFINITIONS.length);
    const mapped = await listServicesForIndustry(db, "education-consultancy");
    expect(mapped.length).toBeGreaterThanOrEqual(4);
    expect(mapped.some((m) => m.relation === "core")).toBe(true);
    expect(mapped.every((m) => m.service && m.service.slug)).toBe(true);
    expect(await listServicesForIndustry(db, "unknown-industry")).toHaveLength(0);
  });
});

describe("Registry API authorization", () => {
  const base = "http://localhost:3000";

  it("rejects unauthenticated industry/service reads with 401", async () => {
    const industries = await import("@/app/api/industries/route");
    const services = await import("@/app/api/services/route");
    expect((await industries.GET(publicRequest(`${base}/api/industries`))).status).toBe(401);
    expect((await services.GET(publicRequest(`${base}/api/services`))).status).toBe(401);
  });

  it("forbids non-admin clients with 403 but serves admins", async () => {
    const industries = await import("@/app/api/industries/route");
    const services = await import("@/app/api/services/route");

    expect((await industries.GET(await authedRequest(`${base}/api/industries`, clientUser))).status).toBe(403);
    expect((await services.GET(await authedRequest(`${base}/api/services`, clientUser))).status).toBe(403);

    const ok = await industries.GET(await authedRequest(`${base}/api/industries`, adminUser));
    expect(ok.status).toBe(200);
    const body = await ok.json();
    expect(body.data.industries).toHaveLength(20);

    const svcOk = await services.GET(await authedRequest(`${base}/api/services`, adminUser));
    expect(svcOk.status).toBe(200);
    const svcBody = await svcOk.json();
    expect(svcBody.data.services.length).toBe(SERVICE_DEFINITIONS.length);
    expect(svcBody.data.services[0].priceMode).toBe("quotation");
  });

  it("creates an industry as admin, blocks duplicate slugs, forbids clients", async () => {
    const route = await import("@/app/api/industries/route");
    const detail = await import("@/app/api/industries/[id]/route");
    const payload = {
      slug: "test-vertical",
      name: "Test Vertical",
      tagline: "A test industry family",
      summary: "Used by the software factory test suite only.",
      status: "draft",
      modules: [{ key: "core", name: "Core", description: "Core records.", mandatory: true }],
      features: [{ group: "Core", items: ["Records"] }],
      challenges: [{ title: "T", description: "Test challenge." }],
      workflow: ["Step one", "Step two", "Step three"],
      faqs: [{ q: "Q?", a: "A." }],
      reports: ["Summary"],
    };
    const body = JSON.stringify(payload);

    const asClient = await route.POST(await authedRequest(`${base}/api/industries`, clientUser, { method: "POST", body }));
    expect(asClient.status).toBe(403);

    const created = await route.POST(await authedRequest(`${base}/api/industries`, adminUser, { method: "POST", body }));
    expect(created.status).toBe(201);
    const createdBody = await created.json();
    expect(createdBody.data.industry.slug).toBe("test-vertical");

    const dup = await route.POST(await authedRequest(`${base}/api/industries`, adminUser, { method: "POST", body }));
    expect(dup.status).toBe(409);

    const invalid = await route.POST(
      await authedRequest(`${base}/api/industries`, adminUser, {
        method: "POST",
        body: JSON.stringify({ ...payload, slug: "Bad Slug!" }),
      })
    );
    expect(invalid.status).toBe(400);

    const id = createdBody.data.industry.id as string;
    const patched = await detail.PATCH(
      await authedRequest(`${base}/api/industries/${id}`, adminUser, {
        method: "PATCH",
        body: JSON.stringify({ status: "hidden" }),
      }),
      ctx(id)
    );
    expect(patched.status).toBe(200);

    const hidden = await db.industrySystem.findUnique({ where: { slug: "test-vertical" } });
    expect(hidden?.status).toBe("hidden");

    const deleted = await detail.DELETE(
      await authedRequest(`${base}/api/industries/${id}`, adminUser, { method: "DELETE" }),
      ctx(id)
    );
    expect(deleted.status).toBe(200);
    expect(await db.industrySystem.findUnique({ where: { slug: "test-vertical" } })).toBeNull();
  });

  it("creates a service with mappings, rejects unknown industries, protects mapped deletes", async () => {
    const route = await import("@/app/api/services/route");
    const detail = await import("@/app/api/services/[id]/route");
    const payload = {
      slug: "test-service-offering",
      name: "Test Service Offering",
      category: "software",
      summary: "A disposable service used by tests.",
      description: "Created and destroyed by the software factory test suite.",
      deliverables: [{ name: "Thing", description: "A delivered thing." }],
      prerequisites: ["Nothing"],
      exclusions: ["Everything else"],
      requiredApps: [],
      status: "draft",
      industries: [{ industry: "education-consultancy", relation: "recommended" }],
    };

    const created = await route.POST(
      await authedRequest(`${base}/api/services`, adminUser, { method: "POST", body: JSON.stringify(payload) })
    );
    expect(created.status).toBe(201);
    const svc = (await created.json()).data.service;
    expect(svc.id).toBeTruthy();

    const bad = await route.POST(
      await authedRequest(`${base}/api/services`, adminUser, {
        method: "POST",
        body: JSON.stringify({
          ...payload,
          slug: "test-service-2",
          industries: [{ industry: "nope-industry", relation: "core" }],
        }),
      })
    );
    expect(bad.status).toBe(400);

    const mappedDelete = await detail.DELETE(
      await authedRequest(`${base}/api/services/${svc.id}`, adminUser, { method: "DELETE" }),
      ctx(svc.id)
    );
    expect(mappedDelete.status).toBe(409);
    expect((await mappedDelete.json()).error.details.mappings).toBe(1);

    const unmap = await detail.PATCH(
      await authedRequest(`${base}/api/services/${svc.id}`, adminUser, {
        method: "PATCH",
        body: JSON.stringify({ industries: [] }),
      }),
      ctx(svc.id)
    );
    expect(unmap.status).toBe(200);
    expect((await unmap.json()).data.mappingCount).toBe(0);

    const deleted = await detail.DELETE(
      await authedRequest(`${base}/api/services/${svc.id}`, adminUser, { method: "DELETE" }),
      ctx(svc.id)
    );
    expect(deleted.status).toBe(200);
    expect(await db.serviceDefinition.findUnique({ where: { slug: "test-service-offering" } })).toBeNull();

    const asClient = await route.POST(
      await authedRequest(`${base}/api/services`, clientUser, { method: "POST", body: JSON.stringify(payload) })
    );
    expect(asClient.status).toBe(403);
  });
});

describe("Enquiry pipeline (public contact → Client CRM)", () => {
  const base = "http://localhost:3000";
  const EMAIL = "factory-enquiry@example.com";

  it("stores the contact with attribution and creates a CRM lead", async () => {
    const route = await import("@/app/api/contact/route");
    const res = await route.POST(
      publicRequest(`${base}/api/contact`, {
        method: "POST",
        body: JSON.stringify({
          name: "Factory Enquiry",
          email: EMAIL,
          subject: "Enquiry — hospital-management",
          message: "We need a hospital management system for a clinic group.",
          source: "industry-landing",
          industry: "hospital-management",
          service: "industry-website-development",
        }),
      })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);

    const contact = await db.contact.findUnique({ where: { id: body.id } });
    expect(contact).toBeTruthy();
    expect(contact!.industry).toBe("hospital-management");
    expect(contact!.service).toBe("industry-website-development");
    expect(contact!.source).toBe("industry-landing");
    expect(contact!.status).toBe("new");

    const lead = await db.crmContact.findFirst({ where: { email: EMAIL } });
    expect(lead).toBeTruthy();
    expect(lead!.status).toBe("lead");
    expect(lead!.userId).toBeNull();
    expect(lead!.notes).toContain("hospital-management");
  });

  it("deduplicates CRM leads per email while keeping every contact row", async () => {
    const route = await import("@/app/api/contact/route");
    const first = await db.crmContact.count({ where: { email: EMAIL } });
    expect(first).toBe(1);

    const res = await route.POST(
      publicRequest(`${base}/api/contact`, {
        method: "POST",
        body: JSON.stringify({
          name: "Factory Enquiry",
          email: EMAIL,
          message: "Following up on my earlier enquiry about the clinic system.",
          source: "industry-landing",
          industry: "hospital-management",
        }),
      })
    );
    expect(res.status).toBe(200);
    expect(await db.crmContact.count({ where: { email: EMAIL } })).toBe(first);
    expect(await db.contact.count({ where: { email: EMAIL } })).toBe(2);
  });

  it("validates required fields and slug formats", async () => {
    const route = await import("@/app/api/contact/route");

    const badEmail = await route.POST(
      publicRequest(`${base}/api/contact`, {
        method: "POST",
        body: JSON.stringify({ name: "X Y", email: "not-an-email", message: "Long enough message here." }),
      })
    );
    expect(badEmail.status).toBe(400);

    const badIndustry = await route.POST(
      publicRequest(`${base}/api/contact`, {
        method: "POST",
        body: JSON.stringify({
          name: "X Y",
          email: "slug-test@example.com",
          message: "Long enough message here.",
          industry: "Not A Slug",
        }),
      })
    );
    expect(badIndustry.status).toBe(400);
  });
});

describe("Routing guards", () => {
  it("protects registry admin pages but leaves public pages open", () => {
    expect(isProtectedDashboardPath("/dashboard/industries")).toBe(true);
    expect(isProtectedDashboardPath("/dashboard/services")).toBe(true);
    expect(isAdminPath("/dashboard/industries")).toBe(true);
    expect(isAdminPath("/dashboard/services")).toBe(true);

    expect(isProtectedDashboardPath("/industries")).toBe(false);
    expect(isProtectedDashboardPath("/services")).toBe(false);
    expect(isProtectedDashboardPath("/industries/hospital-management")).toBe(false);
    expect(isAdminPath("/industries")).toBe(false);
  });

  it("middleware matcher covers the admin dashboard and the registries are admin-gated at the edge", async () => {
    const matchers = (middlewareConfig as { matcher: string[] }).matcher;
    expect(matchers).toContain("/dashboard/:path*");

    const source = await fs.readFile(path.join(__dirname, "../src/middleware.ts"), "utf8");
    const adminApiBlock = source.slice(source.indexOf("ADMIN_API_PREFIXES"), source.indexOf("ADMIN_API_WRITE_PREFIXES"));
    expect(adminApiBlock).toContain('"/api/industries"');
    expect(adminApiBlock).toContain('"/api/services"');
    const adminUiBlock = source.slice(source.indexOf("ADMIN_UI_PREFIXES"), source.indexOf("DASHBOARD_UI_PREFIXES"));
    expect(adminUiBlock).toContain('"/dashboard/industries"');
    expect(adminUiBlock).toContain('"/dashboard/services"');
  });
});
