import { NextRequest, NextResponse } from "next/server";
import { apiSuccess } from "@/lib/response";
import { requireSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { queueStatus } from "@/lib/deploy/queue";
import { activeStaticPorts, releaseBase } from "@/lib/deploy/service";
import { errorResponse } from "@/lib/deploy/http";

export async function GET(request: NextRequest) {
  try {
    await requireSession(request);
    const [pending, running, recent] = await Promise.all([
      db.deployment.count({ where: { status: "PENDING" } }),
      db.deployment.count({ where: { status: "RUNNING" } }),
      db.deployment.findMany({ where: { projectId: { not: null } }, orderBy: { createdAt: "desc" }, take: 10, select: { id: true, projectId: true, status: true, stage: true, commitHash: true, createdAt: true } }),
    ]);
    return NextResponse.json(apiSuccess({
      queue: queueStatus(), pending, running, recent,
      inlineWorker: process.env.DEPLOY_INLINE_WORKER !== "false",
      releaseBase: releaseBase(),
      activeStaticPorts: activeStaticPorts(),
    }));
  } catch (error) {
    return errorResponse(error);
  }
}
