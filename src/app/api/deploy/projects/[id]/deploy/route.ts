import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { apiSuccess } from "@/lib/response";
import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { enqueueDeployment } from "@/lib/deploy/queue";
import { createAuditLog } from "@/lib/audit";
import { badRequest, canAccessProject, errorResponse, forbidden, notFound } from "@/lib/deploy/http";

const schema = z.object({ commitSha: z.string().regex(/^[0-9a-f]{40}$/).optional() });

/** Manual redeploy. Pinned to a stored/explicit SHA, never to a webhook value. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requirePermission(request, "WEBSITE_DEPLOY");
    const { id } = await params;
    const parsed = schema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) return badRequest("commitSha must be a 40-character hex SHA");
    const project = await db.gitProject.findUnique({ where: { id } });
    if (!project) return notFound("Project not found");
    const website = await db.website.findUnique({ where: { id: project.websiteId } });
    if (!canAccessProject(user, project, website)) return forbidden();
    const sha = parsed.data.commitSha || project.lastCommitSha;
    if (!sha || !/^[0-9a-f]{40}$/.test(sha)) return badRequest("No commit SHA is stored; provide commitSha");
    const result = await enqueueDeployment({
      projectId: id, commitSha: sha, branch: project.productionBranch, trigger: "manual",
      commitMessage: project.lastCommitMessage, commitAuthor: project.lastCommitAuthor,
    });
    await createAuditLog({
      actorId: user.id, actorEmail: user.email, actorRole: user.role,
      action: "DEPLOY_MANUAL", resourceType: "Deployment", resourceId: result.deploymentId,
      result: "SUCCESS", metadata: { projectId: id, commitSha: sha },
    });
    return NextResponse.json(apiSuccess(result), { status: 202 });
  } catch (error) {
    return errorResponse(error);
  }
}
