import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { apiSuccess } from "@/lib/response";
import { requireSession, requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { importRepository } from "@/lib/deploy/projects";
import { createAuditLog } from "@/lib/audit";
import { badRequest, canAccessProject, errorResponse } from "@/lib/deploy/http";

const importSchema = z.object({
  repository: z.string().min(3).max(200),
  productionBranch: z.string().regex(/^[A-Za-z0-9._\/-]{1,100}$/).optional(),
  previewBranches: z.array(z.string().regex(/^[A-Za-z0-9._\/-]{1,100}$/)).max(20).optional(),
  connectionId: z.string().optional(),
  autoDeploy: z.boolean().optional(),
  port: z.number().int().min(1024).max(65535).optional(),
  healthUrl: z.string().url().optional(),
  // Only used by the local staging harness; never by the webhook path.
  cloneUrlOverride: z.string().optional(),
});

export async function GET(request: NextRequest) {
  try {
    const user = await requireSession(request);
    const projects = await db.gitProject.findMany({
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    const websiteIds = projects.map((p) => p.websiteId);
    const websites = await db.website.findMany({ where: { id: { in: websiteIds } } });
    const byId = new Map(websites.map((w) => [w.id, w]));
    const visible = projects.filter((p) => canAccessProject(user, p, byId.get(p.websiteId) ?? null));
    const items = await Promise.all(visible.map(async (p) => {
      const latest = await db.deployment.findFirst({ where: { projectId: p.id }, orderBy: { createdAt: "desc" } });
      return {
        ...p,
        // strip credentials / internal paths before returning to the browser
        webhookSecretEnc: undefined,
        tokenEncrypted: undefined,
        detection: p.detection ? JSON.parse(p.detection) : null,
        config: p.config ? JSON.parse(p.config) : null,
        domain: byId.get(p.websiteId)?.domain ?? null,
        liveUrl: (() => {
          const template = process.env.DEPLOY_PUBLIC_URL_TEMPLATE;
          if (template) return template.replace("{port}", String(p.port ?? 0)).replace("{sha}", String(p.id)).replace("{domain}", String(byId.get(p.websiteId)?.domain ?? ""));
          return p.healthUrl || `http://127.0.0.1:${p.port ?? 0}${p.healthPath}`;
        })(),
        latestDeployment: latest ? {
          id: latest.id, status: latest.status, stage: latest.stage, commitHash: latest.commitHash,
          commitMessage: latest.commitMessage, commitAuthor: latest.commitAuthor, trigger: latest.trigger,
          verifiedCommitSha: latest.verifiedCommitSha, failureStage: latest.failureStage,
          createdAt: latest.createdAt, finishedAt: latest.finishedAt, durationMs: latest.durationMs,
        } : null,
      };
    }));
    return NextResponse.json(apiSuccess({ items, total: items.length }));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requirePermission(request, "WEBSITE_CREATE");
    const body = await request.json().catch(() => ({}));
    const parsed = importSchema.safeParse(body);
    if (!parsed.success) return badRequest(`Validation failed: ${parsed.error.issues.map((i) => i.path.join(".")).join(", ")}`);
    // cloneUrlOverride is a server-only staging affordance: reject it unless the
    // operator explicitly opted in via environment on this host.
    const cloneUrlOverride = parsed.data.cloneUrlOverride;
    if (cloneUrlOverride && process.env.DEPLOY_ALLOW_LOCAL_SOURCE !== "true") {
      return badRequest("Local source override is not enabled on this host");
    }
    const result = await importRepository({ ...parsed.data, userId: user.id, cloneUrlOverride });
    await createAuditLog({
      actorId: user.id, actorEmail: user.email, actorRole: user.role,
      action: "GITHUB_REPOSITORY_IMPORT", resourceType: "GitProject", resourceId: result.project.id,
      domain: result.website.domain, result: "SUCCESS",
      metadata: { repository: result.project.repository, branch: result.project.productionBranch, framework: result.detection.framework, webhook: result.webhook.created },
    });
    return NextResponse.json(apiSuccess({
      project: { ...result.project, webhookSecretEnc: undefined, detection: result.detection, config: JSON.parse(result.project.config || "{}") },
      website: { id: result.website.id, domain: result.website.domain },
      detection: result.detection,
      webhook: result.webhook,
      warnings: result.warnings,
    }), { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
