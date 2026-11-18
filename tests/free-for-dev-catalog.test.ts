/**
 * Free for Dev catalog — data integrity, query behaviour and page wiring.
 *
 * The catalog data is generated from the community free-for.dev list by
 * `scripts/sync-free-for-dev.mjs`; these checks pin its shape, prove the pure
 * query helpers filter correctly, and verify the dashboard page is wired to
 * the real API behind the dashboard session guard.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { isProtectedDashboardPath, config as middlewareConfig } from "@/proxy";
import {
  FREE_FOR_DEV_SOURCE,
  FREE_FOR_DEV_CATEGORIES,
  listCategories,
  getCategory,
  getService,
  queryFreeServices,
  countServices,
  catalogSource,
} from "@/lib/free-for-dev/catalog";

describe("free-for-dev catalog data", () => {
  it("records upstream provenance", () => {
    expect(FREE_FOR_DEV_SOURCE.name).toBe("free-for.dev");
    expect(FREE_FOR_DEV_SOURCE.listUrl).toMatch(/^https:\/\//);
    expect(FREE_FOR_DEV_SOURCE.repoUrl).toMatch(/^https:\/\/github\.com\//);
    expect(FREE_FOR_DEV_SOURCE.syncedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(FREE_FOR_DEV_SOURCE.commit === null || /^[0-9a-f]{7,40}$/.test(FREE_FOR_DEV_SOURCE.commit)).toBe(true);
    expect(FREE_FOR_DEV_SOURCE.attribution).toContain("free-for.dev");
  });

  it("carries every category with uniquely-identified, linked services", () => {
    expect(FREE_FOR_DEV_CATEGORIES.length).toBeGreaterThan(20);
    const seenIds = new Set<string>();
    let total = 0;
    for (const category of FREE_FOR_DEV_CATEGORIES) {
      expect(category.id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(category.label.length).toBeGreaterThan(0);
      expect(category.services.length).toBeGreaterThan(0);
      for (const service of category.services) {
        expect(service.id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
        expect(seenIds.has(service.id)).toBe(false);
        seenIds.add(service.id);
        expect(service.name.length).toBeGreaterThan(0);
        expect(service.url).toMatch(/^[a-z][a-z0-9+.-]*:/i);
        expect(service.summary.length > 0 || service.details.length > 0).toBe(true);
        total += 1;
      }
    }
    expect(total).toBe(countServices());
    expect(total).toBeGreaterThan(500);
  });

  it("summary counts match the category payloads", () => {
    const summaries = listCategories();
    expect(summaries.length).toBe(FREE_FOR_DEV_CATEGORIES.length);
    for (const s of summaries) {
      const category = getCategory(s.id);
      expect(category).not.toBeNull();
      expect(s.count).toBe(category?.services.length);
    }
    expect(getCategory("no-such-category")).toBeNull();
  });

  it("getService joins the service with its category", () => {
    const gcp = getService("google-cloud-platform");
    expect(gcp).not.toBeNull();
    expect(gcp?.categoryId).toBe("major-cloud-providers");
    expect(gcp?.details.length).toBeGreaterThan(0);
    expect(getService("no-such-service")).toBeNull();
  });
});

describe("the requested jixserver archive", () => {
  it("keeps all provider links with a separate pinned provenance and no historical pricing claims", () => {
    const archive = catalogSource("jixserver");
    expect(archive).toMatchObject({ historical: true, commit: "a6d2501c4d2566a3f518f08e51a23923edf65734" });
    expect(archive.listUrl).toContain(archive.commit);
    const rows = queryFreeServices({ source: "jixserver" });
    expect(rows.total).toBe(463);
    expect(rows.categories).toHaveLength(36);
    expect(new Set(rows.services.map((row) => row.id)).size).toBe(rows.total);
    expect(rows.services.every((row) => /^(https?:\/\/|stun:)/.test(row.url) && !row.summary && !row.details.length)).toBe(true);
    expect(queryFreeServices({ source: "jixserver", categoryId: "email" }).total).toBe(29);
    expect(queryFreeServices({ source: "jixserver", categoryId: "iaas" }).total).toBeGreaterThan(0);
    expect(queryFreeServices({ source: "jixserver", categoryId: "dbaas" }).total).toBeGreaterThan(0);
  });
});

describe("free-for-dev catalog queries", () => {
  it("filters by category", () => {
    const result = queryFreeServices({ categoryId: "dns" });
    expect(result.total).toBeGreaterThan(0);
    for (const row of result.services) {
      expect(row.categoryId).toBe("dns");
    }
  });

  it("matches text case-insensitively across name, summary and details", () => {
    const lower = queryFreeServices({ q: "dns" });
    const upper = queryFreeServices({ q: "DNS" });
    expect(lower.total).toBe(upper.total);
    expect(lower.total).toBeGreaterThan(0);
    for (const row of lower.services) {
      const haystack = `${row.name}\n${row.summary}\n${row.details.join("\n")}`.toLowerCase();
      expect(haystack).toContain("dns");
    }
  });

  it("combines filters and reports the unlimited total", () => {
    const result = queryFreeServices({ categoryId: "email", q: "free", limit: 5 });
    expect(result.services.length).toBeLessThanOrEqual(5);
    expect(result.total).toBeGreaterThanOrEqual(result.services.length);
    for (const row of result.services) {
      expect(row.categoryId).toBe("email");
    }
  });

  it("returns everything in upstream order when unfiltered", () => {
    const result = queryFreeServices();
    expect(result.total).toBe(countServices());
    expect(result.services.length).toBe(countServices());
    expect(result.services[0]?.categoryId).toBe(FREE_FOR_DEV_CATEGORIES[0]?.id);
  });
});

describe("free-for-dev page wiring", () => {
  it("the page renders FreeForDevCenter, which fetches the real catalog API", () => {
    const page = fs.readFileSync(path.resolve("src/app/dashboard/free-for-dev/page.tsx"), "utf8");
    expect(page).toContain("FreeForDevCenter");

    const comp = fs.readFileSync(path.resolve("src/components/dashboard/FreeForDevCenter.tsx"), "utf8");
    expect(comp).toContain("export function FreeForDevCenter");
    expect(comp).toContain('"/api/free-for-dev"');
    expect(comp).toContain('"/api/free-for-dev?source=jixserver"');
    expect(comp).not.toContain("Math.random");
    expect(comp).not.toMatch(/mock|fake|dummy/i);
  });

  it("the API is read-only catalog access behind the session guard", () => {
    const route = fs.readFileSync(path.resolve("src/app/api/free-for-dev/route.ts"), "utf8");
    expect(route).toContain("requireSession");
    expect(route).toContain("queryFreeServices");
    expect(isProtectedDashboardPath("/dashboard/free-for-dev")).toBe(true);
    const matchers = middlewareConfig.matcher as string[] | string;
    const joined = Array.isArray(matchers) ? matchers.join(" ") : matchers;
    expect(joined).toContain("/dashboard/:path*");
  });

  it("the main nav links to the catalog", () => {
    const shell = fs.readFileSync(path.resolve("src/components/dashboard/DashboardShell.tsx"), "utf8");
    expect(shell).toContain('label: "Free for Dev", href: "/dashboard/free-for-dev"');
  });
});
