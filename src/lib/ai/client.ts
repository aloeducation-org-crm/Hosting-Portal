/**
 * Server-only AI client.
 *
 * One OpenAI-compatible adapter for every provider in the registry, with:
 *   - ordered failover across the configured chain,
 *   - bounded retries for transient failures (429/5xx/network),
 *   - a per-provider circuit breaker so an unavailable local service or
 *     rate-limited free tier does not add latency to every request,
 *   - strict timeouts, redirect blocking (`redirect: "error"`), and zero
 *     leakage of provider response bodies or keys,
 *   - request correlation IDs (`requestId`) for structured observability,
 *   - JSON mode with a defensive parser.
 *
 * Nothing here is safe to import from a client component: it reads API keys.
 */

import { randomUUID } from "crypto";
import {
  aiRuntimeConfig,
  chatCompletionsUrl,
  redactSecretsInText,
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
  /** True when `usage` came from the upstream provider response rather than defaulting to 0. */
  usageReportedByProvider: boolean;
  tokensUsed: number;
  latencyMs: number;
  /** Correlation ID propagated across logs, audit trails, and responses. */
  requestId: string;
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
  | "AI_ABORTED"
  | "AI_CONTEXT_EXCEEDED";

export class AIProviderError extends Error {
  readonly code: AIErrorCode;
  readonly status: number;
  readonly attempts: AIAttempt[];
  readonly requestId: string;

  constructor(
    message: string,
    status: number,
    code: AIErrorCode = "AI_UPSTREAM_ERROR",
    attempts: AIAttempt[] = [],
    requestId: string = randomUUID(),
  ) {
    super(redactSecretsInText(message));
    this.name = "AIProviderError";
    this.code = code;
    this.status = status;
    this.attempts = attempts;
    this.requestId = requestId;
  }

  /** Public, secret-free payload for API responses. */
  toJSON() {
    return {
      code: this.code,
      message: this.message,
      requestId: this.requestId,
      attempts: this.attempts,
    };
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
  /** Optional correlation ID from the inbound HTTP request. */
  requestId?: string;
}

// ─── Circuit breaker ─────────────────────────────────────────────────────────

type BreakerState = { failures: number; openUntil: number; lastErrorAt?: number };
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
  state.lastErrorAt = Date.now();
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

export interface ProviderCircuitSnapshot {
  provider: string;
  circuitOpen: boolean;
  consecutiveFailures: number;
  cooldownRemainingMs: number;
}

/** Inspect in-process circuit breaker states without issuing network calls. */
export function getProviderCircuitStates(providers: readonly ResolvedProvider[]): ProviderCircuitSnapshot[] {
  const now = Date.now();
  return providers.map((provider) => {
    const state = breakers.get(breakerKey(provider));
    const remaining = state && state.openUntil > now ? state.openUntil - now : 0;
    return {
      provider: provider.id,
      circuitOpen: remaining > 0,
      consecutiveFailures: state?.failures ?? 0,
      cooldownRemainingMs: remaining,
    };
  });
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

function upstreamMessage(status: number): string {
  if (status === 401 || status === 403) return "AI provider rejected the credentials";
  if (status === 404) return "AI provider does not expose this model or endpoint";
  if (status === 413) return "Prompt exceeded provider context window";
  if (status === 429) return "AI provider rate limit reached";
  if (status >= 500) return "AI provider is unavailable";
  return `AI provider returned HTTP ${status}`;
}

function sleep(ms: number, signal?: AbortSignal, requestId?: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new AIProviderError("AI request aborted", 499, "AI_ABORTED", [], requestId));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener?.("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new AIProviderError("AI request aborted", 499, "AI_ABORTED", [], requestId));
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

function parseUsage(body: ChatResponseBody): { usage: AIUsage; reportedByProvider: boolean } {
  const hasUsageObj = Boolean(
    body.usage &&
      (typeof body.usage.prompt_tokens === "number" ||
        typeof body.usage.completion_tokens === "number" ||
        typeof body.usage.total_tokens === "number"),
  );
  const promptTokens = typeof body.usage?.prompt_tokens === "number" ? Math.max(0, body.usage.prompt_tokens) : 0;
  const completionTokens = typeof body.usage?.completion_tokens === "number" ? Math.max(0, body.usage.completion_tokens) : 0;
  const total = typeof body.usage?.total_tokens === "number" ? Math.max(0, body.usage.total_tokens) : promptTokens + completionTokens;
  return {
    usage: { promptTokens, completionTokens, totalTokens: total },
    reportedByProvider: hasUsageObj,
  };
}

/** Rough ~4 chars/token heuristic strictly to guard absurdly oversized prompts. */
function estimatePromptTokensRough(messages: readonly AIMessage[]): number {
  let chars = 0;
  for (const m of messages) {
    chars += (m.content?.length ?? 0) + 16;
  }
  return Math.ceil(chars / 4);
}

async function callProvider(
  provider: ResolvedProvider,
  messages: AIMessage[],
  options: CompleteOptions,
  config: ReturnType<typeof aiRuntimeConfig>,
  requestId: string,
): Promise<AICompletion> {
  const startedAt = Date.now();
  // Local opt-in services fail fast if unreachable so failover stays snappy.
  const defaultTimeout =
    provider.kind === "local-openai-compatible" && options.timeoutMs === undefined
      ? Math.min(config.timeoutMs, 15_000)
      : config.timeoutMs;
  const timeoutMs = options.timeoutMs ?? defaultTimeout;

  const requestedMaxTokens = Math.max(1, Math.trunc(options.maxTokens ?? config.maxTokens));
  const clampedMaxTokens = Math.min(requestedMaxTokens, provider.capabilities.maxOutputTokens);

  const roughPromptTokens = estimatePromptTokensRough(messages);
  if (roughPromptTokens > provider.capabilities.contextWindowTokens * 1.25) {
    throw new AIProviderError(
      `Estimated prompt length (~${roughPromptTokens} tokens) exceeds ${provider.id} context window (${provider.capabilities.contextWindowTokens})`,
      413,
      "AI_CONTEXT_EXCEEDED",
      [],
      requestId,
    );
  }

  const body: Record<string, unknown> = {
    model: options.model || provider.model,
    messages,
    temperature: options.temperature ?? config.temperature,
    max_tokens: clampedMaxTokens,
    stream: false,
  };
  if (options.json && provider.capabilities.supportsJsonMode) {
    body.response_format = { type: "json_object" };
  }

  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-request-id": requestId,
  };
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
      // Security: never follow 301/302 redirects from an upstream API host onto internal/metadata targets.
      redirect: "error",
    });
  } catch {
    const aborted = options.signal?.aborted;
    throw new AIProviderError(
      aborted ? "AI request aborted" : "AI provider could not be reached",
      aborted ? 499 : 502,
      aborted ? "AI_ABORTED" : "AI_TIMEOUT",
      [],
      requestId,
    );
  }

  if (!response.ok) {
    // Deliberately never surface the upstream body: it can echo the prompt or key hints.
    throw new AIProviderError(
      upstreamMessage(response.status),
      response.status === 429 ? 503 : 502,
      "AI_UPSTREAM_ERROR",
      [],
      requestId,
    );
  }

  let parsed: ChatResponseBody;
  try {
    parsed = (await response.json()) as ChatResponseBody;
  } catch {
    throw new AIProviderError("AI provider returned malformed JSON", 502, "AI_INVALID_RESPONSE", [], requestId);
  }

  const content = parsed.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) {
    throw new AIProviderError("AI provider returned no text", 502, "AI_INVALID_RESPONSE", [], requestId);
  }

  const { usage, reportedByProvider } = parseUsage(parsed);
  return {
    text: content,
    model: typeof parsed.model === "string" ? parsed.model : (options.model || provider.model),
    provider: provider.id,
    providerLabel: provider.label,
    usage,
    usageReportedByProvider: reportedByProvider,
    tokensUsed: usage.totalTokens,
    latencyMs: Date.now() - startedAt,
    requestId,
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
  const requestId = options.requestId || randomUUID();
  if (!messages.length) {
    throw new AIProviderError("At least one message is required", 400, "AI_INVALID_RESPONSE", [], requestId);
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
      [],
      requestId,
    );
  }

  const attempts: AIAttempt[] = [];
  const retries = Math.max(options.retriesPerProvider ?? config.retriesPerProvider, 0);

  for (const provider of chain) {
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      const attemptStarted = Date.now();
      try {
        const result = await callProvider(provider, messages, options, config, requestId);
        noteSuccess(provider);
        return {
          ...result,
          attempts: [...attempts, { provider: provider.id, ok: true, latencyMs: result.latencyMs }],
        };
      } catch (error) {
        const err = error instanceof AIProviderError
          ? error
          : new AIProviderError("AI provider call failed", 502, "AI_UPSTREAM_ERROR", [], requestId);

        attempts.push({
          provider: provider.id,
          ok: false,
          status: err.status,
          error: err.message,
          latencyMs: Date.now() - attemptStarted,
        });

        // Caller cancellation must not trigger retries or failover.
        if (err.code === "AI_ABORTED") {
          throw new AIProviderError(err.message, err.status, err.code, attempts, requestId);
        }

        if (err.code !== "AI_CONTEXT_EXCEEDED") {
          noteFailure(provider);
        }

        const lastAttemptForProvider = attempt === retries;
        if (
          !lastAttemptForProvider &&
          err.code !== "AI_CONTEXT_EXCEEDED" &&
          (err.code === "AI_TIMEOUT" || err.status === 429 || err.status >= 500)
        ) {
          await sleep(Math.min(250 * 2 ** attempt, 2000), options.signal, requestId);
          continue;
        }
        break; // move to the next provider
      }
    }
  }

  if (attempts.length > 0 && attempts.every((a) => a.status === 413)) {
    throw new AIProviderError(
      `Prompt exceeded context window across configured providers: ${summarizeAttempts(attempts)}`,
      413,
      "AI_CONTEXT_EXCEEDED",
      attempts,
      requestId,
    );
  }

  const summary = attempts.length ? summarizeAttempts(attempts) : "no attempts";
  throw new AIProviderError(`All AI providers failed: ${summary}`, 502, "AI_UPSTREAM_ERROR", attempts, requestId);
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
      redirect: "error",
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
