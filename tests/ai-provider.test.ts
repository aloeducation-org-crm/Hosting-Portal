import { afterEach, describe, expect, it, vi } from 'vitest';
import { AIProviderError, completeWithAI } from '../src/lib/ai-provider';

afterEach(() => vi.unstubAllGlobals());

describe('AI provider adapter', () => {
  it('fails closed instead of returning a demo/echo answer when no key is configured', async () => {
    await expect(completeWithAI([{ role: 'user', content: 'hello' }]))
      .rejects.toMatchObject<Partial<AIProviderError>>({ status: 503, message: 'AI provider is not configured' });
  });
});
