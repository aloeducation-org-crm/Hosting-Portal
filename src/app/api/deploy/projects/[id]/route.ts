import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { apiSuccess } from "@/lib/response";
import { requireSession, requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { validateDeployConfig, deployConfigSchema } from "@/lib/deploy/config";
import { badRequest, canAccessProject, errorResponse, forbidden, notFound } from "@/lib/deploy/http";
import { createAuditLog } from "@/lib/audit";

const patchSchema = z.object({
  productionBranch: z.string().regex(/^[A-Za-z0-9._\/-]{1,100}$/).optional(),
  previewBranches: z.array(z.string().regex(/^[A-Za-z0-9._\/-]{1,100}$/)).max(20).optional(),
  autoDeploy: z.boolean().optional(),
  healthUrl: z.string().url().nullable().optional(),
  healthPath: z.string().regex(/^\/[A-Za-z0-9/._-]*$/).max(200).optional(),
  port: z.number().int().min(1024).max(65535).optional(),
  config: deployConfigSchema.partial().optional(),
  confirm: z.boolean().optional(),
});

async function loadProject(id: string) {
  const project = await db.gitProject.findUnique({ where: { id } });
  if (!project) return null;
  const website = await db.website.findUnique({ where: { id: project.websiteId } });
  return { project, website };
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireSession(request);
    const { id } = await params;
    const loaded = await loadProject(id);
    if (!loaded) return notFound("Project not found");
    if (!canAccessProject(user, loaded.project, loaded.website)) return forbidden();
    const [deployments, releases, deliveries] = await Promise.all([
      db.deployment.findMany({ where: { projectId: id }, orderBy: { createdAt: "desc" }, take: 20 }),
      db.release.findMany({ where: { websiteId: loaded.project.websiteId }, orderBy: { version: "desc" }, take: 20 }),
      db.webhookDelivery.findMany({ where: { projectId: id }, orderBy: { createdAt: "desc" }, take: 20 }),
    ]);
    return NextResponse.json(apiSuccess({
      project: { ...loaded.project, webhookSecretEnc: undefined, detection: loaded.project.detection ? JSON.parse(loaded.project.detection) : null, config: loaded.project.config ? JSON.parse(loaded.project.config) : null },
      website: loaded.website ? { id: loaded.website.id, domain: loaded.website.domain, currentReleasePath: loaded.website.currentReleasePath, healthStatus: loaded.website.healthStatus } : null,
      deployments, releases, webhookDeliveries: deliveries,
    }));
  } catch (error) {
    return errorResponse(error);
  }
}

/** Editable deployment configuration; validated through the command allowlist. */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requirePermission(request, "WEBSITE_UPDATE");
    const { id } = await params;
    const loaded = await loadProject(id);
    if (!loaded) return notFound("Project not found");
    if (!canAccessProject(user, loaded.project, loaded.website)) return forbidden();
    const parsed = patchSchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) return badRequest(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));

    const current = validateDeployConfig(JSON.parse(loaded.project.config || "{}"));
    const merged = validateDeployConfig({
      ...current,
      ...(parsed.data.config ?? {}),
      port: parsed.data.port ?? parsed.data.config?.port ?? current.port,
      healthPath: parsed.data.healthPath ?? parsed.data.config?.healthPath ?? current.healthPath,
      requiresApproval: parsed.data.confirm ? false : (parsed.data.config?.requiresApproval ?? current.requiresApproval),
      confirmedBy: parsed.data.confirm ? user.email : current.confirmedBy,
      source: "operator",
    });
    const updated = await db.gitProject.update({
      where: { id },
      data: {
        ...(parsed.data.productionBranch ? { productionBranch: parsed.data.productionBranch } : {}),
        ...(parsed.data.previewBranches ? { previewBranches: JSON.stringify(parsed.data.previewBranches) } : {}),
        ...(parsed.data.autoDeploy !== undefined ? { autoDeploy: parsed.data.autoDeploy } : {}),
        ...(parsed.data.healthUrl !== undefined ? { healthUrl: parsed.data.healthUrl } : {}),
        ...(parsed.data.healthPath ? { healthPath: parsed.data.healthPath } : {}),
        ...(parsed.data.port ? { port: parsed.data.port } : {}),
        config: JSON.stringify(merged),
        requiresApproval: merged.requiresApproval,
        detectionStatus: parsed.data.confirm ? "confirmed" : loaded.project.detectionStatus,
      },
    });
    await createAuditLog({
      actorId: user.id, actorEmail: user.email, actorRole: user.role,
      action: parsed.data.confirm ? "DEPLOY_CONFIG_CONFIRMED" : "DEPLOY_CONFIG_UPDATED",
      resourceType: "GitProject", resourceId: id, result: "SUCCESS",
      metadata: { fields: Object.keys(parsed.data) },
    });
    return NextResponse.json(apiSuccess({ ...updated, webhookSecretEnc: undefined, config: merged }));
  } catch (error) {
    return errorResponse(error);
  }
}
