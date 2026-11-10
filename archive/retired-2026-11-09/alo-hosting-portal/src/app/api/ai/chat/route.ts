import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/response';

async function callLLM(
  systemPrompt: string,
  userMessage: string,
): Promise<{ text: string; model: string; tokensUsed: number }> {
  const baseUrl = process.env.AI_GATEWAY_URL || 'http://127.0.0.1:11434/v1';
  const model = process.env.AI_MODEL || 'llama3.2:1b';
  const apiKey = process.env.AI_GATEWAY_KEY || 'ollama';

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
        temperature: 0.7,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
      }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!res.ok) {
      const body = await res.text();
      return {
        text: `AI Gateway error ${res.status}: ${body.slice(0, 150)}`,
        model,
        tokensUsed: 0,
      };
    }

    const data = await res.json();
    return {
      text: data.choices?.[0]?.message?.content ?? 'No response',
      model: data.model ?? model,
      tokensUsed: data.usage?.total_tokens ?? 0,
    };
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return {
      text: `Ollama connection error: ${errMsg}`,
      model,
      tokensUsed: 0,
    };
  }
}

const SYSTEM_PROMPTS: Record<string, string> = {
  'nova': 'You are Nova, an AI assistant for the ALO Labs cloud hosting platform. Help users with cloud hosting, domains, and servers.',
  'code-assistant': 'You are an expert DevOps engineer for ALO Labs. Assist with Docker, Node.js, Linux, Nginx, and server configuration.',
  'website-builder': 'You are an AI website builder assistant. Help users design and construct web applications.',
  'domain-advisor': 'You are a DNS and SSL specialist for ALO Labs. Help users configure domain routing.',
};

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const message = body.message ?? '';
    const agentType = body.agentType ?? 'nova';

    if (!message || typeof message !== 'string' || !message.trim()) {
      return NextResponse.json(apiError('Message is required', 'VALIDATION_ERROR', undefined, 400), { status: 400 });
    }

    const systemPrompt: string = (SYSTEM_PROMPTS[agentType] || SYSTEM_PROMPTS['nova'] || '') as string;
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
    return NextResponse.json({ success: false, error: 'Internal error' }, { status: 500 });
  }
}
