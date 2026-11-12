/**
 * Durable job orchestrator.
 *
 * Every privileged platform operation — build, release, backup, replication
 * audit, recovery action — is a persisted row in `operation_jobs`. Nothing here
 * lives only in process memory, so a panel restart cannot lose or double-run
 * work.
 *
 * Guarantees this file is responsible for:
 *   1. **Exactly-once enqueue** per idempotency key (webhook retries, double
 *      clicks and duplicate agent reports collapse into one job).
 *   2. **Atomic claim** — a job is moved QUEUED → RUNNING with a conditional
 *      `updateMany`, the same pattern the deployment engine already uses, so two
 *      workers cannot run the same job.
 *   3. **Leases** — a worker that dies mid-job leaves an expiring lease; the
 *      reaper requeues it instead of leaving it stuck forever.
 *   4. **Per-key serialization** — one job per lock key (normally a project) at
 *      a time, so two pushes cannot swap `current` simultaneously.
 *   5. **Retries with exponential backoff and jitter**, and a dead-letter state
 *      for jobs that keep failing.
 *   6. **Approval gates** — PRIVILEGED and DESTRUCTIVE work waits for a named
 *      human; the AI layer can recommend but never approve.
 *   7. **Redaction** — every persisted message passes through the existing
 *      deployment redactor before it reaches the database or a log.
 */
import { randomUUID, createHash } from "node:crypto";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { redact, collectSecrets } from "@/lib/deploy/redact";
import { createAuditLog } from "@/lib/audit";
import {
  ACTIVE_STATES,
  DEFAULT_RETRY_POLICY,
  TERMINAL_STATES,
  WorkerError,
  computeBackoffDelay,
  isRetryable,
  riskAtLeast,
  effectiveRisk,
  effectiveScopes,
  isHandlerRetrySafe,
  assertActorScopes,
  retryPolicySchema,
  type JobActor,
  type JobState,
  type RetryPolicy,
  type RiskLevel,
  type WorkerContext,
  type WorkerDefinition,
  type WorkerKind,
  type WorkerResult,
} from "./contracts";
import { getWorker } from "./workers";

/**
 * Platform-wide jobs (backup drills, monitoring sweeps, replication audits) have
 * no single website, so `websiteId` stays null for them. Jobs that do belong to
 * a site pass it explicitly and keep the cascade behaviour.
 */
export const PLATFORM_SCOPE = null;

const MAX_EVENTS = 200;

export interface EnqueueJobInput {
  kind: WorkerKind;
  /** Free-form operation name recorded alongside the worker kind. */
  type?: string;
  input: unknown;
  /** Concurrency domain. Deployments use the project id. */
  lockKey?: string;
  websiteId?: string;
  resourceId?: string;
  resourceType?: string;
  priority?: number;
  idempotencyKey?: string;
  correlationId?: string;
  maxAttempts?: number;
  retryPolicy?: Partial<RetryPolicy>;
  timeoutMs?: number;
  /** Override the risk the worker declared (only ever upwards is honoured). */
  riskLevel?: RiskLevel;
  requiresApproval?: boolean;
  actor?: JobActor | null;
  /** Immutable job metadata; never accepted from an HTTP payload. */
  automation?: { runId: string; stepId: string };
  /** Run no earlier than this instant. */
  availableAt?: Date;
}

export interface EnqueueJobResult {
  jobId: string;
  status: JobState;
  duplicate: boolean;
  requiresApproval: boolean;
  correlationId: string;
}

export interface OrchestratorOptions {
  /** Milliseconds of lease granted on top of the job timeout. */
  leaseBufferMs?: number;
  /**
   * How many jobs may run concurrently for one lock key.
   *
   * 1 (the default) is enforced *inside* the atomic claim and is safe on a
   * single SQLite/libSQL writer. Values above 1 are best-effort only: the
   * pre-check is not atomic with the claim, so a multi-node deployment needs a
   * real distributed queue (Redis/BullMQ) before raising it. That trade-off is
   * documented rather than hidden.
   */
  maxConcurrentPerKey?: number;
  /** Risk level from which a human approval is mandatory. */
  approvalThreshold?: RiskLevel;
  now?: () => Date;
}

const DEFAULT_OPTIONS: Required<Omit<OrchestratorOptions, "now">> = {
  leaseBufferMs: 30_000,
  maxConcurrentPerKey: 1,
  approvalThreshold: "PRIVILEGED",
};

interface JobMetadata {
  timeoutMs: number;
  scopes: string[];
  inputHash: string;
  retrySafe: boolean;
  automation?: { runId: string; stepId: string };
}

interface StoredEvents {
  events: Array<{ at: string; percent: number; message: string }>;
  result?: WorkerResult;
  meta?: JobMetadata;
}

function parseOutput(raw: string | null): StoredEvents {
  if (!raw) return { events: [] };
  try {
    const parsed = JSON.parse(raw) as Partial<StoredEvents>;
    return { events: Array.isArray(parsed.events) ? parsed.events : [], result: parsed.result, meta: parsed.meta };
  } catch {
    // Legacy rows stored free-form text. Preserve it as a single event.
    return { events: [{ at: new Date(0).toISOString(), percent: 0, message: raw.slice(0, 500) }] };
  }
}

export class Orchestrator {
  private options: Required<Omit<OrchestratorOptions, "now">>;
  private now: () => Date;
  /**
   * Per-instance worker overrides. Tests use this instead of mutating the shared
   * production catalogue, so a test can never leave a stub registered where a
   * real worker belongs.
   */
  private overrides = new Map<string, WorkerDefinition<any, any>>();

  constructor(options: OrchestratorOptions = {}) {
    const { now, ...rest } = options;
    this.options = { ...DEFAULT_OPTIONS, ...rest };
    this.now = now ?? (() => new Date());
  }

  /** Register a worker for this instance only. Returns the orchestrator. */
  withWorker(def: WorkerDefinition<any, any>): this {
    this.overrides.set(def.kind, def);
    return this;
  }

  private workerFor(kind: string): WorkerDefinition<any, any> | undefined {
    return this.overrides.get(kind) ?? getWorker(kind);
  }

