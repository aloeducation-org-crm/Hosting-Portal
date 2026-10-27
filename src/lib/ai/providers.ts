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
 *  - Optional self-hosted inference servers (LiteLLM/vLLM gateway, Ollama,
 *    LocalAI, local GLM-5 vLLM/SGLang) are opt-in and never stall startup or
 *    requests when unconfigured.
 *  - Cloud metadata and unspecified addresses (169.254.0.0/16, 0.0.0.0, IMDSv6)
 *    are unconditionally rejected even in operator env vars.
 */

export type ProviderTier = "free" | "paid" | "self-hosted";
export type ProviderKind = "openai-compatible" | "local-openai-compatible";

export interface ProviderCapabilities {
  /** Conservative default context window for the default model (tokens). */
  contextWindowTokens: number;
  /** Maximum completion tokens requested per call unless overridden safely. */
  maxOutputTokens: number;
  /** Whether `response_format: { type: "json_object" }` is generally accepted. */
  supportsJsonMode: boolean;
  /** Whether SSE streaming is supported by the upstream protocol. */
  supportsStreaming: boolean;
  /** Whether OpenAI-style `tools` / function calling is generally supported. */
  supportsToolCalls: boolean;
}

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
  /** Secondary env var checked if `apiKeyEnv` is unset (e.g. ZHIPU_API_KEY for GLM-5). */
  altApiKeyEnv?: string;
  /** Additional fallback env vars checked for the bearer token (e.g. ZAI_API_KEY). */
  extraApiKeyEnvs?: readonly string[];
  /** Provider-specific model env alias checked after `AI_MODEL_<ID>` (e.g. GLM_MODEL). */
  altModelEnv?: string;
  /** Allow keyless self-hosted operation when `baseUrlEnv` points at localhost/loopback. */
  allowLocalKeyless?: boolean;
  /** True when the API rejects unauthenticated requests. */
  requiresKey: boolean;
  /** True when the provider documents an anonymous/free tier that works without a key. */
  anonymousAccess: boolean;
  defaultModel: string;
  capabilities: ProviderCapabilities;
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
    capabilities: {
      contextWindowTokens: 32_768,
      maxOutputTokens: 4_096,
      supportsJsonMode: true,
      supportsStreaming: true,
      supportsToolCalls: false,
    },
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
    capabilities: {
      contextWindowTokens: 128_000,
      maxOutputTokens: 16_384,
      supportsJsonMode: true,
      supportsStreaming: true,
      supportsToolCalls: true,
    },
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
    capabilities: {
      contextWindowTokens: 128_000,
      maxOutputTokens: 16_384,
      supportsJsonMode: true,
      supportsStreaming: true,
      supportsToolCalls: true,
    },
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
    capabilities: {
      contextWindowTokens: 128_000,
      maxOutputTokens: 16_384,
      supportsJsonMode: true,
      supportsStreaming: true,
      supportsToolCalls: true,
    },
    docs: "https://openrouter.ai/docs/quick-start",
    notes:
      "Model aggregator: one OpenAI-compatible key reaches many upstream models. Credits are required. " +
      "Model IDs and free variants rotate — read GET /models and pin AI_MODEL_OPENROUTER to an enabled id. " +
      "Set HTTP-Referer/X-Title per OpenRouter's attribution guidance; never send the key to the browser.",
    baseUrlVerified: true,
  },
  {
    id: "okrouter",
    label: "OKRouter unified gateway",
    tier: "paid",
    kind: "openai-compatible",
    baseUrl: "https://api.okrouter.com/v1",
    baseUrlEnv: "OKROUTER_BASE_URL",
    apiKeyEnv: "OKROUTER_API_KEY",
    requiresKey: true,
    anonymousAccess: false,
    defaultModel: "gpt-4o-mini",
    capabilities: {
      contextWindowTokens: 128_000,
      maxOutputTokens: 16_384,
      supportsJsonMode: true,
      supportsStreaming: true,
      supportsToolCalls: true,
    },
    docs: "https://github.com/okrouter/okrouter-python",
    notes:
      "Unified OpenAI-compatible multi-model router (OpenAI/Claude/Gemini/Grok; official SDK okrouter/okrouter-python is MIT). " +
      "Opt-in only via AI_PROVIDER_ORDER + OKROUTER_API_KEY; confirm OKROUTER_BASE_URL against your account dashboard.",
    baseUrlVerified: false,
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
    capabilities: {
      contextWindowTokens: 131_072,
      maxOutputTokens: 8_192,
      supportsJsonMode: true,
      supportsStreaming: true,
      supportsToolCalls: true,
    },
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
    label: "GLM-5 (Z.ai / Zhipu OpenAI-compatible or self-hosted)",
    tier: "paid",
    kind: "openai-compatible",
    baseUrl: "https://api.z.ai/api/paas/v4",
    baseUrlEnv: "GLM_BASE_URL",
    apiKeyEnv: "GLM_API_KEY",
    altApiKeyEnv: "ZHIPU_API_KEY",
    extraApiKeyEnvs: ["ZAI_API_KEY"],
    altModelEnv: "GLM_MODEL",
    allowLocalKeyless: true,
    requiresKey: true,
    anonymousAccess: false,
    defaultModel: "glm-5",
    capabilities: {
      contextWindowTokens: 128_000,
      maxOutputTokens: 16_384,
      supportsJsonMode: true,
      supportsStreaming: true,
      supportsToolCalls: true,
    },
    docs: "https://github.com/zai-org/GLM-5",
    notes:
      "zai-org/GLM-5 (Apache-2.0): supports Z.ai international (https://api.z.ai/api/paas/v4), Zhipu mainland " +
      "(https://open.bigmodel.cn/api/paas/v4), or a self-hosted vLLM/SGLang server via GLM_BASE_URL (e.g. http://127.0.0.1:8000/v1). " +
      "Confirm GLM_BASE_URL for your region/account.",
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
    capabilities: {
      contextWindowTokens: 128_000,
      maxOutputTokens: 8_192,
      supportsJsonMode: true,
      supportsStreaming: true,
      supportsToolCalls: true,
    },
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
    altApiKeyEnv: "AI_GATEWAY_API_KEY",
    requiresKey: false,
    anonymousAccess: true,
    defaultModel: "qwen2.5:7b",
    capabilities: {
      contextWindowTokens: 32_768,
      maxOutputTokens: 4_096,
      supportsJsonMode: true,
      supportsStreaming: true,
      supportsToolCalls: true,
    },
    docs: "https://docs.litellm.ai/docs/proxy/quick_start",
    notes:
      "Completely free of per-token charges when backed by local models, or routes across upstreams via LiteLLM on :4000. " +
      "Bound to loopback by default: do not expose the gateway to the public internet without strong authentication.",
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
    defaultModel: "llama3.1:8b",
    capabilities: {
      contextWindowTokens: 32_768,
      maxOutputTokens: 4_096,
      supportsJsonMode: true,
      supportsStreaming: true,
      supportsToolCalls: true,
    },
    docs: "https://github.com/ollama/ollama/blob/main/docs/openai.md",
    notes: "Runs on the same box as the panel (port 11434); slow without a GPU. Model must be pulled first (ollama pull <model>).",
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
    defaultModel: "qwen2.5-7b-instruct",
    capabilities: {
      contextWindowTokens: 16_384,
      maxOutputTokens: 4_096,
      supportsJsonMode: true,
      supportsStreaming: true,
      supportsToolCalls: true,
    },
    docs: "https://localai.io/basics/getting_started/",
    notes:
      "Drop-in local OpenAI-compatible server (MIT, CPU/GPU GGUF/vLLM/whisper/embeddings). Opt-in only: enabled when LOCALAI_BASE_URL is set or 'localai' is listed in AI_PROVIDER_ORDER. Ensure port 8080 does not collide with reverse-proxy listeners.",
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
  capabilities: ProviderCapabilities;
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

export const DEFAULT_PROVIDER_ORDER = ["unorouter", "llm7", "groq", "glm", "gateway", "ollama", "localai"];

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

function readProviderKey(source: EnvSource, definition: ProviderDefinition): string {
  const primary = read(source, definition.apiKeyEnv);
  if (primary) return primary;
  if (definition.altApiKeyEnv) {
    const secondary = read(source, definition.altApiKeyEnv);
    if (secondary) return secondary;
  }
  if (definition.extraApiKeyEnvs) {
    for (const envName of definition.extraApiKeyEnvs) {
      const candidate = read(source, envName);
      if (candidate) return candidate;
    }
  }
  return "";
}

export function parseOrder(raw: string): string[] {
  return raw
    .split(",")
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);
}

