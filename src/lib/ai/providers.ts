/**
 * AI provider registry.
 *
 * Every supported backend speaks the OpenAI-compatible chat-completions API, so
 * one adapter (`src/lib/ai/client.ts`) can talk to all of them and fail over
 * between them. Nothing in this file performs network I/O, and no secret is
 * ever returned to a caller that is going to serialize it to a browser.
 *
 * Design rules:
 *  - Configuration is read from `process.env` at call time (not import time) so
 *    that operators can change it without a rebuild and tests can stub it.
 *  - A provider that is misconfigured is *skipped with a reason*, never thrown
 *    from, so one bad environment variable cannot take the panel down.
 *  - "Free" here means the provider documents a free/anonymous tier. It is not
 *    a promise of unmetered capacity; see AI-PROVIDER-INTEGRATION.md.
 */

export type ProviderTier = "free" | "paid" | "self-hosted";
export type ProviderKind = "openai-compatible" | "local-openai-compatible";

export interface ProviderDefinition {
  /** Stable id used in env vars (AI_MODEL_<ID>, <ID>_BASE_URL, AI_PROVIDER_ORDER). */
  id: string;
  label: string;
  tier: ProviderTier;
  kind: ProviderKind;
  /** Default API root, without a trailing slash. */
  baseUrl: string;
  /** Env var that overrides `baseUrl`, when the operator needs a different host. */
  baseUrlEnv?: string;
  /** Env var holding the bearer token. */
  apiKeyEnv: string;
  /** True when the API rejects unauthenticated requests. */
  requiresKey: boolean;
  /** True when the provider documents an anonymous/free tier that works without a key. */
  anonymousAccess: boolean;
  defaultModel: string;
  docs: string;
  /** Operational caveats worth surfacing in the UI and docs. */
  notes: string;
  /** False when we could not confirm the API host from first-party sources. */
  baseUrlVerified: boolean;
}

