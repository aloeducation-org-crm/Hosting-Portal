import { NextRequest, NextResponse } from 'next/server';
import { apiSuccess, apiError, type ApiResponse } from '@/lib/response';
import { requirePermission } from '@/lib/auth';
import { callHelper } from '@/lib/helpers';
import { db } from '@/lib/db';

function handleErr(e: unknown): NextResponse {
  if (e && typeof e === 'object' && 'status' in e) {
    const a = e as ApiResponse;
    return NextResponse.json(a, { status: a.status });
  }
  return NextResponse.json(apiError('Internal server error'), { status: 500 });
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requirePermission(request, 'LOGS_READ');
    const { id } = await params;

    const website = await db.website.findUnique({ where: { id } });
    if (!website || website.deletedAt) {
      return NextResponse.json(apiError('Website not found', 'NOT_FOUND', undefined, 404), { status: 404 });
    }

    const { searchParams } = new URL(request.url);
    const lines = searchParams.get('lines') ?? '100';

    const args = ['website-logs', website.domain, lines];
    const result = await callHelper('alo-log-helper', args);

    if (!result.success) {
      return NextResponse.json(apiError('Failed to fetch logs', 'HELPER_ERROR', { stderr: result.stderr }), { status: 500 });
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(result.stdout);
    } catch {
      parsed = { raw: result.stdout };
    }

    return NextResponse.json(apiSuccess(parsed));
  } catch (e) { return handleErr(e); }
}
