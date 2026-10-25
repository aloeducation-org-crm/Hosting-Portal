import { describe, expect, it, vi } from 'vitest';
import { WorkflowValidationError, parseGraph } from '../src/lib/ai/automation/graph';
import { renderTemplate, renderTemplateValue, resolvePath } from '../src/lib/ai/automation/template';
import { runWorkflowGraph, type RunDependencies } from '../src/lib/ai/automation/engine';
import { WORKFLOW_TEMPLATES } from '../src/lib/ai/automation/templates';

function deps(overrides: Partial<RunDependencies> = {}): RunDependencies {
  return {
    ai: vi.fn(async (messages) => ({
      text: `echo:${messages[messages.length - 1]?.content.slice(0, 40)}`,
      provider: 'llm7',
      model: 'test-model',
      tokensUsed: 7,
    })),
    tools: {
      listSites: vi.fn(async () => ({ count: 2, sites: [{ domain: 'a.test' }, { domain: 'b.test' }] })),
      siteHealth: vi.fn(async (args) => ({ found: args.domain === 'a.test', domain: args.domain })),
      sslExpiring: vi.fn(async () => ({ count: 0, certificates: [] })),
    },
    ...overrides,
  };
}

describe('graph validation', () => {
  it('accepts every shipped template', () => {
    for (const template of WORKFLOW_TEMPLATES) {
      const graph = parseGraph({ nodes: template.graph.nodes, edges: template.graph.edges });
      expect(graph.nodes.length).toBeGreaterThan(1);
    }
  });

  it('rejects cycles, unknown types and dangling edges', () => {
    expect(() => parseGraph({
      nodes: [{ id: 'a', type: 'trigger' }, { id: 'b', type: 'output' }],
      edges: [{ from: 'a', to: 'b' }, { from: 'b', to: 'a' }],
    })).toThrow(/cycle/);

    expect(() => parseGraph({ nodes: [{ id: 'a', type: 'shell.exec' }], edges: [] })).toThrow(WorkflowValidationError);

    expect(() => parseGraph({
      nodes: [{ id: 'a', type: 'trigger' }],
      edges: [{ from: 'a', to: 'ghost' }],
    })).toThrow(/unknown node/);
  });

  it('parses the JSON-string form stored in the database', () => {
    const graph = parseGraph({
      nodes: JSON.stringify([{ id: 'start', type: 'trigger' }]),
      edges: JSON.stringify([]),
    });
    expect(graph.nodes[0]?.id).toBe('start');
  });
});

describe('template rendering', () => {
  const scope = {
    input: { domain: 'a.test', audience: 'ops' },
    steps: { sites: { output: { count: 2 }, status: 'succeeded' as const } },
  };

  it('renders nested paths and preserves raw values for single placeholders', () => {
    expect(renderTemplate('domain={{ input.domain }}', scope)).toBe('domain=a.test');
    expect(renderTemplateValue('{{ steps.sites.output }}', scope)).toEqual({ count: 2 });
  });

  it('returns an empty string for missing paths instead of throwing', () => {
    expect(renderTemplate('[{{ input.missing.deep }}]', scope)).toBe('[]');
  });

  it('blocks prototype-polluting path segments', () => {
    expect(() => resolvePath(scope, 'input.__proto__.polluted')).toThrow(/not allowed/);
  });
});

