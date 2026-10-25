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

    const pipelines = await db.crmPipeline.findMany({
      where,
      include: { deals: true },
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

    if (!body.stages || !Array.isArray(body.stages) || body.stages.length === 0) {
      return NextResponse.json(apiError('stages must be a non-empty array', 'VALIDATION_ERROR', undefined, 400), { status: 400 });
    }

    const pipeline = await db.crmPipeline.create({
      data: {
        name: body.name,
        stages: JSON.stringify(body.stages),
        isDefault: body.isDefault ?? false,
        userId: auth.id,
      },
    });

    return NextResponse.json(apiSuccess(pipeline));
  } catch (e) {
    return handleErr(e);
  }
}
