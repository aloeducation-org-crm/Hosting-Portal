import { NextRequest, NextResponse } from 'next/server';
import { apiSuccess, apiError, type ApiResponse } from '@/lib/response';
import { requireSession } from '@/lib/auth';
import { AIProviderError, completeWithAI, type AIMessage } from '@/lib/ai/client';
import { recordAIUsage } from '@/lib/ai/usage';

function handleErr(e: unknown): NextResponse {
  if (e && typeof e === 'object' && 'status' in e) {
    const a = e as ApiResponse;
    return NextResponse.json(a, { status: a.status });
  }
  return NextResponse.json(apiError('Internal server error'), { status: 500 });
}

const MAX_MESSAGES = 20;
const MAX_MESSAGE_CHARS = 12_000;

/** POST /api/ai/chat — { message } or { messages: [...] } */
export async function POST(request: NextRequest) {
  try {
    const user = await requireSession(request);
    const body = await request.json().catch(() => ({}));
    const rawHistory = body.messages;

    let messages: AIMessage[] = [];
    if (Array.isArray(rawHistory) && rawHistory.length) {
      messages = rawHistory
        .filter((entry): entry is { role: string; content: string } =>
          Boolean(entry) && typeof entry === 'object' &&
          typeof (entry as { content?: unknown }).content === 'string' &&
          ['system', 'user', 'assistant'].includes(String((entry as { role?: unknown }).role)))
        .slice(-MAX_MESSAGES)
        .map((entry) => ({
          role: entry.role as AIMessage['role'],
          content: entry.content.slice(0, MAX_MESSAGE_CHARS),
        }));
    } else {
      const message = typeof body.message === 'string' ? body.message.trim() : '';
      if (!message) {
        return NextResponse.json(apiError('Message is required', 'VALIDATION_ERROR', undefined, 400), { status: 400 });
      }
      messages = [
        { role: 'system', content: 'You are a helpful AI assistant for an internal infrastructure control panel. Be concise and helpful.' },
        { role: 'user', content: message.slice(0, MAX_MESSAGE_CHARS) },
      ];
    }

    const result = await completeWithAI(messages, { signal: request.signal });
    await recordAIUsage({
      userId: user.id,
      model: result.model,
      promptTokens: result.usage.promptTokens,
      completionTokens: result.usage.completionTokens,
      totalTokens: result.tokensUsed,
    });

    return NextResponse.json(apiSuccess({
      reply: result.text,
      model: result.model,
      provider: result.provider,
      tokensUsed: result.tokensUsed,
      latencyMs: result.latencyMs,
    }));
  } catch (e) {
    if (e instanceof AIProviderError) {
      return NextResponse.json(
        { success: false, error: e.message, code: e.code, attempts: e.attempts },
        { status: e.status },
      );
    }
    return handleErr(e);
  }
}
