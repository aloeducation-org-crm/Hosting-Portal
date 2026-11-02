/** Internal durable intake/review only. Approval never dispatches a tool or job. */
import { createHash } from "node:crypto";
import { z } from "zod";
import { db } from "@/lib/db";
import { apiError } from "@/lib/response";
import { isAdminRole, type AuthUser } from "@/lib/auth";

const referenceSchema = z.string().trim().min(1).max(400).refine((v) => !/[\x00-\x1f\x7f]/.test(v), "No control characters");
export const capabilityRequestSchema = z.object({
  projectId: z.string().min(1).max(128),
  capability: z.enum(["REVERSE_ENGINEERING", "CODE_EVOLUTION"]),
  targetKind: z.enum(["WEBSITE", "MAC_APP", "NATIVE_BINARY", "SOURCE_REPOSITORY"]),
  targetReference: referenceSchema,
  targetSha256: z.string().regex(/^[a-f0-9]{64}$/),
  objective: z.string().trim().min(10).max(4000),
  authorizationEvidence: z.string().trim().min(10).max(2000),
  authorizedInspection: z.literal(true),
}).strict().superRefine((v, ctx) => {
  if (v.capability === "CODE_EVOLUTION" && v.targetKind !== "SOURCE_REPOSITORY") ctx.addIssue({ code: "custom", path: ["targetKind"], message: "Code evolution requires a source repository snapshot." });
  if (v.targetKind === "WEBSITE") {
    try {
      const url = new URL(v.targetReference);
      if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) throw new Error();
    } catch { ctx.addIssue({ code: "custom", path: ["targetReference"], message: "Use a complete HTTPS reference without credentials, query or fragment." }); }
  }
});
export const reviewCapabilitySchema = z.object({
  action: z.enum(["APPROVE", "REJECT", "REVOKE"]),
  scopeDigest: z.string().regex(/^[a-f0-9]{64}$/),
  reason: z.string().trim().min(10).max(2000),
  validForMinutes: z.number().int().min(1).max(60).optional(),
}).strict();

function assertAdministrator(actor: AuthUser) {
  if (!isAdminRole(actor.role)) throw apiError("Administrator access required", "FORBIDDEN", undefined, 403);
}

export function capabilityRequestPresentation<T extends { status: string; expiresAt: Date | null }>(record: T) {
  const expired = record.status === "APPROVED" && (!record.expiresAt || record.expiresAt.getTime() <= Date.now());
  return { ...record, effectiveStatus: expired ? "EXPIRED" : record.status,
    executionState: record.status === "APPROVED" && !expired ? "REQUIRES_SETUP" : record.status === "REQUESTED" ? "REQUIRES_APPROVAL" : "UNAVAILABLE",
    executable: false as const };
}

export async function createCapabilityRequest(actor: AuthUser, input: unknown) {
  assertAdministrator(actor);
  const value = capabilityRequestSchema.parse(input);
  const { authorizedInspection: _confirmation, ...scope } = value;
  void _confirmation;
  const scopeDigest = createHash("sha256").update(JSON.stringify(scope)).digest("hex");
  return db.$transaction(async (tx) => {
    if (!await tx.project.findUnique({ where: { id: scope.projectId }, select: { id: true } })) throw apiError("Project not found", "NOT_FOUND", undefined, 404);
    const record = await tx.aiCapabilityRequest.create({ data: { ...scope, scopeDigest, requestedBy: actor.id } });
    // Fail closed: a durable request must not outlive a failed audit write.
    await tx.auditLog.create({ data: { actorUserId: actor.id, actorEmail: actor.email, actorRole: actor.role,
      action: "AI_CAPABILITY_REQUESTED", resourceType: "AiCapabilityRequest", resourceId: record.id, result: "REQUESTED",
      metadata: { projectId: record.projectId, capability: record.capability, scopeDigest } } });
    return capabilityRequestPresentation(record);
  });
}

export async function reviewCapabilityRequest(actor: AuthUser, id: string, input: unknown) {
  assertAdministrator(actor);
  const review = reviewCapabilitySchema.parse(input);
  return db.$transaction(async (tx) => {
    const record = await tx.aiCapabilityRequest.findUnique({ where: { id } });
    if (!record) throw apiError("Request not found", "NOT_FOUND", undefined, 404);
    if (record.scopeDigest !== review.scopeDigest) throw apiError("Scope changed; reload the request", "STALE_SCOPE", undefined, 409);
    if (review.action === "APPROVE" && record.requestedBy === actor.id) throw apiError("An independent administrator must approve this request", "SELF_APPROVAL_DENIED", undefined, 403);
    const expected = review.action === "REVOKE" ? "APPROVED" : "REQUESTED";
    if (record.status !== expected) throw apiError("Request has already changed state", "STATE_CONFLICT", undefined, 409);
    if (review.action === "REVOKE" && record.expiresAt && record.expiresAt <= new Date()) throw apiError("Request approval has expired", "STATE_CONFLICT", undefined, 409);
    const status = review.action === "APPROVE" ? "APPROVED" : review.action === "REJECT" ? "REJECTED" : "REVOKED";
    const now = new Date();
    const updated = await tx.aiCapabilityRequest.updateMany({
      where: { id, status: expected, scopeDigest: review.scopeDigest },
      data: { status, reviewedBy: actor.id, reviewedAt: now, reviewReason: review.reason,
        expiresAt: review.action === "APPROVE" ? new Date(now.getTime() + (review.validForMinutes ?? 15) * 60000) : record.expiresAt },
    });
    if (updated.count !== 1) throw apiError("Concurrent review changed this request", "STATE_CONFLICT", undefined, 409);
    await tx.auditLog.create({ data: { actorUserId: actor.id, actorEmail: actor.email, actorRole: actor.role,
      action: `AI_CAPABILITY_${status}`, resourceType: "AiCapabilityRequest", resourceId: id, result: status,
      metadata: { projectId: record.projectId, scopeDigest: record.scopeDigest, reason: review.reason, previousStatus: record.status, validForMinutes: review.action === "APPROVE" ? (review.validForMinutes ?? 15) : null } } });
    return capabilityRequestPresentation((await tx.aiCapabilityRequest.findUniqueOrThrow({ where: { id } })));
  });
}
