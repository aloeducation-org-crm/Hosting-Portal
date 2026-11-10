import { NextRequest, NextResponse } from 'next/server';
import { apiSuccess } from '@/lib/response';
import { requireSession } from '@/lib/auth';
import { env } from '@/lib/env';

function handleErr(e: unknown): NextResponse {
  if (e && typeof e === 'object' && 'status' in e) {
    const a = e as unknown as { status: number; success: boolean; message: string; data: null; error: unknown; requestId: string };
    return NextResponse.json(a, { status: a.status });
  }
  return NextResponse.json({ status: 500, success: false, message: 'Internal server error', data: null, error: { code: 'INTERNAL_ERROR' }, requestId: '' }, { status: 500 });
}

export async function GET(request: NextRequest) {
  try {
    await requireSession(request);

    return NextResponse.json(apiSuccess({
      window: env.RATE_LIMIT_WINDOW_SECONDS,
      max: env.RATE_LIMIT_MAX_REQUESTS,
      loginMax: 10,
      loginWindow: 60,
    }));
  } catch (e) {
    return handleErr(e);
  }
}
