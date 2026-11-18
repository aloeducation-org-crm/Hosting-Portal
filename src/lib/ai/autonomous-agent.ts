/**
 * Autonomous coding agent.
 *
 * Mirrors how a chat agent completes work: a task goes in, the model generates
 * code, the changes are applied, checks are run, and the outcome is reported
 * honestly. Unlike the propose-only `code-evolution.ts` path, this agent actually
 * writes files and runs verification — but every step is gated by the same
 * deterministic safety model:
 *
 *  - Generation is scoped to an explicit, immutable file snapshot.
 *  - Every change path is re-checked against `safePath` / `protectedPath` and the
 *    allowed scope before it touches disk, so a model cannot write outside the
 *    granted scope or into protected areas (deploy/, agents/, security/, …).
 *  - Applies are atomic per file and refuse to overwrite content that no longer
 *    matches the verified baseline (no silent drift).
 *  - Verification is real: a check that did not run is never reported as passed.
 *
 * The agent is intentionally a *bounded* loop (one generation → apply → verify
 * pass) rather than a self-modifying repair loop, keeping its blast radius small
 * and its behaviour auditable.
 */
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { AIMessage } from "./client";
import {
  contentSha256,
  protectedPath,
  safePath,
  type CodeChangeContext,
} from "./code-change-proposal";

/** A single file change the model is allowed to propose. */
export const agentChangeSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("add"),
    path: z.string().min(1).max(240),
    content: z.string().min(1).max(65_536),
  }).strict(),
  z.object({
    action: z.literal("update"),
    path: z.string().min(1).max(240),
    beforeSha256: z.string().regex(/^[a-f0-9]{64}$/),
    content: z.string().min(1).max(65_536),
  }).strict(),
]);

/** The model's structured response for one autonomous coding task. */
export const agentProposalSchema = z
  .object({
    summary: z.string().trim().min(1).max(2000),
    changes: z.array(agentChangeSchema).min(0).max(20),
    checks: z.array(z.enum(["lint", "typecheck", "test", "build"])).min(0).max(4),
  })
  .strict();

/** What the agent needs to run one bounded task. */
export const autonomousTaskSchema = z
  .object({
    /** The task, in plain language — exactly what a chat agent receives. */
    instruction: z.string().trim().min(1).max(8000),
    /** Absolute workspace root the agent may write inside. */
    workspaceRoot: z.string().min(1).max(512),
    /** Trusted server-side scope: exact paths + their verified snapshot. */
    scope: z.object({
      projectId: z.string().min(1).max(128),
      baseCommit: z.string().regex(/^[a-f0-9]{40}$/),
      allowedPaths: z.array(z.string().min(1).max(240)).min(1).max(20),
      snapshot: z.record(z.string(), z.union([z.string(), z.null()])),
    }),
    /** Which provider to use for generation. */
    providerId: z.string().regex(/^[a-z0-9-]{1,64}$/),
  })
  .strict();

export type AutonomousTask = z.infer<typeof autonomousTaskSchema>;
export type AgentProposal = z.infer<typeof agentProposalSchema>;

/** Result of a single check run. `passed` is only true when it actually ran. */
export interface CheckResult {
  kind: "lint" | "typecheck" | "test" | "build";
  passed: boolean;
  ran: boolean;
  detail: string;
}

/** Outcome of one autonomous coding task. */
export interface AutonomousAgentResult {
  ok: boolean;
  code: string;
  message: string;
  summary: string;
  applied: Array<{ path: string; action: "add" | "update" }>;
  checks: CheckResult[];
  verified: boolean;
  generation: { provider: string; model: string; requestId: string } | null;
  warnings?: string[];
}

/** Injected so tests can stub generation and command execution. */
export interface AutonomousAgentDeps {
  generate: (messages: AIMessage[], options?: Record<string, unknown>) => Promise<{
    data: unknown;
    completion: { provider: string; model: string; requestId: string };
  }>;
  runCheck: (kind: CheckResult["kind"], workspaceRoot: string) => Promise<CheckResult>;
}

