/**
 * Stub module for z-ai-web-dev-sdk
 * Provides the same interface used by ai/code and ai/domain-advisor routes.
 */

type ChatCompletionMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

type ChatCompletionChoice = {
  message: {
    content: string;
  };
};

type ChatCompletionResult = {
  choices: ChatCompletionChoice[];
};

type ChatCompletions = {
  create: (params: { messages: ChatCompletionMessage[] }) => Promise<ChatCompletionResult>;
};

type Chat = {
  completions: ChatCompletions;
};

class ZAIClient {
  chat: Chat;

  constructor() {
    this.chat = {
      completions: {
        async create({ messages }: { messages: ChatCompletionMessage[] }): Promise<ChatCompletionResult> {
          // Return a placeholder response
          const lastMessage = messages[messages.length - 1];
          return {
            choices: [
              {
                message: {
                  content: `AI response stub for: ${lastMessage?.content?.slice(0, 100) ?? ''}`,
                },
              },
            ],
          };
        },
      },
    };
  }
}

const ZAI = {
  create: async () => new ZAIClient(),
};

export default ZAI;
