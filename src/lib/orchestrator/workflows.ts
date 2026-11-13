/**
 * Central durable Automation Engine.
 *
 * Definitions are versioned and frozen into each run. Steps are executed by the
 * existing OperationJob orchestrator (atomic claims, leases, retries, approvals,
 * redaction and audit). This module only decides *which* allowlisted handler may
 * run next; it never executes a shell or grants itself approval.
 */
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { db } from "@/lib/db";
import { createAuditLog } from "@/lib/audit";
import { redact } from "@/lib/deploy/redact";
import { renderDeep, resolvePath } from "@/lib/ai/automation/template";
import { WORKER_KINDS, SCOPES, effectiveRisk, type JobActor, type WorkerKind } from "./contracts";
import { getWorker } from "./workers";
import type { Orchestrator } from "./orchestrator";

export const AUTOMATION_STATUSES = [
  "Not implemented", "Partially automated", "Fully automated", "Waiting for external access",
  "Waiting for credentials", "Waiting for approval", "Failed verification", "Operationally verified",
] as const;
export type AutomationStatus = (typeof AUTOMATION_STATUSES)[number];

export const SYSTEM_ACTOR: JobActor = {
  id: "system", email: "automation@alolabs.net", role: "AUTOMATION", scopes: [...SCOPES],
};

const PERMISSION_SCOPES: Record<string, string[]> = {
  WEBSITE_READ: ["monitoring:read"], WEBSITE_CREATE: ["repo:read", "build:run", "release:write"],
  WEBSITE_DEPLOY: ["repo:read", "build:run", "release:write"], WEBSITE_UPDATE: ["release:write"],
  WEBSITE_RESTART: ["recovery:execute"], DOMAIN_READ: ["domain:read"], DOMAIN_CREATE: ["domain:read"],
  DOMAIN_UPDATE: ["domain:read", "domain:write"], SSL_MANAGE: ["domain:read", "domain:write"],
  DATABASE_READ: ["database:read"], DATABASE_CREATE: ["database:read", "database:admin"],
  BACKUP_READ: ["backup:read"], BACKUP_CREATE: ["backup:read", "backup:write"], BACKUP_RESTORE: ["backup:read", "backup:restore"],
  SERVER_MANAGE: ["server:read", "server:execute"], SYSTEM_MANAGE: ["automation:run", "automation:manage", "billing:read", "billing:write", "ai:read"],
};

export function scopesForUser(user: { role: string; permissions?: string[] }): string[] {
  if (user.role === "SUPER_ADMIN" || user.role === "ADMIN") return [...SCOPES];
  const scopes = new Set<string>(["automation:run"]);
  for (const permission of user.permissions ?? []) for (const scope of PERMISSION_SCOPES[permission] ?? []) scopes.add(scope);
  return [...scopes];
}

export async function actorForUser(userId: string | null | undefined): Promise<JobActor> {
  if (!userId) return SYSTEM_ACTOR;
  const user = await db.user.findUnique({ where: { id: userId }, include: { role: { include: { permissions: { include: { permission: true } } } } } });
  if (!user || !user.isActive) return { id: userId, email: "inactive-user", role: "CUSTOMER", scopes: [] };
  return { id: user.id, email: user.email, role: user.role.name, scopes: scopesForUser({ role: user.role.name, permissions: user.role.permissions.map((p) => p.permission.name) }) };
}

const conditionSchema = z.object({
  path: z.string().min(1).max(300),
  operator: z.enum(["truthy", "falsy", "equals", "notEquals", "exists"]).default("truthy"),
  value: z.unknown().optional(),
});
const stepSchema = z.object({
  key: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/),
  label: z.string().min(1).max(160),
  handler: z.enum(WORKER_KINDS),
  input: z.record(z.string(), z.unknown()).default({}),
  dependsOn: z.array(z.string()).max(20).default([]),
  when: conditionSchema.optional(),
  lockKey: z.string().max(200).optional(),
  executionActor: z.enum(["requester", "platform"]).default("requester"),
  requiresApproval: z.boolean().optional(),
  maxAttempts: z.number().int().min(1).max(10).optional(),
  timeoutMs: z.number().int().min(100).max(3_600_000).optional(),
});
export const workflowDefinitionSchema = z.object({ version: z.literal(1), steps: z.array(stepSchema).min(1).max(40) });
export type WorkflowDefinition = z.output<typeof workflowDefinitionSchema>;
export type WorkflowDefinitionInput = z.input<typeof workflowDefinitionSchema>;
export type WorkflowStepDefinition = z.infer<typeof stepSchema>;

