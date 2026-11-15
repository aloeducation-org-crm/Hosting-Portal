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

describe('verify.assert — mechanical structural assertions', () => {
  // The whole point of verify.assert is that it costs zero tokens: it checks
  // structural properties of a prior step's output deterministically, so a
  // model that claims "done" can still be caught when the output is missing the
  // expected field/count/shape. Every test below asserts aiCalls === 0.

  it('passes when an expected path exists and fails when it does not', async () => {
    const ok = await runWorkflowGraph(
      {
        nodes: [
          { id: 'start', type: 'trigger' },
          { id: 'sites', type: 'hosting.listSites', config: { limit: 5 } },
          { id: 'check', type: 'verify.assert', config: { from: 'sites', path: 'count', operator: 'exists' } },
          { id: 'out', type: 'output', config: { value: '{{ steps.check.output.asserted }}' } },
        ],
        edges: [
          { from: 'start', to: 'sites' },
          { from: 'sites', to: 'check' },
          { from: 'check', to: 'out' },
        ],
      },
      deps(),
      { input: {} },
    );
    expect(ok.status).toBe('succeeded');
    expect(ok.output).toBe(true);
    expect(ok.aiCalls).toBe(0);

    const bad = await runWorkflowGraph(
      {
        nodes: [
          { id: 'start', type: 'trigger' },
          { id: 'sites', type: 'hosting.listSites' },
          { id: 'check', type: 'verify.assert', config: { from: 'sites', path: 'nonexistent.deep', operator: 'exists' } },
          { id: 'out', type: 'output', config: { value: 'unreachable' } },
        ],
        edges: [
          { from: 'start', to: 'sites' },
          { from: 'sites', to: 'check' },
          { from: 'check', to: 'out' },
        ],
      },
      deps(),
      { input: {} },
    );
    expect(bad.status).toBe('failed');
    expect(bad.error).toContain('assertion failed');
    expect(bad.error).toContain('exists');
    expect(bad.steps.find((s) => s.nodeId === 'out')?.status).toBe('skipped');
    expect(bad.aiCalls).toBe(0);
  });

  it('checks equality, count and range without spending tokens', async () => {
    // equals on a scalar
    const eq = await runWorkflowGraph(
      {
        nodes: [
          { id: 'start', type: 'trigger' },
          { id: 'sites', type: 'hosting.listSites', config: { limit: 2 } },
          { id: 'check', type: 'verify.assert', config: { from: 'sites', path: 'count', operator: 'equals', expected: 2 } },
          { id: 'out', type: 'output', config: { value: '{{ steps.check.output.asserted }}' } },
        ],
        edges: [
          { from: 'start', to: 'sites' },
          { from: 'sites', to: 'check' },
          { from: 'check', to: 'out' },
        ],
      },
      deps(),
      { input: {} },
    );
    expect(eq.status).toBe('succeeded');
    expect(eq.aiCalls).toBe(0);

    // minCount on an array
    const count = await runWorkflowGraph(
      {
        nodes: [
          { id: 'start', type: 'trigger' },
          { id: 'sites', type: 'hosting.listSites' },
          { id: 'check', type: 'verify.assert', config: { from: 'sites', path: 'sites', operator: 'minCount', expected: 2 } },
          { id: 'out', type: 'output', config: { value: 'ok' } },
        ],
        edges: [
          { from: 'start', to: 'sites' },
          { from: 'sites', to: 'check' },
          { from: 'check', to: 'out' },
        ],
      },
      deps(),
      { input: {} },
    );
    expect(count.status).toBe('succeeded');
    expect(count.aiCalls).toBe(0);

    // range on a number (count is 2, range [1, 5])
    const range = await runWorkflowGraph(
      {
        nodes: [
          { id: 'start', type: 'trigger' },
          { id: 'sites', type: 'hosting.listSites' },
          { id: 'check', type: 'verify.assert', config: { from: 'sites', path: 'count', operator: 'range', expected: { min: 1, max: 5 } } },
          { id: 'out', type: 'output', config: { value: 'ok' } },
        ],
        edges: [
          { from: 'start', to: 'sites' },
          { from: 'sites', to: 'check' },
          { from: 'check', to: 'out' },
        ],
      },
      deps(),
      { input: {} },
    );
    expect(range.status).toBe('succeeded');
    expect(range.aiCalls).toBe(0);

    // range that excludes the actual value fails
    const rangeFail = await runWorkflowGraph(
      {
        nodes: [
          { id: 'start', type: 'trigger' },
          { id: 'sites', type: 'hosting.listSites' },
          { id: 'check', type: 'verify.assert', config: { from: 'sites', path: 'count', operator: 'range', expected: { min: 10, max: 20 } } },
          { id: 'out', type: 'output', config: { value: 'unreachable' } },
        ],
        edges: [
          { from: 'start', to: 'sites' },
          { from: 'sites', to: 'check' },
          { from: 'check', to: 'out' },
        ],
      },
      deps(),
      { input: {} },
    );
    expect(rangeFail.status).toBe('failed');
    expect(rangeFail.error).toContain('range');
    expect(rangeFail.aiCalls).toBe(0);
  });

  it('matches a regex and fails on no match', async () => {
    const ok = await runWorkflowGraph(
      {
        nodes: [
          { id: 'start', type: 'trigger' },
          { id: 'sites', type: 'hosting.listSites' },
          { id: 'check', type: 'verify.assert', config: { from: 'sites', path: 'sites.0.domain', operator: 'matches', expected: '\\.test$' } },
          { id: 'out', type: 'output', config: { value: 'ok' } },
        ],
        edges: [
          { from: 'start', to: 'sites' },
          { from: 'sites', to: 'check' },
          { from: 'check', to: 'out' },
        ],
      },
      deps(),
      { input: {} },
    );
    expect(ok.status).toBe('succeeded');
    expect(ok.aiCalls).toBe(0);

    const bad = await runWorkflowGraph(
      {
        nodes: [
          { id: 'start', type: 'trigger' },
          { id: 'sites', type: 'hosting.listSites' },
          { id: 'check', type: 'verify.assert', config: { from: 'sites', path: 'sites.0.domain', operator: 'matches', expected: '^prod\\.' } },
          { id: 'out', type: 'output', config: { value: 'unreachable' } },
        ],
        edges: [
          { from: 'start', to: 'sites' },
          { from: 'sites', to: 'check' },
          { from: 'check', to: 'out' },
        ],
      },
      deps(),
      { input: {} },
    );
    expect(bad.status).toBe('failed');
    expect(bad.aiCalls).toBe(0);
  });

  it('blocks prototype-polluting paths', async () => {
    const result = await runWorkflowGraph(
      {
        nodes: [
          { id: 'start', type: 'trigger' },
          { id: 'sites', type: 'hosting.listSites' },
          { id: 'check', type: 'verify.assert', config: { from: 'sites', path: '__proto__.polluted', operator: 'exists' } },
          { id: 'out', type: 'output', config: { value: 'unreachable' } },
        ],
        edges: [
          { from: 'start', to: 'sites' },
          { from: 'sites', to: 'check' },
          { from: 'check', to: 'out' },
        ],
      },
      deps(),
      { input: {} },
    );
    // __proto__ segment returns undefined → assertion fails → run fails.
    expect(result.status).toBe('failed');
    expect(result.aiCalls).toBe(0);
  });
});

