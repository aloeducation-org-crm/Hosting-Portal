import { NextRequest, NextResponse } from 'next/server';
import { apiSuccess, apiError, type ApiResponse } from '@/lib/response';
import { requireSession } from '@/lib/auth';
import { db } from '@/lib/db';

function handleErr(e: unknown): NextResponse {
  if (e && typeof e === 'object' && 'status' in e) {
    const a = e as ApiResponse;
    return NextResponse.json(a, { status: a.status });
  }
  return NextResponse.json(apiError('Internal server error'), { status: 500 });
}

export async function GET(request: NextRequest) {
  try {
    const user = await requireSession(request);

    const logs = await db.auditLog.findMany({
      where: { actorUserId: user.id },
      orderBy: { timestamp: 'desc' },
      take: 20,
    });

    return NextResponse.json(apiSuccess(logs));
  } catch (e) {
    return handleErr(e);
  }
}