export function validateWorkflowDefinition(raw: unknown): WorkflowDefinition {
  const definition = workflowDefinitionSchema.parse(raw);
  const keys = new Set<string>();
  for (const step of definition.steps) {
    if (keys.has(step.key)) throw new Error(`Duplicate step key: ${step.key}`);
    keys.add(step.key);
    if (!getWorker(step.handler)) throw new Error(`Unknown allowlisted handler: ${step.handler}`);
    if (step.handler === ("WORKFLOW_STEP" as WorkerKind)) throw new Error("Workflow steps cannot recursively execute workflows");
  }
  for (const step of definition.steps) for (const dep of step.dependsOn) if (!keys.has(dep)) throw new Error(`Step ${step.key} depends on unknown step ${dep}`);
  // Kahn cycle detection.
  const indegree = new Map(definition.steps.map((s) => [s.key, s.dependsOn.length]));
  const queue = definition.steps.filter((s) => s.dependsOn.length === 0).map((s) => s.key);
  let seen = 0;
  while (queue.length) {
    const key = queue.shift()!; seen++;
    for (const step of definition.steps.filter((s) => s.dependsOn.includes(key))) {
      const next = (indegree.get(step.key) ?? 1) - 1; indegree.set(step.key, next); if (next === 0) queue.push(step.key);
    }
  }
  if (seen !== definition.steps.length) throw new Error("Workflow dependencies contain a cycle");
  return definition;
}

function json(value: unknown): string { return JSON.stringify(value ?? null); }
function parse<T>(raw: string | null | undefined, fallback: T): T { try { return raw ? JSON.parse(raw) as T : fallback; } catch { return fallback; } }

