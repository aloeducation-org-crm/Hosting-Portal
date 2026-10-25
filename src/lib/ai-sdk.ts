/**
 * Thin compatibility wrapper kept for the legacy `ZAI` / `callLiteLLMGateway`
 * call sites (`/api/ai/code`, `/api/ai/domain-advisor`).
 *
 * It now delegates to the single provider-chain client, so those routes get the
 * same failover, timeout and secret-hygiene behaviour as everything else.
 */

import { completeWithAI, type AIMessage, type AICompletion } from "./ai/client";

type ChatCompletionMessage = AIMessage;
type ChatCompletionResult = { choices: Array<{ message: { content: string } }> };
type ChatCompletions = {
  create: (params: { messages: ChatCompletionMessage[]; model?: string; temperature?: number }) => Promise<ChatCompletionResult>;
};
type Chat = { completions: ChatCompletions };

class ProviderClient {
  chat: Chat = {
    completions: {
      async create({ messages, model, temperature }) {
        const result = await completeWithAI(messages, { model, temperature });
        return { choices: [{ message: { content: result.text } }] };
      },
    },
  };
}

export async function callLiteLLMGateway(
  messages: AIMessage[],
  options: { model?: string; temperature?: number; maxTokens?: number } = {},
): Promise<AICompletion> {
  return completeWithAI(messages, options);
}

const ZAI = { create: async () => new ProviderClient() };
export default ZAI;
