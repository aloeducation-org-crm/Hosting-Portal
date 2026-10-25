/**
 * Server-only AI client.
 *
 * One OpenAI-compatible adapter for every provider in the registry, with:
 *   - ordered failover across the configured chain,
 *   - bounded retries for transient failures (429/5xx/network),
 *   - a per-provider circuit breaker so a rate-limited free tier does not add
 *     latency to every request,
 *   - strict timeouts and no leakage of provider response bodies or keys,
 *   - JSON mode with a defensive parser.
 *
 * Nothing here is safe to import from a client component: it reads API keys.
 */

import {
  aiRuntimeConfig,
  chatCompletionsUrl,
  resolveProviders,
  type ProviderResolution,
  type ResolvedProvider,
} from "./providers";

export type AIMessage = { role: "system" | "user" | "assistant"; content: string };

export interface AIUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface AICompletion {
  text: string;
  model: string;
  /** Id of the provider that actually answered (not the requested one). */
  provider: string;
  providerLabel: string;
  usage: AIUsage;
  tokensUsed: number;
  latencyMs: number;
  /** One entry per provider attempt, in order. Never contains response bodies. */
  attempts: AIAttempt[];
}

export interface AIAttempt {
  provider: string;
  ok: boolean;
  status?: number;
  error?: string;
  latencyMs: number;
}

export type AIErrorCode =
  | "AI_NOT_CONFIGURED"
  | "AI_TIMEOUT"
  | "AI_UPSTREAM_ERROR"
  | "AI_INVALID_RESPONSE"
  | "AI_ABORTED";

export class AIProviderError extends Error {
  readonly code: AIErrorCode;
  readonly status: number;
  readonly attempts: AIAttempt[];

  constructor(message: string, status: number, code: AIErrorCode = "AI_UPSTREAM_ERROR", attempts: AIAttempt[] = []) {
    super(message);
    this.name = "AIProviderError";
    this.code = code;
    this.status = status;
    this.attempts = attempts;
  }

  /** Public, secret-free payload for API responses. */
  toJSON() {
    return { code: this.code, message: this.message, attempts: this.attempts };
  }
}

export interface CompleteOptions {
  /** Overrides the model for every provider in the chain. */
  model?: string;
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
  retriesPerProvider?: number;
  /** Ask the upstream for a JSON object and validate/parse it. */
  json?: boolean;
  /** Caller cancellation (e.g. the inbound request was aborted). */
  signal?: AbortSignal;
  /** Restrict the chain to these provider ids. */
  onlyProviders?: string[];
  /** Skip the (in-memory) breaker and the cache. Used by health probes. */
  probe?: boolean;
}

// ─── Circuit breaker ─────────────────────────────────────────────────────────

type BreakerState = { failures: number; openUntil: number };
const breakers = new Map<string, BreakerState>();

function breakerKey(provider: ResolvedProvider) {
  return `${provider.id}::${provider.baseUrl}::${provider.model}`;
}

function isCoolingDown(provider: ResolvedProvider): boolean {
  const state = breakers.get(breakerKey(provider));
  return Boolean(state && state.openUntil > Date.now());
}

function noteFailure(provider: ResolvedProvider) {
  const key = breakerKey(provider);
  const config = aiRuntimeConfig();
  const state = breakers.get(key) ?? { failures: 0, openUntil: 0 };
  state.failures += 1;
  if (state.failures >= config.breakerThreshold) {
    state.openUntil = Date.now() + config.breakerCooldownMs;
    state.failures = 0;
  }
  breakers.set(key, state);
}

function noteSuccess(provider: ResolvedProvider) {
  breakers.delete(breakerKey(provider));
}

/** Test/ops helper: clear breaker state (used after changing credentials). */
export function resetProviderHealth(): void {
  breakers.clear();
}

// ─── Chain helpers ───────────────────────────────────────────────────────────

export function currentResolution(): ProviderResolution {
  return resolveProviders(process.env);
}