export const BUILTIN_WORKFLOWS: Array<{ key: string; name: string; description: string; trigger: string; eventName?: string; intervalSeconds?: number; definition: WorkflowDefinitionInput }> = [
  {
    key: "project-lifecycle", name: "Repository to verified application", trigger: "event", eventName: "project.lifecycle.requested",
    description: "Inspects a connected repository, detects/prepares its runtime, deploys through the verified release engine, and optionally configures an approved custom domain/TLS. Missing external access is reported, never simulated.",
    definition: { version: 1, steps: [
      { key: "inspect", label: "Resolve exact repository commit", handler: "REPO_DISCOVERY", input: { projectId: "{{ input.projectId }}", ref: "{{ input.commitSha }}" } },
      { key: "detect", label: "Detect framework and runtime", handler: "FRAMEWORK_DETECTION", dependsOn: ["inspect"], input: { projectId: "{{ input.projectId }}" } },
      { key: "prepare", label: "Validate environment and create deployment", handler: "PLATFORM_OPS", dependsOn: ["detect"], input: { action: "prepare-deployment", projectId: "{{ input.projectId }}", commitSha: "{{ steps.inspect.output.sha }}", detection: "{{ steps.detect.output }}", domain: "{{ input.domain }}", profileKey: "{{ input.profileKey }}" }, lockKey: "project:{{ input.projectId }}" },
      { key: "deploy", label: "Build, activate and verify release", handler: "BUILD_TEST", dependsOn: ["prepare"], input: { deploymentId: "{{ steps.prepare.output.deploymentId }}" }, lockKey: "project:{{ input.projectId }}", timeoutMs: 1_800_000 },
      { key: "dns", label: "Verify custom domain DNS", handler: "DOMAIN_TLS", dependsOn: ["deploy"], when: { path: "input.domain", operator: "truthy" }, input: { action: "verify-ownership", projectId: "{{ input.projectId }}", domain: "{{ input.domain }}", expectedIp: "{{ steps.prepare.output.publicIp }}", agentId: "{{ steps.prepare.output.agentId }}" } },
      { key: "proxy", label: "Configure reverse proxy", handler: "PLATFORM_OPS", dependsOn: ["dns"], when: { path: "input.domain", operator: "truthy" }, executionActor: "platform", input: { action: "configure-proxy", projectId: "{{ input.projectId }}", domain: "{{ input.domain }}", port: "{{ steps.prepare.output.port }}", agentId: "{{ steps.prepare.output.agentId }}" } },
      { key: "tls", label: "Issue TLS certificate", handler: "DOMAIN_TLS", dependsOn: ["proxy"], when: { path: "input.domain", operator: "truthy" }, executionActor: "platform", input: { action: "issue-certificate", projectId: "{{ input.projectId }}", domain: "{{ input.domain }}", agentId: "{{ steps.prepare.output.agentId }}" } },
      { key: "verify", label: "Verify live application", handler: "MONITORING_RECOVERY", dependsOn: ["tls"], input: { action: "check", projectId: "{{ input.projectId }}" } },
      { key: "security", label: "Scan activated release", handler: "SECURITY_ANALYSIS", dependsOn: ["verify"], input: { projectId: "{{ input.projectId }}" } },
      { key: "protect", label: "Enable monitoring and backup schedule", handler: "PLATFORM_OPS", dependsOn: ["security"], input: { action: "enable-protection", projectId: "{{ input.projectId }}" } },
    ] },
  },
  {
    key: "application-health", name: "Application health and self-healing trigger", trigger: "schedule", intervalSeconds: 60,
    description: "Probes managed applications, records real health, and emits a recovery event only for supported failures.",
    definition: { version: 1, steps: [{ key: "sweep", label: "Probe fleet", handler: "PLATFORM_OPS", input: { action: "monitor-fleet" }, timeoutMs: 300_000 }] },
  },
  {
    key: "self-heal", name: "Diagnose and recover application", trigger: "event", eventName: "application.health.failed",
    description: "Collects evidence, diagnoses deterministically, performs only the permitted restart/rollback, and verifies the result. AI may advise but cannot approve or execute arbitrary commands.",
    definition: { version: 1, steps: [
      { key: "evidence", label: "Collect logs and metrics", handler: "PLATFORM_OPS", input: { action: "collect-evidence", projectId: "{{ input.projectId }}" } },
      { key: "diagnose", label: "Determine recovery action", handler: "PLATFORM_OPS", dependsOn: ["evidence"], input: { action: "diagnose", projectId: "{{ input.projectId }}", evidence: "{{ steps.evidence.output }}" } },
      { key: "restart", label: "Restart crashed service", handler: "INFRASTRUCTURE", dependsOn: ["diagnose"], when: { path: "steps.diagnose.output.action", operator: "equals", value: "restart" }, input: { agentId: "{{ steps.diagnose.output.agentId }}", command: "{{ steps.diagnose.output.command }}", args: { unit: "{{ steps.diagnose.output.unit }}", domain: "{{ steps.diagnose.output.domain }}" } } },
      { key: "rollback", label: "Restore previous verified release", handler: "MONITORING_RECOVERY", dependsOn: ["diagnose"], when: { path: "steps.diagnose.output.action", operator: "equals", value: "rollback" }, input: { action: "recover", projectId: "{{ input.projectId }}" } },
      { key: "restart-static", label: "Restart platform static listener", handler: "PLATFORM_OPS", dependsOn: ["diagnose"], when: { path: "steps.diagnose.output.action", operator: "equals", value: "restart-static" }, input: { action: "restart-static", projectId: "{{ input.projectId }}" } },
      { key: "verify", label: "Verify recovery", handler: "MONITORING_RECOVERY", dependsOn: ["restart", "rollback", "restart-static"], input: { action: "check", projectId: "{{ input.projectId }}" } },
    ] },
  },
  { key: "node-health", name: "Node health and allocation guard", trigger: "schedule", intervalSeconds: 60, description: "Marks stale nodes offline for scheduling and alerts administrators.", definition: { version: 1, steps: [{ key: "nodes", label: "Check enrolled nodes", handler: "PLATFORM_OPS", input: { action: "node-health" } }] } },
  { key: "ssl-renewal", name: "Automatic TLS renewal", trigger: "schedule", intervalSeconds: 3600, description: "Renews certificates through verified node agents when DNS and ACME access allow.", definition: { version: 1, steps: [{ key: "renew", label: "Renew expiring certificates", handler: "PLATFORM_OPS", input: { action: "ssl-renewal-sweep" }, timeoutMs: 600_000 }] } },
  { key: "backup-schedule", name: "Backup creation and verification", trigger: "schedule", intervalSeconds: 86400, description: "Creates site backups through enrolled agents and verifies checksums; never deletes customer data.", definition: { version: 1, steps: [{ key: "backup", label: "Backup protected sites", handler: "PLATFORM_OPS", input: { action: "backup-sweep" }, timeoutMs: 1_800_000 }] } },
  { key: "usage-billing", name: "Usage metering and billing calculation", trigger: "schedule", intervalSeconds: 3600, description: "Aggregates measured usage into idempotent usage records; invoice payment remains a financial approval.", definition: { version: 1, steps: [{ key: "usage", label: "Meter usage", handler: "PLATFORM_OPS", input: { action: "usage-sweep" } }] } },
];

