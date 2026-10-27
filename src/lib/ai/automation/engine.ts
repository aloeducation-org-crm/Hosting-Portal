/**
 * Workflow execution engine.
 *
 * Pure-ish: all I/O is injected through `RunDependencies` (AI client + tool
 * registry), so the engine can be unit-tested without a database or network and
 * the production wiring in `./index.ts` supplies the real implementations.
 *
 * Safety properties enforced here:
 *   - the graph is validated (DAG, size limits) before any step runs,
 *   - a per-run cap on AI calls and a per-step timeout,
 *   - tool/config values are template-rendered but never `eval`-ed,
 *   - a failing step fails the run unless the workflow opts into `continueOnError`,
 *   - `dryRun` never touches an AI provider or a tool.
 */

import { renderDeep, renderTemplateValue, type TemplateScope } from "./template";
import type { WorkflowEdge, WorkflowGraph, WorkflowNode, WorkflowNodeType } from "./graph";
import { parseGraph } from "./graph";

export type StepStatus = "succeeded" | "failed" | "skipped";

export interface StepResult {
  nodeId: string;
  type: WorkflowNodeType;
  label?: string;
  status: StepStatus;
  output?: unknown;
  error?: string;
  skippedReason?: string;
  durationMs: number;
  provider?: string;
  model?: string;
  tokensUsed?: number;
  dryRun?: boolean;
}

export interface WorkflowRunResult {
  status: "succeeded" | "failed";
  steps: StepResult[];
  output: unknown;
  error?: string;
  durationMs: number;
  aiCalls: number;
  tokensUsed: number;
  providers: string[];
}

export interface AIInvocationResult {
  text: string;
  provider: string;
  model: string;
  tokensUsed: number;
}

export type AIInvoker = (messages: Array<{ role: "system" | "user" | "assistant"; content: string }>, options: {
  json?: boolean;
  temperature?: number;
  maxTokens?: number;
  model?: string;
}) => Promise<AIInvocationResult>;

export interface WorkflowActor {
  userId?: string | null;
  isAdmin?: boolean;
}

export interface ToolContext {
  input: unknown;
  actor?: WorkflowActor;
}

export type ToolFn = (args: Record<string, unknown>, context: ToolContext) => Promise<unknown>;
export type ToolRegistry = Record<string, ToolFn>;

export interface RunDependencies {
  ai: AIInvoker;
  tools: ToolRegistry;
}

export interface RunOptions {
  input?: unknown;
  dryRun?: boolean;
  /** Per-step budget; defaults to 120s. */
  stepTimeoutMs?: number;
  /** Upper bound on AI calls per run; defaults to 12. */
  maxAiCalls?: number;
  continueOnError?: boolean;
  signal?: AbortSignal;
  /** Acting user/tenant identity passed to read-only hosting tools. */
  actor?: WorkflowActor;
}

const DEFAULT_STEP_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_AI_CALLS = 12;

