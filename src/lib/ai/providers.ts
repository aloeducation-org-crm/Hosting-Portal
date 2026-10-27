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

import { isCloudMetadataOrLinkLocalHost, isPrivateOrLoopbackHost } from "@/lib/security/url-guard";

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
  /** Secondary env var checked when `apiKeyEnv` is unset (e.g. upstream SDK convention). */
  altApiKeyEnv?: string;
  /**
   * When true and `baseUrlEnv` points at a loopback/local host (e.g. local vLLM/SGLang),
   * treat the provider as `self-hosted` and allow keyless requests when `AI_ALLOW_ANONYMOUS` permits.
   */
  allowLocalKeyless?: boolean;
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
    id: "openrouter",
    label: "OpenRouter",
    tier: "paid",
    kind: "openai-compatible",
    baseUrl: "https://openrouter.ai/api/v1",
    baseUrlEnv: "OPENROUTER_BASE_URL",
    apiKeyEnv: "OPENROUTER_API_KEY",
    requiresKey: true,
    anonymousAccess: false,
    defaultModel: "openai/gpt-4o-mini",
    docs: "https://openrouter.ai/docs/quick-start",
    notes:
      "Model aggregator: one OpenAI-compatible key reaches many upstream models. Credits are required. " +
      "Model IDs and free variants rotate — read GET /models and pin AI_MODEL_OPENROUTER to an enabled id. " +
      "Set HTTP-Referer/X-Title per OpenRouter's attribution guidance; never send the key to the browser.",
    baseUrlVerified: true,
  },
  {
    id: "qwen",
    label: "Qwen (DashScope compatible mode)",
    tier: "paid",
    kind: "openai-compatible",
    baseUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
    baseUrlEnv: "QWEN_BASE_URL",
    apiKeyEnv: "QWEN_API_KEY",
    requiresKey: true,
    anonymousAccess: false,
    defaultModel: "qwen-plus",
    docs: "https://help.aliyun.com/en/model-studio/compatibility-of-openai-with-dashscope",
    notes:
      "Alibaba Cloud Model Studio exposes an OpenAI-compatible endpoint. Confirm your REGION's host " +
      "(intl vs mainland) and enabled model ids in your own console, then set QWEN_BASE_URL; the default " +
      "host is intentionally marked unverified. Qwen Coder is a coding agent CLI, not an inference API — " +
      "it is not wired into the panel process.",
    baseUrlVerified: false,
  },
  {
    id: "glm",
    label: "GLM-5 (Z.ai / BigModel / Self-Hosted)",
    tier: "paid",
    kind: "openai-compatible",
    baseUrl: "https://api.z.ai/api/paas/v4",
    baseUrlEnv: "GLM_BASE_URL",
    apiKeyEnv: "GLM_API_KEY",
    altApiKeyEnv: "ZHIPU_API_KEY",
    allowLocalKeyless: true,
    requiresKey: true,
    anonymousAccess: false,
    defaultModel: "glm-5",
    docs: "https://github.com/zai-org/GLM-5",
    notes:
      "Apache-2.0 open-weights model series (GLM-5, GLM-5.1, GLM-5.2, GLM-5.3, GLM-5.3-Flash; 1M context & agentic coding). " +
      "Use via Z.ai / Zhipu BigModel OpenAI-compatible API (set GLM_API_KEY or ZHIPU_API_KEY and confirm your region host in GLM_BASE_URL: " +
      "https://api.z.ai/api/paas/v4 for international or https://open.bigmodel.cn/api/paas/v4 for China), OR self-host weights with vLLM/SGLang " +
      "and point GLM_BASE_URL at http://127.0.0.1:8000/v1. Optional GLM_REASONING_EFFORT (low|high|max) controls thinking budget.",
    baseUrlVerified: false,
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
  {
    id: "localai",
    label: "LocalAI (self-hosted)",
    tier: "self-hosted",
    kind: "local-openai-compatible",
    baseUrl: "http://127.0.0.1:8080/v1",
    baseUrlEnv: "LOCALAI_BASE_URL",
    apiKeyEnv: "LOCALAI_API_KEY",
    requiresKey: false,
    anonymousAccess: true,
    defaultModel: "llama-3.2-3b-instruct:q4_k_m",
    docs: "https://localai.io/basics/getting_started/",
    notes:
      "MIT-licensed OpenAI-compatible local server supporting text, vision, audio transcription and embeddings on CPU or CUDA/ROCm/Metal GPUs. " +
      "Keep bound to 127.0.0.1 or behind authenticated reverse proxy.",
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

export const DEFAULT_PROVIDER_ORDER = [
  "unorouter",
  "llm7",
  "groq",
  "glm",
  "gateway",
  "ollama",
  "localai",
];

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
  // Never allow cloud instance metadata or link-local SSRF targets (169.254.169.254, etc.).
  if (isCloudMetadataOrLinkLocalHost(url.hostname)) return null;
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

    const localSelfHosted = Boolean(definition.allowLocalKeyless && baseRawEnv && isLocalHost(baseUrl));
    const effectiveTier: ProviderTier = localSelfHosted ? "self-hosted" : definition.tier;
    const effectiveKind: ProviderKind = localSelfHosted ? "local-openai-compatible" : definition.kind;

    if (freeOnly && effectiveTier === "paid") {
      skipped.push({ id, label: definition.label, reason: "AI_FREE_ONLY=true" });
      continue;
    }

    const apiKey =
      read(source, definition.apiKeyEnv) || (definition.altApiKeyEnv ? read(source, definition.altApiKeyEnv) : "");
    const requiresKey = definition.requiresKey && !localSelfHosted;
    if (!apiKey && requiresKey) {
      const keyLabel = definition.altApiKeyEnv
        ? `${definition.apiKeyEnv} (or ${definition.altApiKeyEnv})`
        : definition.apiKeyEnv;
      skipped.push({ id, label: definition.label, reason: `${keyLabel} not set` });
      continue;
    }
    if (!apiKey && !allowAnonymous) {
      skipped.push({ id, label: definition.label, reason: "no key and AI_ALLOW_ANONYMOUS=false" });
      continue;
    }

    const baseUrlVerified = definition.baseUrlVerified || Boolean(baseRawEnv);
    if (!baseUrlVerified) {
      warnings.push(
        `${definition.label} is using an unverified default API host (${baseUrl}). ` +
          `Set ${definition.baseUrlEnv} to the host from your own dashboard before relying on it.`,
      );
    }

    const perProviderModel = read(source, `AI_MODEL_${id.toUpperCase()}`);
    add({
      id,
      label: definition.label,
      tier: effectiveTier,
      kind: effectiveKind,
      baseUrl,
      apiKey,
      model: perProviderModel || globalModel || definition.defaultModel,
      anonymous: !apiKey,
      docs: definition.docs,
      notes: definition.notes,
      baseUrlVerified,
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

/**
 * Role-aware provider redaction: non-admin callers never see internal
 * loopback/LAN gateway topology (`http://127.0.0.1:4000/v1`, `http://10.x...`).
 */
export function redactProviderForRole(provider: ResolvedProvider, isAdmin: boolean) {
  const base = redactProvider(provider);
  if (isAdmin) return base;
  let maskedUrl = base.baseUrl;
  try {
    const host = new URL(base.baseUrl).hostname;
    if (isPrivateOrLoopbackHost(host)) {
      maskedUrl = "[internal-self-hosted]";
    }
  } catch {
    maskedUrl = "[redacted]";
  }
  return {
    ...base,
    baseUrl: maskedUrl,
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