  private assertIdempotentMatch(job: { output: string | null; workerKind: string | null }, meta: JobMetadata, kind: string): void {
    const previous = parseOutput(job.output).meta;
    if (previous && (previous.inputHash !== meta.inputHash || job.workerKind !== kind)) {
      throw new WorkerError("IDEMPOTENCY_CONFLICT", "This idempotency key belongs to a different operation payload", false);
    }
  }

  private async assertResourceAccess(request: EnqueueJobInput): Promise<void> {
    const actor = request.actor;
    const privileged = actor?.role === "SUPER_ADMIN" || actor?.role === "ADMIN" || actor?.role === "AUTOMATION";
    if (request.websiteId) {
      const website = await db.website.findUnique({ where: { id: request.websiteId }, select: { ownerId: true, deletedAt: true } });
      if (!website || website.deletedAt) throw new WorkerError("NOT_FOUND", "Website not found", false);
      if (!privileged && website.ownerId !== actor?.id) throw new WorkerError("TENANT_MISMATCH", "Website belongs to another customer", false);
    }
    if (!request.resourceId || request.resourceType === "AutomationStep" || request.resourceType === "AutomationProfileVersion") return;
    if (request.resourceType === "GitProject") {
      // GitProject deliberately has no Prisma relation; resolve its anchor separately.
      const row = await db.gitProject.findUnique({ where: { id: request.resourceId } });
      if (!row) throw new WorkerError("NOT_FOUND", "Project not found", false);
      const website = await db.website.findUnique({ where: { id: row.websiteId } });
      if (!privileged && row.createdById !== actor?.id && website?.ownerId !== actor?.id) {
        throw new WorkerError("TENANT_MISMATCH", "Project belongs to another customer", false);
      }
    } else if (!privileged) {
      throw new WorkerError("FORBIDDEN", "This infrastructure resource requires an administrator grant", false);
    }
  }

  // ── Enqueue ────────────────────────────────────────────────────────────────

  async enqueue(request: EnqueueJobInput): Promise<EnqueueJobResult> {
    const worker = this.workerFor(request.kind);
    if (!worker) throw new WorkerError("UNKNOWN_WORKER", `No worker registered for ${request.kind}`);

    // Validate before anything is persisted: an invalid payload must never
    // become a job that a worker later trips over.
    const parsed = worker.inputSchema.safeParse(request.input);
    if (!parsed.success) {
      throw new WorkerError(
        "VALIDATION_FAILED",
        `Input for ${request.kind} failed validation: ${parsed.error.issues
          .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
          .join("; ")}`,
        false,
        parsed.error.flatten(),
      );
    }

    const correlationId = request.correlationId ?? randomUUID();
    const actionRisk = effectiveRisk(worker, parsed.data);
    const declared = request.riskLevel ?? actionRisk;
    const risk: RiskLevel = riskAtLeast(declared, actionRisk) ? declared : actionRisk;
    const requiresApproval = request.requiresApproval === true || riskAtLeast(risk, this.options.approvalThreshold);
    const retrySafe = isHandlerRetrySafe(worker, parsed.data);
    const requestedAttempts = request.maxAttempts ?? worker.defaultMaxAttempts ?? 1;
    if (!Number.isInteger(requestedAttempts) || requestedAttempts < 1 || requestedAttempts > 10) {
      throw new WorkerError("VALIDATION_FAILED", "maxAttempts must be an integer from 1 to 10", false);
    }
    if (!retrySafe && requestedAttempts > 1) {
      throw new WorkerError("UNSAFE_RETRY", `${request.kind} has not declared this action safe to retry; maxAttempts must be 1`, false);
    }
    const maxAttempts = retrySafe ? requestedAttempts : 1;
    const retryPolicy = retryPolicySchema.parse({ ...DEFAULT_RETRY_POLICY, ...(request.retryPolicy ?? {}) });
    const timeoutMs = request.timeoutMs ?? worker.defaultTimeoutMs ?? 5 * 60_000;
    if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 3_600_000) {
      throw new WorkerError("VALIDATION_FAILED", "timeoutMs must be an integer from 100 to 3600000", false);
    }
    const scopes = effectiveScopes(worker, parsed.data);
    assertActorScopes(request.actor, scopes);
    await this.assertResourceAccess(request);
    const input = JSON.stringify(parsed.data);
    const meta: JobMetadata = {
      timeoutMs, scopes: [...scopes], retrySafe,
      inputHash: createHash("sha256").update(`${request.kind}:${input}`).digest("hex"),
      ...(request.automation ? { automation: request.automation } : {}),
    };

    const data = {
      websiteId: request.websiteId ?? PLATFORM_SCOPE,
      type: request.type ?? worker.kind,
      status: (requiresApproval ? "WAITING_APPROVAL" : "QUEUED") as JobState,
      priority: request.priority ?? 100,
      progress: 0,
      input,
      output: JSON.stringify({ events: [], meta } satisfies StoredEvents),
      resourceId: request.resourceId ?? null,
      resourceType: request.resourceType ?? null,
      requestId: correlationId,
      actorId: request.actor?.id && request.actor.id !== "system" ? request.actor.id : null,
      actorEmail: request.actor?.email ?? null,
      actorRole: request.actor?.role ?? null,
      correlationId,
      workerKind: worker.kind,
      riskLevel: risk,
      maxAttempts,
      retryPolicy: JSON.stringify(retryPolicy),
      availableAt: request.availableAt ?? this.now(),
      lockKey: request.lockKey ?? null,
      requiresApproval,
    };

    if (request.idempotencyKey) {
      const key = request.idempotencyKey;
      const existing = await db.operationJob.findUnique({ where: { idempotencyKey: key } });
      if (existing) {
        this.assertIdempotentMatch(existing, meta, request.kind);
        logger.info({ jobId: existing.id, correlationId: existing.correlationId }, "duplicate job suppressed");
        return {
          jobId: existing.id,
          status: existing.status as JobState,
          duplicate: true,
          requiresApproval: Boolean(existing.requiresApproval),
          correlationId: existing.correlationId ?? correlationId,
        };
      }
      try {
        const job = await db.operationJob.create({ data: { ...data, idempotencyKey: key } });
        return await this.afterEnqueue(job.id, worker.kind, correlationId, requiresApproval, request.actor?.id === "system" ? null : request.actor);
      } catch (error) {
        // Unique-index collision: another writer won the race. Return their job.
        const raced = await db.operationJob.findUnique({ where: { idempotencyKey: key } });
        if (raced) {
          this.assertIdempotentMatch(raced, meta, request.kind);
          return {
            jobId: raced.id,
            status: raced.status as JobState,
            duplicate: true,
            requiresApproval: Boolean(raced.requiresApproval),
            correlationId: raced.correlationId ?? correlationId,
          };
        }
        throw error;
      }
    }

