import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { apiSuccess, apiError, type ApiResponse } from "@/lib/response";
import { createAuditLog } from "@/lib/audit";
import { logger } from "@/lib/logger";
import { redact } from "@/lib/deploy/redact";
import { orchestrator } from "@/lib/orchestrator/orchestrator";
import { listWorkers } from "@/lib/orchestrator/workers";
import { WorkerError, JOB_STATES } from "@/lib/orchestrator/contracts";
import { actorForUser, createWorkflow, startWorkflow, cancelRun, validateWorkflowDefinition, ensureBuiltinWorkflows } from "@/lib/orchestrator/workflows";
import { createProfile, verifyProfile, rollbackProfile, profileConfigSchemas } from "@/lib/orchestrator/profiles";
import { agentOnline } from "@/lib/agents/agent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const keySchema = z.string().regex(/^[a-z][a-z0-9-]{2,63}$/);
const jsonObject = z.record(z.string(), z.unknown());
const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("workflow.create"), key: keySchema, name: z.string().trim().min(1).max(120), description: z.string().max(500).optional(), definition: z.unknown(), trigger: z.enum(["manual", "event", "schedule", "webhook"]).default("manual"), eventName: z.string().max(120).optional(), intervalSeconds: z.number().int().min(30).max(2_592_000).optional(), scheduleInput: jsonObject.default({}) }),
  z.object({ action: z.literal("workflow.toggle"), workflowId: z.string().min(1), enabled: z.boolean() }),
  z.object({ action: z.literal("workflow.run"), workflowId: z.string().min(1), input: jsonObject.default({}), requestId: z.string().uuid().optional() }),
  z.object({ action: z.literal("workflow.version"), workflowId: z.string().min(1), definition: z.unknown(), scheduleInput: jsonObject.optional(), changeNote: z.string().max(300).optional() }),
  z.object({ action: z.literal("run.cancel"), runId: z.string().min(1), reason: z.string().trim().min(1).max(300) }),
  z.object({ action: z.literal("job.approve"), jobId: z.string().min(1), note: z.string().max(500).optional() }),
  z.object({ action: z.literal("job.reject"), jobId: z.string().min(1), reason: z.string().trim().min(1).max(500) }),
  z.object({ action: z.literal("job.cancel"), jobId: z.string().min(1), reason: z.string().trim().min(1).max(300) }),
  z.object({ action: z.literal("job.requeue"), jobId: z.string().min(1), note: z.string().max(500).optional() }),
  z.object({ action: z.literal("profile.create"), key: keySchema, name: z.string().trim().min(1).max(120), kind: z.enum(["node", "github", "dns", "runtime", "database"]), framework: z.string().max(80).optional(), config: z.unknown(), changeNote: z.string().max(300).optional() }),
  z.object({ action: z.literal("profile.verify"), versionId: z.string().min(1), requestId: z.string().uuid().optional() }),
  z.object({ action: z.literal("profile.rollback"), profileId: z.string().min(1), version: z.number().int().min(1) }),
]);

function handleErr(e: unknown): NextResponse {
  if (e && typeof e === "object" && "status" in e && "success" in e) {
    const a = e as ApiResponse;
    return NextResponse.json(a, { status: a.status });
  }
  if (e instanceof z.ZodError) {
    return NextResponse.json(apiError("Validation failed", "VALIDATION_ERROR", e.flatten(), 400), { status: 400 });
  }
  if (e instanceof WorkerError) {
    const status = e.code === "FORBIDDEN" || e.code === "UNAUTHORIZED" ? 403 : e.code === "NOT_FOUND" ? 404 : e.code === "IDEMPOTENCY_CONFLICT" ? 409 : ["VALIDATION_FAILED", "UNSAFE_RETRY"].includes(e.code) ? 400 : 422;
    return NextResponse.json(apiError(redact(e.message).slice(0, 300), e.code, undefined, status), { status });
  }
  const code = (e as { code?: string } | null)?.code;
  if (code === "P2002") return NextResponse.json(apiError("That key or version already exists", "CONFLICT", undefined, 409), { status: 409 });
  if (code === "P2025") return NextResponse.json(apiError("Record not found", "NOT_FOUND", undefined, 404), { status: 404 });
  logger.error({ error: e instanceof Error ? redact(e.message) : "unknown" }, "automation admin request failed");
  return NextResponse.json(apiError("Automation administration is temporarily unavailable", "AUTOMATION_ADMIN_ERROR", undefined, 500), { status: 500 });
}

