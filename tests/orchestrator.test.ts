/**
 * Durable job orchestrator — behavioural tests against a real database.
 *
 * Covers the guarantees the platform depends on: exactly-once enqueue, atomic
 * claims, per-key serialization, retry/backoff/dead-letter, lease recovery,
 * approval gating, cancellation, secret redaction, and the honesty of the
 * specialized workers (no fabricated success).
 *
 * Test-only workers are registered with `orchestrator.withWorker(...)`, which is
 * instance-scoped — the shared production catalogue is never mutated.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { z } from "zod";
import type { Orchestrator as OrchestratorType } from "../src/lib/orchestrator/orchestrator";
import type { WorkerContext, WorkerDefinition } from "../src/lib/orchestrator/contracts";

/**
 * Everything that touches the database is imported inside `beforeAll`, *after*
 * DATABASE_URL points at this test's own copy. Vitest shares a module registry
 * across sequentially-run files in one worker, so a static top-level import of
 * `src/lib/db` would silently reuse a client built by an earlier test file and
 * pointed at its temporary database.
 */
let db: any;
let Orchestrator: typeof import("../src/lib/orchestrator/orchestrator").Orchestrator;
let contracts: typeof import("../src/lib/orchestrator/contracts");
let workerCatalogue: typeof import("../src/lib/orchestrator/workers");
let getWorker: (kind: string) => WorkerDefinition<any, any> | undefined;
let listWorkers: () => Array<{ kind: string; label: string; description: string; execution: string; maxRisk: string; requiredScopes: string[] }>;

const root = path.join(os.tmpdir(), `alo-orchestrator-test-${process.pid}`);
const dbPath = path.join(root, "orchestrator.db");

beforeAll(async () => {
  await fs.mkdir(root, { recursive: true });
  await fs.copyFile(path.resolve("db/custom.db"), dbPath);
  // This suite exercises platform-wide jobs (operation_jobs.websiteId IS NULL),
  // which need the table-rebuild migration. A rebuild is opt-in and requires a
  // verified backup, so the suite provides one: a pristine copy of the source
  // database, exactly as an operator would before touching a real one.
  const backupPath = path.join(root, "pre-migration-backup.db");
  await fs.copyFile(path.resolve("db/custom.db"), backupPath);
  execFileSync(
    process.execPath,
    ["scripts/apply-deploy-schema.mjs", "--allow-rebuild", "--backup", backupPath],
    { cwd: process.cwd(), env: { ...process.env, DATABASE_URL: `file:${dbPath}` }, stdio: "pipe" },
  );

  process.env.DATABASE_URL = `file:${dbPath}`;
  process.env.APP_ENCRYPTION_KEY = "a".repeat(64);
  process.env.NEXTAUTH_SECRET = "t".repeat(64);
  process.env.JWT_SECRET = "j".repeat(64);

  db = (await import("../src/lib/db")).db;
  Orchestrator = (await import("../src/lib/orchestrator/orchestrator")).Orchestrator;
  contracts = await import("../src/lib/orchestrator/contracts");
  workerCatalogue = await import("../src/lib/orchestrator/workers");
  getWorker = workerCatalogue.getWorker;
  listWorkers = workerCatalogue.listWorkers;

  // Resolve a real admin from the seeded database for actor-attributed actions.
  const admin = await db.user.findFirst({
    where: { role: { name: { in: ["SUPER_ADMIN", "ADMIN"] } } },
    select: { id: true, email: true, role: { select: { name: true } } },
  });
  if (!admin) throw new Error("test database has no ADMIN/SUPER_ADMIN user to act as approver");
  ADMIN.id = admin.id;
  ADMIN.email = admin.email;
  ADMIN.role = admin.role.name;

  // Prove the schema this file depends on is really present before any test runs.
  const cols = await db.$queryRawUnsafe('PRAGMA table_info("operation_jobs")');
  const names = cols.map((c: any) => c.name);
  for (const required of ["idempotencyKey", "correlationId", "workerKind", "riskLevel", "attempts", "maxAttempts", "availableAt", "leaseExpiresAt", "leasedBy", "lockKey", "requiresApproval", "deadLetteredAt"]) {
    if (!names.includes(required)) throw new Error(`test database is missing operation_jobs.${required}`);
  }
});

afterAll(async () => {
  await db?.$disconnect().catch(() => {});
  await fs.rm(root, { recursive: true, force: true }).catch(() => {});
});

// ── Helpers ─────────────────────────────────────────────────────────────────

const echoInput = z.object({ value: z.string().min(1), failTimes: z.number().int().min(0).default(0) });
const failCounts = new Map<string, number>();

