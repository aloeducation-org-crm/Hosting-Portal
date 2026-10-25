/**
 * Workflow graph model + validation for the AI automation server.
 *
 * A workflow is a small DAG of nodes that the engine executes server-side.
 * Storing it as JSON (AiWorkflow.nodes / AiWorkflow.edges) keeps the schema
 * unchanged, but the graph is validated strictly before anything runs.
 */

export const WORKFLOW_NODE_TYPES = [
  "trigger",
  "ai.complete",
  "ai.extract",
  "hosting.listSites",
  "hosting.siteHealth",
  "hosting.sslExpiring",
  "logic.condition",
  "transform.template",
  "output",
] as const;

export type WorkflowNodeType = (typeof WORKFLOW_NODE_TYPES)[number];

export type EdgeCondition = "always" | "true" | "false";

export interface WorkflowNode {
  id: string;
  type: WorkflowNodeType;
  label?: string;
  config?: Record<string, unknown>;
}

export interface WorkflowEdge {
  from: string;
  to: string;
  when?: EdgeCondition;
}

export interface WorkflowGraph {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}

export const MAX_NODES = 40;
export const MAX_EDGES = 120;

export class WorkflowValidationError extends Error {
  readonly issues: string[];

  constructor(issues: string[]) {
    super(`Invalid workflow: ${issues.join("; ")}`);
    this.name = "WorkflowValidationError";
    this.issues = issues;
  }
}

const NODE_ID_PATTERN = /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/;

function isNodeType(value: unknown): value is WorkflowNodeType {
  return typeof value === "string" && (WORKFLOW_NODE_TYPES as readonly string[]).includes(value);
}

function coerceJson(input: unknown): unknown {
  if (typeof input !== "string") return input;
  const trimmed = input.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return undefined;
  }
}

/**
 * Validate and normalize an untyped workflow definition. Accepts the JSON-string
 * form used by the existing `/api/ai/workflows` route.
 *
 * Throws WorkflowValidationError listing every problem found.
 */
export function parseGraph(input: { nodes?: unknown; edges?: unknown }): WorkflowGraph {
  const issues: string[] = [];
  const rawNodes = coerceJson(input.nodes);
  const rawEdges = coerceJson(input.edges);

  if (!Array.isArray(rawNodes)) issues.push("nodes must be an array");
  if (rawEdges !== null && rawEdges !== undefined && !Array.isArray(rawEdges)) issues.push("edges must be an array");
  if (issues.length) throw new WorkflowValidationError(issues);

  const nodeList = rawNodes as unknown[];
  const edgeList = (rawEdges ?? []) as unknown[];

  if (!nodeList.length) issues.push("a workflow needs at least one node");
  if (nodeList.length > MAX_NODES) issues.push(`a workflow may contain at most ${MAX_NODES} nodes`);
  if (edgeList.length > MAX_EDGES) issues.push(`a workflow may contain at most ${MAX_EDGES} edges`);

  const nodes: WorkflowNode[] = [];
  const ids = new Set<string>();

  nodeList.forEach((raw, index) => {
    if (!raw || typeof raw !== "object") {
      issues.push(`node #${index + 1} is not an object`);
      return;
    }
    const candidate = raw as Record<string, unknown>;
    const id = candidate.id;
    const type = candidate.type;
    if (typeof id !== "string" || !NODE_ID_PATTERN.test(id)) {
      issues.push(`node #${index + 1} needs an id matching ${NODE_ID_PATTERN.source}`);
      return;
    }
    if (ids.has(id)) {
      issues.push(`duplicate node id "${id}"`);
      return;
    }
    ids.add(id);
    if (!isNodeType(type)) {
      issues.push(`node "${id}" has unsupported type "${String(type)}"`);
      return;
    }
    const config = candidate.config;
    if (config !== undefined && (typeof config !== "object" || config === null || Array.isArray(config))) {
      issues.push(`node "${id}" config must be an object`);
      return;
    }
    nodes.push({
      id,
      type,
      label: typeof candidate.label === "string" ? candidate.label.slice(0, 120) : undefined,
      config: (config as Record<string, unknown> | undefined) ?? {},
    });
  });

  const edges: WorkflowEdge[] = [];
  const edgeKeys = new Set<string>();
  edgeList.forEach((raw, index) => {
    if (!raw || typeof raw !== "object") {
      issues.push(`edge #${index + 1} is not an object`);
      return;
    }
    const candidate = raw as Record<string, unknown>;
    const from = candidate.from;
    const to = candidate.to;
    const when = candidate.when ?? "always";
    if (typeof from !== "string" || typeof to !== "string") {
      issues.push(`edge #${index + 1} needs string "from" and "to"`);
      return;
    }
    if (!ids.has(from) || !ids.has(to)) {
      issues.push(`edge ${from} → ${to} references an unknown node`);
      return;
    }
    if (from === to) {
      issues.push(`edge ${from} → ${to} is a self-loop`);
      return;
    }
    if (when !== "always" && when !== "true" && when !== "false") {
      issues.push(`edge ${from} → ${to} has invalid "when" (expected always|true|false)`);
      return;
    }
    const key = `${from}->${to}`;
    if (edgeKeys.has(key)) {
      issues.push(`duplicate edge ${from} → ${to}`);
      return;
    }
    edgeKeys.add(key);
    edges.push({ from, to, when });
  });

  if (!issues.length) {
    // Cycle detection (Kahn): a workflow must be a DAG so execution terminates.
    const indegree = new Map(nodes.map((node) => [node.id, 0]));
    const adjacency = new Map<string, string[]>(nodes.map((node) => [node.id, []]));
    for (const edge of edges) {
      indegree.set(edge.to, (indegree.get(edge.to) ?? 0) + 1);
      adjacency.get(edge.from)?.push(edge.to);
    }
    const queue = nodes.filter((node) => indegree.get(node.id) === 0).map((node) => node.id);
    let visited = 0;
    while (queue.length) {
      const id = queue.shift() as string;
      visited += 1;
      for (const next of adjacency.get(id) ?? []) {
        const remaining = (indegree.get(next) ?? 1) - 1;
        indegree.set(next, remaining);
        if (remaining === 0) queue.push(next);
      }
    }
    if (visited !== nodes.length) issues.push("the workflow graph contains a cycle");
  }

  if (issues.length) throw new WorkflowValidationError(issues);
  return { nodes, edges };
}

/** Convenience for reading a stored AiWorkflow row. */
export function parseStoredWorkflow(row: { nodes?: string | null; edges?: string | null }): WorkflowGraph {
  return parseGraph({ nodes: row.nodes ?? "[]", edges: row.edges ?? "[]" });
}