const BLOCKED_METADATA_HOSTS = new Set([
  "0.0.0.0",
  "169.254.169.254",
  "100.100.100.200",
  "metadata.google.internal",
  "metadata.goog",
  "metadata",
  "instance-data",
  "[::]",
  "::",
  "[fd00:ec2::254]",
  "fd00:ec2::254",
]);

/**
 * Returns true if the hostname targets cloud instance metadata, link-local
 * ranges (169.254.0.0/16, fe80::/10), or unspecified wildcard addresses.
 */
export function isBlockedMetadataOrWildcardHost(hostname: string): boolean {
  const host = hostname.trim().toLowerCase();
  if (!host) return true;
  if (BLOCKED_METADATA_HOSTS.has(host)) return true;
  if (/^169\.254\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
  const bareIpv6 = host.replace(/^\[|\]$/g, "");
  if (bareIpv6 === "::" || bareIpv6.startsWith("fe80:") || bareIpv6 === "fd00:ec2::254") return true;
  return false;
}

/**
 * Returns true when a URL points at loopback, RFC1918 private LAN, CGNAT/Tailscale,
 * link-local, or cloud metadata addresses. Used to block SSRF in user-supplied URLs.
 */
export function isPrivateOrInternalUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return true;
  }
  const host = url.hostname.toLowerCase();
  if (isBlockedMetadataOrWildcardHost(host)) return true;
  if (host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]" || host.endsWith(".local") || host.endsWith(".internal")) {
    return true;
  }
  if (/^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
  if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
  if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
  const m172 = host.match(/^172\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/);
  if (m172) {
    const second = Number.parseInt(m172[1]!, 10);
    if (second >= 16 && second <= 31) return true;
  }
  const m100 = host.match(/^100\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/);
  if (m100) {
    const second = Number.parseInt(m100[1]!, 10);
    if (second >= 64 && second <= 127) return true;
  }
  const bareIpv6 = host.replace(/^\[|\]$/g, "");
  if (bareIpv6 === "::1" || bareIpv6.startsWith("fc") || bareIpv6.startsWith("fd")) return true;
  return false;
}

