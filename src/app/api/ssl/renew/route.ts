import { NextRequest, NextResponse } from "next/server";
import { apiSuccess, apiError, type ApiResponse } from "@/lib/response";
import { requirePermission, assertWebsiteAccess } from "@/lib/auth";
import { db } from "@/lib/db";
import { createAuditLog } from "@/lib/audit";
import { orchestrator } from "@/lib/orchestrator/orchestrator";
import { actorForUser } from "@/lib/orchestrator/workflows";

function handleErr(e: unknown): NextResponse {
  if (e && typeof e === "object" && "status" in e) {
    const a = e as ApiResponse;
    return NextResponse.json(a, { status: a.status });
  }
  return NextResponse.json(apiError("Internal server error"), { status: 500 });
}

/** Queue certificate renewal through the central orchestrator (approval-gated). */
export async function POST(request: NextRequest) {
  try {
    const user = await requirePermission(request, "SSL_MANAGE");
    const body = await request.json();
    const domainId = String(body?.domainId ?? "");
    if (!domainId) return NextResponse.json(apiError("domainId is required", "VALIDATION_ERROR", undefined, 400), { status: 400 });
    const certificate = await db.sslCertificate.findUnique({ where: { domainId }, include: { domain: { include: { website: true } } } });
    if (!certificate) return NextResponse.json(apiError("No existing certificate found for this domain", "NOT_FOUND", undefined, 404), { status: 404 });
    assertWebsiteAccess(user, certificate.domain.website);
    const project = await db.gitProject.findUnique({ where: { websiteId: certificate.domain.websiteId } });
    const job = await orchestrator.enqueue({
      kind: "DOMAIN_TLS",
      type: "ssl-renew",
      input: { action: "renew", domain: certificate.domain.domain, projectId: project?.id, agentId: process.env.AUTOMATION_DEFAULT_AGENT_ID },
      actor: await actorForUser(user.id),
      websiteId: certificate.domain.websiteId,
      resourceId: project?.id,
      resourceType: project ? "GitProject" : undefined,
      idempotencyKey: `ssl-renew:${domainId}:${new Date().toISOString().slice(0, 10)}`,
      lockKey: `domain:${domainId}`,
    });
    await createAuditLog({ actorId: user.id, actorEmail: user.email, actorRole: user.role, action: "SSL_CERTIFICATE_RENEW_QUEUED", resourceType: "SslCertificate", resourceId: certificate.id, domain: certificate.domain.domain, result: "QUEUED", metadata: { jobId: job.jobId, requiresApproval: job.requiresApproval } });
    return NextResponse.json(apiSuccess({ jobId: job.jobId, status: job.status, requiresApproval: job.requiresApproval }, "Renewal queued through the automation engine", 202), { status: 202 });
  } catch (e) {
    return handleErr(e);
  }
}
