import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { apiSuccess, apiError, type ApiResponse } from '@/lib/response';

function handleErr(e: unknown): NextResponse {
  if (e && typeof e === 'object' && 'status' in e) {
    const a = e as ApiResponse;
    return NextResponse.json(a, { status: a.status });
  }
  return NextResponse.json(apiError('Internal server error'), { status: 500 });
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const category = searchParams.get('category');
    const search = searchParams.get('search');

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