export const AI_PROVIDER_CATALOG: readonly ProviderDefinition[] = [
  {
    id: "llm7",
    label: "LLM7.io (free tier)",
    tier: "free",
    kind: "openai-compatible",
    baseUrl: "https://api.llm7.io/v1",
    baseUrlEnv: "LLM7_BASE_URL",
    apiKeyEnv: "LLM7_API_KEY",
    requiresKey: false,
    anonymousAccess: true,
    defaultModel: "gpt-oss:20b",
    docs: "https://docs.llm7.io",
    notes:
      "Free token tier: roughly 60 requests/min and 250/hour, daily token quota. Anonymous calls reach a small subset of models. " +
      "Model IDs change; read GET /v1/models before pinning one.",
    baseUrlVerified: true,
  },
  {
    id: "unorouter",
    label: "UnoRouter gateway",
    tier: "paid",
    kind: "openai-compatible",
    baseUrl: "https://api.unorouter.com/v1",
    baseUrlEnv: "UNOROUTER_BASE_URL",
    apiKeyEnv: "UNOROUTER_API_KEY",
    requiresKey: true,
    anonymousAccess: false,
    defaultModel: "gpt-4o-mini",
    docs: "https://unorouter.com",
    notes:
      "UnoRouter's public repo is an AGPL storefront/dashboard for the UnoRouter gateway (a new-api fork reselling 130+ upstream providers). " +
      "It is not free inference: you need an account, credits and a token. Confirm the API host and enabled model IDs in your own dashboard " +
      "and set UNOROUTER_BASE_URL / UNOROUTER_API_KEY, because the default host below is unverified.",
    baseUrlVerified: false,
  },
  {
    id: "openai",
    label: "OpenAI",
    tier: "paid",
    kind: "openai-compatible",
    baseUrl: "https://api.openai.com/v1",
    apiKeyEnv: "PROVIDER_OPENAI_API_KEY",
    requiresKey: true,
    anonymousAccess: false,
    defaultModel: "gpt-4o-mini",
    docs: "https://platform.openai.com/docs/api-reference",
    notes: "Paid. Use a dedicated key with a spend limit; it is distinct from OPENAI_API_KEY so the legacy adapter keeps working.",
    baseUrlVerified: true,
  },
  {
    id: "groq",
    label: "Groq",
    tier: "free",
    kind: "openai-compatible",
    baseUrl: "https://api.groq.com/openai/v1",
    apiKeyEnv: "GROQ_API_KEY",
    requiresKey: true,
    anonymousAccess: false,
    defaultModel: "llama-3.3-70b-versatile",
    docs: "https://console.groq.com/docs/openai",
    notes: "Free tier with rate limits, key required. Model IDs are retired over time, so verify against GET /models.",
    baseUrlVerified: true,
  },
  {
    id: "gateway",
    label: "Self-hosted gateway (LiteLLM/vLLM)",
    tier: "self-hosted",
    kind: "local-openai-compatible",
    baseUrl: "http://127.0.0.1:4000/v1",
    baseUrlEnv: "AI_GATEWAY_URL",
    apiKeyEnv: "AI_GATEWAY_KEY",
    requiresKey: false,
    anonymousAccess: true,
    defaultModel: "gemma3:4b",
    docs: "https://docs.litellm.ai/docs/proxy/quick_start",
    notes:
      "Completely free of per-token charges but needs a GPU host, model weights, electricity and ops. " +
      "Bound to loopback by default: do not expose the gateway to the internet without auth.",
    baseUrlVerified: true,
  },
  {
    id: "ollama",
    label: "Ollama (local)",
    tier: "self-hosted",
    kind: "local-openai-compatible",
    baseUrl: "http://127.0.0.1:11434/v1",
    baseUrlEnv: "OLLAMA_BASE_URL",
    apiKeyEnv: "OLLAMA_API_KEY",
    requiresKey: false,
    anonymousAccess: true,
    defaultModel: "llama3.1",
    docs: "https://github.com/ollama/ollama/blob/main/docs/openai.md",
    notes: "Runs on the same box as the panel; slow without a GPU. Model must be pulled first (ollama pull <model>).",
    baseUrlVerified: true,
  },
] as const;

export interface ResolvedProvider {
  id: string;
  label: string;
  tier: ProviderTier;
  kind: ProviderKind;
  /** Normalized API root, no trailing slash. */
  baseUrl: string;
  /** Server-side only. Never serialize a resolved provider to the browser. */
  apiKey: string;
  model: string;
  anonymous: boolean;
  docs: string;
  notes: string;
  baseUrlVerified: boolean;
}

export interface SkippedProvider {
  id: string;
  label: string;
  reason: string;
}

export interface ProviderResolution {
  providers: ResolvedProvider[];
  skipped: SkippedProvider[];
  /** Non-fatal configuration problems (bad URL, unknown id in AI_PROVIDER_ORDER, ...). */
  warnings: string[];
  /** The order actually used, after env overrides. */
  order: string[];
}

export const DEFAULT_PROVIDER_ORDER = ["unorouter", "llm7", "groq", "gateway", "ollama"];

type EnvSource = Record<string, string | undefined>;

function read(source: EnvSource, key: string): string {
  const value = source[key];
  return typeof value === "string" ? value.trim() : "";
}

