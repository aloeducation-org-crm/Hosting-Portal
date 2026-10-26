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

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const user = await requireSession(request);
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

    const rawConfig = (agent.config as Record<string, unknown> | null) ?? {};
    const safeConfig = {
      temperature: typeof rawConfig.temperature === 'number' ? rawConfig.temperature : undefined,
      maxTokens: typeof rawConfig.maxTokens === 'number' ? rawConfig.maxTokens : undefined,
      ...(isAdminRole(user.role) && typeof rawConfig.model === 'string' ? { model: rawConfig.model } : {}),
    };

    return NextResponse.json({
      success: true,
      agent: {
        id: agent.id,
        name: agent.name,
        slug: agent.slug,
        description: agent.description ?? '',
        category: agent.category ?? 'utility',
        icon: agent.icon ?? 'Code2',
        systemPrompt: isAdminRole(user.role) ? ((rawConfig.systemPrompt as string) ?? '') : '',
        isFree: true,
        usageCount: agent._count.runs,
        config: JSON.stringify(safeConfig),
      },
    });
  } catch (e) {
    return handleErr(e);
  }
}
