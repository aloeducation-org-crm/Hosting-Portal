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
    const { searchParams } = new URL(request.url);
    const stage = searchParams.get('stage');

    const where: any = {};
    if (auth.role !== ROLES.SUPER_ADMIN) {
      where.userId = auth.id;
    }
    if (stage) {
      where.stage = stage;
    }

    const deals = await db.crmDeal.findMany({
      where,
      include: { contact: true, pipeline: true },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    return NextResponse.json(apiSuccess(deals));
  } catch (e) {
    return handleErr(e);
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireSession(request);
    const body = await request.json();

    if (!body.title) {
      return NextResponse.json(apiError('title is required', 'VALIDATION_ERROR', undefined, 400), { status: 400 });
    }

    const deal = await db.crmDeal.create({
      data: {
        title: body.title,
        value: body.value ?? 0,
        stage: body.stage ?? 'qualification',
        probability: body.probability ?? 0,
        expectedClose: body.expectedClose ? new Date(body.expectedClose) : undefined,
        contactId: body.contactId ?? undefined,
        pipelineId: body.pipelineId ?? undefined,
        notes: body.notes ?? undefined,
        userId: auth.id,
      },
      include: { contact: true, pipeline: true },
    });

    return NextResponse.json(apiSuccess(deal));
  } catch (e) {
    return handleErr(e);
  }
}
