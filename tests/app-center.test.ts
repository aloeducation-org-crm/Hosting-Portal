/**
 * Must be the first import in this file: it points DATABASE_URL at a throwaway
 * copy of db/custom.db before `@/lib/db` is evaluated, so these tests cannot
 * write into the tracked development database. See tests/helpers/isolated-db.ts.
 */
import { teardownIsolatedDb } from "./helpers/isolated-db";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { NextRequest } from "next/server";
import { encode } from "next-auth/jwt";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { db } from "@/lib/db";
import { isProtectedDashboardPath, isAdminPath, config as middlewareConfig } from "@/middleware";
import {
  BUILTIN_APPS,
  APP_CATEGORIES,
  createAppSchema,
  installSchema,
  slugify,
  isValidSlug,
  validateSettings,
  effectiveBranding,
  effectiveSettings,
  mergeOverrides,
  canManageCompany,
  canViewCompany,
  ensureBuiltinApps,
} from "@/lib/app-center";

const TEST_JWT_SECRET = "dev-secret-change-in-production";
const MIGRATION_NAME = "20261028100000_app_center";
const MIGRATION_FILE = path.resolve("prisma/migrations", MIGRATION_NAME, "migration.sql");
const APPLIER_FILE = path.resolve("scripts/apply-deploy-schema.mjs");

process.env.NEXTAUTH_SECRET = process.env.NEXTAUTH_SECRET || TEST_JWT_SECRET;

// ─── Authenticated request helper (phase2 pattern) ──────────────────────────

async function authedRequest(
  url: string,
  user: { id: string; email: string; role: string },
  init?: { method?: string; body?: string },
): Promise<NextRequest> {
  process.env.NEXTAUTH_SECRET = TEST_JWT_SECRET;
  const token = await encode({
    secret: TEST_JWT_SECRET,
    token: { id: user.id, sub: user.id, email: user.email, role: user.role },
  });
  const headers = new Headers();
  headers.set("cookie", `next-auth.session-token=${token}`);
  if (init?.body) headers.set("content-type", "application/json");
  return new NextRequest(url, {
    method: init?.method ?? "GET",
    headers,
    body: init?.body,
  });
}

async function json(res: Response) {
  return res.json();
}

/** Next.js passes `{ params }` as the 2nd route arg — tests must too. */
function ctx(id: string): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id }) };
}

// ─── Shared fixtures (resolved once against the isolated copy) ─────────────

let admin: { id: string; email: string; role: string };
let client: { id: string; email: string; role: string };
let orgA = ""; // owned by client
let orgB = ""; // owned by admin
let suffix = "";

beforeAll(async () => {
  const adminRow = await db.user.findUnique({
    where: { email: "admin@alolabs.net" },
    select: { id: true, email: true, role: { select: { name: true } } },
  });
  const clientRow = await db.user.findUnique({
    where: { email: "client@alolabs.net" },
    select: { id: true, email: true, role: { select: { name: true } } },
  });
  if (!adminRow || !clientRow) throw new Error("seeded users missing from isolated database");
  admin = { id: adminRow.id, email: adminRow.email, role: adminRow.role.name };
  client = { id: clientRow.id, email: clientRow.email, role: clientRow.role.name };

  suffix = `${Date.now().toString(36)}`;
  orgA = (
    await db.organization.create({
      data: { name: "Tenant A", slug: `tenant-a-${suffix}`, ownerId: client.id },
      select: { id: true },
    })
  ).id;
  orgB = (
    await db.organization.create({
      data: { name: "Tenant B", slug: `tenant-b-${suffix}`, ownerId: admin.id },
      select: { id: true },
    })
  ).id;
});

afterAll(async () => {
  await teardownIsolatedDb();
});

// ─── 1. Migration contract: additive-only SQL, registered with the applier ──