class StepTimeoutError extends Error {
  constructor(ms: number) {
    super(`step timed out after ${ms}ms`);
    this.name = "StepTimeoutError";
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new StepTimeoutError(ms)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function edgeKey(edge: WorkflowEdge): string {
  return `${edge.from}->${edge.to}`;
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function truthy(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["", "false", "0", "no", "null", "undefined"].includes(normalized)) return false;
    return true;
  }
  if (Array.isArray(value)) return value.length > 0;
  if (value && typeof value === "object") return Object.keys(value as Record<string, unknown>).length > 0;
  return false;
}

/**
 * Execute a workflow.
 *
 * Errors are reported in the result rather than thrown (except for invalid
 * graphs, which throw WorkflowValidationError from `parseGraph`).
 */
export async function runWorkflowGraph(
  graphInput: { nodes?: unknown; edges?: unknown },
  deps: RunDependencies,
  options: RunOptions = {},
): Promise<WorkflowRunResult> {
  const graph: WorkflowGraph = parseGraph(graphInput);
  const startedAt = Date.now();
  const input = options.input ?? null;
  const dryRun = Boolean(options.dryRun);
  const stepTimeoutMs = options.stepTimeoutMs ?? DEFAULT_STEP_TIMEOUT_MS;
  const maxAiCalls = options.maxAiCalls ?? DEFAULT_MAX_AI_CALLS;

  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
  const incoming = new Map<string, WorkflowEdge[]>(graph.nodes.map((node) => [node.id, []]));
  const outgoing = new Map<string, WorkflowEdge[]>(graph.nodes.map((node) => [node.id, []]));
  for (const edge of graph.edges) {
    incoming.get(edge.to)?.push(edge);
    outgoing.get(edge.from)?.push(edge);
  }

  const edgeStatus = new Map<string, "taken" | "skipped">();
  const steps: StepResult[] = [];
  const stepById = new Map<string, StepResult>();
  const outputs: Record<string, { output?: unknown; status?: StepStatus }> = {};
  const providers = new Set<string>();
  let aiCalls = 0;
  let tokensUsed = 0;
  let runError: string | undefined;
  let failed = false;

  const scopeFor = (): TemplateScope => ({ input, steps: outputs });

  const markOutgoing = (nodeId: string, verdict: boolean | "all") => {
    for (const edge of outgoing.get(nodeId) ?? []) {
      const condition = edge.when ?? "always";
      const taken =
        verdict === "all" ? true : condition === "always" ? true : condition === "true" ? verdict === true : verdict === false;
      edgeStatus.set(edgeKey(edge), taken ? "taken" : "skipped");
    }
  };

  const skipNode = (node: WorkflowNode, reason: string) => {
    const result: StepResult = {
      nodeId: node.id,
      type: node.type,
      label: node.label,
      status: "skipped",
      skippedReason: reason,
      durationMs: 0,
    };
    steps.push(result);
    stepById.set(node.id, result);
    outputs[node.id] = { status: "skipped" };
    markOutgoing(node.id, "all");
  };

  const executeNode = async (node: WorkflowNode, config: Record<string, unknown>, primaryInput: unknown): Promise<{
    output: unknown;
    meta?: Pick<StepResult, "provider" | "model" | "tokensUsed">;
    condition?: boolean;
  }> => {
    const scope = scopeFor();
    const toolContext: ToolContext = { input, actor: options.actor };

    switch (node.type) {
      case "trigger": {
        return { output: primaryInput ?? input };
      }
      case "ai.complete": {
        const prompt = asString(renderTemplateValue(asString(config.prompt), scope));
        if (!prompt.trim()) throw new Error("ai.complete requires a non-empty prompt");
        if (aiCalls >= maxAiCalls) throw new Error(`AI call budget exhausted (${maxAiCalls} per run)`);
        aiCalls += 1;
        const system = asString(renderTemplateValue(asString(config.system), scope));
        const messages: Array<{ role: "system" | "user"; content: string }> = [];
        if (system.trim()) messages.push({ role: "system", content: system });
        messages.push({ role: "user", content: prompt });
        const result = await deps.ai(messages, {
          json: config.json === true,
          temperature: typeof config.temperature === "number" ? config.temperature : undefined,
          maxTokens: typeof config.maxTokens === "number" ? config.maxTokens : undefined,
          model: typeof config.model === "string" && config.model ? config.model : undefined,
        });
        providers.add(result.provider);
        tokensUsed += result.tokensUsed;
        return {
          output: { text: result.text, model: result.model, provider: result.provider, tokensUsed: result.tokensUsed },
          meta: { provider: result.provider, model: result.model, tokensUsed: result.tokensUsed },
        };
      }
      case "ai.extract": {
        if (aiCalls >= maxAiCalls) throw new Error(`AI call budget exhausted (${maxAiCalls} per run)`);
        aiCalls += 1;
        const instruction = asString(
          renderTemplateValue(
            asString(config.prompt, "Extract structured data from the content below and return it as JSON."),
            scope,
          ),
        );
        const source = config.from !== undefined ? renderTemplateValue(asString(config.from), scope) : primaryInput ?? input;
        const content = typeof source === "string" ? source : JSON.stringify(source ?? null);
        const result = await deps.ai(
          [
            { role: "system", content: "You are a precise data extractor. Reply with JSON only, no prose." },
            { role: "user", content: `${instruction}\n\nCONTENT:\n${content.slice(0, 12_000)}` },
          ],
          { json: true, temperature: 0 },
        );
        providers.add(result.provider);
        tokensUsed += result.tokensUsed;
        return {
          output: parseJsonOrThrow(result.text),
          meta: { provider: result.provider, model: result.model, tokensUsed: result.tokensUsed },
        };
      }
      case "hosting.listSites":
      case "hosting.siteHealth":
      case "hosting.sslExpiring":
      case "hosting.listDeployments":
      case "hosting.automationOverview":
      case "hosting.billingOverview":
      case "hosting.marketingOverview": {
        const toolName = node.type.replace("hosting.", "");
        const tool = deps.tools[toolName];
        if (!tool) throw new Error(`tool "${toolName}" is not available on this server`);
        const args = renderDeep(config, scope) as Record<string, unknown>;
        return { output: await tool(args, toolContext) };
      }
      case "logic.condition": {
        const operator = asString(config.operator, "truthy");
        const value = renderTemplateValue(asString(config.value), scope);
        const compare = config.compare !== undefined ? renderTemplateValue(asString(config.compare), scope) : "";
        let verdict: boolean;
        switch (operator) {
          case "equals":
            verdict = String(value) === String(compare);
            break;
          case "contains":
            verdict = String(value ?? "").includes(String(compare ?? ""));
            break;
          case "notEmpty":
            verdict = truthy(value);
            break;
          case "truthy":
          default:
            verdict = truthy(value);
            break;
        }
        return { output: { value, operator, compare, result: verdict }, condition: verdict };
      }
      case "transform.template": {
        const template = asString(config.template);
        if (!template) throw new Error("transform.template requires a template");
        return { output: renderTemplateValue(template, scope) };
      }
      case "output": {
        const value = renderTemplateValue(asString(config.value), scope);
        if (config.format === "json" && typeof value === "string") {
          return { output: parseJsonOrThrow(value) };
        }
        return { output: value };
      }
      default: {
        const exhaustive: never = node.type;
        throw new Error(`unsupported node type: ${String(exhaustive)}`);
      }
    }
  };

  // Execution loop: run nodes whose inbound edges are all resolved.
  let progress = true;
  while (progress) {
    progress = false;
    for (const node of graph.nodes) {
      if (stepById.has(node.id) || failed) continue;
      const inbound = incoming.get(node.id) ?? [];
      const allResolved = inbound.every((edge) => edgeStatus.has(edgeKey(edge)));
      const isEntry = inbound.length === 0;

      if (!isEntry && !allResolved) continue;
      if (!isEntry && !inbound.some((edge) => edgeStatus.get(edgeKey(edge)) === "taken")) {
        skipNode(node, "no upstream branch selected this node");
        progress = true;
        continue;
      }

      const primaryInput = inbound
        .filter((edge) => edgeStatus.get(edgeKey(edge)) === "taken")
        .map((edge) => outputs[edge.from]?.output)
        .find((value) => value !== undefined);

      const started = Date.now();
      try {
        if (dryRun) {
          const result: StepResult = {
            nodeId: node.id,
            type: node.type,
            label: node.label,
            status: "succeeded",
            output: { planned: true, type: node.type },
            durationMs: Date.now() - started,
            dryRun: true,
          };
          steps.push(result);
          stepById.set(node.id, result);
          outputs[node.id] = { output: result.output, status: "succeeded" };
          markOutgoing(node.id, "all");
          progress = true;
          continue;
        }

        const executed = await withTimeout(
          executeNode(node, (node.config ?? {}) as Record<string, unknown>, primaryInput),
          stepTimeoutMs,
        );
        const result: StepResult = {
          nodeId: node.id,
          type: node.type,
          label: node.label,
          status: "succeeded",
          output: executed.output,
          durationMs: Date.now() - started,
          ...(executed.meta ?? {}),
        };
        steps.push(result);
        stepById.set(node.id, result);
        outputs[node.id] = { output: result.output, status: "succeeded" };
        markOutgoing(node.id, executed.condition ?? "all");
        progress = true;
      } catch (error) {
        const message = error instanceof Error ? error.message : "step failed";
        const result: StepResult = {
          nodeId: node.id,
          type: node.type,
          label: node.label,
          status: "failed",
          error: message.slice(0, 500),
          durationMs: Date.now() - started,
        };
        steps.push(result);
        stepById.set(node.id, result);
        outputs[node.id] = { status: "failed" };
        markOutgoing(node.id, "all");
        progress = true;
        if (!options.continueOnError) {
          failed = true;
          runError = `Step "${node.label ?? node.id}" failed: ${message}`.slice(0, 500);
        }
      }
    }
  }

  // Anything still unvisited is unreachable or downstream of a failure.
  for (const node of graph.nodes) {
    if (stepById.has(node.id)) continue;
    skipNode(node, failed ? "skipped because an upstream step failed" : "unreachable");
  }

  const status = failed || steps.some((step) => step.status === "failed") ? "failed" : "succeeded";

  // A failed run must not look like it produced a result: only a successful
  // `output` node (or, for graphs without one, the last successful step) counts,
  // and only while the run itself succeeded.
  const outputNode = [...graph.nodes].reverse().find((node) => node.type === "output");
  const outputStep = outputNode ? stepById.get(outputNode.id) : undefined;
  const lastStepWithOutput = [...steps].reverse().find((step) => step.status === "succeeded" && step.output !== undefined);
  const output = status === "failed"
    ? null
    : outputStep?.status === "succeeded"
      ? outputStep.output
      : lastStepWithOutput?.output ?? null;

  return {
    status,
    steps,
    output,
    error: runError ?? steps.find((step) => step.status === "failed")?.error,
    durationMs: Date.now() - startedAt,
    aiCalls,
    tokensUsed,
    providers: [...providers],
  };
}

function parseJsonOrThrow(raw: string): unknown {
  const trimmed = raw.trim();
  const candidates = [trimmed];
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) candidates.push(fenced[1].trim());
  const firstBrace = trimmed.search(/[{[]/);
  const lastBrace = Math.max(trimmed.lastIndexOf("}"), trimmed.lastIndexOf("]"));
  if (firstBrace >= 0 && lastBrace > firstBrace) candidates.push(trimmed.slice(firstBrace, lastBrace + 1));
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      // next
    }
  }
  throw new Error("model did not return valid JSON");
}
