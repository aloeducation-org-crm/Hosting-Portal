/**
 * Shared job contracts for every specialized worker.
 *
 * One rule drives this whole file: **an AI model may recommend and classify,
 * but deterministic code enforces authorization, validation and execution
 * limits.** Every worker therefore declares, in code, what it is allowed to
 * touch and how dangerous that is — and the orchestrator refuses to run a job
 * whose payload does not validate against the worker's own schema.
 */
import { z } from "zod";

export const WORKER_KINDS = [
  "REPO_DISCOVERY",
  "FRAMEWORK_DETECTION",
  "BUILD_TEST",
  "SECURITY_ANALYSIS",
  "RELEASE",
  "INFRASTRUCTURE",
  "DATABASE_OPS",
  "DOMAIN_TLS",
  "MONITORING_RECOVERY",
  "BACKUP_RESTORE",
] as const;

export type WorkerKind = (typeof WORKER_KINDS)[number];

export const RISK_LEVELS = ["READ_ONLY", "REVERSIBLE", "PRIVILEGED", "DESTRUCTIVE"] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

/**
 * Where a worker is allowed to execute.
 *
 * `LOCAL`    — deterministic code inside the panel process (safe, testable).
 * `AGENT`    — must be dispatched to an enrolled, allowlisted server agent.
 * `EXTERNAL` — needs a third-party credential (registrar, CA, cloud API).
 *
 * A worker that is not `LOCAL` never pretends to have succeeded: the
 * orchestrator fails the job with an explicit, actionable reason instead.
 */
export const EXECUTION_MODES = ["LOCAL", "AGENT", "EXTERNAL"] as const;
export type ExecutionMode = (typeof EXECUTION_MODES)[number];

export const JOB_STATES = [
  "QUEUED",
  "VALIDATING",
  "WAITING_APPROVAL",
  "RUNNING",
  "VERIFYING",
  "RETRYING",
  "SUCCESS",
  "FAILED",
  "CANCELLED",
  "ROLLING_BACK",
  "ROLLED_BACK",
  "DEAD_LETTER",
] as const;
export type JobState = (typeof JOB_STATES)[number];

export const TERMINAL_STATES: readonly JobState[] = [
  "SUCCESS",
  "FAILED",
  "CANCELLED",
  "ROLLED_BACK",
  "DEAD_LETTER",
];

export const ACTIVE_STATES: readonly JobState[] = [
  "QUEUED",
  "VALIDATING",
  "WAITING_APPROVAL",
  "RUNNING",
  "VERIFYING",
  "RETRYING",
  "ROLLING_BACK",
];

/** Permission scopes a worker may require. Granted to actors, never inferred. */
export const SCOPES = [
  "repo:read",
  "build:run",
  "release:write",
  "server:read",
  "server:execute",
  "database:read",
  "database:admin",
  "domain:read",
  "domain:write",
  "backup:read",
  "backup:write",
  "backup:restore",
  "monitoring:read",
  "recovery:execute",
] as const;
export type Scope = (typeof SCOPES)[number];

export interface RetryPolicy {
  /** Milliseconds before the first retry. */
  baseMs: number;
  /** Multiplicative factor per attempt. */
  factor: number;
  /** Hard ceiling so a stuck job cannot schedule itself a day ahead. */
  maxDelayMs: number;
  /** 0..1 — fraction of the delay randomised to avoid retry stampedes. */
  jitter: number;
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  baseMs: 2_000,
  factor: 2,
  maxDelayMs: 5 * 60_000,
  jitter: 0.2,
};

/** Errors that should never be retried: a second attempt cannot help. */
export const NON_RETRYABLE_CODES = [
  "VALIDATION_FAILED",
  "UNAUTHORIZED",
  "FORBIDDEN",
  "NOT_FOUND",
  "APPROVAL_REJECTED",
  "REFUSED_BY_ALLOWLIST",
  "TENANT_MISMATCH",
] as const;

export const retryPolicySchema = z.object({
  baseMs: z.number().int().min(0).max(3_600_000),
  factor: z.number().min(1).max(10),
  maxDelayMs: z.number().int().min(0).max(86_400_000),
  jitter: z.number().min(0).max(0.9),
});