    const job = await db.operationJob.create({ data });
    return await this.afterEnqueue(job.id, worker.kind, correlationId, requiresApproval, request.actor?.id === "system" ? null : request.actor);
  }

  private async afterEnqueue(
    jobId: string,
    kind: WorkerKind,
    correlationId: string,
    requiresApproval: boolean,
    actor?: { id: string; email: string; role: string } | null,
  ): Promise<EnqueueJobResult> {
    await this.appendEvent(jobId, 0, requiresApproval ? `queued ${kind}, waiting for approval` : `queued ${kind}`);
    await createAuditLog({
      actorId: actor?.id,
      actorEmail: actor?.email,
      actorRole: actor?.role,
      action: "JOB_ENQUEUED",
      resourceType: "OperationJob",
      resourceId: jobId,
      requestId: correlationId,
      result: requiresApproval ? "WAITING_APPROVAL" : "QUEUED",
      metadata: { workerKind: kind, requiresApproval },
    });
    return { jobId, status: requiresApproval ? "WAITING_APPROVAL" : "QUEUED", duplicate: false, requiresApproval, correlationId };
  }

  // ── Approval gate ──────────────────────────────────────────────────────────

  /**
   * Approve a gated job. Only a named human actor may do this; the AI layer is
   * deliberately not given a path here.
   */
  async approve(
    jobId: string,
    actor: { id: string; email: string; role: string },
    note?: string,
  ): Promise<{ ok: true; status: JobState } | { ok: false; reason: string }> {
    if (!["SUPER_ADMIN", "ADMIN"].includes(actor.role)) return { ok: false, reason: "Only a named administrator can approve infrastructure work" };
    const job = await db.operationJob.findUnique({ where: { id: jobId } });
    if (!job) return { ok: false, reason: "Job not found" };
    if (job.status !== "WAITING_APPROVAL") {
      return { ok: false, reason: `Job is ${job.status}, not WAITING_APPROVAL` };
    }
    const updated = await db.operationJob.updateMany({
      where: { id: jobId, status: "WAITING_APPROVAL" },
      data: {
        status: "QUEUED",
        approvedBy: actor.email,
        approvedAt: this.now(),
        approvalNote: note ? redact(note).slice(0, 500) : null,
      },
    });
    if (updated.count !== 1) return { ok: false, reason: "Approval lost a race with another actor" };

    await this.appendEvent(jobId, job.progress, `approved by ${actor.email}`);
    await createAuditLog({
      actorId: actor.id,
      actorEmail: actor.email,
      actorRole: actor.role,
      action: "JOB_APPROVED",
      resourceType: "OperationJob",
      resourceId: jobId,
      requestId: job.correlationId ?? undefined,
      result: "SUCCESS",
      metadata: { riskLevel: job.riskLevel, workerKind: job.workerKind },
    });
    await this.afterJobTransition(jobId);
    return { ok: true, status: "QUEUED" };
  }

  async reject(
    jobId: string,
    actor: { id: string; email: string; role: string },
    reason: string,
  ): Promise<{ ok: boolean; reason?: string }> {
    const updated = await db.operationJob.updateMany({
      where: { id: jobId, status: "WAITING_APPROVAL" },
      data: {
        status: "FAILED",
        error: `Approval rejected: ${redact(reason).slice(0, 400)}`,
        lastError: "APPROVAL_REJECTED",
        finishedAt: this.now(),
        completedAt: this.now(),
        cancelledBy: actor.email,
      },
    });
    if (updated.count !== 1) return { ok: false, reason: "Job is not waiting for approval" };
    await createAuditLog({
      actorId: actor.id,
      actorEmail: actor.email,
      actorRole: actor.role,
      action: "JOB_APPROVAL_REJECTED",
      resourceType: "OperationJob",
      resourceId: jobId,
      result: "SUCCESS",
      metadata: { reason: redact(reason).slice(0, 400) },
    });
    await this.afterJobTransition(jobId);
    return { ok: true };
  }

  // ── Claim & run ────────────────────────────────────────────────────────────

  /**
   * Claim the next runnable job and execute its worker.
   * Returns null when there is nothing to do.
   *
   * `opts.jobId` runs one *specific* job (used by the API and by tests); the
   * claim is still conditional, so a job another worker already took is skipped
   * rather than executed twice.
   */
  async runNext(
    workerId: string,
    opts: { lockKey?: string; kinds?: WorkerKind[]; jobId?: string } = {},
  ): Promise<string | null> {
    // With an explicit jobId this is a *targeted* run: it must never fall back to
    // claiming some other job, or one worker silently executes another's queue.
    const jobId = opts.jobId ? await this.claimSpecific(workerId, opts.jobId) : await this.claim(workerId, opts);
    if (!jobId) return null;
    await this.execute(jobId, workerId).catch((error) => {
      logger.error({ jobId, error }, "orchestrator execute crashed");
    });
    return jobId;
  }

  /** Claim one named job if, and only if, it is still runnable. */
  async claimSpecific(workerId: string, jobId: string): Promise<string | null> {
    const job = await db.operationJob.findUnique({ where: { id: jobId } });
    if (!job) return null;
    if (job.status !== "QUEUED" && job.status !== "RETRYING") return null;
    if (job.availableAt && job.availableAt.getTime() > this.now().getTime()) return null;
    if (job.attempts >= job.maxAttempts) return null;
    if (job.requiresApproval && (!job.approvedAt || this.now().getTime() - job.approvedAt.getTime() > APPROVAL_TTL_MS)) return null;

    if (job.lockKey) {
      const running = await db.operationJob.count({
        where: { lockKey: job.lockKey, status: { in: ["RUNNING", "VERIFYING", "ROLLING_BACK"] } },
      });
      if (running >= this.options.maxConcurrentPerKey) return null;
    }

    const now = this.now();
    const timeoutMs = parseOutput(job.output).meta?.timeoutMs ?? this.timeoutFor(job.workerKind as WorkerKind | null);
    const lease = new Date(now.getTime() + timeoutMs + this.options.leaseBufferMs);
    const strictSerial = job.lockKey !== null && this.options.maxConcurrentPerKey <= 1;

    const claimed = await db.operationJob.updateMany({
      where: {
        id: jobId,
        status: { in: ["QUEUED", "RETRYING"] },
        attempts: { lt: job.maxAttempts },
        availableAt: { lte: now },
        ...(job.requiresApproval ? { approvedAt: { gte: new Date(now.getTime() - APPROVAL_TTL_MS) } } : {}),
        ...(strictSerial
          ? {
              NOT: {
                lockKey: job.lockKey,
                status: { in: ["RUNNING", "VERIFYING", "ROLLING_BACK"] },
                leaseExpiresAt: { gt: now },
              },
            }
          : {}),
      },
      data: {
        status: "RUNNING",
        attempts: job.attempts + 1,
        startedAt: job.startedAt ?? now,
        leaseExpiresAt: lease,
        leasedBy: workerId,
        availableAt: now,
      },
    });
    if (claimed.count !== 1) return null;
    await this.appendEvent(jobId, 5, `claimed by ${workerId} (attempt ${job.attempts + 1})`);
    return jobId;
  }

  /**
   * Atomically claim one QUEUED/RETRYING job.
   *
   * The conditional `updateMany` is the lock: if two workers select the same
   * row, only one update matches `status: QUEUED` and returns count 1.
   */
  async claim(
    workerId: string,
    opts: { lockKey?: string; kinds?: WorkerKind[]; jobId?: string } = {},
  ): Promise<string | null> {
    if (opts.jobId) return await this.claimSpecific(workerId, opts.jobId);
    const now = this.now();
    const candidates = await db.operationJob.findMany({
      where: {
        status: { in: ["QUEUED", "RETRYING"] },
        availableAt: { lte: now },
        ...(opts.lockKey !== undefined ? { lockKey: opts.lockKey } : {}),
        ...(opts.kinds?.length ? { workerKind: { in: opts.kinds } } : {}),
        OR: [{ requiresApproval: false }, { approvedAt: { not: null } }],
      },
      orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
      take: 25,
    });
    // Every guard (eligibility, per-key serialization, lease, attempt count)
    // lives in claimSpecific/tryClaim, so both entry points behave identically.
    for (const candidate of candidates) {
      const won = await this.claimSpecific(workerId, candidate.id);
      if (won) return won;
    }
    return null;
  }

  private timeoutFor(kind: WorkerKind | null): number {
    const worker = kind ? this.workerFor(kind as WorkerKind) : null;
    return worker?.defaultTimeoutMs ?? 5 * 60_000;
  }

  /** Extend a lease while a long job is still making progress. */
  async heartbeat(jobId: string, workerId: string, extraMs = 60_000): Promise<boolean> {
    const res = await db.operationJob.updateMany({
      where: { id: jobId, leasedBy: workerId, status: "RUNNING" },
      data: { leaseExpiresAt: new Date(this.now().getTime() + extraMs) },
    });
    return res.count === 1;
  }

  private async execute(jobId: string, workerId: string): Promise<void> {
    const job = await db.operationJob.findUnique({ where: { id: jobId } });
    if (!job || !job.workerKind) return;

    const worker = this.workerFor(job.workerKind as WorkerKind);
    if (!worker) {
      await this.complete(jobId, workerId, {
        ok: false,
        code: "UNKNOWN_WORKER",
        message: `No worker registered for ${job.workerKind}`,
        verified: false,
      });
      return;
    }

    const correlationId = job.correlationId ?? jobId;
    const started = Date.now();
    const stored = parseOutput(job.output);
    const controller = new AbortController();
    const timeoutMs = stored.meta?.timeoutMs ?? this.timeoutFor(job.workerKind as WorkerKind);
    const timer = setTimeout(() => controller.abort(new TimeoutError(`Worker ${worker.kind} exceeded its ${timeoutMs}ms timeout`)), timeoutMs);
    const cancellationPoll = setInterval(() => {
      void db.operationJob.findUnique({ where: { id: jobId }, select: { status: true, leasedBy: true, cancelledAt: true } }).then((current) => {
        if (!current || current.status === "CANCELLED" || current.cancelledAt || current.leasedBy !== workerId) controller.abort(new WorkerError("CANCELLED", "Job cancellation was requested or its lease was reclaimed", false));
      }).catch(() => {});
    }, Math.min(1000, Math.max(25, timeoutMs / 4)));
    cancellationPoll.unref();
    const ctx: WorkerContext = {
      jobId,
      correlationId,
      signal: controller.signal,
      approval: job.approvedBy && job.approvedAt ? { by: job.approvedBy, at: job.approvedAt } : null,
      actor: job.actorEmail ? { id: job.actorId ?? "", email: job.actorEmail, role: job.actorRole ?? "", scopes: stored.meta?.scopes ?? [] } : null,
      progress: async (percent, message) => {
        controller.signal.throwIfAborted();
        await db.operationJob.updateMany({ where: { id: jobId, leasedBy: workerId, status: "RUNNING" }, data: { progress: clamp(percent, 0, 100) } });
        await this.appendEvent(jobId, clamp(percent, 0, 100), message);
      },
      onlineAgents: async () => {
        const cutoff = new Date(this.now().getTime() - AGENT_ONLINE_WINDOW_MS);
        const agents = await db.serverAgent.findMany({
          where: { status: "active", lastHeartbeat: { gte: cutoff } },
          select: { id: true, name: true, capabilities: true },
        });
        return agents.map((a) => ({ id: a.id, name: a.name, capabilities: parseJsonArray(a.capabilities) }));
      },
    };

    let input: unknown = {};
    try {
      input = job.input ? JSON.parse(job.input) : {};
    } catch {
      await this.complete(jobId, workerId, failResult("VALIDATION_FAILED", "Stored job input is not valid JSON"));
      return;
    }

    const validation = worker.inputSchema.safeParse(input);
    if (!validation.success) {
      await this.complete(
        jobId,
        workerId,
        failResult("VALIDATION_FAILED", `Job input failed validation: ${validation.error.message}`),
      );
      return;
    }

    try {
      assertActorScopes(ctx.actor, stored.meta?.scopes ?? effectiveScopes(worker, validation.data));
      const result = await withTimeout(
        Promise.resolve().then(() => worker.handler(validation.data, ctx)),
        timeoutMs,
        `Worker ${worker.kind} exceeded its ${timeoutMs}ms timeout`,
        controller.signal,
      );
      if (!result.ok && !result.code) throw new WorkerError("WORKER_CRASHED", "Worker returned a failure without a reason", false);
      // An unverified observation is evidence, not a completed operation.
      const normalized: WorkerResult = result.ok && !result.verified
        ? { ...result, ok: false, code: "VERIFICATION_REQUIRED", message: result.message || "The outcome could not be verified" }
        : result;
      await this.complete(jobId, workerId, { ...normalized, durationMs: normalized.durationMs ?? Date.now() - started });
    } catch (error) {
      const cause = controller.signal.aborted ? controller.signal.reason : error;
      const isWorkerError = cause instanceof WorkerError;
      const details = isWorkerError ? cause.details : undefined;
      await this.complete(jobId, workerId, {
        ok: false,
        code: isWorkerError ? cause.code : cause instanceof TimeoutError ? "TIMEOUT" : "WORKER_CRASHED",
        message: redact(cause instanceof Error ? cause.message : String(cause)).slice(0, 1000),
        verified: false,
        retryable: isWorkerError ? cause.retryable : !(cause instanceof TimeoutError),
        ...(details && typeof details === "object" && !Array.isArray(details)
          ? { mergeInput: details as Record<string, unknown> }
          : {}),
      });
    } finally {
      clearTimeout(timer);
      clearInterval(cancellationPoll);
    }
  }

  // ── Terminal transitions ───────────────────────────────────────────────────

  async complete(jobId: string, workerId: string, result: WorkerResult): Promise<JobState> {
    const job = await db.operationJob.findUnique({ where: { id: jobId } });
    if (!job) return "FAILED";
    if (TERMINAL_STATES.includes(job.status as JobState)) return job.status as JobState;
    // Lease fence: a timed-out/reclaimed worker cannot complete the new attempt.
    if (job.leasedBy !== workerId || !["RUNNING", "VERIFYING"].includes(job.status)) return job.status as JobState;

    const now = this.now();
    const durationMs = now.getTime() - (job.startedAt?.getTime() ?? now.getTime());

    if (result.ok) {
      await this.persistResult(jobId, result, durationMs);
      const completed = await db.operationJob.updateMany({
        where: { id: jobId, leasedBy: workerId, status: { in: ["RUNNING", "VERIFYING"] } },
        data: {
          status: "SUCCESS",
          progress: 100,
          finishedAt: now,
          completedAt: now,
          durationMs,
          leaseExpiresAt: null,
          leasedBy: null,
          error: null,
          lastError: null,
        },
      });
      if (completed.count !== 1) return (await db.operationJob.findUnique({ where: { id: jobId } }))?.status as JobState ?? "CANCELLED";
      await this.appendEvent(jobId, 100, `${result.code}: ${result.message}`);
      await this.audit(job, "JOB_COMPLETED", "SUCCESS", { code: result.code, verified: true, durationMs });
      await this.afterJobTransition(jobId);
      return "SUCCESS";
    }

    if (job.cancelledAt && !result.ok) {
      await this.persistResult(jobId, result, durationMs);
      await db.operationJob.updateMany({
        where: { id: jobId, leasedBy: workerId, status: { in: ["RUNNING", "VERIFYING"] } },
        data: { status: "CANCELLED", progress: 100, finishedAt: now, completedAt: now, durationMs, leaseExpiresAt: null, leasedBy: null, lastError: "CANCELLED" },
      });
      await this.appendEvent(jobId, 100, "handler stopped after cancellation request");
      await this.audit(job, "JOB_CANCELLED", "CANCELLED", { code: result.code, durationMs });
      await this.afterJobTransition(jobId);
      return "CANCELLED";
    }

    // Failure path: retry, dead-letter, or fail.
    const attempts = job.attempts;
    const maxAttempts = job.maxAttempts;
    const policy = parseRetryPolicy(job.retryPolicy);
    const retrySafe = parseOutput(job.output).meta?.retrySafe === true;
    const retryable = retrySafe && result.retryable !== false && isRetryable(result.code) && attempts < maxAttempts;

    await this.persistResult(jobId, result, durationMs);

    if (retryable) {
      const delay = computeBackoffDelay(policy, attempts);
      // Let the failed attempt hand the next one a handle (e.g. the id of a
      // task it already dispatched) so retries poll instead of duplicating work.
      const mergedInput = result.mergeInput
        ? JSON.stringify({ ...(safeParse(job.input) as Record<string, unknown>), ...result.mergeInput }).slice(0, 100_000)
        : undefined;
      const transitioned = await db.operationJob.updateMany({
        where: { id: jobId, leasedBy: workerId, status: { in: ["RUNNING", "VERIFYING"] } },
        data: {
          ...(mergedInput ? { input: mergedInput } : {}),
          status: "RETRYING",
          lastError: result.code,
          error: redact(result.message).slice(0, 1000),
          availableAt: new Date(now.getTime() + delay),
          leaseExpiresAt: null,
          leasedBy: null,
          finishedAt: null,
        },
      });
      if (transitioned.count !== 1) return (await db.operationJob.findUnique({ where: { id: jobId } }))?.status as JobState ?? "CANCELLED";
      await this.appendEvent(jobId, job.progress, `attempt ${attempts}/${maxAttempts} failed (${result.code}); retrying in ${delay}ms`);
      logger.warn({ jobId, code: result.code, attempts, delay }, "job retry scheduled");
      await this.afterJobTransition(jobId);
      return "RETRYING";
    }

    const exhausted = attempts >= maxAttempts && retrySafe && result.retryable !== false && isRetryable(result.code);
    const terminal: JobState = exhausted ? "DEAD_LETTER" : "FAILED";
    const transitioned = await db.operationJob.updateMany({
      where: { id: jobId, leasedBy: workerId, status: { in: ["RUNNING", "VERIFYING"] } },
      data: {
        status: terminal,
        progress: 100,
        lastError: result.code,
        error: redact(result.message).slice(0, 1000),
        finishedAt: now,
        completedAt: now,
        durationMs,
        leaseExpiresAt: null,
        leasedBy: null,
        ...(exhausted
          ? {
              deadLetteredAt: now,
              deadLetterReason: `${result.code} after ${attempts} attempt(s)`.slice(0, 300),
            }
          : {}),
      },
    });
    if (transitioned.count !== 1) return (await db.operationJob.findUnique({ where: { id: jobId } }))?.status as JobState ?? "CANCELLED";
    await this.appendEvent(jobId, 100, `${terminal}: ${result.code} — ${result.message}`);
    await this.audit(job, terminal === "DEAD_LETTER" ? "JOB_DEAD_LETTERED" : "JOB_FAILED", terminal, {
      code: result.code,
      attempts,
      durationMs,
    });
    await this.afterJobTransition(jobId);
    return terminal;
  }

  async cancel(jobId: string, actor: { id?: string; email: string; role?: string }, reason = "cancelled"): Promise<boolean> {
    const now = this.now();
    const job = await db.operationJob.findUnique({ where: { id: jobId } });
    if (!job || TERMINAL_STATES.includes(job.status as JobState)) return false;
    const executing = ["RUNNING", "VERIFYING", "ROLLING_BACK"].includes(job.status);
    // Never clear a live lease or claim the process stopped. The handler receives
    // an abort signal; a non-cooperative effect is allowed to finish and fenced
    // from advancing the workflow. The UI reports cancellation as requested.
    const res = await db.operationJob.updateMany({
      where: { id: jobId, status: { in: [...ACTIVE_STATES] } },
      data: executing
        ? { cancelledAt: now, cancelledBy: actor.email, error: `Cancellation requested: ${redact(reason).slice(0, 300)}` }
        : { status: "CANCELLED", cancelledAt: now, cancelledBy: actor.email, finishedAt: now, completedAt: now, leaseExpiresAt: null, leasedBy: null, error: redact(reason).slice(0, 400) },
    });
    if (res.count !== 1) return false;
    if (!executing) await this.afterJobTransition(jobId);
    await this.appendEvent(jobId, 100, `cancelled by ${actor.email}: ${reason}`);
    await createAuditLog({
      actorId: actor.id,
      actorEmail: actor.email,
      actorRole: actor.role,
      action: "JOB_CANCELLED",
      resourceType: "OperationJob",
      resourceId: jobId,
      result: "SUCCESS",
      metadata: { reason: redact(reason).slice(0, 300) },
    });
    return true;
  }

  /**
   * Requeue a dead-lettered job after a human has looked at it. Deliberately
   * manual: a job that failed maxAttempts times should not retry itself.
   */
  async requeueDeadLetter(jobId: string, actor: { id: string; email: string; role: string }, note?: string): Promise<boolean> {
    const job = await db.operationJob.findUnique({ where: { id: jobId } });
    if (!job) return false;
    const meta = parseOutput(job.output).meta;
    if (meta?.retrySafe !== true || (job.status === "FAILED" && !isRetryable(job.lastError))) return false;
    const res = await db.operationJob.updateMany({
      where: { id: jobId, status: { in: ["DEAD_LETTER", "FAILED"] } },
      data: {
        status: "QUEUED",
        attempts: 0,
        deadLetteredAt: null,
        deadLetterReason: null,
        error: null,
        lastError: null,
        leaseExpiresAt: null,
        leasedBy: null,
        finishedAt: null,
        completedAt: null,
        availableAt: this.now(),
        progress: 0,
        cancelledAt: null,
        cancelledBy: null,
        ...(job.requiresApproval ? { status: "WAITING_APPROVAL", approvedBy: null, approvedAt: null, approvalNote: null } : {}),
      },
    });
    if (res.count !== 1) return false;
    await this.afterJobTransition(jobId);
    await this.appendEvent(jobId, 0, `requeued from dead letter by ${actor.email}${note ? `: ${redact(note).slice(0, 200)}` : ""}`);
    await createAuditLog({
      actorId: actor.id,
      actorEmail: actor.email,
      actorRole: actor.role,
      action: "JOB_REQUEUED",
      resourceType: "OperationJob",
      resourceId: jobId,
      result: "SUCCESS",
      metadata: { note: note ? redact(note).slice(0, 300) : undefined },
    });
    return true;
  }

  /**
   * Recover jobs whose worker died. A RUNNING job with an expired lease is
   * counted as an attempt that already happened, so it requeues or
   * dead-letters under the normal retry budget.
   */
  async recoverAbandoned(): Promise<{ requeued: number; deadLettered: number; jobIds: string[] }> {
    const now = this.now();
    const abandoned = await db.operationJob.findMany({
      where: { status: { in: ["RUNNING", "VERIFYING"] }, leaseExpiresAt: { lt: now } },
      take: 50,
    });
    let requeued = 0;
    let deadLettered = 0;
    const jobIds: string[] = [];

    for (const job of abandoned) {
      const retrySafe = parseOutput(job.output).meta?.retrySafe === true;
      const exhausted = !retrySafe || job.attempts >= job.maxAttempts;
      const policy = parseRetryPolicy(job.retryPolicy);
      if (exhausted) {
        const changed = await db.operationJob.updateMany({
          where: { id: job.id, status: { in: ["RUNNING", "VERIFYING"] }, leaseExpiresAt: { lt: now } },
          data: {
            status: "DEAD_LETTER",
            deadLetteredAt: now,
            deadLetterReason: `lease expired after ${job.attempts} attempt(s); worker ${job.leasedBy ?? "unknown"} stopped responding`.slice(0, 300),
            leaseExpiresAt: null,
            leasedBy: null,
            finishedAt: now,
            completedAt: now,
          },
        });
        if (changed.count !== 1) continue;
        deadLettered++;
      } else {
        const delay = computeBackoffDelay(policy, job.attempts);
        const changed = await db.operationJob.updateMany({
          where: { id: job.id, status: { in: ["RUNNING", "VERIFYING"] }, leaseExpiresAt: { lt: now } },
          data: {
            status: "RETRYING",
            lastError: "LEASE_EXPIRED",
            error: `Worker ${job.leasedBy ?? "unknown"} lost its lease; requeued`,
            availableAt: new Date(now.getTime() + delay),
            leaseExpiresAt: null,
            leasedBy: null,
          },
        });
        if (changed.count !== 1) continue;
        requeued++;
      }
      jobIds.push(job.id);
      await this.appendEvent(job.id, job.progress, `lease expired (worker ${job.leasedBy ?? "unknown"}) → ${exhausted ? "dead letter" : "requeued"}`);
      await this.audit(job, exhausted ? "JOB_DEAD_LETTERED" : "JOB_LEASE_RECOVERED", exhausted ? "DEAD_LETTER" : "RETRYING", { code: "LEASE_EXPIRED", retrySafe });
      await this.afterJobTransition(job.id);
      logger.warn({ jobId: job.id, attempts: job.attempts, exhausted }, "recovered abandoned job");
    }
    return { requeued, deadLettered, jobIds };
  }

  // ── Observability ──────────────────────────────────────────────────────────

  async status(jobId: string) {
    const job = await db.operationJob.findUnique({ where: { id: jobId } });
    if (!job) return null;
    const stored = parseOutput(job.output);
    return {
      id: job.id,
      type: job.type,
      workerKind: job.workerKind,
      websiteId: job.websiteId,
      resourceId: job.resourceId,
      resourceType: job.resourceType,
      actorId: job.actorId,
      status: job.status as JobState,
      riskLevel: job.riskLevel as RiskLevel,
      progress: job.progress,
      attempts: job.attempts,
      maxAttempts: job.maxAttempts,
      correlationId: job.correlationId,
      lockKey: job.lockKey,
      requiresApproval: job.requiresApproval,
      approvedBy: job.approvedBy,
      availableAt: job.availableAt,
      leaseExpiresAt: job.leaseExpiresAt,
      leasedBy: job.leasedBy,
      startedAt: job.startedAt,
      finishedAt: job.finishedAt,
      durationMs: job.durationMs,
      lastError: job.lastError,
      error: job.error,
      deadLetterReason: job.deadLetterReason,
      cancellationRequestedAt: job.cancelledAt,
      timeoutMs: stored.meta?.timeoutMs ?? null,
      retrySafe: stored.meta?.retrySafe ?? false,
      automation: stored.meta?.automation ?? null,
      input: safeParse(job.input),
      result: stored.result ?? null,
      events: stored.events,
    };
  }

  async list(limit = 50, filter: { status?: JobState[]; lockKey?: string; kind?: WorkerKind } = {}) {
    const jobs = await db.operationJob.findMany({
      where: {
        ...(filter.status?.length ? { status: { in: filter.status } } : {}),
        ...(filter.lockKey ? { lockKey: filter.lockKey } : {}),
        ...(filter.kind ? { workerKind: filter.kind } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: Math.min(limit, 200),
    });
    return jobs.map((job) => {
      const result = parseOutput(job.output).result;
      return {
      id: job.id,
      type: job.type,
      workerKind: job.workerKind,
      websiteId: job.websiteId,
      resourceId: job.resourceId,
      resourceType: job.resourceType,
      actorId: job.actorId,
      status: job.status,
      riskLevel: job.riskLevel,
      progress: job.progress,
      attempts: job.attempts,
      maxAttempts: job.maxAttempts,
      lockKey: job.lockKey,
      correlationId: job.correlationId,
      requiresApproval: job.requiresApproval,
      approvedBy: job.approvedBy,
      lastError: job.lastError,
      deadLetterReason: job.deadLetterReason,
      createdAt: job.createdAt,
      startedAt: job.startedAt,
      finishedAt: job.finishedAt,
      durationMs: job.durationMs,
      actorEmail: job.actorEmail,
      // Summary only; the detail endpoint carries the bounded evidence/findings.
      // Missing evidence is null, never an implied verification.
      verified: result ? result.verified === true : null,
      resultCode: result?.code ?? null,
      hasEvidence: Boolean(result?.evidence),
      findingCount: result?.findings?.length ?? 0,
      criticalFindings: result?.findings?.filter((f) => f.severity === "critical").length ?? 0,
      retrySafe: parseOutput(job.output).meta?.retrySafe === true,
    };
    });
  }

  async queueDepth() {
    const grouped = await db.operationJob.groupBy({ by: ["status"], _count: { _all: true } });
    const byState: Record<string, number> = {};
    for (const row of grouped) byState[row.status] = row._count._all;
    const oldestQueued = await db.operationJob.findFirst({
      where: { status: { in: ["QUEUED", "RETRYING"] } },
      orderBy: { createdAt: "asc" },
      select: { id: true, createdAt: true, availableAt: true },
    });
    const finished = await db.operationJob.aggregate({ where: { status: { in: ["SUCCESS", "FAILED", "DEAD_LETTER"] } }, _avg: { durationMs: true }, _count: { _all: true } });
    const last = await db.operationJob.findFirst({ where: { finishedAt: { not: null } }, orderBy: { finishedAt: "desc" }, select: { finishedAt: true } });
    const next = await db.operationJob.findFirst({ where: { status: { in: ["QUEUED", "RETRYING"] } }, orderBy: { availableAt: "asc" }, select: { availableAt: true } });
    const completed = byState["SUCCESS"] ?? 0;
    const terminalCount = finished._count._all;
    return {
      byState,
      total: Object.values(byState).reduce((sum, count) => sum + count, 0),
      active: ACTIVE_STATES.reduce((sum, s) => sum + (byState[s] ?? 0), 0),
      running: (byState["RUNNING"] ?? 0) + (byState["VERIFYING"] ?? 0) + (byState["ROLLING_BACK"] ?? 0),
      queued: (byState["QUEUED"] ?? 0) + (byState["RETRYING"] ?? 0),
      completed,
      failed: (byState["FAILED"] ?? 0) + (byState["DEAD_LETTER"] ?? 0),
      waitingApproval: byState["WAITING_APPROVAL"] ?? 0,
      deadLetters: byState["DEAD_LETTER"] ?? 0,
      averageDurationMs: finished._avg.durationMs,
      successRate: terminalCount ? completed / terminalCount : null,
      lastExecutionAt: last?.finishedAt ?? null,
      nextExecutionAt: next?.availableAt ?? null,
      oldestQueuedAt: oldestQueued?.createdAt ?? null,
      oldestQueuedDelayMs: oldestQueued ? this.now().getTime() - oldestQueued.createdAt.getTime() : 0,
    };
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  private async afterJobTransition(jobId: string): Promise<void> {
    try {
      const step = await db.automationStep.findUnique({ where: { jobId } });
      if (step) {
        const { syncWorkflowStep } = await import("./workflows");
        await syncWorkflowStep(step.id, this);
      }
      const job = await db.operationJob.findUnique({ where: { id: jobId } });
      if (job?.resourceType === "AutomationProfileVersion" && job.resourceId) {
        const { syncProfileVerification } = await import("./profiles");
        await syncProfileVerification(job.resourceId, job.status, job.error, job.id, job.actorId);
      }
    } catch (error) {
      // The durable reconciliation sweep repairs this without losing the job.
      logger.error({ jobId, error }, "automation transition synchronization failed");
    }
  }

  private async persistResult(jobId: string, result: WorkerResult, durationMs: number) {
    const stored = parseOutput((await db.operationJob.findUnique({ where: { id: jobId }, select: { output: true } }))?.output ?? null);
    const safeResult = JSON.parse(redact(JSON.stringify({ ...result, durationMs }), collectSecrets())) as WorkerResult;
    const payload: StoredEvents = { events: stored.events.slice(-MAX_EVENTS), result: safeResult, meta: stored.meta };
    await db.operationJob
      .update({ where: { id: jobId }, data: { output: boundedJson(payload, 200_000) } })
      .catch((error) => logger.error({ jobId, error }, "failed to persist job result"));
  }

  private async appendEvent(jobId: string, percent: number, message: string) {
    const safe = redact(message, collectSecrets()).slice(0, 1000);
    const job = await db.operationJob.findUnique({ where: { id: jobId }, select: { output: true } }).catch(() => null);
    if (!job) return;
    const stored = parseOutput(job.output);
    const events = [...stored.events, { at: this.now().toISOString(), percent: clamp(percent, 0, 100), message: safe }].slice(-MAX_EVENTS);
    await db.operationJob
      .update({ where: { id: jobId }, data: { output: boundedJson({ events, result: stored.result, meta: stored.meta }, 200_000) } })
      .catch((error) => logger.error({ jobId, error }, "failed to append job event"));
  }

  private async audit(
    job: { id: string; correlationId: string | null; actorId: string | null; actorEmail: string | null; actorRole: string | null; riskLevel: string | null; workerKind: string | null },
    action: string,
    result: string,
    metadata: Record<string, unknown>,
  ) {
    await createAuditLog({
      actorId: job.actorId ?? undefined,
      actorEmail: job.actorEmail ?? undefined,
      actorRole: job.actorRole ?? undefined,
      action,
      resourceType: "OperationJob",
      resourceId: job.id,
      requestId: job.correlationId ?? undefined,
      result,
      metadata: { ...metadata, riskLevel: job.riskLevel, workerKind: job.workerKind },
    });
  }
}

/** Agents that have not reported within this window are considered offline. */
export const AGENT_ONLINE_WINDOW_MS = 3 * 60_000;
export const APPROVAL_TTL_MS = 15 * 60_000;

/**
 * Lexicographically smaller than any real ISO-8601 timestamp, so
 * `leaseExpiresAt > SENTINEL_NO_LEASE` is true for every live lease and false
 * for NULL. Used to make the per-lock-key claim guard atomic on SQLite.
 */
export const SENTINEL_NO_LEASE = "0000-01-01T00:00:00.000Z";

class TimeoutError extends Error {}

async function withTimeout<T>(promise: Promise<T>, ms: number, message: string, signal?: AbortSignal): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new TimeoutError(message)), ms);
        if (signal) {
          if (signal.aborted) reject(signal.reason);
          else signal.addEventListener("abort", () => reject(signal.reason), { once: true });
        }
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function boundedJson(value: unknown, maxBytes: number): string {
  const text = JSON.stringify(value);
  if (text.length <= maxBytes) return text;
  const stored = value as StoredEvents;
  return JSON.stringify({
    events: stored.events?.slice(-20) ?? [], meta: stored.meta,
    result: { ok: false, code: "OUTPUT_TRUNCATED", message: "Worker output exceeded the persistence budget; inspect the source logs.", verified: false },
  });
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function parseRetryPolicy(raw: string | null): RetryPolicy {
  if (!raw) return DEFAULT_RETRY_POLICY;
  const parsed = retryPolicySchemaSafe(raw);
  return parsed ?? DEFAULT_RETRY_POLICY;
}

function retryPolicySchemaSafe(raw: string): RetryPolicy | null {
  try {
    const value = JSON.parse(raw);
    return { ...DEFAULT_RETRY_POLICY, ...(typeof value === "object" && value ? value : {}) };
  } catch {
    return null;
  }
}

function parseJsonArray(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const value = JSON.parse(raw);
    return Array.isArray(value) ? value.map(String) : [];
  } catch {
    return [];
  }
}

function safeParse(raw: string | null): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function failResult(code: string, message: string): WorkerResult {
  return { ok: false, code, message, verified: false };
}

/** Stable idempotency key for a webhook-driven deployment. */
export function deploymentIdempotencyKey(projectId: string, commitSha: string, deliveryId?: string | null): string {
  return createHash("sha256")
    .update(`deploy:${projectId}:${commitSha}:${deliveryId ?? "no-delivery"}`)
    .digest("hex")
    .slice(0, 64);
}

/** Singleton wired to the live database. Tests construct their own instance. */
export const orchestrator = new Orchestrator();
export type { WorkerDefinition, WorkerResult, WorkerContext, JobState, RiskLevel, WorkerKind };
