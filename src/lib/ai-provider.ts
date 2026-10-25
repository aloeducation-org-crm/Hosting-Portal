/**
 * Backwards-compatible entry point for the AI provider.
 *
 * The implementation now lives in `src/lib/ai/`:
 *   - `providers.ts` — registry + failover chain resolution
 *   - `client.ts`    — OpenAI-compatible calls, retries, breaker, JSON mode
 *
 * Existing imports of `@/lib/ai-provider` keep working. New code should import
 * from `@/lib/ai/client` directly.
 */

export {
  AIProviderError,
  completeWithAI,
  completeJSON,
  extractJson,
  listProviderModels,
  probeProvider,
  probeChain,
  resetProviderHealth,
  currentResolution,
  type AIMessage,
  type AICompletion,
  type AIAttempt,
  type AIErrorCode,
  type AIUsage,
  type CompleteOptions,
  type ModelInfo,
  type ProviderProbe,
} from "./ai/client";
