import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AI_PROVIDER_CATALOG,
  chatCompletionsUrl,
  normalizeBaseUrl,
  parseOrder,
  redactProvider,
  resolveProviders,
} from '../src/lib/ai/providers';

const ALL_ENV_KEYS = [
  'OPENAI_API_KEY',
  'OPENAI_BASE_URL',
  'AI_MODEL',
  'AI_PROVIDER',
  'AI_PROVIDER_ORDER',
  'AI_FREE_ONLY',
  'AI_ALLOW_ANONYMOUS',
  'AI_ANONYMOUS_ACCESS',
  'LLM7_API_KEY',
  'LLM7_BASE_URL',
  'UNOROUTER_API_KEY',
  'UNOROUTER_BASE_URL',
  'PROVIDER_OPENAI_API_KEY',
  'GROQ_API_KEY',
  'AI_GATEWAY_URL',
  'AI_GATEWAY_KEY',
  'OLLAMA_API_KEY',
  'OLLAMA_BASE_URL',
  'GLM_API_KEY',
  'ZHIPU_API_KEY',
  'GLM_BASE_URL',
  'AI_MODEL_GLM',
  'GLM_REASONING_EFFORT',
  'AI_MODEL_LLM7',
];

function stubEnv(overrides: Record<string, string> = {}) {
  for (const key of ALL_ENV_KEYS) vi.stubEnv(key, '');
  for (const [key, value] of Object.entries(overrides)) vi.stubEnv(key, value);
}

afterEach(() => vi.unstubAllEnvs());

describe('provider catalog', () => {
  it('documents an anonymous free provider and keeps unverified hosts marked', () => {
    const llm7 = AI_PROVIDER_CATALOG.find((entry) => entry.id === 'llm7');
    expect(llm7?.tier).toBe('free');
    expect(llm7?.anonymousAccess).toBe(true);
    expect(llm7?.baseUrlVerified).toBe(true);

    const unorouter = AI_PROVIDER_CATALOG.find((entry) => entry.id === 'unorouter');
    expect(unorouter?.tier).toBe('paid');
    expect(unorouter?.requiresKey).toBe(true);
    expect(unorouter?.baseUrlVerified).toBe(false);
  });
});

describe('URL handling', () => {
  it('normalizes base URLs and strips query/hash/trailing slashes', () => {
    expect(normalizeBaseUrl('https://api.example.com/v1/?x=1#y')).toBe('https://api.example.com/v1');
    expect(normalizeBaseUrl('http://127.0.0.1:11434/v1/')).toBe('http://127.0.0.1:11434/v1');
  });

  it('rejects non-http and credential-bearing URLs', () => {
    expect(normalizeBaseUrl('ftp://example.com/v1')).toBeNull();
    expect(normalizeBaseUrl('not a url')).toBeNull();
    expect(normalizeBaseUrl('https://user:pass@example.com/v1')).toBeNull();
  });

  it('builds exactly one /chat/completions suffix', () => {
    expect(chatCompletionsUrl('https://api.llm7.io/v1/')).toBe('https://api.llm7.io/v1/chat/completions');
  });

  it('parses provider order lists', () => {
    expect(parseOrder(' LLM7 , unorouter ,, ')).toEqual(['llm7', 'unorouter']);
  });
});

describe('provider chain resolution', () => {
  it('uses the anonymous free provider when nothing is configured', () => {
    stubEnv();
    const resolution = resolveProviders(process.env);
    expect(resolution.providers.map((provider) => provider.id)).toEqual(['llm7']);
    expect(resolution.providers[0]?.anonymous).toBe(true);
    expect(resolution.providers[0]?.apiKey).toBe('');
  });

  it('drops key-requiring providers that have no key and explains why', () => {
    stubEnv();
    const resolution = resolveProviders(process.env);
    const skippedIds = resolution.skipped.map((entry) => entry.id);
    expect(skippedIds).toContain('unorouter');
    expect(resolution.skipped.find((entry) => entry.id === 'groq')?.reason).toContain('GROQ_API_KEY');
  });

  it('honours AI_ALLOW_ANONYMOUS=false and then fails closed with no configuration', () => {
    stubEnv({ AI_ALLOW_ANONYMOUS: 'false' });
    const resolution = resolveProviders(process.env);
    expect(resolution.providers).toEqual([]);
  });

  it('keeps a legacy OPENAI_* gateway first in the chain', () => {
    stubEnv({
      OPENAI_API_KEY: 'legacy-key',
      OPENAI_BASE_URL: 'https://gateway.internal/v1',
      AI_MODEL: 'custom-model',
    });
    const resolution = resolveProviders(process.env);
    expect(resolution.providers[0]).toMatchObject({
      id: 'custom',
      baseUrl: 'https://gateway.internal/v1',
      model: 'custom-model',
    });
    // The free provider stays available as a fallback.
    expect(resolution.providers.map((provider) => provider.id)).toContain('llm7');
  });

  it('prefers a per-provider model override over the global AI_MODEL', () => {
    stubEnv({ AI_MODEL: 'global-model', AI_MODEL_LLM7: 'llm7-specific' });
    const resolution = resolveProviders(process.env);
    const llm7 = resolution.providers.find((provider) => provider.id === 'llm7');
    expect(llm7?.model).toBe('llm7-specific');
  });

  it('skips providers with an unusable base URL instead of throwing', () => {
    stubEnv({ LLM7_BASE_URL: 'ftp://bad' });
    const resolution = resolveProviders(process.env);
    expect(resolution.providers.some((provider) => provider.id === 'llm7')).toBe(false);
    expect(resolution.warnings.join(' ')).toContain('LLM7_BASE_URL');
  });

  it('filters paid providers when AI_FREE_ONLY=true', () => {
    stubEnv({ AI_FREE_ONLY: 'true', UNOROUTER_API_KEY: 'paid-key' });
    const resolution = resolveProviders(process.env);
    expect(resolution.providers.some((provider) => provider.id === 'unorouter')).toBe(false);
    expect(resolution.skipped.some((entry) => entry.id === 'unorouter' && entry.reason.includes('AI_FREE_ONLY'))).toBe(true);
  });

  it('can pin a single provider with AI_PROVIDER', () => {
    stubEnv({ AI_PROVIDER: 'llm7', AI_PROVIDER_ORDER: 'llm7,gateway' });
    const resolution = resolveProviders(process.env);
    expect(resolution.providers.map((provider) => provider.id)).toEqual(['llm7']);
  });

  it('never exposes the API key when a provider is redacted', () => {
    stubEnv({ GROQ_API_KEY: 'super-secret', AI_PROVIDER_ORDER: 'groq' });
    const resolution = resolveProviders(process.env);
    const redacted = redactProvider(resolution.providers[0]!);
    expect(JSON.stringify(redacted)).not.toContain('super-secret');
    expect(redacted.hasKey).toBe(true);
  });

  it('warns when unverified hosts are used without an explicit override', () => {
    stubEnv({ UNOROUTER_API_KEY: 'key' });
    const resolution = resolveProviders(process.env);
    expect(resolution.providers.some((provider) => provider.id === 'unorouter')).toBe(true);
    expect(resolution.warnings.join(' ')).toContain('unverified default API host');
  });
});
