/**
 * Hosting tools exposed to AI workflows.
 *
 * Security invariants:
 *   1. Read-only: a workflow may inspect sites, SSL expiry, deployments, billing
 *      and marketing overviews, never mutate services, databases or host helpers.
 *   2. Tenant-isolated: non-admin executions are strictly scoped to
 *      `website.ownerId === actor.userId`. Missing actor identity fails closed
 *      rather than querying across all tenants.
 */

import { db } from "@/lib/db";
import type { ToolContext, ToolRegistry, WorkflowActor } from "./engine";

export type HostingToolActor = WorkflowActor;

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

function resolveTenantOwnerFilter(actor?: WorkflowActor): { ownerId?: string } {
  if (actor?.isAdmin === true) {
    return {};
  }
  const userId = typeof actor?.userId === "string" ? actor.userId.trim() : "";
  if (!userId) {
    throw new Error("Tenant context required (authenticated userId) to query hosting resources");
  }
  return { ownerId: userId };
}

export function createScopedHostingTools(boundActor?: WorkflowActor): ToolRegistry {
  const effectiveActor = (context?: ToolContext): WorkflowActor | undefined =>
    context?.actor ?? boundActor;

  return {
    listSites: async (args, context) => {
      const ownerFilter = resolveTenantOwnerFilter(effectiveActor(context));
      const limit = clampInt(args.limit, 20, 1, 100);
      const rows = await db.website.findMany({
        where: { deletedAt: null, ...ownerFilter },
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
    },

    siteHealth: async (args, context) => {
      const ownerFilter = resolveTenantOwnerFilter(effectiveActor(context));
      const domain = asDomain(args.domain);
      const website = await db.website.findFirst({
        where: { domain, deletedAt: null, ...ownerFilter },
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
        note: website ? undefined : "No website with that domain is accessible in your account.",
      };
    },

    sslExpiring: async (args, context) => {
      const ownerFilter = resolveTenantOwnerFilter(effectiveActor(context));
      const days = clampInt(args.days, 30, 1, 365);
      const until = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
      const rows = await db.domain.findMany({
        where: {
          sslEnabled: true,
          certificateExpiry: { not: null, lte: until },
          website: { deletedAt: null, ...ownerFilter },
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
    },

    listDeployments: async (args, context) => {
      const ownerFilter = resolveTenantOwnerFilter(effectiveActor(context));
      const limit = clampInt(args.limit, 10, 1, 50);
      const rows = await db.deployment.findMany({
        where: ownerFilter.ownerId ? { website: { ownerId: ownerFilter.ownerId } } : {},
        take: limit,
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          status: true,
          stage: true,
          branch: true,
          commitHash: true,
          trigger: true,
          durationMs: true,
          createdAt: true,
          website: { select: { id: true, name: true, domain: true, runtime: true } },
        },
      });
      return { count: rows.length, deployments: rows };
    },

    automationOverview: async (_args, context) => {
      const ownerFilter = resolveTenantOwnerFilter(effectiveActor(context));
      const [siteCount, appCount, projectCount, pendingOps] = await Promise.all([
        db.website.count({ where: { deletedAt: null, ...ownerFilter } }),
        db.application.count({
          where: ownerFilter.ownerId ? { userId: ownerFilter.ownerId } : {},
        }),
        db.gitProject.count({
          where: ownerFilter.ownerId ? { createdById: ownerFilter.ownerId } : {},
        }),
        db.operationJob.count({
          where: {
            status: "PENDING",
            ...(ownerFilter.ownerId ? { website: { ownerId: ownerFilter.ownerId } } : {}),
          },
        }),
      ]);
      return {
        checkedAt: new Date().toISOString(),
        siteCount,
        applicationCount: appCount,
        gitProjectCount: projectCount,
        pendingOperations: pendingOps,
      };
    },

    billingOverview: async (_args, context) => {
      const ownerFilter = resolveTenantOwnerFilter(effectiveActor(context));
      const userFilter = ownerFilter.ownerId ? { userId: ownerFilter.ownerId } : {};
      const [activeSub, invoices, orders] = await Promise.all([
        db.subscription.findFirst({
          where: { status: "active", ...userFilter },
          orderBy: { createdAt: "desc" },
          include: { plan: { select: { id: true, name: true, slug: true, priceCents: true } } },
        }),
        db.invoice.findMany({
          where: userFilter,
          orderBy: { createdAt: "desc" },
          take: 10,
          select: { id: true, amountCents: true, currency: true, status: true, createdAt: true },
        }),
        db.order.count({ where: userFilter }),
      ]);
      const paidTotalCents = invoices
        .filter((inv) => inv.status === "paid")
        .reduce((sum, inv) => sum + inv.amountCents, 0);
      return {
        checkedAt: new Date().toISOString(),
        activeSubscription: activeSub
          ? {
              id: activeSub.id,
              plan: activeSub.plan.slug ?? activeSub.plan.name,
              status: activeSub.status,
              amount: Number((activeSub.plan.priceCents / 100).toFixed(2)),
            }
          : null,
        recentInvoiceCount: invoices.length,
        paidRecentTotal: Number((paidTotalCents / 100).toFixed(2)),
        orderCount: orders,
      };
    },

    marketingOverview: async (_args, context) => {
      const ownerFilter = resolveTenantOwnerFilter(effectiveActor(context));
      const userFilter = ownerFilter.ownerId ? { userId: ownerFilter.ownerId } : {};
      const [campaignCount, leadCount, dealCount, subscriberCount] = await Promise.all([
        db.emailCampaign.count({ where: userFilter }),
        db.crmContact.count({ where: userFilter }),
        db.crmDeal.count({ where: userFilter }),
        ownerFilter.ownerId ? Promise.resolve(0) : db.newsletter.count(),
      ]);
      return {
        checkedAt: new Date().toISOString(),
        campaignCount,
        leadCount,
        dealCount,
        subscriberCount,
      };
    },
  };
}

/** Alias preserved for security-audit callers binding a tenant actor directly. */
export const createHostingToolsForActor = createScopedHostingTools;

/** Default registry: enforces tenant isolation via `context.actor`. */
export const HOSTING_TOOLS: ToolRegistry = createScopedHostingTools();
export const listSitesTool = HOSTING_TOOLS.listSites!;
export const siteHealthTool = HOSTING_TOOLS.siteHealth!;
export const sslExpiringTool = HOSTING_TOOLS.sslExpiring!;
export const listDeploymentsTool = HOSTING_TOOLS.listDeployments!;
export const automationOverviewTool = HOSTING_TOOLS.automationOverview!;
export const billingOverviewTool = HOSTING_TOOLS.billingOverview!;
export const marketingOverviewTool = HOSTING_TOOLS.marketingOverview!;