describe('causal trace ids + resumable runs', () => {
  it('threads a caller-supplied traceId through every step and the result', async () => {
    const result = await runWorkflowGraph(
      {
        nodes: [
          { id: 'start', type: 'trigger' },
          { id: 'sites', type: 'hosting.listSites' },
          { id: 'out', type: 'output', config: { value: '{{ steps.sites.output.count }}' } },
        ],
        edges: [
          { from: 'start', to: 'sites' },
          { from: 'sites', to: 'out' },
        ],
      },
      deps(),
      { input: {}, traceId: 'trace-abc-123' },
    );
    expect(result.traceId).toBe('trace-abc-123');
    expect(result.steps.length).toBeGreaterThan(0);
    expect(result.steps.every((s) => s.traceId === 'trace-abc-123')).toBe(true);
  });

  it('invokes onStepComplete for every step (succeeded and skipped)', async () => {
    const seen: string[] = [];
    const result = await runWorkflowGraph(
      {
        nodes: [
          { id: 'start', type: 'trigger' },
          { id: 'health', type: 'hosting.siteHealth', config: { domain: 'a.test' } },
          { id: 'cond', type: 'logic.condition', config: { value: '{{ steps.health.output.found }}' } },
          { id: 'yes', type: 'output', config: { value: 'managed' } },
          { id: 'no', type: 'output', config: { value: 'not managed' } },
        ],
        edges: [
          { from: 'start', to: 'health' },
          { from: 'health', to: 'cond' },
          { from: 'cond', to: 'yes', when: 'true' },
          { from: 'cond', to: 'no', when: 'false' },
        ],
      },
      deps(),
      {
        input: { domain: 'a.test' },
        onStepComplete: async (step) => {
          seen.push(`${step.nodeId}:${step.status}`);
        },
      },
    );
    expect(result.status).toBe('succeeded');
    // start, health, cond, yes (succeeded); no (skipped because the false branch was not taken)
    expect(seen).toEqual(expect.arrayContaining(['start:succeeded', 'health:succeeded', 'cond:succeeded', 'yes:succeeded']));
    expect(seen).toContain('no:skipped');
  });

  it('resumes from priorSteps without re-running succeeded steps', async () => {
    const ai = vi.fn(async () => ({ text: 'summary', provider: 'llm7', model: 'm', tokensUsed: 7 }));
    const listSites = vi.fn(async () => ({ count: 2, sites: [{ domain: 'a.test' }] }));

    // First run: executes start → sites → summary, all succeed.
    const first = await runWorkflowGraph(
      {
        nodes: [
          { id: 'start', type: 'trigger' },
          { id: 'sites', type: 'hosting.listSites' },
          { id: 'summary', type: 'ai.complete', config: { prompt: 'summarise' } },
          { id: 'out', type: 'output', config: { value: '{{ steps.summary.output.text }}' } },
        ],
        edges: [
          { from: 'start', to: 'sites' },
          { from: 'sites', to: 'summary' },
          { from: 'summary', to: 'out' },
        ],
      },
      { ai: ai as unknown as RunDependencies['ai'], tools: { listSites } },
      { input: {}, traceId: 'resume-trace' },
    );
    expect(first.status).toBe('succeeded');
    expect(ai).toHaveBeenCalledTimes(1);
    expect(listSites).toHaveBeenCalledTimes(1);

    // Resume: pass the succeeded steps as priorSteps. The engine must NOT call
    // the AI or the tool again — it should skip straight to the (already done)
    // output and return the same result.
    const resumed = await runWorkflowGraph(
      {
        nodes: [
          { id: 'start', type: 'trigger' },
          { id: 'sites', type: 'hosting.listSites' },
          { id: 'summary', type: 'ai.complete', config: { prompt: 'summarise' } },
          { id: 'out', type: 'output', config: { value: '{{ steps.summary.output.text }}' } },
        ],
        edges: [
          { from: 'start', to: 'sites' },
          { from: 'sites', to: 'summary' },
          { from: 'summary', to: 'out' },
        ],
      },
      { ai: ai as unknown as RunDependencies['ai'], tools: { listSites } },
      { input: {}, traceId: 'resume-trace', priorSteps: first.steps },
    );
    expect(resumed.status).toBe('succeeded');
    expect(resumed.output).toBe('summary');
    expect(resumed.traceId).toBe('resume-trace');
    // No additional AI or tool calls — the prior steps were reused.
    expect(ai).toHaveBeenCalledTimes(1);
    expect(listSites).toHaveBeenCalledTimes(1);
  });

  it('re-derives the taken branch when resuming a condition node', async () => {
    const ai = vi.fn(async () => ({ text: 'yes-branch', provider: 'llm7', model: 'm', tokensUsed: 3 }));
    // Simulate a prior run that executed start → health → cond (result: true)
    // and took the 'yes' branch, then crashed before 'yes' ran.
    const priorSteps = [
      { nodeId: 'start', type: 'trigger' as const, status: 'succeeded' as const, output: {}, durationMs: 1 },
      { nodeId: 'health', type: 'hosting.siteHealth' as const, status: 'succeeded' as const, output: { found: true, domain: 'a.test' }, durationMs: 1 },
      { nodeId: 'cond', type: 'logic.condition' as const, status: 'succeeded' as const, output: { value: true, operator: 'truthy', compare: '', result: true }, durationMs: 1 },
    ];

    const result = await runWorkflowGraph(
      {
        nodes: [
          { id: 'start', type: 'trigger' },
          { id: 'health', type: 'hosting.siteHealth', config: { domain: 'a.test' } },
          { id: 'cond', type: 'logic.condition', config: { value: '{{ steps.health.output.found }}' } },
          { id: 'yes', type: 'ai.complete', config: { prompt: 'yes branch' } },
          { id: 'no', type: 'output', config: { value: 'no branch' } },
        ],
        edges: [
          { from: 'start', to: 'health' },
          { from: 'health', to: 'cond' },
          { from: 'cond', to: 'yes', when: 'true' },
          { from: 'cond', to: 'no', when: 'false' },
        ],
      },
      { ai: ai as unknown as RunDependencies['ai'], tools: { siteHealth: async () => ({ found: true, domain: 'a.test' }) } },
      { input: {}, priorSteps },
    );
    expect(result.status).toBe('succeeded');
    // 'yes' ran (AI was called once for it); 'no' was skipped because the cond
    // result was true and that branch was re-derived from priorSteps.
    expect(ai).toHaveBeenCalledTimes(1);
    expect(result.steps.find((s) => s.nodeId === 'no')?.status).toBe('skipped');
    expect(result.steps.find((s) => s.nodeId === 'yes')?.status).toBe('succeeded');
  });
});