describe('workflow engine', () => {
  it('runs a linear workflow and returns the output node value', async () => {
    const result = await runWorkflowGraph(
      {
        nodes: [
          { id: 'start', type: 'trigger' },
          { id: 'sites', type: 'hosting.listSites', config: { limit: 5 } },
          { id: 'summary', type: 'ai.complete', config: { prompt: 'Summarise {{ steps.sites.output.count }} sites' } },
          { id: 'out', type: 'output', config: { value: '{{ steps.summary.output.text }}' } },
        ],
        edges: [
          { from: 'start', to: 'sites' },
          { from: 'sites', to: 'summary' },
          { from: 'summary', to: 'out' },
        ],
      },
      deps(),
      { input: {} },
    );

    expect(result.status).toBe('succeeded');
    expect(result.steps.map((step) => step.status)).toEqual(['succeeded', 'succeeded', 'succeeded', 'succeeded']);
    expect(result.output).toBe('echo:Summarise 2 sites');
    expect(result.aiCalls).toBe(1);
    expect(result.tokensUsed).toBe(7);
    expect(result.providers).toEqual(['llm7']);
  });

  it('follows only the matching branch of a condition', async () => {
    const dependencies = deps();
    const result = await runWorkflowGraph(
      {
        nodes: [
          { id: 'start', type: 'trigger' },
          { id: 'health', type: 'hosting.siteHealth', config: { domain: '{{ input.domain }}' } },
          { id: 'found', type: 'logic.condition', config: { value: '{{ steps.health.output.found }}' } },
          { id: 'yes', type: 'output', config: { value: 'managed' } },
          { id: 'no', type: 'output', config: { value: 'not managed' } },
        ],
        edges: [
          { from: 'start', to: 'health' },
          { from: 'health', to: 'found' },
          { from: 'found', to: 'yes', when: 'true' },
          { from: 'found', to: 'no', when: 'false' },
        ],
      },
      dependencies,
      { input: { domain: 'a.test' } },
    );

    expect(result.status).toBe('succeeded');
    expect(result.output).toBe('managed');
    expect(result.steps.find((step) => step.nodeId === 'no')?.status).toBe('skipped');
  });

  it('marks a step failure as a failed run and skips the rest', async () => {
    const result = await runWorkflowGraph(
      {
        nodes: [
          { id: 'start', type: 'trigger' },
          { id: 'bad', type: 'hosting.siteHealth', config: { domain: 'not a domain' } },
          { id: 'after', type: 'output', config: { value: 'unreachable' } },
        ],
        edges: [
          { from: 'start', to: 'bad' },
          { from: 'bad', to: 'after' },
        ],
      },
      deps({ tools: { siteHealth: async () => { throw new Error('invalid hostname'); } } }),
      { input: {} },
    );

    expect(result.status).toBe('failed');
    expect(result.error).toContain('invalid hostname');
    expect(result.steps.find((step) => step.nodeId === 'after')?.status).toBe('skipped');
    // A failed run must not look like it produced output.
    expect(result.output).toBeNull();
  });

  it('never calls a provider or tool during a dry run', async () => {
    const ai = vi.fn();
    const listSites = vi.fn();
    const result = await runWorkflowGraph(
      {
        nodes: [
          { id: 'start', type: 'trigger' },
          { id: 'sites', type: 'hosting.listSites' },
          { id: 'out', type: 'output', config: { value: 'x' } },
        ],
        edges: [{ from: 'start', to: 'sites' }, { from: 'sites', to: 'out' }],
      },
      { ai: ai as unknown as RunDependencies['ai'], tools: { listSites } },
      { dryRun: true },
    );

    expect(result.status).toBe('succeeded');
    expect(ai).not.toHaveBeenCalled();
    expect(listSites).not.toHaveBeenCalled();
    expect(result.steps.every((step) => step.dryRun)).toBe(true);
  });

  it('enforces the per-run AI call budget', async () => {
    const result = await runWorkflowGraph(
      {
        nodes: [
          { id: 'start', type: 'trigger' },
          { id: 'a', type: 'ai.complete', config: { prompt: 'one' } },
          { id: 'b', type: 'ai.complete', config: { prompt: 'two' } },
        ],
        edges: [{ from: 'start', to: 'a' }, { from: 'a', to: 'b' }],
      },
      deps(),
      { input: {}, maxAiCalls: 1 },
    );

    expect(result.status).toBe('failed');
    expect(result.error).toContain('budget exhausted');
  });

  it('reports unavailable tools instead of silently succeeding', async () => {
    const result = await runWorkflowGraph(
      {
        nodes: [{ id: 'start', type: 'trigger' }, { id: 'ssl', type: 'hosting.sslExpiring' }],
        edges: [{ from: 'start', to: 'ssl' }],
      },
      deps({ tools: {} }),
      {},
    );
    expect(result.status).toBe('failed');
    expect(result.error).toContain('not available');
  });
});