export async function ensureBuiltinWorkflows(): Promise<void> {
  for (const builtin of BUILTIN_WORKFLOWS) {
    const definition = validateWorkflowDefinition(builtin.definition);
    const existing = await db.automationWorkflow.findUnique({ where: { key: builtin.key } });
    // A platform-owned builtin (no administrator author) is refreshed when the
    // compiled-in definition changes, and the version bump records that the
    // definition moved. A workflow an administrator authored (createdById set)
    // is never overwritten.
    const refresh =
      existing &&
      existing.createdById === null &&
      existing.definition !== json(definition)
        ? { definition: json(definition), version: { increment: 1 }, description: builtin.description }
        : {};
    await db.automationWorkflow.upsert({
      where: { key: builtin.key },
      create: { key: builtin.key, name: builtin.name, description: builtin.description, definition: json(definition), trigger: builtin.trigger, eventName: builtin.eventName ?? null, intervalSeconds: builtin.intervalSeconds ?? null, enabled: true, nextRunAt: builtin.trigger === "schedule" ? new Date() : null },
      update: refresh,
    });
  }
}

export async function createWorkflow(input: { key: string; name: string; description?: string; definition: unknown; trigger?: string; eventName?: string; intervalSeconds?: number; scheduleInput?: Record<string, unknown>; ownerId?: string }, actor: JobActor) {
  const definition = validateWorkflowDefinition(input.definition);
  if (input.scheduleInput && JSON.stringify(input.scheduleInput).length > 100_000) throw new Error("Schedule input is too large");
  const trigger = input.trigger ?? "manual";
  if (!["manual", "event", "schedule", "webhook"].includes(trigger)) throw new Error("Invalid trigger");
  if (trigger === "schedule" && (!input.intervalSeconds || input.intervalSeconds < 30)) throw new Error("Scheduled workflows need intervalSeconds >= 30");
  if ((trigger === "event" || trigger === "webhook") && !input.eventName) throw new Error("Event/webhook workflows need eventName");
  const workflow = await db.automationWorkflow.create({ data: { key: input.key, name: input.name, description: input.description, definition: json(definition), trigger, eventName: input.eventName, intervalSeconds: input.intervalSeconds, scheduleInput: json(input.scheduleInput ?? {}), ownerId: input.ownerId, createdById: actor.id === "system" ? null : actor.id, nextRunAt: trigger === "schedule" ? new Date() : null } });
  await createAuditLog({ actorId: actor.id === "system" ? undefined : actor.id, actorEmail: actor.email, actorRole: actor.role, action: "AUTOMATION_WORKFLOW_CREATED", resourceType: "AutomationWorkflow", resourceId: workflow.id, result: "SUCCESS", metadata: { key: workflow.key, version: 1 } });
  return workflow;
}