function selectChain(options: CompleteOptions): ResolvedProvider[] {
  const resolution = currentResolution();
  let chain = resolution.providers;
  if (options.onlyProviders?.length) {
    const wanted = new Set(options.onlyProviders);
    chain = chain.filter((provider) => wanted.has(provider.id));
  }
  if (options.probe) return chain;
  const ready = chain.filter((provider) => !isCoolingDown(provider));
  // If everything is cooling down, still try: better a slow success than a hard outage.
  return ready.length ? ready : chain;
}

const RETRYABLE_STATUS = new Set([408, 409, 425, 429, 500, 502, 503, 504]);

function isRetryable(status: number): boolean {
  return RETRYABLE_STATUS.has(status);
}

function upstreamMessage(status: number): string {
  if (status === 401 || status === 403) return "AI provider rejected the credentials";
  if (status === 404) return "AI provider does not expose this model or endpoint";
  if (status === 429) return "AI provider rate limit reached";
  if (status >= 500) return "AI provider is unavailable";
  return `AI provider returned HTTP ${status}`;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new AIProviderError("AI request aborted", 499, "AI_ABORTED"));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener?.("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new AIProviderError("AI request aborted", 499, "AI_ABORTED"));
    };
    signal?.addEventListener?.("abort", onAbort, { once: true });
  });
}

// ─── Request/response plumbing ───────────────────────────────────────────────

type ChatResponseBody = {
  model?: unknown;
  choices?: Array<{ message?: { content?: unknown } }>;
  usage?: { prompt_tokens?: unknown; completion_tokens?: unknown; total_tokens?: unknown };
};

function parseUsage(body: ChatResponseBody): AIUsage {
  const promptTokens = typeof body.usage?.prompt_tokens === "number" ? body.usage.prompt_tokens : 0;
  const completionTokens = typeof body.usage?.completion_tokens === "number" ? body.usage.completion_tokens : 0;
  const total = typeof body.usage?.total_tokens === "number" ? body.usage.total_tokens : promptTokens + completionTokens;
  return { promptTokens, completionTokens, totalTokens: total };
}

async function callProvider(
  provider: ResolvedProvider,
  messages: AIMessage[],
  options: CompleteOptions,
  config: ReturnType<typeof aiRuntimeConfig>,
): Promise<AICompletion> {
  const startedAt = Date.now();
  const timeoutMs = options.timeoutMs ?? config.timeoutMs;
  const body: Record<string, unknown> = {
    model: options.model || provider.model,
    messages,
    temperature: options.temperature ?? config.temperature,
    max_tokens: options.maxTokens ?? config.maxTokens,
    stream: false,
  };
  if (options.json) body.response_format = { type: "json_object" };

  const headers: Record<string, string> = { "content-type": "application/json" };
  if (provider.apiKey) headers.authorization = `Bearer ${provider.apiKey}`;
  else headers["x-title"] = "alo-hosting-panel"; // LLM7 asks anonymous clients to identify themselves.

  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const signal = options.signal ? AbortSignal.any([options.signal, timeoutSignal]) : timeoutSignal;

  let response: Response;
  try {
    response = await fetch(chatCompletionsUrl(provider.baseUrl), {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal,
      cache: "no-store",
    });
  } catch (error) {
    const aborted = options.signal?.aborted;
    throw new AIProviderError(
      aborted ? "AI request aborted" : "AI provider could not be reached",
      aborted ? 499 : 502,
      aborted ? "AI_ABORTED" : "AI_TIMEOUT",
    );
  }

  if (!response.ok) {
    // Deliberately never surface the upstream body: it can echo the prompt or key hints.
    throw new AIProviderError(upstreamMessage(response.status), response.status === 429 ? 503 : 502, "AI_UPSTREAM_ERROR");
  }

  let parsed: ChatResponseBody;
  try {
    parsed = (await response.json()) as ChatResponseBody;
  } catch {
    throw new AIProviderError("AI provider returned malformed JSON", 502, "AI_INVALID_RESPONSE");
  }

  const content = parsed.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) {
    throw new AIProviderError("AI provider returned no text", 502, "AI_INVALID_RESPONSE");
  }

  const usage = parseUsage(parsed);
  return {
    text: content,
    model: typeof parsed.model === "string" ? parsed.model : (options.model || provider.model),
    provider: provider.id,
    providerLabel: provider.label,
    usage,
    tokensUsed: usage.totalTokens,
    latencyMs: Date.now() - startedAt,
    attempts: [],
  };
}

