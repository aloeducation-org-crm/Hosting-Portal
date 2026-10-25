import { env } from '@/lib/env';

export type AIMessage = { role: 'system' | 'user' | 'assistant'; content: string };
export type AICompletion = { text: string; model: string; tokensUsed: number };

export class AIProviderError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'AIProviderError';
  }
}

/** Server-only OpenAI-compatible API adapter (works with UnoRouter and similar gateways). */
export async function completeWithAI(messages: AIMessage[], options: { temperature?: number; maxTokens?: number } = {}): Promise<AICompletion> {
  const key = env.OPENAI_API_KEY.trim();
  if (!key) throw new AIProviderError('AI provider is not configured', 503);

  let endpoint: URL;
  try {
    endpoint = new URL(env.OPENAI_BASE_URL);
  } catch {
    throw new AIProviderError('AI provider URL is invalid', 503);
  }
  if (!['https:', 'http:'].includes(endpoint.protocol) || endpoint.username || endpoint.password) {
    throw new AIProviderError('AI provider URL must use HTTP(S) and must not contain credentials', 503);
  }
  endpoint.pathname = `${endpoint.pathname.replace(/\/$/, '')}/chat/completions`;
  endpoint.search = '';
  endpoint.hash = '';

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: env.AI_MODEL,
        messages,
        temperature: options.temperature ?? 0.7,
        max_tokens: options.maxTokens ?? 4096,
      }),
      signal: AbortSignal.timeout(120_000),
      cache: 'no-store',
    });
  } catch {
    throw new AIProviderError('AI provider could not be reached', 502);
  }

  if (!response.ok) {
    // Do not return provider response bodies: they may contain credentials or private data.
    throw new AIProviderError(`AI provider returned HTTP ${response.status}`, 502);
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new AIProviderError('AI provider returned malformed JSON', 502);
  }
  if (!body || typeof body !== 'object') throw new AIProviderError('AI provider returned an invalid response', 502);
  const data = body as {
    model?: unknown;
    choices?: Array<{ message?: { content?: unknown } }>;
    usage?: { total_tokens?: unknown };
  };
  const content = data.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content.trim()) throw new AIProviderError('AI provider returned no text', 502);
  return {
    text: content,
    model: typeof data.model === 'string' ? data.model : env.AI_MODEL,
    tokensUsed: typeof data.usage?.total_tokens === 'number' ? data.usage.total_tokens : 0,
  };
}