export async function startWorkflow(opts: { workflowId?: string; key?: string; input: Record<string, unknown>; actor: JobActor; trigger: string; idempotencyKey?: string; resourceId?: string; resourceType?: string }) {
  const workflow = opts.workflowId ? await db.automationWorkflow.findUnique({ where: { id: opts.workflowId } }) : await db.automationWorkflow.findUnique({ where: { key: opts.key! } });
  if (!workflow) throw new Error("Workflow not found");
  if (!workflow.enabled && opts.trigger !== "manual") throw new Error("Workflow is disabled");
  const definition = validateWorkflowDefinition(parse(workflow.definition, { version: 1, steps: [] }));
  const input = opts.input;
  if (typeof input.projectId === "string") {
    const project = await db.gitProject.findUnique({ where: { id: input.projectId } });
    if (!project) throw new Error("Project not found");
    const website = await db.website.findUnique({ where: { id: project.websiteId } });
    const privileged = ["ADMIN", "SUPER_ADMIN", "AUTOMATION"].includes(opts.actor.role);
    if (!privileged && project.createdById !== opts.actor.id && website?.ownerId !== opts.actor.id) throw new Error("Project belongs to another customer");
  }
  if (JSON.stringify(input).length > 100_000) throw new Error("Workflow input is too large");
  const idempotencyKey = opts.idempotencyKey ?? `manual:${workflow.id}:${randomUUID()}`;
  const existing = await db.automationRun.findUnique({ where: { idempotencyKey }, include: { steps: true } });
  if (existing) return existing;
  const correlationId = randomUUID();
  const run = await db.automationRun.create({ data: { workflowId: workflow.id, workflowVersion: workflow.version, snapshot: json(definition), trigger: opts.trigger, idempotencyKey, correlationId, input: json(input), actorId: opts.actor.id === "system" ? null : opts.actor.id, actorEmail: opts.actor.email, actorRole: opts.actor.role, actorScopes: json(opts.actor.scopes ?? []), resourceId: opts.resourceId ?? (typeof input.projectId === "string" ? input.projectId : null), resourceType: opts.resourceType ?? (typeof input.projectId === "string" ? "GitProject" : null) } });
  await db.automationStep.createMany({ data: definition.steps.map((step, ordinal) => ({ runId: run.id, key: step.key, ordinal, label: step.label, handler: step.handler, dependsOn: json(step.dependsOn), inputTemplate: json({ input: step.input, when: step.when ?? null, lockKey: step.lockKey ?? null, executionActor: step.executionActor, requiresApproval: step.requiresApproval ?? null, maxAttempts: step.maxAttempts ?? null, timeoutMs: step.timeoutMs ?? null }) })) });
  await db.automationWorkflow.update({ where: { id: workflow.id }, data: { lastRunAt: new Date() } });
  await createAuditLog({ actorId: run.actorId ?? undefined, actorEmail: opts.actor.email, actorRole: opts.actor.role, action: "AUTOMATION_RUN_STARTED", resourceType: "AutomationRun", resourceId: run.id, requestId: correlationId, result: "QUEUED", metadata: { workflowKey: workflow.key, version: workflow.version, trigger: opts.trigger } });
  const { orchestrator } = await import("./orchestrator");
  await advanceRun(run.id, orchestrator);
  return db.automationRun.findUniqueOrThrow({ where: { id: run.id }, include: { steps: { orderBy: { ordinal: "asc" } } } });
}

export async function triggerEvent(eventName: string, payload: Record<string, unknown>, actor?: JobActor, deliveryId?: string) {
  await ensureBuiltinWorkflows();
  const workflows = await db.automationWorkflow.findMany({ where: { enabled: true, trigger: { in: ["event", "webhook"] }, eventName } });
  const runs = [];
  for (const workflow of workflows) {
    const runActor = actor ?? (typeof payload.userId === "string" ? await actorForUser(payload.userId) : SYSTEM_ACTOR);
    const key = deliveryId ?? createHash("sha256").update(JSON.stringify(payload)).digest("hex").slice(0, 32);
    runs.push(await startWorkflow({ workflowId: workflow.id, input: payload, actor: runActor, trigger: workflow.trigger, idempotencyKey: `event:${workflow.id}:${eventName}:${key}`.slice(0, 180), resourceId: typeof payload.projectId === "string" ? payload.projectId : undefined, resourceType: typeof payload.projectId === "string" ? "GitProject" : undefined }));
  }
  return runs;
}