const SYSTEM_PROMPT = `You are an autonomous coding agent inside a hosting control panel. You receive a task and the current contents of a small, explicitly scoped set of files. You implement the task by returning file changes only — you never run shell commands, delete files, alter security or deployment policy, or claim a check passed that you did not run.

Return ONLY a JSON object:
{
  "summary": "one or two sentences describing the change",
  "changes": [
    { "action": "add", "path": "<relative path>", "content": "<full new file content>" },
    { "action": "update", "path": "<relative path>", "beforeSha256": "<sha256 of current content>", "content": "<full replacement content>" }
  ],
  "checks": ["lint", "typecheck", "test", "build"]
}

Rules:
- Only touch paths present in the provided scope. Use the exact beforeSha256 for updates.
- Preserve existing behaviour and content unless the task requires changing it.
- Prefer minimal, correct changes. Do not rewrite unrelated code.
- If the task is already satisfied, return an empty changes array and an empty checks array.`;

function buildSnapshot(task: AutonomousTask): CodeChangeContext {
  const snapshot = new Map<string, string | null>();
  for (const p of task.scope.allowedPaths) {
    snapshot.set(p, task.scope.snapshot[p] ?? null);
  }
  return {
    projectId: task.scope.projectId,
    baseCommit: task.scope.baseCommit,
    allowedPaths: task.scope.allowedPaths,
    snapshot,
  };
}

/** Validate model output against the trusted snapshot and the path guards. */
function validateProposal(proposal: AgentProposal, context: CodeChangeContext): AgentProposal {
  const seen = new Set<string>();
  for (const change of proposal.changes) {
    if (!safePath(change.path) || protectedPath(change.path)) {
      throw new Error(`Change path is protected or unsafe: ${change.path}`);
    }
    if (!context.allowedPaths.includes(change.path)) {
      throw new Error(`Change path is outside the permitted scope: ${change.path}`);
    }
    const key = change.path.toLowerCase();
    if (seen.has(key)) throw new Error(`Duplicate or case-colliding change path: ${change.path}`);
    seen.add(key);
    if (!context.snapshot.has(change.path)) {
      throw new Error(`Missing verified snapshot entry: ${change.path}`);
    }
    const existing = context.snapshot.get(change.path);
    if (change.action === "add" && existing !== null) {
      throw new Error(`An addition must not overwrite an existing file: ${change.path}`);
    }
    if (change.action === "update") {
      if (typeof existing !== "string" || contentSha256(existing) !== change.beforeSha256) {
        throw new Error(`Update does not match the verified original content: ${change.path}`);
      }
    }
    if (!change.content.trim() || change.content.includes("\u0000")) {
      throw new Error(`Empty or binary replacement is not permitted: ${change.path}`);
    }
  }
  return proposal;
}

/**
 * Run one bounded autonomous coding task: generate → validate → apply → verify.
 *
 * Never throws for "the work didn't fully succeed" — it returns an honest
 * `AutonomousAgentResult`. It only throws for hard safety violations (bad input
 * or a proposal that escapes its scope), which indicate a bug, not a normal
 * outcome.
 */