function makeCtx(jobId = "job-test"): WorkerContext {
  return {
    jobId,
    correlationId: "corr-test",
    actor: null,
    progress: async () => {},
    onlineAgents: async () => [],
  };
}

/** A worker that fails `failTimes` times and then succeeds. */
function echoWorker(overrides: Partial<WorkerDefinition<any, any>> = {}): WorkerDefinition<any, any> {
  return contracts.defineWorker({
    kind: "BUILD_TEST",
    label: "echo",
    description: "test worker",
    execution: "LOCAL",
    maxRisk: "REVERSIBLE",
    requiredScopes: ["build:run"],
    defaultMaxAttempts: 3,
    defaultTimeoutMs: 30_000,
    inputSchema: echoInput,
    handler: async (input: { value: string; failTimes: number }) => {
      const seen = failCounts.get(input.value) ?? 0;
      failCounts.set(input.value, seen + 1);
      if (seen < input.failTimes) return contracts.fail("TRANSIENT", `attempt ${seen + 1} failed on purpose`);
      return contracts.ok({ value: input.value, attempts: seen + 1 }, `echoed ${input.value}`);
    },
    ...overrides,
  } as WorkerDefinition<any, any>);
}

function privilegedWorker(): WorkerDefinition<any, any> {
  return contracts.defineWorker({
    kind: "INFRASTRUCTURE",
    label: "privileged",
    description: "test worker",
    execution: "AGENT",
    maxRisk: "PRIVILEGED",
    requiredScopes: ["server:execute"],
    inputSchema: z.object({ unit: z.string() }),
    handler: async () => contracts.ok({ restarted: true }, "service restarted"),
  } as WorkerDefinition<any, any>);
}

function orch(...defs: WorkerDefinition<any, any>[]): OrchestratorType {
  const instance = new Orchestrator();
  for (const def of defs) instance.withWorker(def);
  return instance;
}

/**
 * A real user row. `audit_logs.actorUserId` has a foreign key to `users`, so a
 * fabricated actor id would make the audit insert fail (createAuditLog swallows
 * and logs the error), and the audit assertion would report a phantom bug.
 */
const ADMIN = { id: "", email: "", role: "ADMIN" };
// ── Core guarantees ─────────────────────────────────────────────────────────

