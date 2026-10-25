import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/response';

async function callLLM(
  systemPrompt: string,
  userMessage: string,
): Promise<{ text: string; model: string; tokensUsed: number }> {
  const apiKey = process.env.AI_GATEWAY_KEY || process.env.OPENAI_API_KEY;
  const baseUrl = process.env.AI_GATEWAY_URL || process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
  const model = (process.env.AI_MODEL as string) || 'gpt-4o-mini';

  if (!apiKey || apiKey.includes('YOUR_') || apiKey === 'sk-demo') {
    return {
      text: `🤖 [ALO AI Assistant - Demo Mode]: Received message "${userMessage}". Connect your AI Provider in Settings to activate real-time LLM responses.`,
      model: 'demo-nova',
      tokensUsed: 0,
    };
  }

  const url = baseUrl.endsWith('/') ? `${baseUrl}chat/completions` : `${baseUrl}/chat/completions`;

  try {
    const res = await fetch(url, {
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
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) {
      const body = await res.text();
      return {
        text: `🤖 [ALO AI Warning]: AI Gateway returned HTTP ${res.status}. Error details: ${body.slice(0, 150)}`,
        model: 'gateway-error',
        tokensUsed: 0,
      };
    }

    const data = await res.json();
    return {
      text: data.choices?.[0]?.message?.content ?? '',
      model: data.model ?? model,
      tokensUsed: data.usage?.total_tokens ?? 0,
    };
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return {
      text: `🤖 [ALO AI Fallback]: Gateway connection pending (${errMsg}). Reply for: "${userMessage}"`,
      model: 'system-fallback',
      tokensUsed: 0,
    };
  }
}

const SYSTEM_PROMPTS: Record<string, string> = {
  'nova': 'You are Nova, a helpful AI assistant for ALO Labs hosting platform.',
  'code-assistant': 'You are a code assistant for ALO Labs server configuration.',
  'website-builder': 'You are a website builder assistant for ALO Labs.',
  'domain-advisor': 'You are a domain advisor for ALO Labs DNS and SSL.',
};

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const message = body.message ?? '';
    const agentType = body.agentType ?? 'nova';

    if (!message || typeof message !== 'string' || !message.trim()) {
      return NextResponse.json(apiError('Message is required', 'VALIDATION_ERROR', undefined, 400), { status: 400 });
    }

    const systemPrompt: string = SYSTEM_PROMPTS[agentType] ?? SYSTEM_PROMPTS['nova'] ?? '';

    const result = await callLLM(systemPrompt, message.trim());

    return NextResponse.json({
      success: true,
      message: result.text,
      reply: result.text,
      model: result.model,
      tokensUsed: result.tokensUsed,
      data: {
        reply: result.text,
        model: result.model,
        tokensUsed: result.tokensUsed,
      },
    });
  } catch (e) {
    return NextResponse.json({ success: false, error: 'Internal error', message: 'Something went wrong' }, { status: 500 });
  }
}