describe("App Center migration contract", () => {
  it("is additive-only: CREATE/INDEX IF NOT EXISTS, never DROP/DELETE/ALTER", () => {
    const sql = fs.readFileSync(MIGRATION_FILE, "utf8");
    const statements = sql
      .split("\n")
      .filter((line) => !line.trim().startsWith("--"))
      .join("\n")
      .split(";")
      .map((s) => s.trim())
      .filter(Boolean);

    expect(statements.length).toBeGreaterThanOrEqual(8);
    for (const statement of statements) {
      expect(statement).toMatch(/^CREATE (TABLE|UNIQUE INDEX|INDEX) IF NOT EXISTS /i);
      // Destructive verbs can only appear at the start of a line inside a
      // statement (the applier strips comments and splits on ';'). FK clauses
      // like `ON DELETE CASCADE` sit mid-line after REFERENCES, so they pass.
      expect(statement).not.toMatch(/^\s*(DROP\s|DELETE\s|TRUNCATE|ALTER\s|UPDATE\s|INSERT\s)/im);
    }
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS "app_definitions"');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS "company_apps"');
    expect(sql).toContain('"company_apps_appId_organizationId_key"');
  });

  it("keeps semicolons out of comment lines (the applier splits statements on ';')", () => {
    const sql = fs.readFileSync(MIGRATION_FILE, "utf8");
    for (const line of sql.split("\n")) {
      if (line.trim().startsWith("--")) expect(line).not.toContain(";");
    }
  });

  it("is registered in the deploy applier as an ADDITIVE migration", () => {
    const source = fs.readFileSync(APPLIER_FILE, "utf8");
    expect(source).toContain(`{ name: "${MIGRATION_NAME}", kind: "ADDITIVE" }`);
    // The folder must exist with its migration.sql or registry() filters it out.
    expect(fs.existsSync(MIGRATION_FILE)).toBe(true);
  });

  it("the applier recreates the tables when they are missing (registration works end-to-end)", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "alo-appcenter-applier-"));
    const dbPath = path.join(root, "applier.db");
    fs.copyFileSync(path.resolve("db/custom.db"), dbPath);

    // Simulate a database from before this release: drop just the App Center tables.
    execFileSync(
      process.execPath,
      [
        "-e",
        `const { DatabaseSync } = require("node:sqlite");
         const db = new DatabaseSync(process.argv[1]);
         db.exec("DROP TABLE IF EXISTS company_apps");
         db.exec("DROP TABLE IF EXISTS app_definitions");
         db.close();`,
        dbPath,
      ],
      { stdio: "pipe" },
    );

    const out = execFileSync(process.execPath, ["scripts/apply-deploy-schema.mjs"], {
      cwd: process.cwd(),
      env: { ...process.env, DATABASE_URL: `file:${dbPath}` },
      encoding: "utf8",
      stdio: "pipe",
      timeout: 120_000,
    });
    const result = JSON.parse(out.slice(out.indexOf("{"), out.lastIndexOf("}") + 1));
    expect(result.ok).toBe(true);
    expect(result.migrations).toContain(MIGRATION_NAME);

    const tables = execFileSync(
      process.execPath,
      [
        "-e",
        `const { DatabaseSync } = require("node:sqlite");
         const db = new DatabaseSync(process.argv[1]);
         const rows = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('app_definitions','company_apps')").all();
         const idx = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='company_apps_appId_organizationId_key'").all();
         console.log(JSON.stringify({ tables: rows.map(r=>r.name), idx: idx.length }));`,
        dbPath,
      ],
      { encoding: "utf8", stdio: "pipe" },
    ).trim();
    const state = JSON.parse(tables);
    expect(state.tables.sort()).toEqual(["app_definitions", "company_apps"]);
    expect(state.idx).toBe(1);

    fs.rmSync(root, { recursive: true, force: true });
  });
});

// ─── 2. Domain library: validation, merge semantics, catalog sanity ─────────

