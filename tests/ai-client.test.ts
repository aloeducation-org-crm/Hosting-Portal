import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AIProviderError,
  completeJSON,
  completeWithAI,
  extractJson,
  resetProviderHealth,
} from '../src/lib/ai/client';

const ENV_KEYS = [
  'OPENAI_API_KEY',
  'OPENAI_BASE_URL',
  'AI_MODEL',
  'AI_PROVIDER',
  'AI_PROVIDER_ORDER',
  'AI_ALLOW_ANONYMOUS',
  'LLM7_API_KEY',
  'LLM7_BASE_URL',
  'AI_GATEWAY_URL',
  'AI_GATEWAY_KEY',
  'GLM_API_KEY',
  'ZHIPU_API_KEY',
  'GLM_BASE_URL',
  'AI_MODEL_GLM',
  'GLM_REASONING_EFFORT',
  'AI_RETRIES_PER_PROVIDER',
  'AI_TIMEOUT_MS',
  'AI_BREAKER_THRESHOLD',
];

function stubEnv(overrides: Record<string, string> = {}) {
  for (const key of ENV_KEYS) vi.stubEnv(key, '');
  vi.stubEnv('AI_RETRIES_PER_PROVIDER', '0');
  for (const [key, value] of Object.entries(overrides)) vi.stubEnv(key, value);
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

const okBody = {
  model: 'test-model',
  choices: [{ message: { content: 'hello from the model' } }],
  usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
};

beforeEach(() => {
  resetProviderHealth();
  stubEnv();
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('completeWithAI', () => {
  it('fails closed with AI_NOT_CONFIGURED when no provider resolves', async () => {
    stubEnv({ AI_ALLOW_ANONYMOUS: 'false' });
    await expect(completeWithAI([{ role: 'user', content: 'hi' }])).rejects.toMatchObject({
      status: 503,
      code: 'AI_NOT_CONFIGURED',
    });
    await expect(completeWithAI([{ role: 'user', content: 'hi' }])).rejects.toThrow('AI provider is not configured');
  });

  it('returns real text, usage and the answering provider', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(okBody));
    const result = await completeWithAI([{ role: 'user', content: 'hi' }]);
    expect(result).toMatchObject({ text: 'hello from the model', provider: 'llm7', tokensUsed: 15 });
    expect(result.usage).toEqual({ promptTokens: 10, completionTokens: 5, totalTokens: 15 });
  });

  it('sends an OpenAI-compatible payload to /chat/completions with the model id', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(okBody));
    await completeWithAI([{ role: 'system', content: 's' }, { role: 'user', content: 'u' }], { temperature: 0.1, maxTokens: 42 });
    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(String(url)).toBe('https://api.llm7.io/v1/chat/completions');
    const body = JSON.parse(String((init as RequestInit).body));
    expect(body).toMatchObject({ model: 'gpt-oss:20b', temperature: 0.1, max_tokens: 42, stream: false });
    expect(body.messages).toEqual([{ role: 'system', content: 's' }, { role: 'user', content: 'u' }]);
  });

  it('forwards GLM_REASONING_EFFORT when calling the glm provider', async () => {
    stubEnv({
      AI_PROVIDER_ORDER: 'glm',
      GLM_API_KEY: 'glm-test-key',
      GLM_BASE_URL: 'https://api.z.ai/api/paas/v4',
      AI_MODEL_GLM: 'glm-5.3-flash',
      GLM_REASONING_EFFORT: 'low',
    });
    vi.mocked(fetch).mockResolvedValue(jsonResponse(okBody));
    const result = await completeWithAI([{ role: 'user', content: 'solve' }]);
    expect(result.provider).toBe('glm');
    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(String(url)).toBe('https://api.z.ai/api/paas/v4/chat/completions');
    const body = JSON.parse(String((init as RequestInit).body));
    expect(body).toMatchObject({
      model: 'glm-5.3-flash',
      reasoning_effort: 'low',
      stream: false,
    });
  });

  it('fails over to the next provider and reports every attempt', async () => {
    stubEnv({ AI_PROVIDER_ORDER: 'gateway,llm7' });
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse({ error: 'boom' }, 500))
      .mockResolvedValueOnce(jsonResponse(okBody));

    const result = await completeWithAI([{ role: 'user', content: 'hi' }]);
    expect(result.provider).toBe('llm7');
    expect(result.attempts).toHaveLength(2);
    expect(result.attempts[0]).toMatchObject({ provider: 'gateway', ok: false, status: 502 });
    expect(result.attempts[1]).toMatchObject({ provider: 'llm7', ok: true });
  });

  it('does not leak the upstream response body in errors', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ error: 'sk-secret-token-should-not-appear' }, 401));
    await expect(completeWithAI([{ role: 'user', content: 'hi' }])).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(AIProviderError);
      expect((error as Error).message).not.toContain('sk-secret-token-should-not-appear');
      return true;
    });
  });

  it('rejects an empty completion instead of returning blank text', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ choices: [{ message: { content: '   ' } }] }));
    await expect(completeWithAI([{ role: 'user', content: 'hi' }])).rejects.toMatchObject({ status: 502 });
  });

  it('honours caller cancellation without retrying other providers', async () => {
    stubEnv({ AI_PROVIDER_ORDER: 'gateway,llm7' });
    const controller = new AbortController();
    controller.abort();
    const fetchMock = vi.mocked(fetch).mockImplementation(async () => {
      throw new DOMException('aborted', 'AbortError');
    });
    await expect(completeWithAI([{ role: 'user', content: 'hi' }], { signal: controller.signal })).rejects.toMatchObject({
      code: 'AI_ABORTED',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('JSON handling', () => {
  it('extracts JSON from fenced model output', () => {
    expect(extractJson('Sure!\n```json\n{"a": 1}\n```\nDone')).toEqual({ a: 1 });
    expect(extractJson('prefix [{"b":2}] suffix')).toEqual([{ b: 2 }]);
  });

  it('throws rather than fabricating data when the model returns prose', () => {
    expect(() => extractJson('I could not find anything.')).toThrow('invalid JSON');
  });

  it('requests JSON mode and parses it', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({
      choices: [{ message: { content: '{"category":"dns","priority":"high"}' } }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    }));
    const { data } = await completeJSON<{ category: string; priority: string }>([
      { role: 'user', content: 'classify' },
    ]);
    expect(data).toEqual({ category: 'dns', priority: 'high' });
    const init = vi.mocked(fetch).mock.calls[0]![1] as RequestInit;
    expect(JSON.parse(String(init.body)).response_format).toEqual({ type: 'json_object' });
  });
});
