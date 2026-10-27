/**
 * Hosting tools exposed to AI workflows.
 *
 * SECURITY / MULTI-TENANT ISOLATION:
 *  - Every tool is strictly READ-ONLY.
 *  - Every query MUST be bound to a verified actor via `createHostingToolsForActor`.
 *  - Non-admin users (`isAdmin: false`) can ONLY read websites and SSL certificates
 *    owned by `actor.userId`. Calling without a valid `userId` fails closed.
 */

import { db } from "@/lib/db";
import type { ToolRegistry } from "./engine";

export interface HostingToolActor {
  userId: string | null;
  isAdmin: boolean;
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(Math.trunc(parsed), min), max);
}

function asDomain(value: unknown): string {
  const raw = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!raw) throw new Error("a domain is required");
  if (!/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/.test(raw)) {
    throw new Error(`"${raw}" is not a valid domain name`);
  }
  return raw;
}

function ownerWhere(actor: HostingToolActor): { ownerId?: string } {
  if (actor.isAdmin) return {};
  if (!actor.userId) {
    throw new Error("Tenant context required for hosting workflow tools");
  }
  return { ownerId: actor.userId };
}

/**
 * Build a tenant-scoped read-only tool registry for a specific workflow actor.
 */
export function createHostingToolsForActor(actor: HostingToolActor): ToolRegistry {
  const listSites: ToolRegistry["listSites"] = async (args) => {
    const scope = ownerWhere(actor);
    const limit = clampInt(args.limit, 20, 1, 100);
    const rows = await db.website.findMany({
      where: { deletedAt: null, ...scope },
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

  const siteHealth: ToolRegistry["siteHealth"] = async (args) => {
    const scope = ownerWhere(actor);
    const domain = asDomain(args.domain);
    const website = await db.website.findFirst({
      where: { domain, deletedAt: null, ...scope },
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
      note: website ? undefined : "No website with that domain is accessible in your workspace.",
    };
  };

  const sslExpiring: ToolRegistry["sslExpiring"] = async (args) => {
    const scope = ownerWhere(actor);
    const days = clampInt(args.days, 30, 1, 365);
    const until = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
    const rows = await db.domain.findMany({
      where: {
        sslEnabled: true,
        certificateExpiry: { not: null, lte: until },
        website: { deletedAt: null, ...scope },
      },
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

  return {
    listSites,
    siteHealth,
    sslExpiring,
  };
}

/**
 * Unscoped fallback registry fails closed unless explicitly constructed via
 * `createHostingToolsForActor({ userId, isAdmin })`.
 */
export const HOSTING_TOOLS: ToolRegistry = createHostingToolsForActor({
  userId: null,
  isAdmin: false,
});
