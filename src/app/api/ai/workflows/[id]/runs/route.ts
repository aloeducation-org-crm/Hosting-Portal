import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { isAdminRole, requireSession } from '@/lib/auth';
import { apiError, apiSuccess, type ApiResponse } from '@/lib/response';

function handleErr(e: unknown): NextResponse {
  if (e && typeof e === 'object' && 'status' in e) {
    const a = e as ApiResponse;
    return NextResponse.json(a, { status: a.status });
  }
  return NextResponse.json(apiError('Internal server error'), { status: 500 });
}

/** GET /api/ai/workflows/:id/runs?limit=20&status=failed */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireSession(request);
    const { id } = await params;

    const workflow = await db.aiWorkflow.findUnique({ where: { id }, select: { id: true, userId: true } });
    if (!workflow) {
      return NextResponse.json(apiError('Workflow not found', 'NOT_FOUND', undefined, 404), { status: 404 });
    }
    if (!isAdminRole(user.role) && workflow.userId !== user.id) {
      return NextResponse.json(apiError('Forbidden', 'FORBIDDEN', undefined, 403), { status: 403 });
    }

    const url = new URL(request.url);
    const limitRaw = Number.parseInt(url.searchParams.get('limit') ?? '20', 10);
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 100) : 20;
    const status = url.searchParams.get('status');

    const runs = await db.aiWorkflowRun.findMany({
      where: { workflowId: id, ...(status ? { status } : {}) },
      orderBy: { startedAt: 'desc' },
      take: limit,
    });

    return NextResponse.json(apiSuccess({ runs }));
  } catch (e) {
    return handleErr(e);
  }
}
