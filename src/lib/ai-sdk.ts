import { completeWithAI, type AIMessage, type AICompletion } from "./ai-provider";
import { env } from "./env";

type ChatCompletionMessage = AIMessage;
type ChatCompletionResult = { choices: Array<{ message: { content: string } }> };
type ChatCompletions = { create: (params: { messages: ChatCompletionMessage[] }) => Promise<ChatCompletionResult> };
type Chat = { completions: ChatCompletions };

class ZAIClient {
  chat: Chat = {
    completions: {
      async create({ messages }) {
        const result = await completeWithAI(messages);
        return { choices: [{ message: { content: result.text } }] };
      },
    },
  };
}

export async function callLiteLLMGateway(
  messages: AIMessage[],
  options: { model?: string; temperature?: number; maxTokens?: number } = {}
): Promise<AICompletion> {
  const gatewayKey = env.AI_GATEWAY_KEY || env.OPENAI_API_KEY;
  const gatewayUrl = env.AI_GATEWAY_URL || env.OPENAI_BASE_URL;

  if (gatewayKey) {
    const endpoint = `${gatewayUrl.replace(/\/$/, "")}/chat/completions`;
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${gatewayKey}`,
      },
      body: JSON.stringify({
        model: options.model || env.AI_MODEL || "gemini-2.0-flash",
        messages,
        temperature: options.temperature ?? 0.7,
        max_tokens: options.maxTokens ?? 4096,
      }),
    });

    if (response.ok) {
      const data = (await response.json()) as {
        model?: string;
        choices?: Array<{ message?: { content?: string } }>;
        usage?: { total_tokens?: number };
      };
      const text = data.choices?.[0]?.message?.content ?? "";
      return {
        text,
        model: data.model || options.model || env.AI_MODEL,
        tokensUsed: data.usage?.total_tokens ?? 0,
      };
    }
  }

  return completeWithAI(messages, options);
}

const ZAI = { create: async () => new ZAIClient() };
export default ZAI;
