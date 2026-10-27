/**
 * Production wiring for the workflow engine: real AI client, tenant-scoped
 * read-only hosting tools, and run persistence.
 *
 * The engine itself has no database or network dependency — this module is the
 * only place that knows about both, which keeps the engine unit-testable.
 */

import { db } from "@/lib/db";
import { completeWithAI } from "@/lib/ai/client";
import { createHostingToolsForActor } from "./tools";
import { parseStoredWorkflow } from "./graph";
import { runWorkflowGraph, type WorkflowRunResult } from "./engine";

export interface StoredWorkflow {
  id: string;
  userId?: string | null;
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
}

export interface ExecuteOutcome {
  runId: string | null;
  result: WorkflowRunResult;
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

export async function executeStoredWorkflow(
  workflow: StoredWorkflow,
  options: ExecuteOptions = {},
): Promise<ExecuteOutcome> {
  const dryRun = Boolean(options.dryRun);
  const persist = options.persist !== false;
  const trigger = options.trigger ?? "manual";
  const graph = parseStoredWorkflow(workflow); // throws WorkflowValidationError

  // Resolve actor scope: never fall back to cross-tenant access.
  const effectiveUserId = options.userId ?? workflow.userId ?? null;
  const scopedTools = createHostingToolsForActor({
    userId: effectiveUserId,
    isAdmin: Boolean(options.isAdmin),
  });

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
      },
      select: { id: true },
    });
    runId = run.id;
  }

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
        tools: scopedTools,
      },
      {
        input: options.input ?? null,
        dryRun,
        continueOnError: options.continueOnError,
        signal: options.signal,
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

  return { runId, result };
}