export function computeBackoffDelay(
  policy: RetryPolicy,
  attempt: number,
  rand: () => number = Math.random,
): number {
  const safeAttempt = Math.max(1, Math.floor(attempt));
  const raw = policy.baseMs * Math.pow(policy.factor, safeAttempt - 1);
  const capped = Math.min(raw, policy.maxDelayMs);
  // "Full-ish" jitter: keep most of the delay but decorrelate concurrent workers.
  const spread = capped * policy.jitter;
  const delta = (rand() * 2 - 1) * spread;
  return Math.max(0, Math.round(capped + delta));
}

export function isRetryable(code?: string | null): boolean {
  if (!code) return true;
  return !(NON_RETRYABLE_CODES as readonly string[]).includes(code);
}

/**
 * Every worker returns this envelope. `verified` is what keeps the dashboard
 * honest: a worker that could not confirm its own outcome must not claim
 * success, and the UI shows "unverified" rather than a green tick.
 */
export interface WorkerResult<T = unknown> {
  ok: boolean;
  /** Machine-readable, from a small controlled vocabulary. */
  code: string;
  /** Human-readable, already redacted of secrets. */
  message: string;
  data?: T;
  /** True only when the outcome was confirmed by an independent observation. */
  verified: boolean;
  /** How the outcome was verified, when it was. */
  evidence?: string;
  /** Structured findings (security, detection, health) for the UI. */
  findings?: JobFinding[];
  /**
   * Shallow-merged into the stored job input before a retry, so an attempt can
   * hand the next one a handle (a dispatched task id, a resolved path) instead
   * of repeating work. Values are validated again on the next attempt.
   */
  mergeInput?: Record<string, unknown>;
  /** Non-fatal problems worth surfacing without failing the job. */
  warnings?: string[];
  durationMs?: number;
}

export interface JobFinding {
  severity: "info" | "warning" | "critical";
  title: string;
  detail?: string;
  remediation?: string;
}

export function ok<T>(data: T, evidence: string, extra: Partial<WorkerResult<T>> = {}): WorkerResult<T> {
  return { ok: true, code: "OK", message: evidence, data, verified: true, evidence, ...extra };
}

export function unverified<T>(data: T, message: string, extra: Partial<WorkerResult<T>> = {}): WorkerResult<T> {
  return { ok: true, code: "OK_UNVERIFIED", message, data, verified: false, ...extra };
}

export function fail(code: string, message: string, extra: Partial<WorkerResult> = {}): WorkerResult {
  return { ok: false, code, message, verified: false, ...extra };
}

export class WorkerError extends Error {
  constructor(
    public code: string,
    message: string,
    public retryable: boolean = isRetryable(code),
    public details?: unknown,
  ) {
    super(message);
    this.name = "WorkerError";
  }
}

/** Anything a worker needs to run, handed over by the orchestrator. */
export interface WorkerContext {
  jobId: string;
  correlationId: string;
  actor?: { id: string; email: string; role: string } | null;
  /** Report structured progress; persisted and redacted by the orchestrator. */
  progress: (percent: number, message: string) => Promise<void>;
  /** Enrolled agents that are currently reachable, for AGENT-mode workers. */
  onlineAgents: () => Promise<Array<{ id: string; name: string; capabilities: string[] }>>;
}

export interface WorkerDefinition<TInput = unknown, TOutput = unknown> {
  kind: WorkerKind;
  /** Human label for the dashboard. */
  label: string;
  description: string;
  execution: ExecutionMode;
  /** Highest risk this worker can ever perform. Drives the approval gate. */
  maxRisk: RiskLevel;
  requiredScopes: Scope[];
  inputSchema: z.ZodType<TInput>;
  /** Defaults merged into every job of this kind unless the caller overrides. */
  defaultMaxAttempts?: number;
  defaultTimeoutMs?: number;
  handler: (input: TInput, ctx: WorkerContext) => Promise<WorkerResult<TOutput>>;
}

export function defineWorker<TInput, TOutput>(
  def: WorkerDefinition<TInput, TOutput>,
): WorkerDefinition<TInput, TOutput> {
  return def;
}

/** Risk ordering used to decide whether an approval gate is required. */
export const RISK_ORDER: Record<RiskLevel, number> = {
  READ_ONLY: 0,
  REVERSIBLE: 1,
  PRIVILEGED: 2,
  DESTRUCTIVE: 3,
};

export function riskAtLeast(level: RiskLevel, minimum: RiskLevel): boolean {
  return RISK_ORDER[level] >= RISK_ORDER[minimum];
}
