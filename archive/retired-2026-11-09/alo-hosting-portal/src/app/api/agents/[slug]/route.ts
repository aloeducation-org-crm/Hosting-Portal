import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { apiError, type ApiResponse } from '@/lib/response';

function handleErr(e: unknown): NextResponse {
  if (e && typeof e === 'object' && 'status' in e) {
    const a = e as ApiResponse;
    return NextResponse.json(a, { status: a.status });
  }
  return NextResponse.json(apiError('Internal server error'), { status: 500 });
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const { slug } = await params;
    const agent = await db.aiAgent.findUnique({
      where: { slug },
      include: {
        _count: { select: { runs: true } },
      },
    });

    if (!agent || !agent.isActive) {
      return NextResponse.json(
        { success: false, error: 'Agent not found' },
        { status: 404 },
      );
    }

    const config = agent.config as Record<string, unknown> | null;

    return NextResponse.json({
      success: true,
      agent: {
        id: agent.id,
        name: agent.name,
        slug: agent.slug,
        description: agent.description ?? '',
        category: agent.category ?? 'utility',
        icon: agent.icon ?? 'Code2',
        systemPrompt: (config?.systemPrompt as string) ?? '',
        isFree: true,
        usageCount: agent._count.runs,
        config: JSON.stringify(config ?? {}),
      },
    });
  } catch (e) {
    return handleErr(e);
  }
}
