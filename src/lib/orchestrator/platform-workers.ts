/** Platform lifecycle handlers executed by the central orchestrator. */
import { z } from "zod";
import { db } from "@/lib/db";
import { redact } from "@/lib/deploy/redact";
import { configFromDetection, resolveConfig, validateDeployConfig } from "@/lib/deploy/config";
import { verifyDeployment, startStaticServer, projectRoot, currentReleaseDir } from "@/lib/deploy/service";
import { agentOnline, dispatchTask } from "@/lib/agents/agent";
import { defineWorker, fail, ok, WorkerError, type WorkerDefinition, type WorkerContext } from "./contracts";
import { activeProfile, validateProfileConfig } from "./profiles";

const platformInput = z.object({
  action: z.enum(["prepare-deployment", "configure-proxy", "enable-protection", "monitor-fleet", "collect-evidence", "diagnose", "restart-static", "node-health", "ssl-renewal-sweep", "backup-sweep", "backup-site", "usage-sweep"]),
  projectId: z.string().min(1).optional(),
  commitSha: z.string().regex(/^[0-9a-f]{40}$/).optional(),
  detection: z.record(z.string(), z.unknown()).optional(),
  domain: z.string().min(3).max(253).optional(),
  profileKey: z.string().max(100).optional(),
  port: z.number().int().min(1).max(65535).optional(),
  agentId: z.string().min(1).optional(),
  evidence: z.record(z.string(), z.unknown()).optional(),
});
type PlatformInput = z.infer<typeof platformInput>;

const READ_ACTIONS = new Set(["monitor-fleet", "collect-evidence", "diagnose", "node-health", "usage-sweep"]);
const IDEMPOTENT_ACTIONS = new Set(["enable-protection", "monitor-fleet", "collect-evidence", "diagnose", "node-health", "usage-sweep", "restart-static", "ssl-renewal-sweep", "backup-sweep"]);

function parse<T>(raw: string | null | undefined, fallback: T): T { try { return raw ? JSON.parse(raw) as T : fallback; } catch { return fallback; } }

async function projectWithWebsite(projectId: string) {
  const project = await db.gitProject.findUnique({ where: { id: projectId } });
  if (!project) throw new WorkerError("NOT_FOUND", `Project ${projectId} not found`, false);
  const website = await db.website.findUnique({ where: { id: project.websiteId } });
  if (!website || website.deletedAt) throw new WorkerError("NOT_FOUND", "Website not found", false);
  return { project, website };
}

async function nodeForProject(projectId: string, profileKey?: string) {
  if (profileKey) {
    const version = await activeProfile(profileKey);
    if (!version) throw new WorkerError("WAITING_EXTERNAL", `Node profile ${profileKey} has no verified active version`, false);
    const profile = await db.automationProfile.findUnique({ where: { id: version.profileId } });
    if (profile?.kind !== "node") throw new WorkerError("VALIDATION_FAILED", "profileKey must reference a node profile", false);
    const config = validateProfileConfig("node", parse(version.config, {})) as { agentId: string; publicIp?: string };
    const agent = await db.serverAgent.findUnique({ where: { id: config.agentId }, include: { server: true } });
    if (!agent || !agentOnline(agent)) throw new WorkerError("AGENT_UNAVAILABLE", `Node agent ${config.agentId} is not online`, false);
    return { agentId: agent.id, publicIp: config.publicIp ?? agent.server?.ip ?? null };
  }
  const defaultAgent = process.env.AUTOMATION_DEFAULT_AGENT_ID;
  if (defaultAgent) {
    const agent = await db.serverAgent.findUnique({ where: { id: defaultAgent } });
    if (!agent || !agentOnline(agent)) throw new WorkerError("AGENT_UNAVAILABLE", `Default node agent ${defaultAgent} is not online`, false);
    return { agentId: agent.id, publicIp: process.env.DEPLOY_PUBLIC_IP ?? null };
  }
  if (process.env.DEPLOY_LOCAL_EXECUTION === "false") throw new WorkerError("WAITING_EXTERNAL", "No verified node profile is selected and local deployment execution is disabled", false);
  return { agentId: null, publicIp: process.env.DEPLOY_PUBLIC_IP ?? null };
}

