import { NextRequest, NextResponse } from "next/server";
import { apiSuccess } from "@/lib/response";
import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { rollbackProject } from "@/lib/deploy/engine";
import { createAuditLog } from "@/lib/audit";
import { canAccessProject, errorResponse, forbidden, notFound } from "@/lib/deploy/http";

/** Approval-gated manual rollback to the previous verified release. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requirePermission(request, "BACKUP_RESTORE");
    const { id } = await params;
    const project = await db.gitProject.findUnique({ where: { id } });
    if (!project) return notFound("Project not found");
    const website = await db.website.findUnique({ where: { id: project.websiteId } });
    if (!canAccessProject(user, project, website)) return forbidden();
    const result = await rollbackProject(id, user.id);
    await createAuditLog({
      actorId: user.id, actorEmail: user.email, actorRole: user.role,
      action: "DEPLOY_ROLLBACK", resourceType: "Deployment", resourceId: result.deploymentId,
      result: result.verified ? "SUCCESS" : "FAILURE",
      metadata: { projectId: id, commitSha: result.commitSha, verified: result.verified },
    });
    return NextResponse.json(apiSuccess(result), { status: result.verified ? 200 : 500 });
  } catch (error) {
    return errorResponse(error);
  }
}