function parseJson(raw: string): unknown { try { return JSON.parse(raw); } catch { return null; } }
function safeArray(raw: string): string[] { const v = parseJson(raw); return Array.isArray(v) ? v.map(String) : []; }

/** Admin-only Automation Center read model. Credential values are never returned. */
export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request);
    await ensureBuiltinWorkflows();
    const runId = request.nextUrl.searchParams.get("run");
    const [workflows, runs, jobs, queue, profiles, agents, selectedRun] = await Promise.all([
      db.automationWorkflow.findMany({ orderBy: { createdAt: "asc" }, take: 200, include: { _count: { select: { runs: true } } } }),
      db.automationRun.findMany({ orderBy: { createdAt: "desc" }, take: 50, include: { workflow: { select: { key: true, name: true } }, steps: { orderBy: { ordinal: "asc" } } } }),
      orchestrator.list(100),
      orchestrator.queueDepth(),
      db.automationProfile.findMany({ orderBy: { createdAt: "desc" }, take: 100, include: { versions: { orderBy: { version: "desc" }, take: 10 } } }),
      db.serverAgent.findMany({ orderBy: { createdAt: "desc" }, take: 100, select: { id: true, name: true, agentKey: true, status: true, version: true, capabilities: true, scopes: true, lastHeartbeat: true, serverId: true, server: { select: { hostname: true, ip: true, status: true } } } }),
      runId ? db.automationRun.findUnique({ where: { id: runId }, include: { workflow: { select: { key: true, name: true } }, steps: { orderBy: { ordinal: "asc" } } } }) : Promise.resolve(null),
    ]);
    return NextResponse.json(apiSuccess({
      workflows, runs, selectedRun, jobs, queue,
      profiles: profiles.map((p) => ({ ...p, versions: p.versions.map((v) => ({ ...v, config: parseJson(v.config) })) })),
      agents: agents.map((a) => ({ ...a, online: agentOnline(a), capabilities: safeArray(a.capabilities), scopes: safeArray(a.scopes) })),
      workers: listWorkers(),
      profileKinds: Object.keys(profileConfigSchemas),
      jobStates: JOB_STATES,
      observedAt: new Date().toISOString(),
    }));
  } catch (e) { return handleErr(e); }
}

