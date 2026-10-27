import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { ensureDefaultAgentsSeeded } from '@/lib/seed-agents';
import { apiSuccess, apiError, type ApiResponse } from '@/lib/response';

function handleErr(e: unknown): NextResponse {
  if (e && typeof e === 'object' && 'status' in e) {
    const a = e as ApiResponse;
    return NextResponse.json(a, { status: a.status });
  }
  return NextResponse.json(apiError('Internal server error'), { status: 500 });
}

export async function POST(request: NextRequest) {
  try {
    await requireAdmin(request);
    const { seeded, total } = await ensureDefaultAgentsSeeded();

    return NextResponse.json(
      apiSuccess(
        { seeded, total },
        `Seeded ${seeded} new agents`,
      ),
    );
  } catch (e) {
    return handleErr(e);
  }
}