/** Normalize and validate an OpenAI-compatible base URL. Returns null when unusable or unsafe. */
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
  // Block cloud metadata and unspecified addresses even from env misconfiguration.
  if (isBlockedMetadataOrWildcardHost(url.hostname)) return null;
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
    const host = new URL(baseUrl).hostname.toLowerCase();
    return host === "127.0.0.1" || host === "localhost" || host === "::1" || host === "[::1]" || host.endsWith(".local");
  } catch {
    return false;
  }
}

/** Scrub bearer tokens, OpenAI/Groq/LiteLLM/Google keys, and URL credentials from log strings. */
export function redactSecretsInText(input: string): string {
  if (!input) return "";
  return input
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, "Bearer [REDACTED]")
    .replace(/\b(sk|gsk|rk|pk|xoxb|xoxp|ghp|gho|ghs|glpat)-[A-Za-z0-9_-]{10,}\b/g, "$1-[REDACTED]")
    .replace(/\bAIza[0-9A-Za-z_-]{20,}\b/g, "AIza[REDACTED]")
    .replace(/(https?:\/\/)([^/\s:@]+):([^/\s@]+)@/gi, "$1[REDACTED]@");
}

const DEFAULT_CUSTOM_CAPABILITIES: ProviderCapabilities = {
  contextWindowTokens: 64_000,
  maxOutputTokens: 8_192,
  supportsJsonMode: true,
  supportsStreaming: true,
  supportsToolCalls: true,
};

