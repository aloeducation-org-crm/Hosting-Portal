/**
 * Production wiring for the workflow engine: real AI client, read-only hosting
 * tools, and run persistence.
 *
 * The engine itself has no database or network dependency — this module is the
 * only place that knows about both, which keeps the engine unit-testable.
 *
 * Crash-resilience: step results are flushed to the AiWorkflowRun row as each
 * step completes (via the engine's onStepComplete hook), not only at the end.
 * A run interrupted mid-flight therefore retains its partial progress, and a
 * caller can resume it by passing `resumeFromRunId` — the engine re-loads the
 * succeeded steps and continues downstream.
 */

import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { completeWithAI } from "@/lib/ai/client";
import { createScopedHostingTools } from "./tools";
import { parseStoredWorkflow } from "./graph";
import { runWorkflowGraph, type StepResult, type WorkflowActor, type WorkflowRunResult } from "./engine";

export interface StoredWorkflow {
  id: string;
  name?: string | null;
  nodes?: string | null;
  edges?: string | null;
}

export interface ExecuteOptions {
  input?: unknown;
  dryRun?: boolean;
  trigger?: "manual" | "schedule" | "webhook";
  userId?: string | null;
  isAdmin?: boolean;
  continueOnError?: boolean;
  signal?: AbortSignal;
  /** Skip writing an AiWorkflowRun row (used by tests / previews). */
  persist?: boolean;
  /** Stable trace id for causal correlation across logs, audit trail and steps.
   *  If omitted, a fresh UUID is generated. When resuming, defaults to the
   *  original run's traceId for continuity. */
  traceId?: string;
  /** Resume a prior partial run: load its succeeded steps and continue
   *  downstream. The run row must still exist and have a parseable `steps`
   *  blob. Failed/skipped steps re-execute. */
  resumeFromRunId?: string;
}

export interface ExecuteOutcome {
  runId: string | null;
  result: WorkflowRunResult;
  /** The trace id actually used (passed in or generated). Index it in logs. */
  traceId?: string;
}

const MAX_PERSISTED_STEPS = 200;

function jsonOrNull(value: unknown): string | null {
  if (value === undefined) return null;
  try {
    const text = JSON.stringify(value);
    // Guard the SQLite row size for pathological outputs.
    return text.length > 200_000 ? JSON.stringify({ truncated: true, preview: text.slice(0, 200_000) }) : text;
  } catch {
    return JSON.stringify({ unserializable: true });
  }
}

function parseSteps(blob: string | null | undefined): StepResult[] | undefined {
  if (!blob) return undefined;
  try {
    const parsed = JSON.parse(blob);
    if (!Array.isArray(parsed)) return undefined;
    // Keep only well-formed succeeded steps; anything else re-executes.
    return parsed.filter(
      (s): s is StepResult =>
        s && typeof s === "object" && typeof (s as StepResult).nodeId === "string" && (s as StepResult).status === "succeeded",
    );
  } catch {
    return undefined;
  }
}

export async function executeStoredWorkflow(
  workflow: StoredWorkflow,
  options: ExecuteOptions = {},
): Promise<ExecuteOutcome> {
  const dryRun = Boolean(options.dryRun);
  const persist = options.persist !== false;
  const trigger = options.trigger ?? "manual";
  const graph = parseStoredWorkflow(workflow); // throws WorkflowValidationError

  // Resume: load succeeded steps from the prior run, and reuse its traceId for
  // causal continuity unless the caller overrode it.
  let priorSteps: StepResult[] | undefined;
  let effectiveTraceId = options.traceId ?? randomUUID();
  if (options.resumeFromRunId) {
    const priorRun = await db.aiWorkflowRun.findUnique({
      where: { id: options.resumeFromRunId },
      select: { steps: true, traceId: true, status: true, workflowId: true },
    });
    if (!priorRun) {
      throw new Error(`Cannot resume: run ${options.resumeFromRunId} not found`);
    }
    if (priorRun.workflowId !== workflow.id) {
      throw new Error(`Cannot resume: run ${options.resumeFromRunId} belongs to a different workflow`);
    }
    priorSteps = parseSteps(priorRun.steps);
    if (!options.traceId && priorRun.traceId) {
      effectiveTraceId = priorRun.traceId;
    }
  }

  let runId: string | null = null;
  if (persist) {
    const run = await db.aiWorkflowRun.create({
      data: {
        workflowId: workflow.id,
        userId: options.userId ?? null,
        trigger,
        dryRun,
        status: "running",
        input: jsonOrNull(options.input ?? null),
        traceId: effectiveTraceId,
      },
      select: { id: true },
    });
    runId = run.id;
  }

  const actor: WorkflowActor = {
    userId: options.userId ?? null,
    isAdmin: Boolean(options.isAdmin),
  };

  // Incremental persistence: flush the accumulated steps array to the run row
  // after every step completes. Best-effort — a write failure must not crash
  // the run, but it IS logged via the promise rejection so it is visible.
  const accumulated: StepResult[] = [];
  const onStepComplete = persist && runId
    ? async (step: StepResult) => {
        accumulated.push(step);
        try {
          await db.aiWorkflowRun.update({
            where: { id: runId },
            data: { steps: jsonOrNull(accumulated.slice(0, MAX_PERSISTED_STEPS)) },
            select: { id: true },
          });
        } catch {
          // Swallow: a persistence failure must not abort the workflow. The
          // final write in the try/catch below still captures the outcome.
        }
      }
    : undefined;

  let result: WorkflowRunResult;
  try {
    result = await runWorkflowGraph(
      { nodes: graph.nodes, edges: graph.edges },
      {
        ai: async (messages, aiOptions) => {
          const completion = await completeWithAI(messages, {
            json: aiOptions.json,
            temperature: aiOptions.temperature,
            maxTokens: aiOptions.maxTokens,
            model: aiOptions.model,
            signal: options.signal,
          });
          return {
            text: completion.text,
            provider: completion.provider,
            model: completion.model,
            tokensUsed: completion.tokensUsed,
          };
        },
        tools: createScopedHostingTools(actor),
      },
      {
        input: options.input ?? null,
        dryRun,
        continueOnError: options.continueOnError,
        signal: options.signal,
        actor,
        traceId: effectiveTraceId,
        priorSteps,
        onStepComplete,
      },
    );
  } catch (error) {
    if (!persist || !runId) throw error;
    await db.aiWorkflowRun.update({
      where: { id: runId },
      data: {
        status: "failed",
        error: (error instanceof Error ? error.message : "workflow failed").slice(0, 500),
        finishedAt: new Date(),
      },
    }).catch(() => undefined);
    throw error;
  }

  if (persist && runId) {
    await db.aiWorkflowRun.update({
      where: { id: runId },
      data: {
        status: result.status,
        output: jsonOrNull(result.output),
        steps: jsonOrNull(result.steps.slice(0, MAX_PERSISTED_STEPS)),
        error: result.error ?? null,
        providers: result.providers.join(",") || null,
        aiCalls: result.aiCalls,
        tokensUsed: result.tokensUsed,
        durationMs: result.durationMs,
        finishedAt: new Date(),
      },
    });
  }

  return { runId, result, traceId: effectiveTraceId };
}
