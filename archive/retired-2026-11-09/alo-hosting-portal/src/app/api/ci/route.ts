import { NextRequest, NextResponse } from 'next/server';
import { apiSuccess, apiError, type ApiResponse } from '@/lib/response';
import { requireSession, ROLES } from '@/lib/auth';
import { db } from '@/lib/db';

function handleErr(e: unknown): NextResponse {
  if (e && typeof e === 'object' && 'status' in e) {
    const a = e as ApiResponse;
    return NextResponse.json(a, { status: a.status });
  }
  return NextResponse.json(apiError('Internal server error'), { status: 500 });
}

export async function GET(request: NextRequest) {
  try {
    const auth = await requireSession(request);

    const where: any = {};
    if (auth.role !== ROLES.SUPER_ADMIN) {
      where.userId = auth.id;
    }

    const pipelines = await db.ciPipeline.findMany({
      where,
      include: {
        website: true,
        builds: {
          orderBy: { number: 'desc' },
          take: 1,
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    return NextResponse.json(apiSuccess(pipelines));
  } catch (e) {
    return handleErr(e);
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireSession(request);
    const body = await request.json();

    if (!body.name) {
      return NextResponse.json(apiError('name is required', 'VALIDATION_ERROR', undefined, 400), { status: 400 });
    }

    const pipeline = await db.ciPipeline.create({
      data: {
        name: body.name,
        websiteId: body.websiteId ?? undefined,
        repository: body.repository ?? undefined,
        branch: body.branch ?? 'main',
        buildCmd: body.buildCmd ?? undefined,
        deployCmd: body.deployCmd ?? undefined,
        status: body.status ?? 'active',
        userId: auth.id,
      },
    });

    return NextResponse.json(apiSuccess(pipeline));
  } catch (e) {
    return handleErr(e);
  }
}