/** Dispatch one allowlisted agent command and wait for its durable result. */
export async function runAgent(ctx: WorkerContext, agentId: string, command: string, args: Record<string, string | number | boolean>, timeoutMs = 120_000) {
  const agent = await db.serverAgent.findUnique({ where: { id: agentId } });
  if (!agent || !agentOnline(agent)) throw new WorkerError("AGENT_UNAVAILABLE", `Agent ${agentId} is offline; ${command} was not dispatched`, false);
  const task = await dispatchTask({ agentId, command, args, jobId: ctx.jobId, correlationId: ctx.correlationId, actorEmail: ctx.actor?.email, actorScopes: ctx.actor?.scopes ?? [], approvedBy: ctx.approval?.by, approvedAt: ctx.approval?.at });
  if (task.status === "REFUSED") throw new WorkerError("REFUSED_BY_ALLOWLIST", task.refuseReason ?? "Agent refused command", false);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    ctx.signal.throwIfAborted();
    const row = await db.agentTask.findUnique({ where: { id: task.id } });
    if (row && !["PENDING", "ASSIGNED", "RUNNING"].includes(row.status)) {
      if (row.status !== "SUCCEEDED") throw new WorkerError(row.status === "REFUSED" ? "REFUSED_BY_ALLOWLIST" : "AGENT_TASK_FAILED", row.error ?? row.refuseReason ?? `Agent task ${row.status}`, false);
      const result = parse<{ data?: Record<string, unknown> }>(row.result, {});
      return { taskId: row.id, data: result.data ?? parse<Record<string, unknown>>(row.result, {}) };
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new WorkerError("AGENT_TASK_PENDING", `Agent task ${task.id} is still pending; it was not reported as successful`, true, { taskId: task.id });
}

async function prepareDeployment(input: PlatformInput, ctx: WorkerContext) {
  if (!input.projectId || !input.commitSha) throw new WorkerError("VALIDATION_FAILED", "projectId and commitSha are required", false);
  const { project, website } = await projectWithWebsite(input.projectId);
  const node = await nodeForProject(input.projectId, input.profileKey);
  const stored = validateDeployConfig(parse(project.config, {}));
  const importDetection = parse<any>(project.detection, null);
  let config = stored;
  if (input.detection && stored.source === "detected") {
    try { config = resolveConfig(stored, importDetection, input.detection as any); } catch { config = stored; }
  }
  config.port = project.port ?? config.port;
  config.serviceManager = project.serviceManager as typeof config.serviceManager;
  config.serviceName = project.serviceName ?? config.serviceName;
  config = validateDeployConfig(config);
  if (config.requiresApproval && !config.confirmedBy) throw new WorkerError("WAITING_APPROVAL", "Detected runtime configuration is ambiguous and must be confirmed before deployment", false);
  if (config.serviceManager === "none") throw new WorkerError("WAITING_EXTERNAL", "This runtime needs a verified service-manager profile; the platform will not pretend a static server can run it", false);
  const envRows = await db.websiteEnvironment.findMany({ where: { websiteId: website.id }, select: { key: true } });
  const present = new Set(envRows.map((e) => e.key));
  const missing = config.envNames.filter((name) => !present.has(name) && !process.env[name]);
  if (missing.length) throw new WorkerError("WAITING_CREDENTIALS", `Missing required environment configuration: ${missing.join(", ")}. Values are never guessed.`, false);
  const dbRequired = config.envNames.some((name) => /^(DATABASE_URL|DB_HOST|DB_NAME|MYSQL_URL|POSTGRES_URL)$/.test(name));
  if (dbRequired) {
    const instances = await db.databaseInstance.count({ where: { websiteId: website.id, deletedAt: null } });
    if (instances === 0) throw new WorkerError("WAITING_EXTERNAL", "Repository requires a database, but no provisioned database instance is attached. Database provisioning adapter is not configured.", false);
  }
  // Remote agent deployment is not wired into the local release engine yet.
  if (node.agentId) throw new WorkerError("NOT_IMPLEMENTED", "A verified node is selected, but remote release execution is not implemented for this engine. No deployment was reported as successful.", false);
  const existing = await db.deployment.findFirst({ where: { projectId: project.id, commitHash: input.commitSha, status: { in: ["PENDING", "RUNNING", "SUCCESS"] } }, orderBy: { createdAt: "desc" } });
  if (existing) return ok({ deploymentId: existing.id, projectId: project.id, websiteId: website.id, port: config.port, publicIp: node.publicIp, agentId: node.agentId, reused: true }, `Reusing deployment ${existing.id} (${existing.status})`, { evidence: `deploymentId=${existing.id}` });
  const deployment = await db.deployment.create({ data: { websiteId: website.id, projectId: project.id, status: "PENDING", stage: "queued", source: "git", trigger: "manual", commitHash: input.commitSha, branch: project.productionBranch, configSnapshot: JSON.stringify(config), actorId: ctx.actor?.id } });
  await db.deploymentLog.create({ data: { deploymentId: deployment.id, level: "INFO", message: `queued by central automation job ${ctx.jobId}` } });
  await db.gitProject.update({ where: { id: project.id }, data: { config: JSON.stringify(config), lastCommitSha: input.commitSha, lastDeployStatus: "QUEUED" } });
  return ok({ deploymentId: deployment.id, projectId: project.id, websiteId: website.id, port: config.port, publicIp: node.publicIp, agentId: node.agentId }, `Deployment ${deployment.id} queued for verified release engine`, { evidence: `deploymentId=${deployment.id}; commit=${input.commitSha}` });
}

async function checkProject(projectId: string) {
  const { project, website } = await projectWithWebsite(projectId);
  const latest = await db.deployment.findFirst({ where: { projectId, status: "SUCCESS", verifiedCommitSha: { not: null } }, orderBy: { createdAt: "desc" } });
  if (!latest?.verifiedCommitSha) return { healthy: false, reason: "no verified release", projectId };
  const baseUrl = project.healthUrl || `http://127.0.0.1:${project.port ?? 3100}`;
  const result = await verifyDeployment({ baseUrl, healthPath: project.healthPath || "/", expectedSha: latest.verifiedCommitSha, expectedDeploymentId: latest.id, attempts: 2, delayMs: 200 });
  await db.website.update({ where: { id: website.id }, data: { healthStatus: result.ok ? "HEALTHY" : "DOWN" } });
  await db.healthCheck.upsert({ where: { websiteId: website.id }, create: { websiteId: website.id, publicHttp: result.ok, localHttp: result.ok, overallStatus: result.ok ? "HEALTHY" : "DOWN", checkedAt: new Date() }, update: { publicHttp: result.ok, localHttp: result.ok, overallStatus: result.ok ? "HEALTHY" : "DOWN", checkedAt: new Date() } });
  return { healthy: result.ok, reason: result.reason, projectId, httpStatus: result.httpStatus, commitSha: result.marker?.commitSha ?? null };
}

export const platformWorker: WorkerDefinition<PlatformInput, unknown> = defineWorker<PlatformInput, unknown>({
  kind: "PLATFORM_OPS",
  label: "Platform lifecycle operations",
  description: "Central handlers for deployment preparation, health sweeps, evidence collection, bounded self-healing, node health, TLS renewal, backups and usage metering. External operations require enrolled agents or explicit credentials.",
  execution: "LOCAL",
  maxRisk: "PRIVILEGED",
  requiredScopes: ["automation:run"],
  retrySafe: (input) => IDEMPOTENT_ACTIONS.has(input.action),
  riskForInput: (input) => READ_ACTIONS.has(input.action) ? "READ_ONLY" : input.action === "configure-proxy" || input.action === "ssl-renewal-sweep" ? "PRIVILEGED" : "REVERSIBLE",
  scopesForInput: (input) => input.action === "usage-sweep" ? ["automation:run", "billing:read", "billing:write"] : input.action === "backup-sweep" || input.action === "backup-site" ? ["automation:run", "backup:read", "backup:write"] : ["automation:run"],
  defaultMaxAttempts: 2,
  defaultTimeoutMs: 10 * 60_000,
  inputSchema: platformInput,
  async handler(input, ctx) {
    await ctx.progress(10, input.action);
    if (input.action === "prepare-deployment") return prepareDeployment(input, ctx);
    if (input.action === "enable-protection") {
      if (!input.projectId) throw new WorkerError("VALIDATION_FAILED", "projectId required", false);
      const { website } = await projectWithWebsite(input.projectId);
      await db.website.update({ where: { id: website.id }, data: { healthPath: website.healthPath || "/" } });
      return ok({ projectId: input.projectId, monitoring: true, backupSchedule: "backup-schedule workflow (daily)", notification: "in-app on workflow completion" }, "Monitoring and backup schedules are enabled by the central workflows; no customer data is deleted", { evidence: "builtin workflows application-health and backup-schedule" });
    }
    if (input.action === "monitor-fleet") {
      const websites = await db.website.findMany({ where: { deletedAt: null }, select: { id: true }, take: 200 });
      const projects = await db.gitProject.findMany({ where: { websiteId: { in: websites.map((w) => w.id) } }, select: { id: true } });
      const results = [];
      for (const p of projects) {
        ctx.signal.throwIfAborted();
        const result = await checkProject(p.id); results.push(result);
        if (!result.healthy) {
          const { triggerEvent, SYSTEM_ACTOR } = await import("./workflows");
          await triggerEvent("application.health.failed", { projectId: p.id, reason: result.reason }, SYSTEM_ACTOR, `health:${p.id}:${Math.floor(Date.now() / 300_000)}`);
        }
      }
      return ok({ checked: results.length, healthy: results.filter((r) => r.healthy).length, results }, `Probed ${results.length} project(s) with release-marker verification`, { evidence: `healthy=${results.filter((r) => r.healthy).length}` });
    }
    if (input.action === "collect-evidence") {
      if (!input.projectId) throw new WorkerError("VALIDATION_FAILED", "projectId required", false);
      const { project, website } = await projectWithWebsite(input.projectId);
      const deployments = await db.deployment.findMany({ where: { projectId: project.id }, orderBy: { createdAt: "desc" }, take: 5, include: { logs: { orderBy: { timestamp: "desc" }, take: 20 } } });
      const health = await db.healthCheck.findUnique({ where: { websiteId: website.id } });
      return ok({ projectId: project.id, health, deployments: deployments.map((d) => ({ id: d.id, status: d.status, failureStage: d.failureStage, logs: d.logs.map((l) => redact(l.message).slice(0, 500)) })) }, "Collected persisted deployment logs and health evidence", { evidence: `deployments=${deployments.length}` });
    }
    if (input.action === "diagnose") {
      if (!input.projectId) throw new WorkerError("VALIDATION_FAILED", "projectId required", false);
      const { project } = await projectWithWebsite(input.projectId);
      const evidence = input.evidence ?? {};
      const deployments = (evidence.deployments ?? []) as Array<{ status?: string; failureStage?: string }>;
      const failed = deployments.find((d) => d.status === "FAILED" || d.status === "ROLLED_BACK");
      const previous = await db.deployment.findFirst({ where: { projectId: project.id, status: "SUCCESS", verifiedCommitSha: { not: null } }, orderBy: { createdAt: "desc" } });
      if (failed && previous) return ok({ action: "rollback", projectId: project.id, rootCause: `Latest deployment failed at ${failed.failureStage ?? "unknown stage"}`, permittedAction: "restore previous verified release" }, "Deterministic diagnosis selected verified rollback", { evidence: `previousDeployment=${previous.id}` });
      if (project.serviceManager === "static" && project.port) return ok({ action: "restart-static", projectId: project.id, rootCause: "Static release health probe failed", permittedAction: "restart platform-owned static listener" }, "Deterministic diagnosis selected bounded static restart", { evidence: `port=${project.port}` });
      if (project.serviceName && project.serviceManager !== "static") return ok({ action: "restart", projectId: project.id, unit: project.serviceName, agentId: process.env.AUTOMATION_DEFAULT_AGENT_ID ?? null, rootCause: "Application health probe failed", permittedAction: "service.restart through allowlisted agent (approval required)" }, "Deterministic diagnosis selected allowlisted service restart", { evidence: `unit=${project.serviceName}` });
      return ok({ action: "escalate", projectId: project.id, rootCause: "No safe automated recovery is available", evidence }, "Escalating with collected evidence; no destructive action was taken", { evidence: "no permitted recovery handler" });
    }
    if (input.action === "restart-static") {
      if (!input.projectId) throw new WorkerError("VALIDATION_FAILED", "projectId required", false);
      const { project } = await projectWithWebsite(input.projectId);
      if (project.serviceManager !== "static" || !project.port) throw new WorkerError("VALIDATION_FAILED", "Only platform-owned static listeners can be restarted by this handler", false);
      const active = await currentReleaseDir(project.id);
      if (!active) throw new WorkerError("NO_ACTIVE_RELEASE", "No active release to restart", false);
      await startStaticServer(project.port, projectRoot(project.id));
      const latest = await db.deployment.findFirst({ where: { projectId: project.id, status: "SUCCESS", verifiedCommitSha: { not: null } }, orderBy: { createdAt: "desc" } });
      if (!latest?.verifiedCommitSha) throw new WorkerError("VERIFICATION_REQUIRED", "Restarted listener but no verified release identity exists", false);
      const verified = await verifyDeployment({ baseUrl: project.healthUrl || `http://127.0.0.1:${project.port}`, healthPath: project.healthPath || "/", expectedSha: latest.verifiedCommitSha, expectedDeploymentId: latest.id, attempts: 5 });
      if (!verified.ok) return fail("RECOVERY_VERIFICATION_FAILED", verified.reason, { data: { projectId: project.id } });
      return ok({ projectId: project.id, port: project.port, commitSha: verified.marker?.commitSha }, "Static listener restarted and live release verified", { evidence: `http=${verified.httpStatus}` });
    }
    if (input.action === "node-health") {
      const agents = await db.serverAgent.findMany({ where: { status: "active" } });
      const stale = agents.filter((a) => !agentOnline(a));
      for (const agent of stale) if (agent.serverId) await db.server.update({ where: { id: agent.serverId }, data: { status: "OFFLINE" } }).catch(() => {});
      const { triggerEvent, SYSTEM_ACTOR } = await import("./workflows");
      for (const agent of stale) await triggerEvent("node.health.failed", { agentId: agent.id, serverId: agent.serverId }, SYSTEM_ACTOR, `node:${agent.id}:${Math.floor(Date.now() / 300_000)}`);
      return ok({ active: agents.length, online: agents.length - stale.length, stale: stale.map((a) => a.id) }, `Checked ${agents.length} enrolled agent(s); ${stale.length} stale`, { evidence: `stale=${stale.length}` });
    }
    if (input.action === "configure-proxy") {
      if (!input.domain || !input.port || !input.agentId) throw new WorkerError("VALIDATION_FAILED", "domain, port and agentId are required", false);
      const proxy = await runAgent(ctx, input.agentId, "domain.add", { domain: input.domain, type: "node", port: input.port }, 60_000);
      const probe = await runAgent(ctx, input.agentId, "health.probe", { url: `http://127.0.0.1:${input.port}/` }, 30_000);
      const httpStatus = Number((probe.data as { httpStatus?: number }).httpStatus ?? 0);
      if (httpStatus < 200 || httpStatus >= 400) return fail("PROXY_VERIFICATION_FAILED", `Caddy fragment created but local probe returned HTTP ${httpStatus}`, { data: { taskId: proxy.taskId } });
      return ok({ domain: input.domain, port: input.port, taskId: proxy.taskId, httpStatus }, "Reverse-proxy fragment created, Caddy reloaded, and local upstream probe verified", { evidence: `agentTaskId=${proxy.taskId}; http=${httpStatus}` });
    }
    if (input.action === "ssl-renewal-sweep") {
      const expiring = await db.domain.findMany({ where: { sslEnabled: true, certificateExpiry: { lte: new Date(Date.now() + 30 * 86400_000) } }, include: { website: true }, take: 50 });
      const results = [];
      for (const domain of expiring) {
        const agentId = process.env.AUTOMATION_DEFAULT_AGENT_ID;
        if (!agentId) { results.push({ domain: domain.domain, status: "WAITING_EXTERNAL" }); continue; }
        try {
          const r = await runAgent(ctx, agentId, "ssl.renew", { domain: domain.domain });
          const info = await runAgent(ctx, agentId, "ssl.info", { domain: domain.domain });
          const data = info.data as { notAfter?: string; issuer?: string };
          const notAfter = data.notAfter ? new Date(data.notAfter) : null;
          if (!notAfter || Number.isNaN(notAfter.getTime()) || notAfter.getTime() <= Date.now()) throw new WorkerError("VERIFICATION_REQUIRED", "Renewal task succeeded but installed certificate is not valid", false);
          await db.sslCertificate.upsert({ where: { domainId: domain.id }, create: { domainId: domain.id, issuer: data.issuer ?? "unknown", notAfter }, update: { issuer: data.issuer ?? "unknown", notAfter } });
          await db.domain.update({ where: { id: domain.id }, data: { sslStatus: "ISSUED", certificateExpiry: notAfter } });
          results.push({ domain: domain.domain, status: "RENEWED", taskId: r.taskId, notAfter });
        } catch (error) { results.push({ domain: domain.domain, status: "FAILED", error: redact(error instanceof Error ? error.message : String(error)) }); }
      }
      if (results.some((r) => r.status === "FAILED")) return fail("SSL_RENEWAL_FAILED", "One or more certificates failed renewal verification", { data: { results } });
      if (results.some((r) => r.status === "WAITING_EXTERNAL")) return fail("WAITING_EXTERNAL", "Expiring certificates exist but no enrolled ACME agent is configured", { data: { results } });
      return ok({ checked: expiring.length, results }, `Processed ${expiring.length} expiring certificate(s)`, { evidence: `renewed=${results.filter((r) => r.status === "RENEWED").length}` });
    }
    if (input.action === "backup-site" || input.action === "backup-sweep") {
      const websites = input.action === "backup-site" && input.projectId ? [(await projectWithWebsite(input.projectId)).website] : await db.website.findMany({ where: { deletedAt: null, currentReleasePath: { not: null } }, take: 50 });
      const results = [];
      for (const website of websites) {
        const agentId = input.agentId ?? process.env.AUTOMATION_DEFAULT_AGENT_ID;
        if (!agentId) { results.push({ websiteId: website.id, status: "WAITING_EXTERNAL", reason: "no enrolled backup agent" }); continue; }
        try {
          const created = await runAgent(ctx, agentId, "backup.database", { domain: website.domain }, 20 * 60_000);
          const data = created.data as { path?: string; sha256?: string; size?: number };
          if (!data.path || !data.sha256) throw new WorkerError("VERIFICATION_REQUIRED", "Backup helper did not return artifact path and checksum", false);
          const verified = await runAgent(ctx, agentId, "backup.verify", { path: data.path }, 10 * 60_000);
          const stdout = String((verified.data as { stdoutHead?: string }).stdoutHead ?? "");
          if (!stdout.includes(data.sha256)) throw new WorkerError("VERIFICATION_REQUIRED", "Backup checksum verification did not match", false);
          const backup = await db.backup.create({ data: { websiteId: website.id, filename: data.path.split("/").pop() ?? "backup.tar.gz", filepath: data.path, fileSize: BigInt(data.size ?? 0), checksum: data.sha256, status: "COMPLETED", backupType: "SCHEDULED", metadata: JSON.stringify({ agentId, taskId: created.taskId, verified: true }) } });
          results.push({ websiteId: website.id, status: "VERIFIED", backupId: backup.id });
        } catch (error) { results.push({ websiteId: website.id, status: "FAILED", error: redact(error instanceof Error ? error.message : String(error)) }); }
      }
      const failed = results.filter((r) => r.status === "FAILED");
      if (failed.length) return fail("BACKUP_FAILED", `${failed.length} backup(s) failed verification`, { data: { results } });
      if (results.length > 0 && results.every((r) => r.status === "WAITING_EXTERNAL")) return fail("WAITING_EXTERNAL", "No enrolled backup agent is configured; no backup was created", { data: { results } });
      return ok({ results }, `Created and checksum-verified ${results.filter((r) => r.status === "VERIFIED").length} backup(s); ${results.filter((r) => r.status === "WAITING_EXTERNAL").length} waiting for agent`, { evidence: `verified=${results.filter((r) => r.status === "VERIFIED").length}` });
    }
    if (input.action === "usage-sweep") {
      // Meter only measured deployment compute time; never invent bandwidth or storage.
      const now = new Date(); const start = new Date(now.getFullYear(), now.getMonth(), 1); const end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
      const deployments = await db.deployment.findMany({ where: { status: "SUCCESS", durationMs: { not: null }, finishedAt: { gte: start, lte: end }, website: { ownerId: { not: null } } }, include: { website: true }, take: 1000 });
      let created = 0;
      for (const d of deployments) {
        if (!d.website?.ownerId) continue;
        const id = `usage-deploy-${d.id}`;
        const exists = await db.usageRecord.findUnique({ where: { id } });
        if (exists) continue;
        const hours = (d.durationMs ?? 0) / 3_600_000;
        await db.usageRecord.create({ data: { id, userId: d.website.ownerId, websiteId: d.websiteId, resource: "cpu_hours", quantity: hours, unitPrice: 0, totalCost: 0, periodStart: start, periodEnd: end } });
        created++;
      }
      return ok({ measuredDeployments: deployments.length, created }, `Metered ${deployments.length} successful deployment(s) from recorded duration; unit price requires a billing plan`, { evidence: `created=${created}` });
    }
    throw new WorkerError("VALIDATION_FAILED", `Unsupported action ${input.action}`, false);
  },
});

const workflowStepInput = z.object({ action: z.literal("verify-profile"), versionId: z.string().min(1) });
export const workflowStepWorker = defineWorker<z.infer<typeof workflowStepInput>, unknown>({
  kind: "WORKFLOW_STEP", label: "Profile verification", description: "Validates an immutable profile version and its credential references. This verifies configuration shape and reference availability, not remote infrastructure health.", execution: "LOCAL", maxRisk: "READ_ONLY", requiredScopes: ["automation:run"], retrySafe: true, defaultMaxAttempts: 2, inputSchema: workflowStepInput,
  async handler(input) {
    const version = await db.automationProfileVersion.findUnique({ where: { id: input.versionId }, include: { profile: true } });
    if (!version) throw new WorkerError("NOT_FOUND", "Profile version not found", false);
    const config = validateProfileConfig(version.profile.kind, parse(version.config, {}));
    const refs = [...JSON.stringify(config).matchAll(/"envName":"([A-Z0-9_]+)"/g)].map((m) => m[1]!);
    const missing = refs.filter((name) => !process.env[name]);
    if (missing.length) throw new WorkerError("WAITING_CREDENTIALS", `Credential references are not available in the worker environment: ${missing.join(", ")}`, false);
    const secretIds = [...JSON.stringify(config).matchAll(/"secretId":"([^"]+)"/g)].map((m) => m[1]!);
    for (const id of secretIds) {
      const secret = await db.cloudSecret.findUnique({ where: { id }, select: { id: true } });
      if (!secret) throw new WorkerError("WAITING_CREDENTIALS", `Credential reference ${id} does not exist`, false);
    }
    return ok({ versionId: version.id, kind: version.profile.kind, checksum: version.checksum, verificationScope: "configuration-and-references" }, "Profile schema and credential references validated; remote operation still requires its own handler verification", { evidence: `checksum=${version.checksum}` });
  },
});

const aiDiagnosisInput = z.object({ projectId: z.string().min(1), evidence: z.record(z.string(), z.unknown()).default({}) });
export const aiDiagnosisWorker = defineWorker<z.infer<typeof aiDiagnosisInput>, unknown>({
  kind: "AI_DIAGNOSIS", label: "AI evidence diagnosis", description: "Asks the configured AI provider for a bounded diagnosis. Output is advisory only and validated against a fixed action vocabulary; it can never execute or approve infrastructure work.", execution: "EXTERNAL", maxRisk: "READ_ONLY", requiredScopes: ["ai:read", "automation:run"], retrySafe: true, defaultMaxAttempts: 2, inputSchema: aiDiagnosisInput,
  async handler(input, ctx) {
    const { completeJSON } = await import("@/lib/ai/client");
    const { data: plan } = await completeJSON<{ rootCause?: string; action?: string; evidence?: string[] }>([
      { role: "system", content: "You are an SRE advisor. Return JSON only: rootCause, action (one of restart, rollback, restart-static, escalate), evidence array. Never propose shell commands, credential access, data deletion, or database restores." },
      { role: "user", content: JSON.stringify(input.evidence).slice(0, 12000) },
    ], { temperature: 0, maxTokens: 600, signal: ctx.signal, requestId: ctx.correlationId });
    const action = ["restart", "rollback", "restart-static", "escalate"].includes(plan.action ?? "") ? plan.action : "escalate";
    return ok({ projectId: input.projectId, rootCause: String(plan.rootCause ?? "unknown").slice(0, 1000), action, evidence: Array.isArray(plan.evidence) ? plan.evidence.slice(0, 10).map(String) : [], advisory: true }, "AI diagnosis validated against the allowlisted action vocabulary; no action was executed", { evidence: `advisoryAction=${action}` });
  },
});
