import { NextRequest, NextResponse } from "next/server";
import { apiSuccess } from "@/lib/response";
import { requireSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { canAccessProject, errorResponse, forbidden, notFound } from "@/lib/deploy/http";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireSession(request);
    const { id } = await params;
    const deployment = await db.deployment.findUnique({
      where: { id },
      include: { logs: { orderBy: { timestamp: "asc" }, take: 500 }, website: { select: { id: true, domain: true } } },
    });
    if (!deployment) return notFound("Deployment not found");
    if (deployment.projectId) {
      const project = await db.gitProject.findUnique({ where: { id: deployment.projectId } });
      const website = await db.website.findUnique({ where: { id: deployment.websiteId } });
      if (project && !canAccessProject(user, project, website)) return forbidden();
    }
    return NextResponse.json(apiSuccess(deployment));
  } catch (error) {
    return errorResponse(error);
  }
}
