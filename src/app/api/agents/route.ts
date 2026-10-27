import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireSession } from '@/lib/auth';
import { ensureDefaultAgentsSeeded } from '@/lib/seed-agents';
import { apiError, type ApiResponse } from '@/lib/response';

function handleErr(e: unknown): NextResponse {
  if (e && typeof e === 'object' && 'status' in e) {
    const a = e as ApiResponse;
    return NextResponse.json(a, { status: a.status });
  }
  return NextResponse.json(apiError('Internal server error'), { status: 500 });
}

export async function GET(request: NextRequest) {
  try {
    await requireSession(request);

    const existingCount = await db.aiAgent.count();
    if (existingCount === 0) {
      await ensureDefaultAgentsSeeded();
    }

    const { searchParams } = new URL(request.url);
    const category = searchParams.get('category');
    const search = searchParams.get('search')?.trim().slice(0, 120);

    const where: Record<string, unknown> = { isActive: true };
    if (category && category !== 'All') {
      where.category = category.toLowerCase();
    }
    if (search) {
      where.OR = [
        { name: { contains: search } },
        { description: { contains: search } },
      ];
    }

    const agents = await db.aiAgent.findMany({
      where,
      take: 100,
      orderBy: { createdAt: 'asc' },
      include: {
        _count: { select: { runs: true } },
      },
    });

    const formatted = agents.map((a) => ({
      id: a.id,
      name: a.name,
      slug: a.slug,
      description: a.description ?? '',
      category: a.category ?? 'utility',
      icon: a.icon ?? 'Code2',
      isFree: true,
      usageCount: a._count.runs,
    }));

    return NextResponse.json({ success: true, agents: formatted });
  } catch (e) {
    return handleErr(e);
  }
}