export async function tickSchedules(now = new Date(), limit = 20) {
  await ensureBuiltinWorkflows();
  const due = await db.automationWorkflow.findMany({ where: { enabled: true, trigger: "schedule", nextRunAt: { lte: now } }, orderBy: { nextRunAt: "asc" }, take: limit });
  const started: string[] = [];
  for (const workflow of due) {
    const next = new Date(now.getTime() + (workflow.intervalSeconds ?? 3600) * 1000);
    const claimed = await db.automationWorkflow.updateMany({ where: { id: workflow.id, enabled: true, nextRunAt: workflow.nextRunAt }, data: { nextRunAt: next } });
    if (claimed.count !== 1) continue;
    const actor = workflow.createdById ? await actorForUser(workflow.createdById) : SYSTEM_ACTOR;
    const run = await startWorkflow({ workflowId: workflow.id, input: parse(workflow.scheduleInput, {}), actor, trigger: "schedule", idempotencyKey: `schedule:${workflow.id}:${workflow.nextRunAt?.toISOString() ?? now.toISOString()}` });
    started.push(run.id);
  }
  return started;
}

function conditionPasses(condition: z.infer<typeof conditionSchema> | null, scope: { input: unknown; steps: Record<string, { output?: unknown; status?: string }> }): boolean {
  if (!condition) return true;
  const value = resolvePath(scope, condition.path);
  switch (condition.operator) {
    case "falsy": return !value;
    case "equals": return JSON.stringify(value) === JSON.stringify(condition.value);
    case "notEquals": return JSON.stringify(value) !== JSON.stringify(condition.value);
    case "exists": return value !== undefined && value !== null && value !== "";
    default: return Boolean(value);
  }
}

const WAITING_CODES = new Set(["WAITING_CREDENTIALS", "WAITING_EXTERNAL", "NOT_CONFIGURED", "AGENT_UNAVAILABLE", "WAITING_APPROVAL"]);