export async function runAutonomousCodingTask(
  input: unknown,
  deps: AutonomousAgentDeps,
  signal?: AbortSignal,
): Promise<AutonomousAgentResult> {
  const task = autonomousTaskSchema.parse(input);
  if (signal?.aborted) throw new Error("Autonomous coding task cancelled before generation.");

  const context = buildSnapshot(task);
  const allowed = new Set(task.scope.allowedPaths);

  const packet = {
    projectId: task.scope.projectId,
    baseCommit: task.scope.baseCommit,
    files: [...task.scope.allowedPaths].sort().map((p) => {
      const content = task.scope.snapshot[p] ?? null;
      return { path: p, content, beforeSha256: content === null ? null : contentSha256(content) };
    }),
  };

  const { data, completion } = await deps.generate(
    [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: JSON.stringify({ task: { instruction: task.instruction }, scope: packet }) },
    ],
    { onlyProviders: [task.providerId], retriesPerProvider: 0, maxTokens: 8192, timeoutMs: 60_000, temperature: 0, signal },
  );
  if (signal?.aborted) throw new Error("Autonomous coding task cancelled during generation.");
  if (completion.provider !== task.providerId) {
    throw new Error(`Unexpected provider "${completion.provider}"; refusing unapproved generation.`);
  }

  const proposal = validateProposal(agentProposalSchema.parse(data), context);

  if (proposal.changes.length === 0) {
    return {
      ok: true,
      code: "NO_CHANGES_NEEDED",
      message: "Task already satisfied; no file changes were required.",
      summary: proposal.summary,
      applied: [],
      checks: [],
      verified: true,
      generation: { provider: completion.provider, model: completion.model, requestId: completion.requestId },
    };
  }

  // Apply: resolve each path inside the workspace root and re-check it stays in
  // scope before writing. A symlink or `..` that escapes the root is refused.
  const applied: Array<{ path: string; action: "add" | "update" }> = [];
  const warnings: string[] = [];
  for (const change of proposal.changes) {
    const abs = path.resolve(task.workspaceRoot, change.path);
    const rel = path.relative(task.workspaceRoot, abs);
    if (rel.startsWith("..") || path.isAbsolute(rel)) {
      throw new Error(`Resolved path escapes the workspace root: ${change.path}`);
    }
    if (!allowed.has(change.path)) {
      throw new Error(`Refusing to write outside the granted scope: ${change.path}`);
    }
    if (protectedPath(change.path) || !safePath(change.path)) {
      throw new Error(`Refusing to write a protected or unsafe path: ${change.path}`);
    }

    if (change.action === "update") {
      let current: string;
      try {
        current = await fs.readFile(abs, "utf8");
      } catch {
        throw new Error(`Update target does not exist on disk: ${change.path}`);
      }
      if (contentSha256(current) !== change.beforeSha256) {
        throw new Error(`File changed since the snapshot; refusing to overwrite: ${change.path}`);
      }
    } else if (await exists(abs)) {
      throw new Error(`Cannot add a file that already exists: ${change.path}`);
    }

    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, change.content, "utf8");
    applied.push({ path: change.path, action: change.action });
  }

  // Verify: run the requested checks for real. A check that throws or is not
  // configured is reported as not-run, never as passed.
  const checks: CheckResult[] = [];
  for (const kind of proposal.checks) {
    try {
      checks.push(await deps.runCheck(kind, task.workspaceRoot));
    } catch (error) {
      checks.push({
        kind,
        passed: false,
        ran: false,
        detail: error instanceof Error ? error.message : "check could not run",
      });
    }
  }

  const failedChecks = checks.filter((c) => !c.passed);
  // Success = the apply completed and no requested check failed. With no checks
  // requested, the apply itself is the confirmed outcome.
  const ok = applied.length > 0 && failedChecks.length === 0;
  const evidence = checks.length
    ? `${checks.filter((c) => c.ran && c.passed).length}/${checks.length} checks passed`
    : "no checks requested";

  return {
    ok,
    code: ok ? "OK" : "CHECKS_FAILED",
    message: ok
      ? `Applied ${applied.length} change(s) and all requested checks passed (${evidence}).`
      : `Applied ${applied.length} change(s) but checks did not pass (${evidence}).`,
    summary: proposal.summary,
    applied,
    checks,
    verified: ok,
    generation: { provider: completion.provider, model: completion.model, requestId: completion.requestId },
    warnings: failedChecks.length ? failedChecks.map((c) => `${c.kind}: ${c.detail}`) : warnings,
  };
}

async function exists(abs: string): Promise<boolean> {
  try {
    await fs.access(abs);
    return true;
  } catch {
    return false;
  }
}

/** Re-exported for callers that want the digest helper without importing deeper. */
export { contentSha256 };
