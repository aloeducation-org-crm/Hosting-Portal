import { NextRequest, NextResponse } from 'next/server';
import { apiSuccess, apiError, type ApiResponse } from '@/lib/response';
import { requireSession } from '@/lib/auth';

function handleErr(e: unknown): NextResponse {
  if (e && typeof e === 'object' && 'status' in e) {
    const a = e as ApiResponse;
    return NextResponse.json(a, { status: a.status });
  }
  return NextResponse.json(apiError('Internal server error'), { status: 500 });
}

/**
 * Call an OpenAI-compatible LLM API.
 * Falls back to a simple echo when no API key is configured.
 */
async function callLLM(
  systemPrompt: string,
  userMessage: string,
): Promise<{ text: string; model: string; tokensUsed: number }> {
  const apiKey = process.env.OPENAI_API_KEY;
  const baseUrl = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
  const model = (process.env.AI_MODEL as string) || 'gpt-4o-mini';

  if (apiKey) {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0.5,
        max_tokens: 4096,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
      }),
      signal: AbortSignal.timeout(120_000),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`LLM API error ${res.status}: ${body.slice(0, 300)}`);
    }

    const data = await res.json();
    return {
      text: data.choices?.[0]?.message?.content ?? '',
      model: data.model ?? model,
      tokensUsed: data.usage?.total_tokens ?? 0,
    };
  }

  // Fallback when no API key is configured
  return {
    text: `This is a demo AI response. You said: "${userMessage}". Configure OPENAI_API_KEY to enable real AI responses.`,
    model: 'alolabs-built-in',
    tokensUsed: 0,
  };
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireSession(request);
    const body = await request.json();
    const message = body.message ?? '';

    if (!message || typeof message !== 'string' || !message.trim()) {
      return NextResponse.json(apiError('Message is required', 'VALIDATION_ERROR', undefined, 400), { status: 400 });
    }

    const result = await callLLM(
      'You are a helpful AI assistant for a web hosting platform. Be concise and helpful.',
      message.trim(),
    );

    return NextResponse.json(apiSuccess({
      reply: result.text,
      model: result.model,
      tokensUsed: result.tokensUsed,
    }));
  } catch (e) {
    if (e instanceof Error && e.message.includes('LLM API error')) {
      return NextResponse.json(
        { success: false, error: e.message },
        { status: 502 },
      );
    }
    return handleErr(e);
  }
}