function summarizeAttempts(attempts: AIAttempt[]): string {
  const grouped = new Map<string, { count: number; error?: string; status?: number }>();
  for (const attempt of attempts) {
    const entry = grouped.get(attempt.provider) ?? { count: 0 };
    entry.count += 1;
    if (!attempt.ok) {
      entry.error = attempt.error;
      entry.status = attempt.status;
    }
    grouped.set(attempt.provider, entry);
  }
  return [...grouped.entries()]
    .map(([provider, entry]) => `${provider}${entry.count > 1 ? ` x${entry.count}` : ""} (${entry.error ?? entry.status ?? "unknown"})`)
    .join(", ");
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Complete a chat request against the configured provider chain.
 * Fails closed (`AI_NOT_CONFIGURED`, HTTP 503) when no provider can be used —
 * it never returns canned/demo text.
 */
export async function completeWithAI(messages: AIMessage[], options: CompleteOptions = {}): Promise<AICompletion> {
  if (!messages.length) {
    throw new AIProviderError("At least one message is required", 400, "AI_INVALID_RESPONSE");
  }

  const config = aiRuntimeConfig();
  const chain = selectChain(options);
  if (!chain.length) {
    const resolution = currentResolution();
    const detail = resolution.skipped.map((entry) => `${entry.id}: ${entry.reason}`).join("; ");
    throw new AIProviderError(
      "AI provider is not configured" + (detail ? ` (${detail})` : ""),
      503,
      "AI_NOT_CONFIGURED",
    );
  }

  const attempts: AIAttempt[] = [];
  const retries = Math.max(options.retriesPerProvider ?? config.retriesPerProvider, 0);

  for (const provider of chain) {
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      const attemptStarted = Date.now();
      try {
        const result = await callProvider(provider, messages, options, config);
        noteSuccess(provider);
        return { ...result, attempts: [...attempts, { provider: provider.id, ok: true, latencyMs: result.latencyMs }] };
      } catch (error) {
        const err = error instanceof AIProviderError
          ? error
          : new AIProviderError("AI provider call failed", 502, "AI_UPSTREAM_ERROR");

        attempts.push({
          provider: provider.id,
          ok: false,
          status: err.status,
          error: err.message,
          latencyMs: Date.now() - attemptStarted,
        });

        // Caller cancellation must not trigger retries or failover.
        if (err.code === "AI_ABORTED") {
          throw new AIProviderError(err.message, err.status, err.code, attempts);
        }

        noteFailure(provider);

        const lastAttemptForProvider = attempt === retries;
        if (!lastAttemptForProvider && (err.code === "AI_TIMEOUT" || err.status === 429 || err.status >= 500)) {
          await sleep(Math.min(250 * 2 ** attempt, 2000), options.signal);
          continue;
        }
        break; // move to the next provider
      }
    }
  }

  const summary = attempts.length ? summarizeAttempts(attempts) : "no attempts";
  throw new AIProviderError(`All AI providers failed: ${summary}`, 502, "AI_UPSTREAM_ERROR", attempts);
}

/** Strip markdown fences and surrounding prose, then parse JSON. */
export function extractJson<T = unknown>(raw: string): T {
  const trimmed = raw.trim();
  const candidates: string[] = [trimmed];

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) candidates.push(fenced[1].trim());

  const firstBrace = trimmed.search(/[{[]/);
  const lastBrace = Math.max(trimmed.lastIndexOf("}"), trimmed.lastIndexOf("]"));
  if (firstBrace >= 0 && lastBrace > firstBrace) candidates.push(trimmed.slice(firstBrace, lastBrace + 1));

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate) as T;
    } catch {
      // try the next candidate
    }
  }
  throw new AIProviderError("AI provider returned invalid JSON", 502, "AI_INVALID_RESPONSE");
}

