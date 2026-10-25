/**
 * Hosting tools exposed to AI workflows.
 *
 * These are deliberately READ-ONLY. A workflow may inspect sites, SSL expiry and
 * health, but it cannot restart a service, delete a database or run a privileged
 * helper. Mutating tools need their own approval/audit design (see
 * docs/AI-AUTOMATION.md) — an LLM must never be one prompt-injection away from a
 * root helper.
 */

import { db } from "@/lib/db";
import type { ToolRegistry } from "./engine";

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(Math.trunc(parsed), min), max);
}

function asDomain(value: unknown): string {
  const raw = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!raw) throw new Error("a domain is required");
  // Reject anything that is not a plausible hostname before it reaches the DB.
  if (!/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/.test(raw)) {
    throw new Error(`"${raw}" is not a valid domain name`);
  }
  return raw;
}

export const listSitesTool: ToolRegistry["listSites"] = async (args) => {
  const limit = clampInt(args.limit, 20, 1, 100);
  const rows = await db.website.findMany({
    where: { deletedAt: null },
    take: limit,
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      domain: true,
      runtime: true,
      status: true,
      healthStatus: true,
      createdAt: true,
    },
  });
  return { count: rows.length, sites: rows };
};

export const siteHealthTool: ToolRegistry["siteHealth"] = async (args) => {
  const domain = asDomain(args.domain);
  const website = await db.website.findFirst({
    where: { domain, deletedAt: null },
    select: {
      id: true,
      name: true,
      domain: true,
      status: true,
      runtime: true,
      healthPath: true,
      healthStatus: true,
      updatedAt: true,
      domains: {
        select: { domain: true, primary: true, sslEnabled: true, sslStatus: true, certificateExpiry: true },
      },
      deployments: {
        take: 3,
        orderBy: { createdAt: "desc" },
        select: { id: true, status: true, createdAt: true },
      },
    },
  });

  return {
    found: Boolean(website),
    domain,
    website: website ?? null,
    note: website ? undefined : "No website with that domain is managed by this panel.",
  };
};

export const sslExpiringTool: ToolRegistry["sslExpiring"] = async (args) => {
  const days = clampInt(args.days, 30, 1, 365);
  const until = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  const rows = await db.domain.findMany({
    where: { sslEnabled: true, certificateExpiry: { not: null, lte: until } },
    orderBy: { certificateExpiry: "asc" },
    take: 100,
    select: { domain: true, sslStatus: true, certificateExpiry: true },
  });
  return {
    windowDays: days,
    checkedAt: new Date().toISOString(),
    count: rows.length,
    certificates: rows,
  };
};

/** The registry the workflow engine receives in production. */
export const HOSTING_TOOLS: ToolRegistry = {
  listSites: listSitesTool,
  siteHealth: siteHealthTool,
  sslExpiring: sslExpiringTool,
};