describe("durable orchestrator", () => {
  it("enqueues, claims and completes a job, persisting the verified result", async () => {
    const o = orch(echoWorker());
    const enq = await o.enqueue({ kind: "BUILD_TEST", input: { value: "happy" } });
    expect(enq.duplicate).toBe(false);
    expect(enq.status).toBe("QUEUED");

    const jobId = await o.runNext("worker-a", { jobId: enq.jobId });
    expect(jobId).toBe(enq.jobId);

    const status = await o.status(enq.jobId);
    expect(status?.status).toBe("SUCCESS");
    expect(status?.attempts).toBe(1);
    expect(status?.result?.ok).toBe(true);
    expect(status?.result?.verified).toBe(true);
    expect(status?.events.length).toBeGreaterThan(0);
    expect(status?.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("persists the job so a restart cannot lose it", async () => {
    const o = orch(echoWorker());
    const enq = await o.enqueue({ kind: "BUILD_TEST", input: { value: "durable" } });
    const row = await db.operationJob.findUnique({ where: { id: enq.jobId } });
    expect(row).not.toBeNull();
    expect(row.status).toBe("QUEUED");
    expect(JSON.parse(row.input)).toEqual({ value: "durable", failTimes: 0 });

    // A brand-new orchestrator instance (i.e. a restarted process) finds it.
    const restarted = orch(echoWorker());
    expect(await restarted.runNext("worker-after-restart", { jobId: enq.jobId })).toBe(enq.jobId);
    expect((await restarted.status(enq.jobId))?.status).toBe("SUCCESS");
  });

  it("rejects an invalid payload before anything is persisted", async () => {
    const o = orch(echoWorker());
    await expect(o.enqueue({ kind: "BUILD_TEST", input: { value: "" } })).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
    });
    const count = await db.operationJob.count({ where: { input: '{"value":""}' } });
    expect(count).toBe(0);
  });

  it("refuses an unknown worker kind", async () => {
    const o = new Orchestrator();
    await expect(o.enqueue({ kind: "NOT_A_WORKER" as never, input: {} })).rejects.toMatchObject({ code: "UNKNOWN_WORKER" });
  });

  it("collapses duplicate enqueues into one job via the idempotency key", async () => {
    const o = orch(echoWorker());
    const key = `idem-${crypto.randomUUID()}`;
    const first = await o.enqueue({ kind: "BUILD_TEST", input: { value: "dupe" }, idempotencyKey: key });
    const second = await o.enqueue({ kind: "BUILD_TEST", input: { value: "dupe" }, idempotencyKey: key });
    const third = await o.enqueue({ kind: "BUILD_TEST", input: { value: "different" }, idempotencyKey: key });

    expect(first.duplicate).toBe(false);
    expect(second.duplicate).toBe(true);
    expect(second.jobId).toBe(first.jobId);
    // Same key ⇒ same job even when the payload differs. That is the point: a
    // webhook redelivery must not produce a second deployment.
    expect(third.duplicate).toBe(true);
    expect(third.jobId).toBe(first.jobId);

    const rows = await db.operationJob.findMany({ where: { idempotencyKey: key } });
    expect(rows).toHaveLength(1);
  });

  it("retries with exponential backoff, then succeeds", async () => {
    const o = orch(echoWorker());
    failCounts.delete("retry-me");
    const enq = await o.enqueue({
      kind: "BUILD_TEST",
      input: { value: "retry-me", failTimes: 2 },
      maxAttempts: 4,
      retryPolicy: { baseMs: 0, factor: 2, maxDelayMs: 10, jitter: 0 },
    });

    await o.runNext("worker-a", { jobId: enq.jobId });
    let status = await o.status(enq.jobId);
    expect(status?.status).toBe("RETRYING");
    expect(status?.attempts).toBe(1);

    await o.runNext("worker-a", { jobId: enq.jobId });
    status = await o.status(enq.jobId);
    expect(status?.status).toBe("RETRYING");
    expect(status?.attempts).toBe(2);

    await o.runNext("worker-a", { jobId: enq.jobId });
    status = await o.status(enq.jobId);
    expect(status?.status).toBe("SUCCESS");
    expect(status?.attempts).toBe(3);
    expect((status?.result?.data as any)?.attempts).toBe(3);
  });

  it("dead-letters a job that exhausts its retry budget and never reruns it automatically", async () => {
    const o = orch(echoWorker());
    failCounts.delete("always-fails");
    const enq = await o.enqueue({
      kind: "BUILD_TEST",
      input: { value: "always-fails", failTimes: 99 },
      maxAttempts: 2,
      retryPolicy: { baseMs: 0, factor: 1, maxDelayMs: 1, jitter: 0 },
    });
    await o.runNext("worker-a", { jobId: enq.jobId });
    await o.runNext("worker-a", { jobId: enq.jobId });

    const status = await o.status(enq.jobId);
    expect(status?.status).toBe("DEAD_LETTER");
    expect(status?.attempts).toBe(2);
    expect(status?.lastError).toBe("TRANSIENT");
    expect(status?.deadLetterReason).toContain("TRANSIENT");
    expect(status?.deadLetteredAt).not.toBeNull();

    expect(await o.runNext("worker-a", { jobId: enq.jobId })).toBeNull();
    expect((await o.status(enq.jobId))?.attempts).toBe(2);
  });

  it("never retries a non-retryable error code", async () => {
    const o = orch(
      echoWorker({
        kind: "SECURITY_ANALYSIS",
        requiredScopes: ["repo:read"],
        inputSchema: z.object({}),
        defaultMaxAttempts: 5,
        handler: async () => contracts.fail("FORBIDDEN", "actor may not do this"),
      } as Partial<WorkerDefinition<any, any>>),
    );
    const enq = await o.enqueue({ kind: "SECURITY_ANALYSIS", input: {}, maxAttempts: 5 });
    await o.runNext("worker-a", { jobId: enq.jobId });
    const status = await o.status(enq.jobId);
    expect(status?.status).toBe("FAILED");
    expect(status?.attempts).toBe(1);
    expect(status?.lastError).toBe("FORBIDDEN");
  });

  it("does not claim a job whose backoff window has not elapsed", async () => {
    const o = orch(echoWorker());
    failCounts.delete("slow-backoff");
    const enq = await o.enqueue({
      kind: "BUILD_TEST",
      input: { value: "slow-backoff", failTimes: 1 },
      maxAttempts: 3,
      retryPolicy: { baseMs: 60_000, factor: 2, maxDelayMs: 120_000, jitter: 0 },
    });
    await o.runNext("worker-a", { jobId: enq.jobId });
    expect((await o.status(enq.jobId))?.status).toBe("RETRYING");
    expect(await o.claim("worker-b", { jobId: enq.jobId })).toBeNull();
  });

  it("requeues a job whose worker lost its lease, and dead-letters it once the budget is gone", async () => {
    const o = new Orchestrator({ leaseBufferMs: 0 }).withWorker(echoWorker());
    const enq = await o.enqueue({
      kind: "BUILD_TEST",
      input: { value: "abandoned" },
      maxAttempts: 2,
      retryPolicy: { baseMs: 0, factor: 1, maxDelayMs: 1, jitter: 0 },
    });

    await db.operationJob.update({
      where: { id: enq.jobId },
      data: { status: "RUNNING", attempts: 1, leasedBy: "worker-that-died", leaseExpiresAt: new Date(Date.now() - 1000), startedAt: new Date() },
    });

    const recovered = await o.recoverAbandoned();
    expect(recovered.requeued).toBe(1);
    expect(recovered.jobIds).toContain(enq.jobId);
    let status = await o.status(enq.jobId);
    expect(status?.status).toBe("RETRYING");
    expect(status?.lastError).toBe("LEASE_EXPIRED");
    expect(status?.leasedBy).toBeNull();

    await db.operationJob.update({
      where: { id: enq.jobId },
      data: { status: "RUNNING", attempts: 2, leasedBy: "worker-that-died-again", leaseExpiresAt: new Date(Date.now() - 1000) },
    });
    const second = await o.recoverAbandoned();
    expect(second.deadLettered).toBe(1);
    status = await o.status(enq.jobId);
    expect(status?.status).toBe("DEAD_LETTER");
    expect(status?.deadLetterReason).toContain("lease expired");
  });

  it("requeues a dead letter only through an explicit, audited human action", async () => {
    const o = orch(echoWorker());
    failCounts.delete("requeue-me");
    const enq = await o.enqueue({
      kind: "BUILD_TEST",
      input: { value: "requeue-me", failTimes: 99 },
      maxAttempts: 1,
      retryPolicy: { baseMs: 0, factor: 1, maxDelayMs: 1, jitter: 0 },
    });
    await o.runNext("worker-a", { jobId: enq.jobId });
    expect((await o.status(enq.jobId))?.status).toBe("DEAD_LETTER");

    expect(await o.requeueDeadLetter(enq.jobId, ADMIN, "reviewed")).toBe(true);
    const status = await o.status(enq.jobId);
    expect(status?.status).toBe("QUEUED");
    expect(status?.attempts).toBe(0);
    expect(status?.deadLetterReason).toBeNull();
    expect(status?.events.some((e: any) => e.message.includes(`requeued from dead letter by ${ADMIN.email}`))).toBe(true);

    const audit = await db.auditLog.findFirst({ where: { action: "JOB_REQUEUED", resourceId: enq.jobId } });
    expect(audit).not.toBeNull();
    expect(audit!.actorEmail).toBe(ADMIN.email);
    expect(audit!.actorUserId).toBe(ADMIN.id);
  });

  it("serializes two jobs that share a lock key", async () => {
    const o = new Orchestrator({ maxConcurrentPerKey: 1 }).withWorker(echoWorker());
    const lockKey = `project-${crypto.randomUUID()}`;
    const a = await o.enqueue({ kind: "BUILD_TEST", input: { value: "serial-a" }, lockKey });
    const b = await o.enqueue({ kind: "BUILD_TEST", input: { value: "serial-b" }, lockKey });

    expect(await o.claim("worker-a", { lockKey })).toBe(a.jobId);
    // While the first holds its lease the second must not be claimable.
    expect(await o.claim("worker-b", { lockKey })).toBeNull();

    await o.complete(a.jobId, "worker-a", contracts.ok({ done: true }, "finished"));
    expect(await o.claim("worker-b", { lockKey })).toBe(b.jobId);
    await o.complete(b.jobId, "worker-b", contracts.ok({ done: true }, "finished"));
  });

  it("lets two jobs run concurrently when they use different lock keys", async () => {
    const o = new Orchestrator({ maxConcurrentPerKey: 1 }).withWorker(echoWorker());
    const a = await o.enqueue({ kind: "BUILD_TEST", input: { value: "par-a" }, lockKey: `p-${crypto.randomUUID()}` });
    const b = await o.enqueue({ kind: "BUILD_TEST", input: { value: "par-b" }, lockKey: `p-${crypto.randomUUID()}` });
    expect(await o.claimSpecific("worker-a", a.jobId)).toBe(a.jobId);
    expect(await o.claimSpecific("worker-b", b.jobId)).toBe(b.jobId);
    await o.complete(a.jobId, "worker-a", contracts.ok({}, "done"));
    await o.complete(b.jobId, "worker-b", contracts.ok({}, "done"));
  });

  it("gates PRIVILEGED work behind a named human approval", async () => {
    const o = orch(privilegedWorker());
    const enq = await o.enqueue({ kind: "INFRASTRUCTURE", input: { unit: "alo-hosting-panel.service" } });
    expect(enq.requiresApproval).toBe(true);
    expect(enq.status).toBe("WAITING_APPROVAL");
    expect(await o.claim("worker-a", { jobId: enq.jobId })).toBeNull();

    const approved = await o.approve(enq.jobId, ADMIN, "scheduled window");
    expect(approved.ok).toBe(true);

    expect(await o.runNext("worker-a", { jobId: enq.jobId })).toBe(enq.jobId);
    const status = await o.status(enq.jobId);
    expect(status?.status).toBe("SUCCESS");
    expect(status?.approvedBy).toBe(ADMIN.email);

    const audit = await db.auditLog.findFirst({ where: { action: "JOB_APPROVED", resourceId: enq.jobId } });
    expect(audit?.actorEmail).toBe(ADMIN.email);
  });

  it("never lets a caller lower the risk below what the worker declared", async () => {
    const o = orch(privilegedWorker());
    const enq = await o.enqueue({
      kind: "INFRASTRUCTURE",
      input: { unit: "sneaky.service" },
      riskLevel: "READ_ONLY", // an attacker-supplied label must not bypass the gate
    });
    expect(enq.requiresApproval).toBe(true);
    expect((await o.status(enq.jobId))?.riskLevel).toBe("PRIVILEGED");
    await o.cancel(enq.jobId, ADMIN);
  });

  it("records a rejection without ever running the job", async () => {
    const o = orch(privilegedWorker());
    const enq = await o.enqueue({ kind: "INFRASTRUCTURE", input: { unit: "rejected.service" } });
    expect((await o.reject(enq.jobId, ADMIN, "not during business hours")).ok).toBe(true);
    const status = await o.status(enq.jobId);
    expect(status?.status).toBe("FAILED");
    expect(status?.lastError).toBe("APPROVAL_REJECTED");
    expect(status?.error).toContain("not during business hours");
    expect(await o.claim("worker-a", { jobId: enq.jobId })).toBeNull();
  });

  it("cancels an active job and refuses to cancel a finished one", async () => {
    const o = orch(echoWorker());
    const enq = await o.enqueue({ kind: "BUILD_TEST", input: { value: "cancel-me" } });
    expect(await o.cancel(enq.jobId, ADMIN, "changed my mind")).toBe(true);
    expect((await o.status(enq.jobId))?.status).toBe("CANCELLED");
    expect(await o.cancel(enq.jobId, ADMIN)).toBe(false);
  });

  it("redacts secrets from every persisted progress event", async () => {
    process.env.GITHUB_TOKEN = "ghp_SUPERSECRETTOKENVALUE1234567890";
    const leaky = contracts.defineWorker({
      kind: "RELEASE",
      label: "leaky",
      description: "test worker",
      execution: "LOCAL",
      maxRisk: "READ_ONLY",
      requiredScopes: ["release:write"],
      inputSchema: z.object({}),
      handler: async (_input: unknown, ctx: WorkerContext) => {
        await ctx.progress(50, "cloning with token ghp_SUPERSECRETTOKENVALUE1234567890");
        await ctx.progress(70, "authorization: Bearer abcdefghijklmnopqrstuvwxyz012345");
        return contracts.ok({ done: true }, "finished with password=hunter2secretvalue");
      },
    } as WorkerDefinition<any, any>);

    const o = orch(leaky);
    const enq = await o.enqueue({ kind: "RELEASE", input: {} });
    await o.runNext("worker-a", { jobId: enq.jobId });
    const status = await o.status(enq.jobId);
    const persisted = JSON.stringify(status?.events ?? []);
    expect(persisted).not.toContain("ghp_SUPERSECRETTOKENVALUE1234567890");
    expect(persisted).toContain("[REDACTED");
    delete process.env.GITHUB_TOKEN;
  });

  it("reports queue depth per state, including dead letters and pending approvals", async () => {
    const o = orch(privilegedWorker());
    await o.enqueue({ kind: "INFRASTRUCTURE", input: { unit: "depth.service" } });
    const depth = await o.queueDepth();
    expect(depth.byState).toBeDefined();
    expect(depth.waitingApproval).toBeGreaterThan(0);
    expect(typeof depth.active).toBe("number");
    expect(typeof depth.deadLetters).toBe("number");
  });
});

describe("backoff maths", () => {
  it("grows exponentially and never exceeds the ceiling", () => {
    const policy = { baseMs: 1000, factor: 2, maxDelayMs: 10_000, jitter: 0 };
    expect(contracts.computeBackoffDelay(policy, 1, () => 0.5)).toBe(1000);
    expect(contracts.computeBackoffDelay(policy, 2, () => 0.5)).toBe(2000);
    expect(contracts.computeBackoffDelay(policy, 3, () => 0.5)).toBe(4000);
    expect(contracts.computeBackoffDelay(policy, 9, () => 0.5)).toBe(10_000);
  });

  it("jitter decorrelates concurrent retries without going negative", () => {
    const policy = { baseMs: 1000, factor: 2, maxDelayMs: 60_000, jitter: 0.5 };
    const seen = new Set<number>();
    for (let i = 0; i < 50; i++) {
      const value = contracts.computeBackoffDelay(policy, 3);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(8000);
      seen.add(value);
    }
    expect(seen.size).toBeGreaterThan(1);
  });

  it("classifies retryable and non-retryable codes", () => {
    expect(contracts.isRetryable("TIMEOUT")).toBe(true);
    expect(contracts.isRetryable("AGENT_TASK_PENDING")).toBe(true);
    expect(contracts.isRetryable(null)).toBe(true);
    for (const code of contracts.NON_RETRYABLE_CODES) expect(contracts.isRetryable(code)).toBe(false);
  });
});

// ── The production worker catalogue ─────────────────────────────────────────

describe("worker catalogue", () => {
  it("registers all ten specialized workers with declared risk and scopes", () => {
    const list = listWorkers();
    expect(list.map((w) => w.kind).sort()).toEqual(
      [
        "BACKUP_RESTORE",
        "BUILD_TEST",
        "DATABASE_OPS",
        "DOMAIN_TLS",
        "FRAMEWORK_DETECTION",
        "INFRASTRUCTURE",
        "MONITORING_RECOVERY",
        "RELEASE",
        "REPO_DISCOVERY",
        "SECURITY_ANALYSIS",
      ].sort(),
    );
    for (const worker of list) {
      expect(worker.requiredScopes.length).toBeGreaterThan(0);
      expect(["LOCAL", "AGENT", "EXTERNAL"]).toContain(worker.execution);
      expect(["READ_ONLY", "REVERSIBLE", "PRIVILEGED", "DESTRUCTIVE"]).toContain(worker.maxRisk);
      expect(worker.description.length).toBeGreaterThan(20);
    }
  });

  it("security analysis fails a release that carries a committed secret", async () => {
    const worker = getWorker("SECURITY_ANALYSIS")!;
    const input = worker.inputSchema.parse({
      files: {
        "src/config.ts": 'export const token = "ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ012345";',
        "docker-compose.yml": "services:\n  app:\n    privileged: true\n    volumes:\n      - /var/run/docker.sock:/var/run/docker.sock\n",
        ".env": "DATABASE_URL=postgres://user:pass@db:5432/app\n",
        "next.config.ts": "export default { typescript: { ignoreBuildErrors: true } };",
        "README.md": "a perfectly normal readme",
      },
    });
    const result = await worker.handler(input, makeCtx("job-sec"));
    expect(result.ok).toBe(false);
    expect(result.code).toBe("SECURITY_CRITICAL");
    // The secret value itself must never be echoed back into a result or a log.
    expect(JSON.stringify(result)).not.toContain("ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ012345");
    const titles = (result.findings ?? []).map((f: any) => f.title);
    expect(titles.some((t: string) => t.includes("GitHub token"))).toBe(true);
    expect(titles.some((t: string) => t.includes("Docker socket mounted"))).toBe(true);
    expect(titles.some((t: string) => t.includes("Privileged container"))).toBe(true);
    expect(titles.some((t: string) => t.includes("Committed .env file"))).toBe(true);
    expect(titles.some((t: string) => t.includes("Build error checking disabled"))).toBe(true);
  });

  it("security analysis passes a clean tree and states its evidence", async () => {
    const worker = getWorker("SECURITY_ANALYSIS")!;
    const input = worker.inputSchema.parse({
      files: { "package.json": '{"name":"clean","scripts":{"build":"vite build"}}', "index.html": "<h1>hi</h1>" },
    });
    const result = await worker.handler(input, makeCtx("job-clean"));
    expect(result.ok).toBe(true);
    expect(result.verified).toBe(true);
    expect((result.data as any).scannedFiles).toBe(2);
    expect(result.evidence).toContain("2 file(s)");
  });

  it("framework detection reports ambiguity instead of guessing", async () => {
    const worker = getWorker("FRAMEWORK_DETECTION")!;
    const clear = worker.inputSchema.parse({
      files: { "package.json": '{"name":"x","scripts":{"dev":"next dev","build":"next build"},"dependencies":{"next":"15.0.0","react":"19.0.0"}}' },
    });
    const clearResult = await worker.handler(clear, makeCtx("job-detect"));
    expect(clearResult.ok).toBe(true);
    expect(String((clearResult.data as any).framework).toLowerCase()).toContain("next");

    const ambiguous = worker.inputSchema.parse({ files: { "package.json": '{"name":"y"}' } });
    const ambiguousResult = await worker.handler(ambiguous, makeCtx("job-detect-2"));
    // Ambiguous detection must never be presented as a verified, ready manifest.
    expect(ambiguousResult.verified).toBe(false);
    expect((ambiguousResult.findings ?? []).some((f: any) => f.severity === "critical")).toBe(true);
  });

  it("backup verification computes a real checksum and refuses an unreadable artifact", async () => {
    const worker = getWorker("BACKUP_RESTORE")!;
    const file = path.join(root, "artifact.sql");
    await fs.writeFile(file, "CREATE TABLE t(id INT);\n");
    const expected = crypto.createHash("sha256").update(await fs.readFile(file)).digest("hex");

    const result = await worker.handler(worker.inputSchema.parse({ action: "verify", path: file }), makeCtx("job-backup"));
    expect(result.ok).toBe(true);
    expect(result.verified).toBe(true);
    expect((result.data as any).digest).toBe(expected);
    expect(result.evidence).toContain(expected.slice(0, 12));

    const missing = await worker.handler(
      worker.inputSchema.parse({ action: "verify", path: path.join(root, "does-not-exist.sql") }),
      makeCtx("job-backup-2"),
    );
    expect(missing.ok).toBe(false);
    expect(missing.code).toBe("BACKUP_UNREADABLE");
    expect(missing.message).toContain("NOT verified");
  });

  it("database and domain workers report a real blocker rather than a fake success", async () => {
    const dbWorker = getWorker("DATABASE_OPS")!;
    const audit = await dbWorker.handler(dbWorker.inputSchema.parse({ action: "audit" }), makeCtx("job-db"));
    expect(audit.ok).toBe(true);
    expect(audit.verified).toBe(false);
    expect(audit.message.toLowerCase()).toContain("no replication audit has been recorded");

    await expect(dbWorker.handler(dbWorker.inputSchema.parse({ action: "restore" }), makeCtx("job-db-2"))).rejects.toMatchObject({
      code: "AGENT_UNAVAILABLE",
    });

    const plan = await dbWorker.handler(dbWorker.inputSchema.parse({ action: "plan-migration", notes: "sqlite→mysql" }), makeCtx("job-db-3"));
    expect(plan.ok).toBe(true);
    expect((plan.data as any).plan.length).toBeGreaterThan(3);
    expect((plan.data as any).rollbackLimitations).toBeTruthy();

    delete process.env.CLOUDFLARE_API_TOKEN;
    delete process.env.CLOUDFLARE_ZONE_ID;
    const domainWorker = getWorker("DOMAIN_TLS")!;
    await expect(
      domainWorker.handler(domainWorker.inputSchema.parse({ action: "issue-certificate", domain: "example.test" }), makeCtx("job-domain")),
    ).rejects.toMatchObject({ code: "NOT_CONFIGURED" });

    const preview = await domainWorker.handler(
      domainWorker.inputSchema.parse({ action: "plan-dns", domain: "example.test" }),
      makeCtx("job-domain-2"),
    );
    expect(preview.ok).toBe(true);
    expect((preview.data as any).approvalRequired).toBe(true);
  });

  it("monitoring performs a real HTTP health check and confirms release identity", async () => {
    const worker = getWorker("MONITORING_RECOVERY")!;
    const sha = "a".repeat(40);

    const server = http.createServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end(`ok ${sha}`);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as any).port;
    try {
      const result = await worker.handler(
        worker.inputSchema.parse({ action: "check", url: `http://127.0.0.1:${port}/`, expectedCommitSha: sha }),
        makeCtx("job-health"),
      );
      expect(result.ok).toBe(true);
      expect(result.verified).toBe(true);
      expect((result.data as any).markerCommit).toBe(sha);
      expect(result.evidence).toContain("http=200");

      const mismatch = await worker.handler(
        worker.inputSchema.parse({ action: "check", url: `http://127.0.0.1:${port}/`, expectedCommitSha: "b".repeat(40) }),
        makeCtx("job-health-2"),
      );
      expect(mismatch.ok).toBe(false);
      expect(mismatch.code).toBe("RELEASE_IDENTITY_MISMATCH");
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }

    const down = await worker.handler(worker.inputSchema.parse({ action: "check", url: "http://127.0.0.1:1/" }), makeCtx("job-health-3"));
    expect(down.ok).toBe(false);
    expect(down.code).toBe("HEALTHCHECK_UNREACHABLE");
  });

  it("release worker refuses to invent an identity when there is no active release", async () => {
    const worker = getWorker("RELEASE")!;
    const result = await worker.handler(worker.inputSchema.parse({ projectId: "no-such-project" }), makeCtx("job-release"));
    expect(result.ok).toBe(false);
    expect(result.code).toBe("NO_ACTIVE_RELEASE");
  });

  it("infrastructure worker refuses an unauthorized command before any host is touched", async () => {
    const worker = getWorker("INFRASTRUCTURE")!;
    const agent = await db.serverAgent.create({
      data: { name: "test-host", agentKey: `alo_agt_${crypto.randomBytes(8).toString("hex")}`, secretEnc: "unused", status: "active", capabilities: "[]", scopes: "[]" },
    });
    await expect(
      worker.handler(worker.inputSchema.parse({ agentId: agent.id, command: "rm -rf /" }), makeCtx("job-infra")),
    ).rejects.toMatchObject({ code: "REFUSED_BY_ALLOWLIST" });

    const refused = await db.agentTask.findFirst({ where: { agentId: agent.id, status: "REFUSED" } });
    expect(refused).not.toBeNull();
    expect(refused.refuseReason).toContain("not in the platform allowlist");
  });
});