/**
 * Ask for JSON and parse it. If the model returns prose that contains no JSON
 * object, this throws instead of inventing data.
 */
export async function completeJSON<T = unknown>(
  messages: AIMessage[],
  options: CompleteOptions = {},
): Promise<{ data: T; completion: AICompletion }> {
  const completion = await completeWithAI(messages, { ...options, json: true });
  return { data: extractJson<T>(completion.text), completion };
}

export interface ModelInfo {
  provider: string;
  providerLabel: string;
  models: string[];
  latencyMs: number;
  error?: string;
}

/**
 * Live model catalogue for one provider (`GET {baseUrl}/models`).
 * Free providers change these IDs often, so the UI should not hardcode them.
 */
export async function listProviderModels(provider: ResolvedProvider, timeoutMs = 10_000): Promise<ModelInfo> {
  const startedAt = Date.now();
  const headers: Record<string, string> = {};
  if (provider.apiKey) headers.authorization = `Bearer ${provider.apiKey}`;
  try {
    const response = await fetch(`${provider.baseUrl}/models`, {
      headers,
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
    });
    if (!response.ok) {
      return {
        provider: provider.id,
        providerLabel: provider.label,
        models: [],
        latencyMs: Date.now() - startedAt,
        error: upstreamMessage(response.status),
      };
    }
    const body = (await response.json()) as { data?: Array<{ id?: unknown }> };
    const models = (body.data ?? [])
      .map((entry) => entry?.id)
      .filter((id): id is string => typeof id === "string" && id.length > 0)
      .sort();
    return { provider: provider.id, providerLabel: provider.label, models, latencyMs: Date.now() - startedAt };
  } catch {
    return {
      provider: provider.id,
      providerLabel: provider.label,
      models: [],
      latencyMs: Date.now() - startedAt,
      error: "Could not reach the provider",
    };
  }
}

export interface ProviderProbe {
  provider: string;
  providerLabel: string;
  ok: boolean;
  latencyMs: number;
  model?: string;
  error?: string;
}

/**
 * Real connectivity check: one tiny completion. This is the only way to claim a
 * provider is healthy — configuration alone proves nothing.
 */
export async function probeProvider(provider: ResolvedProvider): Promise<ProviderProbe> {
  const startedAt = Date.now();
  try {
    const result = await completeWithAI(
      [{ role: "user", content: "Reply with the single word: ok" }],
      { onlyProviders: [provider.id], maxTokens: 8, temperature: 0, timeoutMs: 15_000, retriesPerProvider: 0, probe: true },
    );
    return {
      provider: provider.id,
      providerLabel: provider.label,
      ok: true,
      latencyMs: Date.now() - startedAt,
      model: result.model,
    };
  } catch (error) {
    const err = error instanceof AIProviderError ? error : new AIProviderError("probe failed", 502);
    return {
      provider: provider.id,
      providerLabel: provider.label,
      ok: false,
      latencyMs: Date.now() - startedAt,
      error: err.message,
    };
  }
}

/** Small cache so the status endpoint does not hammer free tiers. */
const probeCache = new Map<string, { at: number; probes: ProviderProbe[] }>();
const PROBE_TTL_MS = 60_000;

export async function probeChain(force = false): Promise<ProviderProbe[]> {
  const resolution = currentResolution();
  const chain = resolution.providers.filter((provider) => !provider.id.startsWith("custom"));
  const targets = chain.length ? chain : resolution.providers;
  const key = targets.map((provider) => `${provider.id}:${provider.model}`).join("|");
  const cached = probeCache.get(key);
  if (!force && cached && Date.now() - cached.at < PROBE_TTL_MS) return cached.probes;

  const probes = await Promise.all(targets.map((provider) => probeProvider(provider)));
  probeCache.set(key, { at: Date.now(), probes });
  return probes;
}
