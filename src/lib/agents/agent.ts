/**
 * Secure server-agent registration, authentication and task dispatch.
 *
 * Threat model this file defends:
 *   - An attacker who can reach the API must not be able to impersonate an
 *     agent → every agent request carries an HMAC over a canonical body, signed
 *     with a per-agent secret, compared in constant time.
 *   - An attacker who steals one agent secret must not get a shell → the secret
 *     only authorises allowlisted commands, and privileged ones need a human
 *     approval recorded in the database.
 *   - A leaked enrollment token must not be replayable → tokens are single-use,
 *     short-lived and stored as a sha256 hash; the plaintext is shown exactly
 *     once, at creation time.
 *   - Nothing secret may reach a log or a process argument → secrets live in
 *     request bodies and in the encrypted `secretEnc` column, never in argv.
 */
import { createHmac, createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { encryptSecret, decryptSecret } from "@/lib/encryption";
import { redact } from "@/lib/deploy/redact";
import { createAuditLog } from "@/lib/audit";
import { AGENT_ONLINE_WINDOW_MS } from "@/lib/orchestrator/orchestrator";
import { authorizeCommand, DEFAULT_AGENT_CAPABILITIES, findAllowlistEntry } from "./allowlist";

/** How long an enrollment token stays valid. Deliberately short. */
export const ENROLLMENT_TTL_MS = 15 * 60_000;

/** How long a dispatched task waits for an agent to claim it. */
export const TASK_CLAIM_TTL_MS = 5 * 60_000;

export const AGENT_SCOPES = [
  "server:read",
  "server:execute",
  "monitoring:read",
  "database:read",
  "domain:read",
  "domain:write",
  "release:write",
  "backup:read",
  "backup:write",
  "backup:restore",
  "recovery:execute",
] as const;
export type AgentScope = (typeof AGENT_SCOPES)[number];

// ─── Identity & signing ─────────────────────────────────────────────────────

export function generateAgentKey(): string {
  return `alo_agt_${randomBytes(12).toString("base64url")}`;
}

export function generateAgentSecret(): string {
  return `alo_ags_${randomBytes(32).toString("base64url")}`;
}

export function generateEnrollmentToken(): { token: string; hash: string; prefix: string } {
  const token = `alo_enroll_${randomBytes(24).toString("base64url")}`;
  return { token, hash: hashToken(token), prefix: token.slice(0, 16) };
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Canonical string that both sides sign. Field order is fixed and values are
 * length-prefixed so no concatenation ambiguity is possible.
 */
export function canonicalString(parts: Record<string, string | number | undefined | null>): string {
  return Object.keys(parts)
    .sort()
    .map((k) => `${k}=${parts[k] === undefined || parts[k] === null ? "" : String(parts[k])}`)
    .join("&");
}

export function signPayload(secret: string, body: string, timestamp: string, nonce: string): string {
  return createHmac("sha256", secret)
    .update(`${timestamp}.${nonce}.${createHash("sha256").update(body).digest("hex")}`)
    .digest("hex");
}

/** Signature validity window. Exported so the nonce TTL matches it exactly. */
export const SIGNATURE_MAX_SKEW_MS = 5 * 60_000;

/** How long a recorded human approval of an agent task stays valid. */
export const AGENT_APPROVAL_TTL_MS = 60 * 60_000;

/**
 * Consume a request nonce: single use, per agent.
 *
 * The unique index on (agentId, nonce) is the guard, not a read-then-write, so
 * two concurrent replays of the same captured request race on the insert and
 * exactly one wins. Rows are kept only as long as the signature window they
 * belong to (`SIGNATURE_MAX_SKEW_MS`); after that the timestamp check rejects
 * the request anyway, so pruning keeps the table bounded.
 */
export async function consumeRequestNonce(agentId: string, nonce: string, now = Date.now()): Promise<boolean> {
  try {
    await db.agentNonce.create({
      data: { agentId, nonce: nonce.slice(0, 128), expiresAt: new Date(now + SIGNATURE_MAX_SKEW_MS) },
    });
  } catch {
    // P2002: this (agent, nonce) pair was already consumed — a replay.
    return false;
  }
  await db.agentNonce.deleteMany({ where: { expiresAt: { lt: new Date(now) } } }).catch(() => ({ count: 0 }));
  return true;
}

export function verifySignature(opts: {
  secret: string;
  body: string;
  timestamp: string;
  nonce: string;
  signature: string;
  /** Reject timestamps further than this from now (replay window). */
  maxSkewMs?: number;
  now?: () => number;
}): { valid: boolean; reason?: string } {
  const now = (opts.now ?? Date.now)();
  const maxSkew = opts.maxSkewMs ?? 5 * 60_000;
  const ts = Number(opts.timestamp);
  if (!Number.isFinite(ts)) return { valid: false, reason: "timestamp is not a number" };
  if (Math.abs(now - ts) > maxSkew) {
    return { valid: false, reason: `timestamp outside the ±${Math.round(maxSkew / 1000)}s replay window` };
  }
  if (!opts.nonce || opts.nonce.length < 8) return { valid: false, reason: "nonce is missing or too short" };
  const expected = signPayload(opts.secret, opts.body, opts.timestamp, opts.nonce);
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(opts.signature ?? "", "utf8");
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { valid: false, reason: "signature mismatch" };
  return { valid: true };
}

// ─── Enrollment ─────────────────────────────────────────────────────────────

export interface CreateEnrollmentInput {
  agentName: string;
  serverId?: string | null;
  scopes?: AgentScope[];
  capabilities?: string[];
  actor?: { id: string; email: string; role: string };
}

/**
 * Issue a single-use enrollment token. The plaintext is returned once and never
 * stored; only its hash is persisted.
 */
export async function createEnrollmentToken(input: CreateEnrollmentInput) {
  const scopes = (input.scopes ?? ["server:read", "monitoring:read"]).filter((s) => (AGENT_SCOPES as readonly string[]).includes(s));
  const capabilities = (input.capabilities ?? DEFAULT_AGENT_CAPABILITIES).filter((c) => findAllowlistEntry(c));
  const { token, hash, prefix } = generateEnrollmentToken();

  const row = await db.agentEnrollmentToken.create({
    data: {
      tokenHash: hash,
      prefix,
      agentName: input.agentName.slice(0, 120),
      serverId: input.serverId ?? null,
      scopes: JSON.stringify(scopes),
      capabilities: JSON.stringify(capabilities),
      expiresAt: new Date(Date.now() + ENROLLMENT_TTL_MS),
      createdById: input.actor?.id ?? null,
    },
  });

  await createAuditLog({
    actorId: input.actor?.id,
    actorEmail: input.actor?.email,
    actorRole: input.actor?.role,
    action: "AGENT_ENROLLMENT_TOKEN_CREATED",
    resourceType: "AgentEnrollmentToken",
    resourceId: row.id,
    result: "SUCCESS",
    metadata: { agentName: row.agentName, prefix, scopes, capabilities, expiresInMs: ENROLLMENT_TTL_MS },
  });

  return { tokenId: row.id, token, prefix, agentName: row.agentName, scopes, capabilities, expiresAt: row.expiresAt };
}

export interface EnrollResult {
  ok: true;
  agentId: string;
  agentKey: string;
  /** Returned once, in this response only. Stored encrypted. */
  secret: string;
  capabilities: string[];
  scopes: string[];
  heartbeatIntervalMs: number;
  pollIntervalMs: number;
}

/** Exchange an enrollment token for agent credentials. Single use. */
export async function enrollAgent(opts: {
  token: string;
  version?: string;
  ip?: string;
}): Promise<EnrollResult | { ok: false; reason: string }> {
  const hash = hashToken(opts.token);
  const row = await db.agentEnrollmentToken.findUnique({ where: { tokenHash: hash } });
  if (!row) return { ok: false, reason: "Unknown enrollment token" };
  if (row.usedAt) return { ok: false, reason: "This enrollment token has already been used" };
  if (row.expiresAt.getTime() < Date.now()) return { ok: false, reason: "This enrollment token has expired" };

  // Claim the token atomically so two concurrent enrollments cannot both win.
  const claim = await db.agentEnrollmentToken.updateMany({
    where: { id: row.id, usedAt: null },
    data: { usedAt: new Date(), usedByIp: opts.ip ? opts.ip.slice(0, 64) : null },
  });
  if (claim.count !== 1) return { ok: false, reason: "This enrollment token has already been used" };

  const agentKey = generateAgentKey();
  const secret = generateAgentSecret();
  const capabilities = parseArray(row.capabilities).length ? parseArray(row.capabilities) : DEFAULT_AGENT_CAPABILITIES;
  const scopes = parseArray(row.scopes).length ? parseArray(row.scopes) : ["server:read"];

  const agent = await db.serverAgent.create({
    data: {
      serverId: row.serverId,
      name: row.agentName,
      agentKey,
      secretEnc: encryptSecret(secret),
      status: "active",
      version: opts.version?.slice(0, 40) ?? null,
      capabilities: JSON.stringify(capabilities),
      scopes: JSON.stringify(scopes),
      enrolledAt: new Date(),
      lastSeenIp: opts.ip ? opts.ip.slice(0, 64) : null,
    },
  });

  await createAuditLog({
    action: "AGENT_ENROLLED",
    resourceType: "ServerAgent",
    resourceId: agent.id,
    result: "SUCCESS",
    ipAddress: opts.ip,
    metadata: { agentName: agent.name, agentKey, capabilities, scopes },
  });
  logger.info({ agentId: agent.id, agentKey }, "server agent enrolled");

  return {
    ok: true,
    agentId: agent.id,
    agentKey,
    secret,
    capabilities,
    scopes,
    heartbeatIntervalMs: 60_000,
    pollIntervalMs: 5_000,
  };
}

/** Rotate an agent's signing secret. The old secret stops working immediately. */
export async function rotateAgentSecret(agentId: string, actor?: { id: string; email: string; role: string }) {
  const agent = await db.serverAgent.findUnique({ where: { id: agentId } });
  if (!agent) return { ok: false as const, reason: "Agent not found" };
  const secret = generateAgentSecret();
  await db.serverAgent.update({ where: { id: agentId }, data: { secretEnc: encryptSecret(secret) } });
  await createAuditLog({
    actorId: actor?.id,
    actorEmail: actor?.email,
    actorRole: actor?.role,
    action: "AGENT_SECRET_ROTATED",
    resourceType: "ServerAgent",
    resourceId: agentId,
    result: "SUCCESS",
  });
  return { ok: true as const, secret };
}

export async function revokeAgent(agentId: string, actor?: { id: string; email: string; role: string }) {
  const updated = await db.serverAgent.updateMany({
    where: { id: agentId, status: { not: "revoked" } },
    data: { status: "revoked", revokedAt: new Date() },
  });
  if (updated.count !== 1) return { ok: false as const, reason: "Agent not found or already revoked" };
  await createAuditLog({
    actorId: actor?.id,
    actorEmail: actor?.email,
    actorRole: actor?.role,
    action: "AGENT_REVOKED",
    resourceType: "ServerAgent",
    resourceId: agentId,
    result: "SUCCESS",
  });
  return { ok: true as const };
}

/** Look up an agent and verify a request signature in one step. */
export async function authenticateAgentRequest(opts: {
  agentKey: string;
  signature: string;
  timestamp: string;
  nonce: string;
  body: string;
  ip?: string;
}) {
  const agent = await db.serverAgent.findUnique({ where: { agentKey: opts.agentKey } });
  if (!agent) return { ok: false as const, reason: "Unknown agent key", agent: null };
  if (agent.status !== "active") return { ok: false as const, reason: `Agent is ${agent.status}, not active`, agent };

  let secret: string;
  try {
    secret = decryptSecret(agent.secretEnc);
  } catch {
    return { ok: false as const, reason: "Agent secret could not be decrypted on the server; rotate it", agent };
  }

  const check = verifySignature({ secret, body: opts.body, timestamp: opts.timestamp, nonce: opts.nonce, signature: opts.signature });
  if (!check.valid) {
    await createAuditLog({
      action: "AGENT_AUTH_FAILURE",
      resourceType: "ServerAgent",
      resourceId: agent.id,
      result: "FAILURE",
      ipAddress: opts.ip,
      errorCode: "SIGNATURE_INVALID",
      metadata: { reason: check.reason },
    });
    logger.warn({ agentId: agent.id, reason: check.reason }, "agent signature rejected");
    return { ok: false as const, reason: check.reason ?? "Invalid signature", agent };
  }

  // The signature is valid, so this really came from someone holding the secret.
  // That is exactly why the nonce must be single use: without this check a
  // captured request stays valid for the rest of the timestamp window, which on
  // /api/agents/tasks/result would allow a forged "task succeeded".
  if (!(await consumeRequestNonce(agent.id, opts.nonce))) {
    await createAuditLog({
      action: "AGENT_AUTH_FAILURE",
      resourceType: "ServerAgent",
      resourceId: agent.id,
      result: "FAILURE",
      ipAddress: opts.ip,
      errorCode: "NONCE_REPLAY",
      metadata: { reason: "nonce already used within the signature window" },
    });
    logger.warn({ agentId: agent.id }, "agent request replayed: nonce already consumed");
    return { ok: false as const, reason: "This request was already received (nonce replay)", agent };
  }

  return { ok: true as const, agent, secret };
}

// ─── Heartbeat & metrics ────────────────────────────────────────────────────

export interface HeartbeatPayload {
  version?: string;
  capabilities?: string[];
  inventory?: {
    hostname?: string;
    platform?: string;
    arch?: string;
    kernel?: string;
    cpuCores?: number;
    cpuModel?: string;
    ramGb?: number;
    uptimeSeconds?: number;
  } | null;
  metrics?: {
    cpuPercent?: number | null;
    memoryUsedMb?: number | null;
    memoryTotalMb?: number | null;
    diskUsedGb?: number | null;
    diskTotalGb?: number | null;
    loadAvg1m?: number | null;
    uptimeSeconds?: number | null;
    netInKbps?: number | null;
    netOutKbps?: number | null;
    services?: Array<{ name: string; state: string }> | null;
  } | null;
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

export async function recordHeartbeat(agentId: string, payload: HeartbeatPayload, ip?: string) {
  const m = payload.metrics ?? {};
  const agent = await db.serverAgent.update({
    where: { id: agentId },
    data: {
      lastHeartbeat: new Date(),
      lastSeenIp: ip ? ip.slice(0, 64) : undefined,
      ...(payload.version ? { version: payload.version.slice(0, 40) } : {}),
      ...(payload.capabilities
        ? { capabilities: JSON.stringify(payload.capabilities.filter((c) => findAllowlistEntry(c)).slice(0, 50)) }
        : {}),
    },
  });

  await db.agentMetric.create({
    data: {
      agentId,
      cpuPercent: num(m.cpuPercent),
      memoryUsedMb: num(m.memoryUsedMb),
      memoryTotalMb: num(m.memoryTotalMb),
      diskUsedGb: num(m.diskUsedGb),
      diskTotalGb: num(m.diskTotalGb),
      loadAvg1m: num(m.loadAvg1m),
      uptimeSeconds: num(m.uptimeSeconds),
      netInKbps: num(m.netInKbps),
      netOutKbps: num(m.netOutKbps),
      services: m.services ? JSON.stringify(m.services.slice(0, 50)) : null,
    },
  });

  // Mirror the newest numbers onto the Server row so the existing servers UI and
  // APIs show real data without a second query path.
  if (agent.serverId) {
    const memPct = m.memoryTotalMb && m.memoryUsedMb ? (m.memoryUsedMb / m.memoryTotalMb) * 100 : null;
    const diskPct = m.diskTotalGb && m.diskUsedGb ? (m.diskUsedGb / m.diskTotalGb) * 100 : null;
    const inv = payload.inventory ?? null;
    const osLabel = inv ? [inv.platform, inv.arch, inv.kernel].filter(Boolean).join(" ") : "";
    await db.server
      .update({
        where: { id: agent.serverId },
        data: {
          status: "ONLINE",
          ...(num(m.cpuPercent) !== null ? { cpuUsage: num(m.cpuPercent)! } : {}),
          ...(memPct !== null ? { memoryUsage: memPct } : {}),
          ...(diskPct !== null ? { diskUsage: diskPct } : {}),
          ...(num(m.uptimeSeconds) !== null ? { uptime: Math.round(num(m.uptimeSeconds)!) } : {}),
          ...(num(m.diskTotalGb) !== null ? { diskGb: Math.round(num(m.diskTotalGb)!) } : {}),
          // Static inventory reported by the agent — only fields it actually sent.
          ...(osLabel ? { os: osLabel.slice(0, 120) } : {}),
          ...(inv && typeof inv.cpuCores === "number" ? { cpuCores: inv.cpuCores } : {}),
          ...(inv && typeof inv.ramGb === "number" ? { ramGb: inv.ramGb } : {}),
        },
      })
      .catch(() => {});
    await db.serverMetric
      .create({
        data: {
          serverId: agent.serverId,
          cpuPercent: num(m.cpuPercent) ?? 0,
          memoryUsedMb: num(m.memoryUsedMb) ?? 0,
          memoryTotalMb: num(m.memoryTotalMb) ?? 0,
          diskUsedGb: num(m.diskUsedGb) ?? 0,
          diskTotalGb: num(m.diskTotalGb) ?? 0,
          loadAvg1m: num(m.loadAvg1m) ?? 0,
          networkInKbps: num(m.netInKbps) ?? 0,
          networkOutKbps: num(m.netOutKbps) ?? 0,
        },
      })
      .catch(() => {});
  }
  return agent;
}

export function agentOnline(agent: { lastHeartbeat: Date | null; status: string }, now = Date.now()): boolean {
  if (agent.status !== "active") return false;
  if (!agent.lastHeartbeat) return false;
  return now - agent.lastHeartbeat.getTime() <= AGENT_ONLINE_WINDOW_MS;
}

// ─── Task dispatch ──────────────────────────────────────────────────────────

export interface DispatchInput {
  agentId: string;
  command: string;
  args?: Record<string, unknown>;
  jobId?: string;
  correlationId?: string;
  actorEmail?: string;
  actorScopes?: string[];
}

export interface DispatchedTask {
  id: string;
  status: string;
  refuseReason?: string | null;
  requiresApproval: boolean;
  /** Present when the task reached a terminal state synchronously. */
  exitCode?: number | null;
  result?: string | null;
  logs?: string | null;
  error?: string | null;
  command?: string;
}

/**
 * Validate and queue a task for an agent.
 *
 * The task is refused *at dispatch time* when the command is not allowlisted,
 * the agent has not been granted it, or the arguments do not validate — so an
 * unauthorized command is rejected before it ever reaches a host, and the
 * refusal is recorded for the audit trail.
 */
export async function dispatchTask(input: DispatchInput): Promise<DispatchedTask> {
  const agent = await db.serverAgent.findUnique({ where: { id: input.agentId } });
  if (!agent) {
    return await recordRefusal(input, "AGENT_NOT_FOUND", `No agent with id ${input.agentId}`);
  }
  if (agent.status !== "active") {
    return await recordRefusal(input, "AGENT_NOT_ACTIVE", `Agent ${agent.name} is ${agent.status}`);
  }

  const decision = authorizeCommand({
    command: input.command,
    args: input.args ?? {},
    agentCapabilities: parseArray(agent.capabilities),
    actorScopes: input.actorScopes ?? parseArray(agent.scopes),
  });
  if (!decision.allowed || !decision.entry) {
    return await recordRefusal(input, "REFUSED_BY_ALLOWLIST", decision.reason ?? "Not authorized");
  }

  const online = agentOnline(agent);
  const task = await db.agentTask.create({
    data: {
      agentId: agent.id,
      jobId: input.jobId ?? null,
      correlationId: input.correlationId ?? null,
      command: decision.entry.command,
      args: JSON.stringify(input.args ?? {}),
      // Queued but not yet picked up: the agent polls and claims it.
      status: online ? "PENDING" : "PENDING",
      timeoutMs: decision.entry.timeoutMs,
      requiresApproval: decision.entry.risk === "PRIVILEGED" || decision.entry.risk === "DESTRUCTIVE",
      approvedBy: decision.entry.risk === "PRIVILEGED" || decision.entry.risk === "DESTRUCTIVE" ? null : input.actorEmail ?? null,
    },
  });

  if (decision.entry.risk === "PRIVILEGED" || decision.entry.risk === "DESTRUCTIVE") {
    await createAuditLog({
      actorEmail: input.actorEmail,
      action: "AGENT_TASK_GATED",
      resourceType: "AgentTask",
      resourceId: task.id,
      result: "WAITING_APPROVAL",
      metadata: { command: decision.entry.command, risk: decision.entry.risk, agentName: agent.name },
    });
  }

  return {
    id: task.id,
    status: task.status,
    refuseReason: null,
    requiresApproval: task.requiresApproval,
    exitCode: task.exitCode,
    result: task.result,
    logs: task.logs,
    error: task.error,
    command: task.command,
  };
}

async function recordRefusal(input: DispatchInput, code: string, reason: string): Promise<DispatchedTask> {
  const agent = await db.serverAgent.findUnique({ where: { id: input.agentId } }).catch(() => null);
  const task = await db.agentTask
    .create({
      data: {
        agentId: input.agentId,
        jobId: input.jobId ?? null,
        correlationId: input.correlationId ?? null,
        command: input.command.slice(0, 64),
        args: JSON.stringify(input.args ?? {}).slice(0, 4000),
        status: "REFUSED",
        refuseReason: `${code}: ${redact(reason)}`.slice(0, 500),
        finishedAt: new Date(),
      },
    })
    .catch(() => null);

  await createAuditLog({
    actorEmail: input.actorEmail,
    action: "AGENT_TASK_REFUSED",
    resourceType: "AgentTask",
    resourceId: task?.id,
    result: "FAILURE",
    errorCode: code,
    metadata: { command: input.command, reason: redact(reason).slice(0, 300), agentName: agent?.name ?? null },
  });
  logger.warn({ agentId: input.agentId, command: input.command, code }, "agent task refused");

  return { id: task?.id ?? "", status: "REFUSED", refuseReason: `${code}: ${redact(reason)}`, requiresApproval: false };
}

/**
 * Approve a gated agent task.
 *
 * A PRIVILEGED or DESTRUCTIVE command is dispatched with `requiresApproval`
 * and no `approvedBy`, and `claimTask()` only hands out tasks that are either
 * ungated or already approved — so without this call the task can never reach
 * a host. Approval is written with a named human identity and audited, exactly
 * like an orchestrator job approval.
 */
export async function approveAgentTask(
  taskId: string,
  actor: { id: string; email: string; role: string },
  note?: string,
): Promise<{ ok: true; status: string } | { ok: false; reason: string }> {
  const task = await db.agentTask.findUnique({ where: { id: taskId } });
  if (!task) return { ok: false, reason: "Task not found" };
  if (task.status !== "PENDING") return { ok: false, reason: `Task is ${task.status}, not PENDING` };
  if (!task.requiresApproval) return { ok: false, reason: "Task does not require approval" };

  // Conditional write: two admins clicking approve produce one winner.
  const updated = await db.agentTask.updateMany({
    where: { id: taskId, status: "PENDING", requiresApproval: true, approvedBy: null },
    data: { approvedBy: actor.email, approvedAt: new Date() },
  });
  if (updated.count !== 1) return { ok: false, reason: "Task was approved or dispatched by someone else first" };

  await createAuditLog({
    actorId: actor.id,
    actorEmail: actor.email,
    actorRole: actor.role,
    action: "AGENT_TASK_APPROVED",
    resourceType: "AgentTask",
    resourceId: taskId,
    result: "SUCCESS",
    metadata: { command: task.command, agentId: task.agentId, note: note ? redact(note).slice(0, 300) : undefined },
  });
  return { ok: true, status: "PENDING" };
}

/** Refuse a gated task so it can never be claimed. Recorded, never executed. */
export async function rejectAgentTask(
  taskId: string,
  actor: { id: string; email: string; role: string },
  reason: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const updated = await db.agentTask.updateMany({
    where: { id: taskId, status: "PENDING" },
    data: {
      status: "REFUSED",
      finishedAt: new Date(),
      refuseReason: `APPROVAL_REJECTED: ${redact(reason).slice(0, 400)}`,
    },
  });
  if (updated.count !== 1) return { ok: false, reason: "Task not found or already finished" };
  await createAuditLog({
    actorId: actor.id,
    actorEmail: actor.email,
    actorRole: actor.role,
    action: "AGENT_TASK_REJECTED",
    resourceType: "AgentTask",
    resourceId: taskId,
    result: "SUCCESS",
    metadata: { reason: redact(reason).slice(0, 300) },
  });
  return { ok: true };
}

/**
 * Claim the oldest pending, approved task for an agent (atomic).
 *
 * A gated task is claimable only while its approval is fresh: an operator
 * approved a specific host state at a specific moment, and a task that has sat
 * unclaimed past `AGENT_APPROVAL_TTL_MS` must be re-approved rather than
 * executed on stale authority.
 */
export async function claimTask(agentId: string, now = Date.now()) {
  const cutoff = new Date(now - TASK_CLAIM_TTL_MS);
  const approvalFloor = new Date(now - AGENT_APPROVAL_TTL_MS);
  const candidates = await db.agentTask.findMany({
    where: {
      agentId,
      status: "PENDING",
      createdAt: { gte: cutoff },
      OR: [
        { requiresApproval: false },
        { requiresApproval: true, approvedBy: { not: null }, approvedAt: { gte: approvalFloor } },
      ],
    },
    orderBy: { createdAt: "asc" },
    take: 5,
  });
  for (const candidate of candidates) {
    const claimed = await db.agentTask.updateMany({
      where: { id: candidate.id, status: "PENDING" },
      data: { status: "ASSIGNED", dispatchedAt: new Date() },
    });
    if (claimed.count === 1) {
      return await db.agentTask.findUnique({ where: { id: candidate.id } });
    }
  }
  return null;
}

/** Mark tasks that were dispatched but never started as TIMED_OUT. */
export async function expireStaleTasks() {
  const now = Date.now();
  const cutoff = new Date(now - TASK_CLAIM_TTL_MS);
  const res = await db.agentTask.updateMany({
    where: { status: { in: ["PENDING", "ASSIGNED"] }, createdAt: { lt: cutoff } },
    data: { status: "TIMED_OUT", finishedAt: new Date(), error: "No agent claimed this task within the claim window" },
  });
  if (res.count > 0) logger.warn({ count: res.count }, "expired stale agent tasks");

  // An approval older than its window is revoked, so the task becomes
  // unclaimable again and shows up in the dashboard as waiting for a human.
  const staleApprovals = await db.agentTask.updateMany({
    where: {
      status: "PENDING",
      requiresApproval: true,
      approvedBy: { not: null },
      approvedAt: { lt: new Date(now - AGENT_APPROVAL_TTL_MS) },
    },
    data: { approvedBy: null, approvedAt: null },
  });
  if (staleApprovals.count > 0) {
    logger.warn({ count: staleApprovals.count }, "revoked expired agent task approvals");
    await createAuditLog({
      action: "AGENT_TASK_APPROVAL_EXPIRED",
      resourceType: "AgentTask",
      result: "WAITING_APPROVAL",
      metadata: { count: staleApprovals.count, ttlMs: AGENT_APPROVAL_TTL_MS },
    }).catch(() => {});
  }
  return res.count;
}

export async function recordTaskResult(
  taskId: string,
  result: { status: "SUCCEEDED" | "FAILED" | "REFUSED"; exitCode?: number | null; result?: unknown; logs?: string; error?: string; refuseReason?: string },
) {
  const task = await db.agentTask.update({
    where: { id: taskId },
    data: {
      status: result.status,
      startedAt: undefined,
      finishedAt: new Date(),
      exitCode: result.exitCode ?? null,
      result: result.result !== undefined ? JSON.stringify(result.result).slice(0, 100_000) : null,
      logs: result.logs ? redact(result.logs).slice(0, 50_000) : null,
      error: result.error ? redact(result.error).slice(0, 2000) : null,
      refuseReason: result.refuseReason ? redact(result.refuseReason).slice(0, 500) : undefined,
    },
  });
  if (task.command && (task.status === "SUCCEEDED" || task.status === "FAILED")) {
    const entry = findAllowlistEntry(task.command);
    if (entry && (entry.risk === "PRIVILEGED" || entry.risk === "DESTRUCTIVE")) {
      await createAuditLog({
        action: "AGENT_TASK_EXECUTED",
        resourceType: "AgentTask",
        resourceId: task.id,
        result: task.status,
        metadata: { command: task.command, risk: entry.risk, agentId: task.agentId, exitCode: task.exitCode },
      });
    }
  }
  return task;
}

export function parseArray(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const value = JSON.parse(raw);
    return Array.isArray(value) ? value.map(String) : [];
  } catch {
    return [];
  }
}

/** Everything the dashboard needs about one agent, with no secret material. */
export async function describeAgents(now = Date.now()) {
  const agents = await db.serverAgent.findMany({ orderBy: { createdAt: "desc" }, take: 100 });
  const withMetrics = await Promise.all(
    agents.map(async (agent) => {
      const metric = await db.agentMetric.findFirst({ where: { agentId: agent.id }, orderBy: { recordedAt: "desc" } });
      const recentTasks = await db.agentTask.findMany({
        where: { agentId: agent.id },
        orderBy: { createdAt: "desc" },
        take: 5,
        select: { id: true, command: true, status: true, createdAt: true, finishedAt: true, refuseReason: true, exitCode: true },
      });
      return {
        id: agent.id,
        name: agent.name,
        agentKey: agent.agentKey,
        serverId: agent.serverId,
        status: agent.status,
        version: agent.version,
        capabilities: parseArray(agent.capabilities),
        scopes: parseArray(agent.scopes),
        online: agentOnline(agent, now),
        lastHeartbeat: agent.lastHeartbeat,
        heartbeatAgeMs: agent.lastHeartbeat ? now - agent.lastHeartbeat.getTime() : null,
        lastSeenIp: agent.lastSeenIp,
        enrolledAt: agent.enrolledAt,
        revokedAt: agent.revokedAt,
        latestMetric: metric
          ? {
              cpuPercent: metric.cpuPercent,
              memoryUsedMb: metric.memoryUsedMb,
              memoryTotalMb: metric.memoryTotalMb,
              diskUsedGb: metric.diskUsedGb,
              diskTotalGb: metric.diskTotalGb,
              loadAvg1m: metric.loadAvg1m,
              uptimeSeconds: metric.uptimeSeconds,
              recordedAt: metric.recordedAt,
            }
          : null,
        recentTasks,
      };
    }),
  );
  return withMetrics;
}