/**
 * Build the ordered failover chain for this process.
 *
 * Precedence:
 *  1. A legacy `OPENAI_API_KEY` + `OPENAI_BASE_URL` pair becomes an explicit
 *     `custom` provider that is tried first (this keeps existing deployments on
 *     the gateway they already configured).
 *  2. Providers listed in `AI_PROVIDER_ORDER` (default DEFAULT_PROVIDER_ORDER).
 *  3. `AI_FREE_ONLY=true` drops paid providers (unless overridden to local self-hosted).
 *  4. `AI_ALLOW_ANONYMOUS=false` (or `AI_ANONYMOUS_ACCESS=false`) drops
 *     providers that would be called without a key.
 *
 * `AI_MODEL` (legacy) overrides the model for every provider in the chain;
 * `AI_MODEL_<ID>` (or `altModelEnv` such as `GLM_MODEL`) wins over it for one provider only.
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
      warnings.push("OPENAI_BASE_URL is not a valid or permitted http(s) URL; the legacy gateway was skipped.");
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
        capabilities: DEFAULT_CUSTOM_CAPABILITIES,
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

    const baseRawEnv = definition.baseUrlEnv ? read(source, definition.baseUrlEnv) : "";
    const isSelfHostedOverride = Boolean(definition.allowLocalKeyless && baseRawEnv && isLocalHost(baseRawEnv));
    const effectiveTier: ProviderTier = isSelfHostedOverride ? "self-hosted" : definition.tier;
    const effectiveKind: ProviderKind = isSelfHostedOverride ? "local-openai-compatible" : definition.kind;
    const effectiveRequiresKey = isSelfHostedOverride ? false : definition.requiresKey;

    if (freeOnly && effectiveTier === "paid") {
      skipped.push({ id, label: definition.label, reason: "AI_FREE_ONLY=true" });
      continue;
    }

    // Self-hosted endpoints are opt-in: a fresh install must never waste time
    // or stall startup dialling 127.0.0.1:11434 / :4000 / :8080 when unused.
    const explicitlyListed = Boolean(rawOrder);
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
      warnings.push(`${definition.baseUrlEnv ?? definition.id} is not a valid or permitted http(s) URL; ${definition.label} was skipped.`);
      skipped.push({ id, label: definition.label, reason: "invalid or blocked base URL" });
      continue;
    }

    const apiKey = readProviderKey(source, definition);
    if (!apiKey && effectiveRequiresKey) {
      const keyLabel = definition.altApiKeyEnv
        ? `${definition.apiKeyEnv} (or ${definition.altApiKeyEnv}) not set`
        : `${definition.apiKeyEnv} not set`;
      skipped.push({ id, label: definition.label, reason: keyLabel });
      continue;
    }
    if (!apiKey && !allowAnonymous) {
      skipped.push({ id, label: definition.label, reason: "no key and AI_ALLOW_ANONYMOUS=false" });
      continue;
    }

    const effectiveBaseUrlVerified = definition.baseUrlVerified || Boolean(baseRawEnv) || isSelfHostedOverride;
    if (!effectiveBaseUrlVerified) {
      warnings.push(
        `${definition.label} is using an unverified default API host (${baseUrl}). ` +
          `Set ${definition.baseUrlEnv} to the host from your own dashboard before relying on it.`,
      );
    }

    const perProviderModel =
      read(source, `AI_MODEL_${id.toUpperCase()}`) ||
      (definition.altModelEnv ? read(source, definition.altModelEnv) : "");

    add({
      id,
      label: definition.label,
      tier: effectiveTier,
      kind: effectiveKind,
      baseUrl,
      apiKey,
      model: perProviderModel || globalModel || definition.defaultModel,
      anonymous: !apiKey,
      capabilities: definition.capabilities,
      docs: definition.docs,
      notes: definition.notes,
      baseUrlVerified: effectiveBaseUrlVerified,
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

export interface RedactProviderOptions {
  /**
   * When false (used for non-admin client responses), hides internal host/IP
   * topology so unprivileged tenants cannot enumerate private inference servers.
   * Defaults to true for backwards compatibility with internal/admin callers.
   */
  includeTopology?: boolean;
}

/** Strip secrets (and optionally internal topology) so a provider can be serialized safely. */
export function redactProvider(provider: ResolvedProvider, options: RedactProviderOptions = {}) {
  const includeTopology = options.includeTopology !== false;
  const maskedUrl = isPrivateOrInternalUrl(provider.baseUrl)
    ? "internal-endpoint (redacted)"
    : "configured-endpoint";

  return {
    id: provider.id,
    label: provider.label,
    tier: provider.tier,
    kind: provider.kind,
    baseUrl: includeTopology ? provider.baseUrl : maskedUrl,
    model: provider.model,
    anonymous: provider.anonymous,
    hasKey: Boolean(provider.apiKey),
    capabilities: provider.capabilities,
    docs: provider.docs,
    notes: provider.notes,
    baseUrlVerified: provider.baseUrlVerified,
  };
}

/**
 * Role-aware provider serializer: always strips API keys, and masks private/local
 * self-hosted gateway endpoints for non-admin roles while leaving verified public
 * cloud API base URLs visible.
 */
export function redactProviderForRole(provider: ResolvedProvider, isAdmin: boolean) {
  const hideInternal =
    !isAdmin &&
    (provider.kind === "local-openai-compatible" || isPrivateOrInternalUrl(provider.baseUrl));

  return {
    ...redactProvider(provider, { includeTopology: true }),
    baseUrl: hideInternal ? "[internal-self-hosted]" : provider.baseUrl,
  };
}

/** Client/operation tunables, all optional and bounded safely. */
export function aiRuntimeConfig(source: EnvSource = process.env) {
  const rawTemp = Number(read(source, "AI_TEMPERATURE") || 0.7);
  return {
    timeoutMs: Math.min(Math.max(readInt(source, "AI_TIMEOUT_MS", 60_000), 1_000), 300_000),
    retriesPerProvider: Math.min(Math.max(readInt(source, "AI_RETRIES_PER_PROVIDER", 1), 0), 3),
    /** After this many consecutive failures a provider is skipped for the cooldown window. */
    breakerThreshold: Math.max(readInt(source, "AI_BREAKER_THRESHOLD", 3), 1),
    breakerCooldownMs: Math.min(Math.max(readInt(source, "AI_BREAKER_COOLDOWN_MS", 60_000), 1_000), 3_600_000),
    maxTokens: Math.min(Math.max(readInt(source, "AI_MAX_TOKENS", 4096), 1), 32_768),
    temperature: Number.isFinite(rawTemp) ? Math.min(Math.max(rawTemp, 0), 2) : 0.7,
  };
}
