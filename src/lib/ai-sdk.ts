import { completeWithAI, type AIMessage } from './ai-provider';

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

const ZAI = { create: async () => new ZAIClient() };
export default ZAI;
