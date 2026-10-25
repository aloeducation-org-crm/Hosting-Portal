import { NextRequest, NextResponse } from 'next/server';
import { apiSuccess, apiError, type ApiResponse } from '@/lib/response';
import { requireSession } from '@/lib/auth';
import { AIProviderError, completeWithAI } from '@/lib/ai-provider';

function handleErr(e: unknown): NextResponse {
  if (e && typeof e === 'object' && 'status' in e) {
    const a = e as ApiResponse;
    return NextResponse.json(a, { status: a.status });
  }
  return NextResponse.json(apiError('Internal server error'), { status: 500 });
}

export async function POST(request: NextRequest) {
  try {
    await requireSession(request);
    const body = await request.json();
    const message = body.message ?? '';

    if (!message || typeof message !== 'string' || !message.trim()) {
      return NextResponse.json(apiError('Message is required', 'VALIDATION_ERROR', undefined, 400), { status: 400 });
    }

    const result = await completeWithAI([
      { role: 'system', content: 'You are a helpful AI assistant for an internal infrastructure control panel. Be concise and helpful.' },
      { role: 'user', content: message.trim() },
    ]);

    return NextResponse.json(apiSuccess({
      reply: result.text,
      model: result.model,
      tokensUsed: result.tokensUsed,
    }));
  } catch (e) {
    if (e instanceof AIProviderError) {
      return NextResponse.json({ success: false, error: e.message }, { status: e.status });
    }
    return handleErr(e);
  }
}