export async function advanceRun(runId: string, orch: Orchestrator): Promise<void> {
  const run = await db.automationRun.findUnique({ where: { id: runId }, include: { steps: { orderBy: { ordinal: "asc" } }, workflow: true } });
  if (!run || ["SUCCEEDED", "FAILED", "CANCELLED"].includes(run.status)) { await notifyTerminal(runId); return; }
  const definition = parse<WorkflowDefinition>(run.snapshot, { version: 1, steps: [] });
  const scope = { input: parse<Record<string, unknown>>(run.input, {}), steps: Object.fromEntries(run.steps.map((s) => [s.key, { output: parse(s.output, undefined), status: s.status }])) } as { input: unknown; steps: Record<string, { output?: unknown; status?: string }> };
  const actor: JobActor = { id: run.actorId ?? "system", email: run.actorEmail ?? SYSTEM_ACTOR.email, role: run.actorRole ?? "AUTOMATION", scopes: parse<string[]>(run.actorScopes, []) };
  let changed = false;
  for (const step of run.steps) {
    if (step.status !== "PENDING") continue;
    const def = definition.steps.find((s) => s.key === step.key)!;
    const deps = run.steps.filter((s) => def.dependsOn.includes(s.key));
    if (deps.some((d) => ["FAILED", "CANCELLED", "WAITING_EXTERNAL"].includes(d.status))) { await db.automationStep.update({ where: { id: step.id }, data: { status: "SKIPPED", error: "Dependency did not complete" } }); changed = true; continue; }
    if (deps.some((d) => d.status !== "SUCCEEDED")) continue;
    const stored = parse<{ input: Record<string, unknown>; when: z.infer<typeof conditionSchema> | null; lockKey: string | null; executionActor: "requester" | "platform"; requiresApproval: boolean | null; maxAttempts: number | null; timeoutMs: number | null }>(step.inputTemplate, { input: {}, when: null, lockKey: null, executionActor: "requester", requiresApproval: null, maxAttempts: null, timeoutMs: null });
    if (!conditionPasses(stored.when, scope)) { await db.automationStep.update({ where: { id: step.id }, data: { status: "SKIPPED", finishedAt: new Date() } }); changed = true; continue; }
    const input = renderDeep(stored.input, scope) as Record<string, unknown>;
    const worker = getWorker(step.handler)!;
    const risk = effectiveRisk(worker, worker.inputSchema.parse(input));
    const stepActor = stored.executionActor === "platform" ? SYSTEM_ACTOR : actor;
    const requiresApproval = stored.requiresApproval === true || (stored.executionActor === "platform" && risk !== "READ_ONLY") || undefined;
    try {
      const job = await orch.enqueue({ kind: step.handler as WorkerKind, type: `${run.workflow.key}:${step.key}`, input, actor: stepActor, lockKey: stored.lockKey ? String(renderDeep(stored.lockKey, scope)) : `workflow:${run.id}`, websiteId: typeof input.websiteId === "string" ? input.websiteId : undefined, resourceId: run.resourceId ?? undefined, resourceType: run.resourceType ?? (typeof input.projectId === "string" ? "GitProject" : undefined), idempotencyKey: `workflow-step:${run.id}:${step.key}`, correlationId: run.correlationId, requiresApproval, maxAttempts: stored.maxAttempts ?? undefined, timeoutMs: stored.timeoutMs ?? undefined, automation: { runId: run.id, stepId: step.id } });
      await db.automationStep.updateMany({ where: { id: step.id, jobId: null }, data: { jobId: job.jobId, status: job.status === "WAITING_APPROVAL" ? "WAITING_APPROVAL" : "QUEUED" } });
      changed = true;
    } catch (error) {
      await db.automationStep.update({ where: { id: step.id }, data: { status: "FAILED", error: redact(error instanceof Error ? error.message : String(error)).slice(0, 1000), finishedAt: new Date() } });
      changed = true;
    }
  }
  const steps = await db.automationStep.findMany({ where: { runId }, orderBy: { ordinal: "asc" } });
  const failed = steps.find((s) => s.status === "FAILED");
  const waiting = steps.find((s) => s.status === "WAITING_EXTERNAL");
  const done = steps.every((s) => ["SUCCEEDED", "SKIPPED"].includes(s.status));
  let status = run.status;
  let error = run.error;
  if (failed) { status = "FAILED"; error = failed.error; }
  else if (waiting) { status = "WAITING_EXTERNAL"; error = waiting.error; }
  else if (done) { status = "SUCCEEDED"; error = null; }
  else if (steps.some((s) => s.status === "WAITING_APPROVAL")) status = "WAITING_APPROVAL";
  else if (steps.some((s) => s.status === "RETRYING")) status = "RETRYING";
  else if (steps.some((s) => ["QUEUED", "RUNNING"].includes(s.status))) status = "RUNNING";
  const executed = steps.filter((s) => s.status === "SUCCEEDED");
  // An all-skipped run completed, but nothing was independently observed.
  const verified = done && executed.length > 0 && executed.every((s) => s.verified === true);
  const terminal = ["SUCCEEDED", "FAILED", "CANCELLED"].includes(status);
  if (status !== run.status || error !== run.error || verified !== run.verified || changed) {
    await db.automationRun.update({ where: { id: runId }, data: { status, error, verified, startedAt: run.startedAt ?? new Date(), ...(terminal ? { finishedAt: new Date(), durationMs: Date.now() - (run.startedAt?.getTime() ?? run.createdAt.getTime()), output: json(Object.fromEntries(steps.map((s) => [s.key, parse(s.output, null)]))) } : {}) } });
  }
  if (terminal) {
    for (const step of steps.filter((s) => ["PENDING", "QUEUED", "RETRYING", "WAITING_APPROVAL"].includes(s.status) && s.jobId)) await orch.cancel(step.jobId!, { email: actor.email, role: actor.role }, `Workflow ${status}`).catch(() => false);
    await createAuditLog({ actorId: run.actorId ?? undefined, actorEmail: run.actorEmail ?? undefined, actorRole: run.actorRole ?? undefined, action: "AUTOMATION_RUN_FINISHED", resourceType: "AutomationRun", resourceId: runId, requestId: run.correlationId, result: status, metadata: { verified, workflowKey: run.workflow.key, error } });
    await notifyTerminal(runId);
  }
}