describe("app-center domain library", () => {
  it("slugifies names into valid slugs", () => {
    expect(slugify("My Cool App")).toBe("my-cool-app");
    expect(isValidSlug(slugify("My Cool App"))).toBe(true);
    expect(isValidSlug("Bad Slug!")).toBe(false);
  });

  it("createAppSchema rejects bad accents/categories and allows auto-slug", () => {
    expect(
      createAppSchema.safeParse({ name: "Project Portal", category: "projects" }).success,
    ).toBe(true);
    expect(
      createAppSchema.safeParse({ name: "X!", category: "nope" }).success,
    ).toBe(false);
    expect(
      createAppSchema.safeParse({
        name: "Bad Color",
        category: "operations",
        accentColor: "orange",
      }).success,
    ).toBe(false);
    expect(
      createAppSchema.safeParse({ name: "Bad Route", category: "operations", route: "nope" })
        .success,
    ).toBe(false);
  });

  it("installSchema requires organizationId and validates settings value types", () => {
    expect(installSchema.safeParse({ organizationId: "org-1" }).success).toBe(true);
    expect(installSchema.safeParse({}).success).toBe(false);
    expect(
      installSchema.safeParse({ organizationId: "org-1", settings: { n: "not-a-number" } })
        .success,
    ).toBe(true); // shape-level ok; schema-aware checking is validateSettings' job
  });

  it("validateSettings rejects unknown keys, wrong types and bad select options", () => {
    const config = [
      { key: "currency", label: "Currency", type: "select", options: ["USD", "EUR"], default: "USD" },
      { key: "autoInvoice", label: "Auto", type: "boolean", default: true },
      { key: "terms", label: "Terms (days)", type: "number", default: 30 },
    ];
    expect(validateSettings(config, { currency: "EUR", autoInvoice: false }).ok).toBe(true);
    const unknown = validateSettings(config, { nope: 1 });
    expect(unknown.ok).toBe(false);
    if (!unknown.ok) expect(unknown.errors.nope).toContain("Unknown setting");
    const wrongType = validateSettings(config, { autoInvoice: "yes" });
    expect(wrongType.ok).toBe(false);
    const badOption = validateSettings(config, { currency: "JPY" });
    expect(badOption.ok).toBe(false);
    const badNumber = validateSettings(config, { terms: "soon" });
    expect(badNumber.ok).toBe(false);
    // Apps with no config schema accept nothing (settings must be declared first).
    const noSchema = validateSettings(null, { anything: true });
    expect(noSchema.ok).toBe(false);
  });

  it("effectiveSettings layers field defaults, catalog defaults, then company overrides", () => {
    const definition = {
      name: "Accounting",
      accentColor: "#0F766E",
      configSchema: [
        { key: "currency", label: "Currency", type: "select", options: ["USD", "EUR"], default: "USD" },
        { key: "autoInvoice", label: "Auto", type: "boolean", default: true },
      ],
      defaultSettings: { currency: "EUR" },
    };
    // No install → field defaults overlaid by catalog defaultSettings.
    expect(effectiveSettings(definition, null)).toEqual({ currency: "EUR", autoInvoice: true });
    // Company override wins over both.
    expect(effectiveSettings(definition, { settings: { currency: "BDT" } })).toEqual({
      currency: "BDT",
      autoInvoice: true,
    });
    // Stale override keys outside the schema are ignored, not fatal.
    expect(
      effectiveSettings(definition, { settings: { currency: "USD", legacyFlag: true } }),
    ).toEqual({ currency: "USD", autoInvoice: true });
  });

  it("effectiveBranding falls back to the catalog and lets the company override", () => {
    const definition = { name: "CRM", accentColor: "#2563EB" };
    expect(effectiveBranding(definition, null)).toEqual({
      name: "CRM",
      logoUrl: null,
      accentColor: "#2563EB",
    });
    expect(effectiveBranding(definition, { branding: { name: "Acme Pipeline" } })).toEqual({
      name: "Acme Pipeline",
      logoUrl: null,
      accentColor: "#2563EB",
    });
    // A null override clears back to the catalog default.
    expect(effectiveBranding(definition, { branding: { name: null } }).name).toBe("CRM");
  });

  it("mergeOverrides preserves stored values, patches provided ones, null clears", () => {
    expect(mergeOverrides({ a: 1, b: 2 }, undefined)).toBeUndefined();
    expect(mergeOverrides({ a: 1, b: 2 }, { b: 3 })).toEqual({ a: 1, b: 3 });
    expect(mergeOverrides({ a: 1, b: 2 }, { a: null })).toEqual({ a: null, b: 2 });
    expect(mergeOverrides(null, { a: 1 })).toEqual({ a: 1 });
  });

  it("built-in catalog is well-formed: unique slugs, known categories, sane routes", () => {
    const slugs = BUILTIN_APPS.map((a) => a.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    expect(slugs).toEqual(
      expect.arrayContaining(["accounting", "crm", "hr", "projects", "helpdesk", "ai", "documents", "website"]),
    );
    const categoryIds = APP_CATEGORIES.map((c) => c.id);
    for (const app of BUILTIN_APPS) {
      expect(categoryIds).toContain(app.category);
      expect(app.route === null || app.route.startsWith("/")).toBe(true);
      expect(app.icon).toBeTruthy();
      expect(app.accentColor).toMatch(/^#[0-9a-fA-F]{6}$/);
      expect(validateSettings(app.configSchema, app.defaultSettings).ok).toBe(true);
    }
  });

  it("ensureBuiltinApps is idempotent and never clobbers admin edits", async () => {
    await ensureBuiltinApps(db);
    await ensureBuiltinApps(db);
    const count = await db.appDefinition.count({
      where: { slug: { in: BUILTIN_APPS.map((a) => a.slug) } },
    });
    expect(count).toBe(BUILTIN_APPS.length);

    await db.appDefinition.update({ where: { slug: "crm" }, data: { name: "Renamed CRM" } });
    await ensureBuiltinApps(db);
    const renamed = await db.appDefinition.findUnique({ where: { slug: "crm" } });
    expect(renamed?.name).toBe("Renamed CRM");
    expect(renamed?.isSystem).toBe(true);
    await db.appDefinition.update({ where: { slug: "crm" }, data: { name: "CRM" } });
  });
});

// ─── 3. Authorization rules (pure, DB-backed helpers) ───────────────────────

describe("company authorization", () => {
  it("admins manage everything; owners manage their own; others manage nothing", async () => {
    expect(await canManageCompany(db, admin, orgA)).toBe(true); // platform admin
    expect(await canManageCompany(db, client, orgA)).toBe(true); // client owns orgA
    expect(await canManageCompany(db, client, orgB)).toBe(false); // foreign company
    expect(await canViewCompany(db, client, orgB)).toBe(false);
    expect(await canViewCompany(db, client, orgA)).toBe(true);
  });

  it("an ordinary MEMBER can view but not install", async () => {
    const reseller = await db.user.findUnique({
      where: { email: "reseller@alolabs.net" },
      select: { id: true, email: true, role: { select: { name: true } } },
    });
    if (!reseller) throw new Error("reseller user missing");
    await db.membership.create({
      data: { userId: reseller.id, organizationId: orgA, role: "MEMBER" },
    });
    const member = { id: reseller.id, role: reseller.role.name };
    expect(await canViewCompany(db, member, orgA)).toBe(true);
    expect(await canManageCompany(db, member, orgA)).toBe(false);
    await db.membership.delete({
      where: { userId_organizationId: { userId: reseller.id, organizationId: orgA } },
    });
  });
});

// ─── 4. Route-level API: catalog, install lifecycle, multi-company reuse ────

describe("App Center API", () => {
  it("rejects unauthenticated catalog reads with 401", async () => {
    const { GET } = await import("@/app/api/apps/route");
    const res = await GET(new NextRequest("http://localhost:3000/api/apps"));
    expect(res.status).toBe(401);
  });

  it("serves the self-seeded catalog to signed-in users", async () => {
    const { GET } = await import("@/app/api/apps/route");
    const res = await GET(await authedRequest("http://localhost:3000/api/apps", client));
    expect(res.status).toBe(200);
    const body = await json(res);
    const slugs = body.data.apps.map((a: { slug: string }) => a.slug);
    expect(slugs).toEqual(expect.arrayContaining(["accounting", "crm", "website"]));
    expect(body.data.categories.length).toBe(APP_CATEGORIES.length);
    // Reuse counts are a platform-admin detail — never leaked to tenants.
    for (const app of body.data.apps) {
      expect(app.installedCompanies).toBeUndefined();
    }
  });

  it("forbids non-admins from creating catalog definitions", async () => {
    const { POST } = await import("@/app/api/apps/route");
    const res = await POST(
      await authedRequest("http://localhost:3000/api/apps", client, {
        method: "POST",
        body: JSON.stringify({ name: "Sneaky App", category: "operations" }),
      }),
    );
    expect(res.status).toBe(403);
  });

  it("lets admins create custom apps, and enforces unique slugs with 409", async () => {
    const { POST } = await import("@/app/api/apps/route");
    const payload = {
      name: `Custom Portal ${suffix}`,
      slug: `custom-portal-${suffix}`,
      category: "projects",
      summary: "A per-tenant favorite",
      accentColor: "#4F46E5",
      configSchema: [{ key: "theme", label: "Theme", type: "select", options: ["light", "dark"], default: "light" }],
    };
    const created = await POST(
      await authedRequest("http://localhost:3000/api/apps", admin, {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    );
    expect(created.status).toBe(201);
    const body = await json(created);
    expect(body.data.app.slug).toBe(payload.slug);
    expect(body.data.app.isSystem).toBe(false);

    const dup = await POST(
      await authedRequest("http://localhost:3000/api/apps", admin, {
        method: "POST",
        body: JSON.stringify({ ...payload, name: "Same Slug" }),
      }),
    );
    expect(dup.status).toBe(409);
  });

  it("scopes catalog reads by company: 403 for foreign companies", async () => {
    const { GET } = await import("@/app/api/apps/route");
    const res = await GET(
      await authedRequest(
        `http://localhost:3000/api/apps?organizationId=${orgB}`,
        client, // not a member of orgB and not a platform admin
      ),
    );
    expect(res.status).toBe(403);
  });

  it("installs one shared definition into two companies with independent branding and settings", async () => {
    const catalog = await import("@/app/api/apps/route");
    const installRoute = await import("@/app/api/apps/[id]/install/route");

    const accounting = await db.appDefinition.findUnique({ where: { slug: "accounting" } });
    expect(accounting).not.toBeNull();
    if (!accounting) throw new Error("accounting definition missing");

    // Client brands it their way for orgA.
    const installA = await installRoute.POST(
      await authedRequest(`http://localhost:3000/api/apps/${accounting.id}/install`, client, {
        method: "POST",
        body: JSON.stringify({
          organizationId: orgA,
          branding: { name: "Tenant A Books", accentColor: "#B45309" },
          settings: { currency: "BDT", autoInvoice: false },
        }),
      }),
      ctx(accounting.id),
    );
    expect(installA.status).toBe(201);

    // Admin brands the SAME app differently for orgB.
    const installB = await installRoute.POST(
      await authedRequest(`http://localhost:3000/api/apps/${accounting.id}/install`, admin, {
        method: "POST",
        body: JSON.stringify({
          organizationId: orgB,
          branding: { name: "Tenant B Ledger", accentColor: "#047857" },
          settings: { currency: "EUR" },
        }),
      }),
      ctx(accounting.id),
    );
    expect(installB.status).toBe(201);

    // Still exactly ONE definition row — that's the reuse invariant.
    const defCount = await db.appDefinition.count({ where: { slug: "accounting" } });
    expect(defCount).toBe(1);
    const installCount = await db.companyApp.count({ where: { appId: accounting.id } });
    expect(installCount).toBeGreaterThanOrEqual(2);

    // Each company's catalog view shows its OWN branding and settings.
    const viewA = await catalog.GET(
      await authedRequest(
        `http://localhost:3000/api/apps?organizationId=${orgA}`,
        client,
      ),
    );
    const appA = (await json(viewA)).data.apps.find(
      (a: { slug: string }) => a.slug === "accounting",
    );
    expect(appA.branding.name).toBe("Tenant A Books");
    expect(appA.branding.accentColor).toBe("#B45309");
    expect(appA.settings.currency).toBe("BDT");
    expect(appA.settings.autoInvoice).toBe(false);

    const viewB = await catalog.GET(
      await authedRequest(`http://localhost:3000/api/apps?organizationId=${orgB}`, admin),
    );
    const appB = (await json(viewB)).data.apps.find(
      (a: { slug: string }) => a.slug === "accounting",
    );
    expect(appB.branding.name).toBe("Tenant B Ledger");
    expect(appB.branding.accentColor).toBe("#047857");
    expect(appB.settings.currency).toBe("EUR");
    // orgB did not set autoInvoice → falls back to the catalog default (true).
    expect(appB.settings.autoInvoice).toBe(true);
  });

  it("blocks a tenant from installing into someone else's company (403)", async () => {
    const { POST } = await import("@/app/api/apps/[id]/install/route");
    const crm = await db.appDefinition.findUnique({ where: { slug: "crm" } });
    if (!crm) throw new Error("crm definition missing");
    const res = await POST(
      await authedRequest(`http://localhost:3000/api/apps/${crm.id}/install`, client, {
        method: "POST",
        body: JSON.stringify({ organizationId: orgB }),
      }),
      ctx(crm.id),
    );
    expect(res.status).toBe(403);
    const rows = await db.companyApp.count({ where: { appId: crm.id, organizationId: orgB } });
    expect(rows).toBe(0);
  });

  it("validates settings against the app's config schema on install", async () => {
    const { POST } = await import("@/app/api/apps/[id]/install/route");
    const accounting = await db.appDefinition.findUnique({ where: { slug: "accounting" } });
    if (!accounting) throw new Error("accounting definition missing");
    const res = await POST(
      await authedRequest(`http://localhost:3000/api/apps/${accounting.id}/install`, client, {
        method: "POST",
        body: JSON.stringify({
          organizationId: orgA,
          settings: { currency: "XYZ", mysteryKnob: 1 },
        }),
      }),
      ctx(accounting.id),
    );
    expect(res.status).toBe(400);
    const body = await json(res);
    expect(Object.keys(body.error.details.settings)).toEqual(
      expect.arrayContaining(["currency", "mysteryKnob"]),
    );
  });

  it("reconfigures one company without touching the other (PATCH isolation)", async () => {
    const { PATCH } = await import("@/app/api/apps/[id]/install/route");
    const accounting = await db.appDefinition.findUnique({ where: { slug: "accounting" } });
    if (!accounting) throw new Error("accounting definition missing");

    const res = await PATCH(
      await authedRequest(
        `http://localhost:3000/api/apps/${accounting.id}/install?organizationId=${orgA}`,
        client,
        {
          method: "PATCH",
          body: JSON.stringify({ branding: { name: "Tenant A Books v2" } }),
        },
      ),
      ctx(accounting.id),
    );
    expect(res.status).toBe(200);

    const rowA = await db.companyApp.findUnique({
      where: { appId_organizationId: { appId: accounting.id, organizationId: orgA } },
    });
    const rowB = await db.companyApp.findUnique({
      where: { appId_organizationId: { appId: accounting.id, organizationId: orgB } },
    });
    expect((rowA?.branding as { name?: string }).name).toBe("Tenant A Books v2");
    expect((rowB?.branding as { name?: string }).name).toBe("Tenant B Ledger");
  });

  it("uninstalls only the requesting company's row; the definition survives for everyone", async () => {
    const { DELETE } = await import("@/app/api/apps/[id]/install/route");
    const accounting = await db.appDefinition.findUnique({ where: { slug: "accounting" } });
    if (!accounting) throw new Error("accounting definition missing");

    const res = await DELETE(
      await authedRequest(
        `http://localhost:3000/api/apps/${accounting.id}/install?organizationId=${orgA}`,
        client,
        { method: "DELETE" },
      ),
      ctx(accounting.id),
    );
    expect(res.status).toBe(200);

    expect(
      await db.companyApp.findUnique({
        where: { appId_organizationId: { appId: accounting.id, organizationId: orgA } },
      }),
    ).toBeNull();
    // orgB keeps running the app and the shared definition is untouched.
    expect(
      await db.companyApp.findUnique({
        where: { appId_organizationId: { appId: accounting.id, organizationId: orgB } },
      }),
    ).not.toBeNull();
    expect(await db.appDefinition.findUnique({ where: { id: accounting.id } })).not.toBeNull();

    // Second uninstall is an honest 404, not a silent success.
    const again = await DELETE(
      await authedRequest(
        `http://localhost:3000/api/apps/${accounting.id}/install?organizationId=${orgA}`,
        client,
        { method: "DELETE" },
      ),
      ctx(accounting.id),
    );
    expect(again.status).toBe(404);
  });

  it("protects definitions: system apps undeletable, installed apps refused, custom deletable", async () => {
    const route = await import("@/app/api/apps/[id]/route");

    const systemApp = await db.appDefinition.findUnique({ where: { slug: "accounting" } });
    if (!systemApp) throw new Error("accounting definition missing");
    // Built-ins are permanent — refused before install state is even considered.
    const delSystem = await route.DELETE(
      await authedRequest(`http://localhost:3000/api/apps/${systemApp.id}`, admin, {
        method: "DELETE",
      }),
      ctx(systemApp.id),
    );
    expect(delSystem.status).toBe(403);
    expect(await db.appDefinition.findUnique({ where: { id: systemApp.id } })).not.toBeNull();

    // A custom app with an installation must be uninstalled first…
    const custom = await db.appDefinition.findUnique({
      where: { slug: `custom-portal-${suffix}` },
    });
    if (!custom) throw new Error("custom app missing");
    const installRoute = await import("@/app/api/apps/[id]/install/route");
    await installRoute.POST(
      await authedRequest(`http://localhost:3000/api/apps/${custom.id}/install`, admin, {
        method: "POST",
        body: JSON.stringify({ organizationId: orgB }),
      }),
      ctx(custom.id),
    );
    const delBusy = await route.DELETE(
      await authedRequest(`http://localhost:3000/api/apps/${custom.id}`, admin, {
        method: "DELETE",
      }),
      ctx(custom.id),
    );
    expect(delBusy.status).toBe(409);

    // …and once free, it goes away.
    await installRoute.DELETE(
      await authedRequest(
        `http://localhost:3000/api/apps/${custom.id}/install?organizationId=${orgB}`,
        admin,
        { method: "DELETE" },
      ),
      ctx(custom.id),
    );
    const delOk = await route.DELETE(
      await authedRequest(`http://localhost:3000/api/apps/${custom.id}`, admin, {
        method: "DELETE",
      }),
      ctx(custom.id),
    );
    expect(delOk.status).toBe(200);
    expect(await db.appDefinition.findUnique({ where: { id: custom.id } })).toBeNull();

    // Non-admins can never delete, even custom apps.
    const delForbidden = await route.DELETE(
      await authedRequest(`http://localhost:3000/api/apps/${systemApp.id}`, client, {
        method: "DELETE",
      }),
      ctx(systemApp.id),
    );
    expect(delForbidden.status).toBe(403);
  });

  it("admins can hide a built-in from tenants via status", async () => {
    const route = await import("@/app/api/apps/[id]/route");
    const catalog = await import("@/app/api/apps/route");
    const helpdesk = await db.appDefinition.findUnique({ where: { slug: "helpdesk" } });
    if (!helpdesk) throw new Error("helpdesk definition missing");

    const hidden = await route.PATCH(
      await authedRequest(`http://localhost:3000/api/apps/${helpdesk.id}`, admin, {
        method: "PATCH",
        body: JSON.stringify({ status: "hidden" }),
      }),
      ctx(helpdesk.id),
    );
    expect(hidden.status).toBe(200);

    const tenantView = await catalog.GET(
      await authedRequest(
        `http://localhost:3000/api/apps?organizationId=${orgA}`,
        client,
      ),
    );
    const slugs = (await json(tenantView)).data.apps.map((a: { slug: string }) => a.slug);
    expect(slugs).not.toContain("helpdesk");

    const adminView = await catalog.GET(
      await authedRequest(`http://localhost:3000/api/apps`, admin),
    );
    const adminSlugs = (await json(adminView)).data.apps.map((a: { slug: string }) => a.slug);
    expect(adminSlugs).toContain("helpdesk");

    await db.appDefinition.update({ where: { slug: "helpdesk" }, data: { status: "active" } });
  });
});

// ─── 5. Companies endpoint ──────────────────────────────────────────────────

describe("/api/companies", () => {
  it("shows users only their own companies and admins everything", async () => {
    const { GET } = await import("@/app/api/companies/route");

    const clientView = await GET(await authedRequest("http://localhost:3000/api/companies", client));
    expect(clientView.status).toBe(200);
    const clientSlugs = (await json(clientView)).data.companies.map((c: { slug: string }) => c.slug);
    expect(clientSlugs).toContain(`tenant-a-${suffix}`);
    expect(clientSlugs).not.toContain(`tenant-b-${suffix}`);

    const adminView = await GET(await authedRequest("http://localhost:3000/api/companies", admin));
    const adminSlugs = (await json(adminView)).data.companies.map((c: { slug: string }) => c.slug);
    expect(adminSlugs).toEqual(expect.arrayContaining([`tenant-a-${suffix}`, `tenant-b-${suffix}`]));
  });

  it("lets a signed-in user create a company they own", async () => {
    const route = await import("@/app/api/companies/route");
    const created = await route.POST(
      await authedRequest("http://localhost:3000/api/companies", client, {
        method: "POST",
        body: JSON.stringify({ name: `Branch Office ${suffix}` }),
      }),
    );
    expect(created.status).toBe(201);
    const company = (await json(created)).data.company;
    expect(company.role).toBe("OWNER");

    const membership = await db.membership.findUnique({
      where: {
        userId_organizationId: { userId: client.id, organizationId: company.id },
      },
    });
    expect(membership?.role).toBe("OWNER");

    // Invalid payloads are rejected up front.
    const bad = await route.POST(
      await authedRequest("http://localhost:3000/api/companies", client, {
        method: "POST",
        body: JSON.stringify({ name: "x" }),
      }),
    );
    expect(bad.status).toBe(400);
  });
});

// ─── 6. Middleware surface ──────────────────────────────────────────────────

describe("App Center routing", () => {
  it("protects /apps as a dashboard page but not as an admin-only path", () => {
    expect(isProtectedDashboardPath("/apps")).toBe(true);
    expect(isProtectedDashboardPath("/apps/settings")).toBe(true);
    expect(isAdminPath("/apps")).toBe(false);
  });

  it("the middleware matcher actually runs for /apps (prefix lists alone do nothing)", () => {
    // Regression: /apps was listed in DASHBOARD_UI_PREFIXES but missing from
    // config.matcher, so unauthenticated requests reached the page unguarded.
    const matchers = (middlewareConfig as { matcher: string[] }).matcher;
    expect(matchers).toContain("/apps/:path*");
  });
});
