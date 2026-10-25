import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { apiSuccess } from "@/lib/response";
import { requireSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { resolveToken, deleteWebhook } from "@/lib/deploy/github";
import { createAuditLog } from "@/lib/audit";
import { badRequest, errorResponse, forbidden } from "@/lib/deploy/http";

const schema = z.object({ connectionId: z.string().min(1) });

export async function POST(request: NextRequest) {
  try {
    const user = await requireSession(request);
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return badRequest("connectionId is required");
    const connection = await db.gitConnection.findUnique({ where: { id: parsed.data.connectionId } });
    if (!connection) return badRequest("Connection not found");
    if (connection.connectedById !== user.id && !["SUPER_ADMIN", "ADMIN"].includes(user.role)) return forbidden();

    const projects = await db.gitProject.findMany({ where: { connectionId: connection.id } });
    let token: string | null = null;
    try {
      token = (await resolveToken(connection)).token;
    } catch { /* revocation still proceeds locally */ }
    let hooksRemoved = 0;
    if (token) {
      for (const project of projects) {
        if (!project.webhookId) continue;
        try {
          await deleteWebhook(token, project.repository, project.webhookId);
          hooksRemoved++;
        } catch { /* report count honestly; don't fail disconnect */ }
      }
    }
    // Preserve projects and their data. Only unlink the credential and stop auto-deploys.
    await db.gitProject.updateMany({ where: { connectionId: connection.id }, data: { connectionId: null, autoDeploy: false } });
    await db.gitConnection.update({ where: { id: connection.id }, data: { status: "revoked", tokenEncrypted: null } });
    await createAuditLog({
      actorId: user.id, actorEmail: user.email, actorRole: user.role,
      action: "GITHUB_DISCONNECT", resourceType: "GitConnection", resourceId: connection.id,
      result: "SUCCESS", metadata: { accountLogin: connection.accountLogin, hooksRemoved },
    });
    return NextResponse.json(apiSuccess({ disconnected: true, hooksRemoved, projectsUnlinked: projects.length }));
  } catch (error) {
    return errorResponse(error);
  }
}
