/**
 * Phase 3 — §19 dashboard surface: the Monitoring and Backups pages.
 *
 * Structural checks that the pages exist, are wired to their components, are
 * reachable from the main nav, and are covered by the dashboard session guard.
 * Live rendering is verified separately against the built preview (E2E sweep),
 * and the APIs behind both pages have their own tests.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { isProtectedDashboardPath, config as middlewareConfig } from "@/middleware";

describe("dashboard pages (monitoring, backups)", () => {
  it("both routes exist and render their components", () => {
    for (const [page, component] of [
      ["src/app/dashboard/monitoring/page.tsx", "MonitoringCenter"],
      ["src/app/dashboard/backups/page.tsx", "BackupsCenter"],
    ]) {
      const src = fs.readFileSync(path.resolve(page), "utf8");
      expect(src).toContain(component);
      const componentFile =
        component === "MonitoringCenter"
          ? "src/components/dashboard/MonitoringCenter.tsx"
          : "src/components/dashboard/BackupsCenter.tsx";
      const comp = fs.readFileSync(path.resolve(componentFile), "utf8");
      expect(comp).toContain(`export function ${component}`);
      // No fabricated data hooks: both pages only fetch real endpoints.
      expect(comp).toContain("fetch(");
      expect(comp).not.toContain("Math.random");
      expect(comp).not.toMatch(/mock|fake|dummy/i);
    }
  });

  it("the main nav links to both pages", () => {
    const shell = fs.readFileSync(path.resolve("src/components/dashboard/DashboardShell.tsx"), "utf8");
    expect(shell).toContain('label: "Monitoring", href: "/dashboard/monitoring"');
    expect(shell).toContain('label: "Backups", href: "/dashboard/backups"');
  });

  it("both routes sit behind the dashboard session guard", () => {
    expect(isProtectedDashboardPath("/dashboard/monitoring")).toBe(true);
    expect(isProtectedDashboardPath("/dashboard/backups")).toBe(true);
    const matchers = middlewareConfig.matcher as string[] | string;
    const joined = Array.isArray(matchers) ? matchers.join(" ") : matchers;
    expect(joined).toContain("/dashboard/:path*");
  });

  it("monitoring renders 'not measured' instead of inventing zeroes", () => {
    const comp = fs.readFileSync(path.resolve("src/components/dashboard/MonitoringCenter.tsx"), "utf8");
    expect(comp).toContain("not measured");
    expect(comp).toContain('source: "system"');
    // bandwidth stays null-until-measured in the API contract too.
    const route = fs.readFileSync(path.resolve("src/app/api/monitoring/metrics/route.ts"), "utf8");
    expect(route).toContain("bandwidth: null");
  });
});
