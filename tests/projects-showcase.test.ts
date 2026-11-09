/**
 * The public landing page is now a showcase of the projects we actually run.
 * These tests protect the two things that make such a page trustworthy:
 *
 *   - it never links to a retired storefront route (those now redirect);
 *   - every project has a real status and a link that goes somewhere sensible.
 */
import { describe, expect, it } from "vitest";
import {
  PROJECTS,
  STATUS_LABEL,
  getProject,
  otherProjects,
  projectAction,
  type ProjectStatus,
} from "@/lib/marketing/projects";

const VALID_STATUSES: ProjectStatus[] = ["live", "beta", "internal", "archived"];

/** Storefront routes retired in next.config.ts — nothing public may link to them. */
const RETIRED_ROUTES = ["/pricing", "/hosting", "/domains", "/email", "/ssl"];

describe("projects showcase registry", () => {
  it("lists at least one project and keeps slugs unique and URL-safe", () => {
    expect(PROJECTS.length).toBeGreaterThan(0);
    const slugs = PROJECTS.map((project) => project.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const slug of slugs) expect(slug).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  });

  it("describes every project for cards and its own page", () => {
    for (const project of PROJECTS) {
      expect(project.name.trim().length).toBeGreaterThan(2);
      expect(project.tagline.length).toBeGreaterThan(10);
      expect(project.description.length).toBeGreaterThan(60);
      expect(project.category.length).toBeGreaterThan(0);
      expect(project.tags.length).toBeGreaterThan(0);
      expect(project.highlights.length).toBeGreaterThanOrEqual(2);
      expect(project.since).toBeGreaterThan(2000);
      for (const highlight of project.highlights) {
        expect(highlight).not.toMatch(/lorem ipsum|todo|tbd/i);
      }
    }
  });

  it("uses only known statuses, each with a label", () => {
    for (const project of PROJECTS) {
      expect(VALID_STATUSES).toContain(project.status);
      expect(STATUS_LABEL[project.status].length).toBeGreaterThan(0);
    }
  });

  it("links to real destinations and never to retired storefront routes", () => {
    for (const project of PROJECTS) {
      const action = projectAction(project);
      expect(action.href).toMatch(/^(https?:\/\/|\/)/);

      const targets = [project.url, project.dashboardHref].filter(Boolean) as string[];
      for (const target of targets) {
        const path = target.startsWith("http") ? new URL(target).pathname : target;
        for (const retired of RETIRED_ROUTES) {
          expect(path === retired || path.startsWith(`${retired}/`), `${project.slug} → ${target}`).toBe(
            false,
          );
        }
      }
    }
  });

  it("marks public URLs as external links and internal tools as sign-in", () => {
    const hosting = getProject("hosting-portal");
    expect(hosting).toBeDefined();
    expect(projectAction(hosting!).external).toBe(true);

    const crm = getProject("crm");
    expect(crm).toBeDefined();
    expect(projectAction(crm!).href).toBe("/dashboard/crm");
    expect(projectAction(crm!).external).toBe(false);

    expect(projectAction({ ...crm!, url: undefined, dashboardHref: undefined }).href).toBe("/login");
  });

  it("resolves a detail page helper that never recommends itself", () => {
    expect(getProject("does-not-exist")).toBeUndefined();
    for (const project of PROJECTS) {
      const others = otherProjects(project.slug);
      expect(others.length).toBe(Math.min(3, PROJECTS.length - 1));
      expect(others.some((item) => item.slug === project.slug)).toBe(false);
    }
  });
});
