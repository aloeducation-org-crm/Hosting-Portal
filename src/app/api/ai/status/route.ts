import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth';
import { env } from '@/lib/env';

export async function GET(request: NextRequest) {
  try {
    await requireSession(request);
    const configured = Boolean(env.OPENAI_API_KEY.trim());
    return NextResponse.json({
      success: true,
      data: {
        configured,
        providerType: configured ? 'openai-compatible-gateway' : null,
        model: configured ? env.AI_MODEL : null,
        // Configuration is not a live connectivity or model-health check.
        state: configured ? 'CONFIGURED_NOT_CHECKED' : 'NOT_CONFIGURED',
      },
    });
  } catch {
    return NextResponse.json({ success: false, error: 'Authentication required' }, { status: 401 });
  }
}
