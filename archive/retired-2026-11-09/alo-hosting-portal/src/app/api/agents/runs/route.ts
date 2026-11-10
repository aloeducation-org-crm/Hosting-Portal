import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { apiError, apiSuccess, type ApiResponse } from '@/lib/response';

function handleErr(e: unknown): NextResponse {
  if (e && typeof e === 'object' && 'status' in e) {
    const a = e as ApiResponse;
    return NextResponse.json(a, { status: a.status });
  }
  return NextResponse.json(apiError('Internal server error'), { status: 500 });
}

export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    // Accept both Bearer token and session-based auth
    // For now, return recent runs (the frontend filters by slug client-side)

    const runs = await db.aiAgentRun.findMany({
      take: 50,
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
