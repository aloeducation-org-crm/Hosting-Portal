import { afterEach, describe, expect, it, vi } from 'vitest';
import { AIProviderError, completeWithAI } from '../src/lib/ai-provider';

afterEach(() => vi.unstubAllEnvs());

describe('AI provider adapter (compatibility entry point)', () => {
  it('fails closed instead of returning a demo/echo answer when no provider is usable', async () => {
    // With anonymous free access disabled and no keys, the chain is empty.
    vi.stubEnv('AI_ALLOW_ANONYMOUS', 'false');
    vi.stubEnv('OPENAI_API_KEY', '');
    vi.stubEnv('UNOROUTER_API_KEY', '');
    vi.stubEnv('GROQ_API_KEY', '');
    vi.stubEnv('PROVIDER_OPENAI_API_KEY', '');
    vi.stubEnv('AI_GATEWAY_KEY', '');

    await expect(completeWithAI([{ role: 'user', content: 'hello' }]))
      .rejects.toMatchObject<Partial<AIProviderError>>({ status: 503, message: expect.stringContaining('AI provider is not configured') });
  });
});
