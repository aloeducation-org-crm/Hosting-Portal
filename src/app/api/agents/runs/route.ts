import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { isAdminRole, requireSession } from '@/lib/auth';
import { apiError, type ApiResponse } from '@/lib/response';

function handleErr(e: unknown): NextResponse {
  if (e && typeof e === 'object' && 'status' in e) {
    const a = e as ApiResponse;
    return NextResponse.json(a, { status: a.status });
  }
  return NextResponse.json(apiError('Internal server error'), { status: 500 });
}

/**
 * GET /api/agents/runs?slug=&limit=
 *
 * Tenant-isolated execution history: non-admin users only ever receive their
 * own runs (`userId === user.id`). Admins may inspect runs across users or
 * filter by `?userId=`.
 */
export async function GET(request: NextRequest) {
  try {
    const user = await requireSession(request);
    const { searchParams } = new URL(request.url);
    const slug = searchParams.get('slug')?.trim() || undefined;
    const requestedUserId = searchParams.get('userId')?.trim() || undefined;
    const parsedLimit = Number.parseInt(searchParams.get('limit') ?? '50', 10);
    const take = Number.isFinite(parsedLimit) ? Math.min(Math.max(parsedLimit, 1), 100) : 50;

    if (requestedUserId && requestedUserId !== user.id && !isAdminRole(user.role)) {
      throw apiError('Forbidden: cannot inspect another user\'s agent runs', 'FORBIDDEN', undefined, 403);
    }

    const where: Record<string, unknown> = {
      ...(isAdminRole(user.role)
        ? requestedUserId
          ? { userId: requestedUserId }
          : {}
        : { userId: user.id }),
      ...(slug ? { agent: { slug } } : {}),
    };

    const runs = await db.aiAgentRun.findMany({
      where,
      take,
      orderBy: { createdAt: 'desc' },
      include: {
        agent: {
          select: {
            name: true,
            slug: true,
            icon: true,
          },
        },
      },
    });

    const formatted = runs.map((r) => ({
      id: r.id,
      input: r.input ?? '',
      output: r.output,
      status: r.status,
      tokensUsed: r.tokensUsed ?? 0,
      durationMs: r.durationMs ?? null,
      model: r.model ?? null,
      createdAt: r.createdAt.toISOString(),
      agent: {
        name: r.agent.name,
        slug: r.agent.slug,
        icon: r.agent.icon ?? 'Code2',
      },
    }));

    return NextResponse.json({ success: true, runs: formatted });
  } catch (e) {
    return handleErr(e);
  }
}
