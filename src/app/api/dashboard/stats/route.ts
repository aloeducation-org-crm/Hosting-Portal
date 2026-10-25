import { NextRequest, NextResponse } from "next/server";
import { apiSuccess, apiError, type ApiResponse } from "@/lib/response";
import { requireSession, isAdminRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { callHelper } from "@/lib/helpers";

function handleErr(e: unknown): NextResponse {
  if (e && typeof e === "object" && "status" in e) {
    const a = e as ApiResponse;
    return NextResponse.json(a, { status: a.status });
  }
  return NextResponse.json(apiError("Internal server error"), { status: 500 });
}

export async function GET(request: NextRequest) {
  try {
    const user = await requireSession(request);
    const isAdmin = isAdminRole(user.role);

    const where = isAdmin
      ? { deletedAt: null }
      : { ownerId: user.id, deletedAt: null };

    const [
      totalWebsites,
      activeWebsites,
      suspendedWebsites,
      totalDatabases,
      totalBackups,
      totalDomains,
      crmContacts,
      aiAgentRuns,
      recentDeployments,
      dbUser,
      tokenUsageAgg,
    ] = await Promise.all([
      db.website.count({ where }),
      db.website.count({ where: { ...where, status: "ACTIVE" } }),
      db.website.count({ where: { ...where, status: "SUSPENDED" } }),
      db.databaseInstance.count({
        where: {
          deletedAt: null,
          website: { deletedAt: null, ...(!isAdmin ? { ownerId: user.id } : {}) },
        },
      }),
      db.backup.count({
        where: {
          website: { deletedAt: null, ...(!isAdmin ? { ownerId: user.id } : {}) },
        },
      }),
      db.domain.count({
        where: {
          website: { deletedAt: null, ...(!isAdmin ? { ownerId: user.id } : {}) },
        },
      }),
      db.crmContact.count({
        where: isAdmin ? {} : { userId: user.id },
      }),
      db.aiAgentRun.count({
        where: isAdmin ? {} : { userId: user.id },
      }),
      db.deployment.findMany({
        where: { website: where },
        take: 5,
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          status: true,
          commitHash: true,
          source: true,
          createdAt: true,
          website: { select: { id: true, domain: true, runtime: true } },
        },
      }),
      db.user.findUnique({
        where: { id: user.id },
        include: {
          subscriptions: {
            where: { status: "active" },
            include: { plan: true },
            take: 1,
          },
        },
      }),
      db.tokenUsage.aggregate({
        where: isAdmin ? {} : { userId: user.id },
        _sum: { totalTokens: true },
      }),
    ]);

    let adminSummary = null;
    let systemInfo = null;
    if (isAdmin) {
      const [totalUsers, totalServers, activePlans, recentAuditCount] =
        await Promise.all([
          db.user.count(),
          db.server.count(),
          db.plan.count({ where: { isActive: true } }),
          db.auditLog.count(),
        ]);

      adminSummary = {
        totalUsers,
        totalServers,
        activePlans,
        recentAuditCount,
      };

      const sysResult = await callHelper("alo-health-helper", ["system-info"]);
      if (sysResult.success) {
        try {
          systemInfo = JSON.parse(sysResult.stdout);
        } catch {
          systemInfo = null;
        }
      }
    }

    const activePlan = dbUser?.subscriptions?.[0]?.plan;
    const planSlug = activePlan?.name?.toLowerCase() || "starter";
    const aiTokensUsed = tokenUsageAgg._sum.totalTokens ?? 0;

    return NextResponse.json(
      apiSuccess({
        websites: {
          total: totalWebsites,
          active: activeWebsites,
          suspended: suspendedWebsites,
        },
        databases: totalDatabases,
        backups: totalBackups,
        domains: totalDomains,
        recentDeployments,
        systemInfo,
        adminSummary,
        stats: {
          domains: totalDomains,
          activeWebsites,
          totalWebsites,
          crmContacts,
          aiAgentRuns,
          databases: totalDatabases,
          backups: totalBackups,
          aiTokensUsed,
          maxSites: activePlan?.maxSites ?? 5,
          maxStorageGb: activePlan?.maxStorageGb ?? 1,
          maxBandwidthGb: activePlan?.maxBandwidthGb ?? 100,
          maxAiTokens: activePlan?.maxAiTokens ?? 10000,
        },
        user: {
          id: user.id,
          name: dbUser?.name ?? user.name ?? "User",
          email: user.email,
          role: user.role,
          plan: planSlug,
          emailVerified: !!dbUser?.emailVerified,
          onboardingCompleted: dbUser?.onboardingCompleted ?? false,
          createdAt: dbUser?.createdAt?.toISOString() ?? new Date().toISOString(),
        },
      })
    );
  } catch (e) {
    return handleErr(e);
  }
}