function readBool(source: EnvSource, key: string, fallback: boolean): boolean {
  const raw = read(source, key).toLowerCase();
  if (!raw) return fallback;
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

function readInt(source: EnvSource, key: string, fallback: number): number {
  const raw = read(source, key);
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function parseOrder(raw: string): string[] {
  return raw
    .split(",")
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);
}

/** Normalize and validate an OpenAI-compatible base URL. Returns null when unusable. */
export function normalizeBaseUrl(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  // Credentials in the URL would end up in logs and error messages.
  if (url.username || url.password) return null;
  url.search = "";
  url.hash = "";
  return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
}

/** The chat-completions endpoint for a provider (always exactly one suffix). */
export function chatCompletionsUrl(baseUrl: string): string {
  return `${normalizeBaseUrl(baseUrl) ?? baseUrl.replace(/\/+$/, "")}/chat/completions`;
}

export function isLocalHost(baseUrl: string): boolean {
  try {
    const host = new URL(baseUrl).hostname;
    return host === "127.0.0.1" || host === "localhost" || host === "::1" || host.endsWith(".local");
  } catch {
    return false;
  }
}

/**
 * Build the ordered failover chain for this process.
 *
 * Precedence:
 *  1. A legacy `OPENAI_API_KEY` + `OPENAI_BASE_URL` pair becomes an explicit
 *     `custom` provider that is tried first (this keeps existing deployments on
 *     the gateway they already configured).
 *  2. Providers listed in `AI_PROVIDER_ORDER` (default DEFAULT_PROVIDER_ORDER).
 *  3. `AI_FREE_ONLY=true` drops paid providers.
 *  4. `AI_ALLOW_ANONYMOUS=false` (or `AI_ANONYMOUS_ACCESS=false`) drops
 *     providers that would be called without a key.
 *
 * `AI_MODEL` (legacy) overrides the model for every provider in the chain;
 * `AI_MODEL_<ID>` wins over it for one provider only.
 */
export function resolveProviders(source: EnvSource = process.env): ProviderResolution {
  const warnings: string[] = [];
  const skipped: SkippedProvider[] = [];
  const providers: ResolvedProvider[] = [];
  const seen = new Set<string>();

  const allowAnonymous = readBool(source, "AI_ALLOW_ANONYMOUS", readBool(source, "AI_ANONYMOUS_ACCESS", true));
  const freeOnly = readBool(source, "AI_FREE_ONLY", false);
  const globalModel = read(source, "AI_MODEL");

  const byId = new Map(AI_PROVIDER_CATALOG.map((definition) => [definition.id, definition]));
  const rawOrder = read(source, "AI_PROVIDER_ORDER");
  const order = rawOrder ? parseOrder(rawOrder) : DEFAULT_PROVIDER_ORDER.slice();

  const add = (provider: ResolvedProvider) => {
    const key = `${provider.id}::${provider.baseUrl}`;
    if (seen.has(key)) return;
    seen.add(key);
    providers.push(provider);
  };

  // ── 1. Explicit legacy gateway (OPENAI_API_KEY / OPENAI_BASE_URL) ───────────
  const legacyKey = read(source, "OPENAI_API_KEY");
  if (legacyKey) {
    const baseRaw = read(source, "OPENAI_BASE_URL") || "https://api.openai.com/v1";
    const baseUrl = normalizeBaseUrl(baseRaw);
    if (!baseUrl) {
      warnings.push("OPENAI_BASE_URL is not a valid http(s) URL; the legacy gateway was skipped.");
    } else {
      add({
        id: "custom",
        label: "Configured gateway (OPENAI_*)",
        tier: isLocalHost(baseUrl) ? "self-hosted" : "paid",
        kind: isLocalHost(baseUrl) ? "local-openai-compatible" : "openai-compatible",
        baseUrl,
        apiKey: legacyKey,
        model: globalModel || "gpt-4o-mini",
        anonymous: false,
        docs: "https://platform.openai.com/docs/api-reference/chat",
        notes: "Legacy OPENAI_API_KEY / OPENAI_BASE_URL pair from this deployment's .env.",
        baseUrlVerified: true,
      });
    }
  }

  // ── 2. Catalog providers in the configured order ───────────────────────────
  for (const id of order) {
    const definition = byId.get(id);
    if (!definition) {
      warnings.push(`AI_PROVIDER_ORDER contains an unknown provider "${id}"; it was ignored.`);
      continue;
    }
    if (freeOnly && definition.tier === "paid") {
      skipped.push({ id, label: definition.label, reason: "AI_FREE_ONLY=true" });
      continue;
    }

    const baseRawEnv = definition.baseUrlEnv ? read(source, definition.baseUrlEnv) : '';
    // Self-hosted endpoints are opt-in: a fresh install should not spend 2s
    // failing to reach 127.0.0.1:11434 on every request.
    const explicitlyListed = rawOrder ? true : false;
    if (definition.kind === "local-openai-compatible" && !baseRawEnv && !explicitlyListed) {
      skipped.push({
        id,
        label: definition.label,
        reason: `not enabled (set ${definition.baseUrlEnv} or add "${id}" to AI_PROVIDER_ORDER)`,
      });
      continue;
    }

    const baseRaw = baseRawEnv || definition.baseUrl;
    const baseUrl = normalizeBaseUrl(baseRaw);
    if (!baseUrl) {
      warnings.push(`${definition.baseUrlEnv ?? definition.id} is not a valid http(s) URL; ${definition.label} was skipped.`);
      skipped.push({ id, label: definition.label, reason: "invalid base URL" });
      continue;
    }

    if (!definition.baseUrlVerified && !(definition.baseUrlEnv && read(source, definition.baseUrlEnv))) {
      warnings.push(
        `${definition.label} is using an unverified default API host (${baseUrl}). ` +
          `Set ${definition.baseUrlEnv} to the host from your own dashboard before relying on it.`,
      );
    }

    const apiKey = read(source, definition.apiKeyEnv);
    if (!apiKey && definition.requiresKey) {
      skipped.push({ id, label: definition.label, reason: `${definition.apiKeyEnv} not set` });
      continue;
    }
    if (!apiKey && !allowAnonymous) {
      skipped.push({ id, label: definition.label, reason: "no key and AI_ALLOW_ANONYMOUS=false" });
      continue;
    }

    const perProviderModel = read(source, `AI_MODEL_${id.toUpperCase()}`);
    add({
      id,
      label: definition.label,
      tier: definition.tier,
      kind: definition.kind,
      baseUrl,
      apiKey,
      model: perProviderModel || globalModel || definition.defaultModel,
      anonymous: !apiKey,
      docs: definition.docs,
      notes: definition.notes,
      baseUrlVerified: definition.baseUrlVerified,
    });
  }

  // ── 3. Explicit single-provider pinning ────────────────────────────────────
  const pinnedId = read(source, "AI_PROVIDER").toLowerCase();
  if (pinnedId) {
    const pinned = providers.filter((provider) => provider.id === pinnedId || provider.id === "custom");
    if (!pinned.some((provider) => provider.id === pinnedId)) {
      warnings.push(`AI_PROVIDER=${pinnedId} did not resolve to a configured provider; the full chain is still in use.`);
    } else {
      return { providers: pinned.filter((provider) => provider.id === pinnedId), skipped, warnings, order };
    }
  }

  return { providers, skipped, warnings, order };
}

/** Strip secrets so a provider can be serialized to a client response. */
export function redactProvider(provider: ResolvedProvider) {
  return {
    id: provider.id,
    label: provider.label,
    tier: provider.tier,
    kind: provider.kind,
    baseUrl: provider.baseUrl,
    model: provider.model,
    anonymous: provider.anonymous,
    hasKey: Boolean(provider.apiKey),
    docs: provider.docs,
    notes: provider.notes,
    baseUrlVerified: provider.baseUrlVerified,
  };
}

/** Client/operation tunables, all optional. */
export function aiRuntimeConfig(source: EnvSource = process.env) {
  return {
    timeoutMs: readInt(source, "AI_TIMEOUT_MS", 60_000),
    retriesPerProvider: Math.min(readInt(source, "AI_RETRIES_PER_PROVIDER", 1), 3),
    /** After this many consecutive failures a provider is skipped for the cooldown window. */
    breakerThreshold: Math.max(readInt(source, "AI_BREAKER_THRESHOLD", 3), 1),
    breakerCooldownMs: readInt(source, "AI_BREAKER_COOLDOWN_MS", 60_000),
    maxTokens: readInt(source, "AI_MAX_TOKENS", 4096),
    temperature: Number(read(source, "AI_TEMPERATURE") || 0.7),
  };
}