// ── The real deployment engine, driven through the orchestrator ─────────────

describe("BUILD_TEST worker drives the verified deployment engine", () => {
  it("deploys a good commit, then fails a broken one without replacing it", async () => {
    const { setupHarness, makeGitRepo } = await import("./helpers/deploy-harness");
    const h = await setupHarness();
    try {
      const shas = await makeGitRepo(path.join(h.root, "source"));
      const { detectFramework, memoryReader } = await import("../src/lib/deploy/detect");
      const { configFromDetection, validateDeployConfig } = await import("../src/lib/deploy/config");
      const detection = await detectFramework(memoryReader({ "index.html": "<h1>static</h1>" }));
      const config = validateDeployConfig({
        ...configFromDetection(detection),
        port: h.port,
        serviceManager: "static",
        requiresApproval: false,
        confirmedBy: "test@example.com",
        source: "operator",
      });
      const website = await h.db.website.create({
        data: { domain: `orch-${Date.now()}.staging.local`, name: "orchestrator test site", runtime: "STATIC", status: "ACTIVE" },
      });
      const repo = `acme/orchestrator-test-${Date.now()}`;
      const project = await h.db.gitProject.create({
        data: {
          websiteId: website.id,
          repository: repo,
          cloneUrl: `file://${path.join(h.root, "source")}`,
          productionBranch: "main",
          config: JSON.stringify(config),
          detection: JSON.stringify(detection),
          detectionStatus: "confirmed",
          serviceManager: "static",
          port: h.port,
          releaseRoot: path.join(h.releaseBase, repo),
        },
      });

      const worker = getWorker("BUILD_TEST")!;

      const dep1 = await h.db.deployment.create({
        data: { websiteId: website.id, projectId: project.id, status: "PENDING", stage: "queued", commitHash: shas.sha1, branch: "main", configSnapshot: project.config },
      });
      const good = await worker.handler(worker.inputSchema.parse({ deploymentId: dep1.id }), makeCtx("job-build-1"));
      expect(good.ok).toBe(true);
      expect(good.verified).toBe(true);
      expect((good.data as any).verifiedCommitSha).toBe(shas.sha1);

      const dep2 = await h.db.deployment.create({
        data: { websiteId: website.id, projectId: project.id, status: "PENDING", stage: "queued", commitHash: shas.sha3, branch: "main", configSnapshot: project.config },
      });
      const broken = await worker.handler(worker.inputSchema.parse({ deploymentId: dep2.id }), makeCtx("job-build-2"));
      expect(broken.ok).toBe(false);
      expect(["BUILD_FAILED", "ROLLED_BACK"]).toContain(broken.code);
      expect(broken.message).toContain("previous release was left live");

      const live = await fetch(`http://127.0.0.1:${h.port}/__alo_release.json`).then((r) => r.json());
      expect(live.commitSha).toBe(shas.sha1);
    } finally {
      await h.cleanup();
    }
  }, 120_000);
});
