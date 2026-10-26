import { NextRequest, NextResponse } from "next/server";
import { apiSuccess } from "@/lib/response";
import { requireSession, isAdminRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { queueStatus } from "@/lib/deploy/queue";
import { activeStaticPorts, releaseBase } from "@/lib/deploy/service";
import { errorResponse } from "@/lib/deploy/http";

export async function GET(request: NextRequest) {
  try {
    const user = await requireSession(request);
    const adminCaller = isAdminRole(user.role);
    const tenantScope = adminCaller ? {} : { website: { ownerId: user.id } };

    const [pending, running, recent] = await Promise.all([
      db.deployment.count({ where: { status: "PENDING", ...tenantScope } }),
      db.deployment.count({ where: { status: "RUNNING", ...tenantScope } }),
      db.deployment.findMany({
        where: { projectId: { not: null }, ...tenantScope },
        orderBy: { createdAt: "desc" },
        take: 10,
        select: { id: true, projectId: true, status: true, stage: true, commitHash: true, createdAt: true },
      }),
    ]);

    return NextResponse.json(
      apiSuccess({
        queue: adminCaller ? queueStatus() : { active: running },
        pending,
        running,
        recent,
        inlineWorker: process.env.DEPLOY_INLINE_WORKER !== "false",
        ...(adminCaller
          ? {
              releaseBase: releaseBase(),
              activeStaticPorts: activeStaticPorts(),
            }
          : {}),
      }),
    );
  } catch (error) {
    return errorResponse(error);
  }
}