export async function syncWorkflowStep(stepId: string, orch: Orchestrator): Promise<void> {
  const step = await db.automationStep.findUnique({ where: { id: stepId } });
  if (!step?.jobId) return;
  const job = await db.operationJob.findUnique({ where: { id: step.jobId } });
  if (!job) return;
  const stored = parse<{ result?: { data?: unknown; verified?: boolean; message?: string } }>(job.output, {});
  const map: Record<string, string> = { QUEUED: "QUEUED", RETRYING: "RETRYING", RUNNING: "RUNNING", VERIFYING: "RUNNING", WAITING_APPROVAL: "WAITING_APPROVAL", SUCCESS: "SUCCEEDED", FAILED: WAITING_CODES.has(job.lastError ?? "") ? "WAITING_EXTERNAL" : "FAILED", DEAD_LETTER: "FAILED", CANCELLED: "CANCELLED", ROLLED_BACK: "FAILED", ROLLING_BACK: "RUNNING" };
  await db.automationStep.update({ where: { id: step.id }, data: { status: map[job.status] ?? "FAILED", output: stored.result?.data !== undefined ? json(stored.result.data) : null, verified: job.status === "SUCCESS" ? stored.result?.verified === true : null, error: job.error, attempts: job.attempts, startedAt: job.startedAt, finishedAt: job.finishedAt } });
  await advanceRun(step.runId, orch);
}

async function notifyTerminal(runId: string): Promise<void> {
  const run = await db.automationRun.findUnique({ where: { id: runId }, include: { workflow: true } });
  if (!run || !["SUCCEEDED", "FAILED", "CANCELLED"].includes(run.status) || run.notificationId) return;
  const recipient = run.actorId ?? (await db.user.findFirst({ where: { role: { name: "SUPER_ADMIN" }, isActive: true }, select: { id: true } }))?.id;
  if (!recipient) return;
  // Deterministic notification id: a crash between insert and run update cannot duplicate it.
  await db.notification.upsert({ where: { id: run.id }, create: { id: run.id, userId: recipient, title: `${run.workflow.name}: ${run.status}`, message: run.status === "SUCCEEDED" ? (run.verified ? `Verified workflow completed (version ${run.workflowVersion}).` : `Workflow completed without verified execution evidence (version ${run.workflowVersion}).`) : (run.error ?? "Workflow did not complete.").slice(0, 1000), type: "automation", link: `/automation?run=${run.id}` }, update: {} });
  await db.automationRun.updateMany({ where: { id: runId, notificationId: null }, data: { notificationId: run.id } });
}

export async function reconcileAutomation(orch: Orchestrator): Promise<{ runs: number; notifications: number }> {
  const steps = await db.automationStep.findMany({ where: { jobId: { not: null }, status: { in: ["QUEUED", "RUNNING", "RETRYING", "WAITING_APPROVAL", "WAITING_EXTERNAL"] } }, take: 200 });
  for (const step of steps) await syncWorkflowStep(step.id, orch);
  const runs = await db.automationRun.findMany({ where: { status: { in: ["QUEUED", "RUNNING", "RETRYING", "WAITING_APPROVAL", "WAITING_EXTERNAL"] } }, take: 100 });
  for (const run of runs) await advanceRun(run.id, orch);
  const pendingNotifications = await db.automationRun.findMany({ where: { status: { in: ["SUCCEEDED", "FAILED", "CANCELLED"] }, notificationId: null }, take: 100 });
  for (const run of pendingNotifications) await notifyTerminal(run.id);
  return { runs: runs.length, notifications: pendingNotifications.length };
}

export async function cancelRun(runId: string, actor: JobActor, reason: string, orch: Orchestrator) {
  const run = await db.automationRun.findUnique({ where: { id: runId }, include: { steps: true } });
  if (!run || ["SUCCEEDED", "FAILED", "CANCELLED"].includes(run.status)) return false;
  await db.automationRun.update({ where: { id: runId }, data: { status: "CANCELLED", error: reason.slice(0, 500), finishedAt: new Date(), durationMs: Date.now() - (run.startedAt?.getTime() ?? run.createdAt.getTime()) } });
  for (const step of run.steps) if (step.jobId) await orch.cancel(step.jobId, actor, reason).catch(() => false);
  await createAuditLog({ actorId: actor.id === "system" ? undefined : actor.id, actorEmail: actor.email, actorRole: actor.role, action: "AUTOMATION_RUN_CANCELLED", resourceType: "AutomationRun", resourceId: runId, result: "CANCELLED", metadata: { reason } });
  await notifyTerminal(runId);
  return true;
}