/** Admin-only mutations. Execution, approval freshness and scopes remain orchestrator-enforced. */
export async function POST(request: NextRequest) {
  try {
    const admin = await requireAdmin(request);
    const actor = await actorForUser(admin.id);
    const parsed = actionSchema.parse(await request.json());
    let data: unknown;
    let message = "Automation action recorded";
    switch (parsed.action) {
      case "workflow.create":
        data = await createWorkflow({ ...parsed, ownerId: admin.id }, actor);
        message = "Workflow created"; break;
      case "workflow.toggle": {
        const current = await db.automationWorkflow.findUniqueOrThrow({ where: { id: parsed.workflowId } });
        const workflow = await db.automationWorkflow.update({ where: { id: current.id }, data: { enabled: parsed.enabled, nextRunAt: parsed.enabled && current.trigger === "schedule" ? new Date() : null } });
        await createAuditLog({ actorId: admin.id, actorEmail: admin.email, actorRole: admin.role, action: "AUTOMATION_WORKFLOW_TOGGLED", resourceType: "AutomationWorkflow", resourceId: workflow.id, result: "SUCCESS", metadata: { enabled: parsed.enabled } });
        data = workflow; message = parsed.enabled ? "Workflow enabled" : "Workflow disabled"; break;
      }
      case "workflow.version": {
        const definition = validateWorkflowDefinition(parsed.definition);
        if (parsed.scheduleInput && JSON.stringify(parsed.scheduleInput).length > 100_000) throw new WorkerError("VALIDATION_FAILED", "Schedule input is too large", false);
        const current = await db.automationWorkflow.findUniqueOrThrow({ where: { id: parsed.workflowId } });
        const updated = await db.automationWorkflow.updateMany({ where: { id: current.id, version: current.version }, data: { definition: JSON.stringify(definition), version: current.version + 1, ...(parsed.scheduleInput !== undefined ? { scheduleInput: JSON.stringify(parsed.scheduleInput) } : {}) } });
        if (updated.count !== 1) throw new WorkerError("IDEMPOTENCY_CONFLICT", "Workflow changed while you were editing; reload and try again", false);
        await createAuditLog({ actorId: admin.id, actorEmail: admin.email, actorRole: admin.role, action: "AUTOMATION_WORKFLOW_VERSIONED", resourceType: "AutomationWorkflow", resourceId: current.id, result: "SUCCESS", metadata: { version: current.version + 1, changeNote: parsed.changeNote } });
        data = await db.automationWorkflow.findUniqueOrThrow({ where: { id: current.id } }); message = "Workflow version saved"; break;
      }
      case "workflow.run":
        data = await startWorkflow({ workflowId: parsed.workflowId, input: parsed.input, actor, trigger: "manual", idempotencyKey: `admin-run:${parsed.workflowId}:${parsed.requestId ?? randomUUID()}` });
        message = "Workflow run queued"; break;
      case "run.cancel": {
        const ok = await cancelRun(parsed.runId, actor, parsed.reason, orchestrator);
        if (!ok) throw new WorkerError("NOT_FOUND", "Run is already terminal or missing", false);
        data = { runId: parsed.runId, status: "CANCELLED" }; message = "Cancellation recorded; in-flight effects may still finish"; break;
      }
      case "job.approve": {
        const result = await orchestrator.approve(parsed.jobId, admin, parsed.note);
        if (!result.ok) throw new WorkerError("VALIDATION_FAILED", result.reason, false);
        data = result; message = "Job approved and queued"; break;
      }
      case "job.reject": {
        const result = await orchestrator.reject(parsed.jobId, admin, parsed.reason);
        if (!result.ok) throw new WorkerError("VALIDATION_FAILED", result.reason ?? "Job is not waiting for approval", false);
        data = result; message = "Approval rejected"; break;
      }
      case "job.cancel": {
        const ok = await orchestrator.cancel(parsed.jobId, admin, parsed.reason);
        if (!ok) throw new WorkerError("NOT_FOUND", "Job is already terminal or missing", false);
        data = await orchestrator.status(parsed.jobId); message = "Cancellation recorded; in-flight effects may still finish"; break;
      }
      case "job.requeue": {
        const ok = await orchestrator.requeueDeadLetter(parsed.jobId, admin, parsed.note);
        if (!ok) throw new WorkerError("UNSAFE_RETRY", "Only a retry-safe failed/dead-letter job with a retryable error can be requeued", false);
        data = await orchestrator.status(parsed.jobId); message = "Job requeued; approval is required again when gated"; break;
      }
      case "profile.create":
        data = await createProfile({ ...parsed, ownerId: admin.id }, actor); message = "Profile version saved; verification is still required"; break;
      case "profile.verify":
        data = await verifyProfile(parsed.versionId, actor, parsed.requestId); message = "Profile verification queued"; break;
      case "profile.rollback":
        data = await rollbackProfile(parsed.profileId, parsed.version, actor); message = "Active profile rolled back to a verified version"; break;
    }
    return NextResponse.json(apiSuccess(data, message));
  } catch (e) { return handleErr(e); }
}
