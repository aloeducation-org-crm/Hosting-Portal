import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { apiSuccess, apiError, type ApiResponse } from '@/lib/response';
import { requirePermission } from '@/lib/auth';
import { callHelper } from '@/lib/helpers';
import { db } from '@/lib/db';

const querySchema = z.object({
  websiteId: z.string().uuid(),
  source: z.enum(['caddy-access', 'caddy-error', 'systemd', 'php-fpm']).default('caddy-access'),
  lines: z.coerce.number().int().min(1).max(10000).default(100),
});

function handleErr(e: unknown): NextResponse {
  if (e && typeof e === 'object' && 'status' in e) {
    const a = e as ApiResponse;
    return NextResponse.json(a, { status: a.status });
  }
  return NextResponse.json(apiError('Internal server error'), { status: 500 });
}

export async function GET(request: NextRequest) {
  try {
    const user = await requirePermission(request, 'LOGS_READ');
    const { searchParams } = new URL(request.url);
    const input = querySchema.parse(Object.fromEntries(searchParams));

    const website = await db.website.findUnique({ where: { id: input.websiteId } });
    if (!website || website.deletedAt) {
      return NextResponse.json(apiError('Website not found', 'NOT_FOUND', undefined, 404), { status: 404 });
    }

    const result = await callHelper('alo-log-helper', [input.source, website.domain, String(input.lines)]);
    if (!result.success) {
      return NextResponse.json(apiError('Failed to fetch logs', 'LOG_ERROR', { stderr: result.stderr }), { status: 500 });
    }

    let data;
    try { data = JSON.parse(result.stdout); } catch { data = { lines: [], totalLines: 0 }; }

    return NextResponse.json(apiSuccess(data));
  } catch (e) {
    if (e instanceof z.ZodError) return NextResponse.json(apiError('Validation failed', 'VALIDATION_ERROR', e.flatten(), 400), { status: 400 });
    return handleErr(e);
  }
}
