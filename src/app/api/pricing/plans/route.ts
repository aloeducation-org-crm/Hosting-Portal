import { NextRequest, NextResponse } from 'next/server';
import { apiSuccess, apiError, type ApiResponse } from '@/lib/response';
import { db } from '@/lib/db';

function handleErr(e: unknown): NextResponse {
  if (e && typeof e === 'object' && 'status' in e) {
    const a = e as ApiResponse;
    return NextResponse.json(a, { status: a.status });
  }
  return NextResponse.json(apiError('Internal server error'), { status: 500 });
}

export async function GET() {
  try {
    const plans = await db.plan.findMany({
      where: { isActive: true },
    });
    return NextResponse.json(apiSuccess(plans));
  } catch (e) {
    return handleErr(e);
  }
}
