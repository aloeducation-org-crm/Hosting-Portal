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
    const status = searchParams.get('status');

    const where: any = {};
    if (auth.role !== ROLES.SUPER_ADMIN) {
      where.userId = auth.id;
    }
    if (status) {
      where.status = status;
    }

    const campaigns = await db.emailCampaign.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    return NextResponse.json(apiSuccess(campaigns));
  } catch (e) {
    return handleErr(e);
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireSession(request);
    const body = await request.json();

    if (!body.name || !body.subject) {
      return NextResponse.json(apiError('name and subject are required', 'VALIDATION_ERROR', undefined, 400), { status: 400 });
    }

    const campaign = await db.emailCampaign.create({
      data: {
        name: body.name,
        subject: body.subject,
        fromAddress: body.fromAddress ?? undefined,
        fromName: body.fromName ?? undefined,
        status: body.status ?? 'draft',
        content: body.content ?? undefined,
        textContent: body.textContent ?? undefined,
        recipientCount: body.recipientCount ?? 0,
        scheduledAt: body.scheduledAt ? new Date(body.scheduledAt) : undefined,
        userId: auth.id,
      },
    });

    return NextResponse.json(apiSuccess(campaign));
  } catch (e) {
    return handleErr(e);
  }
}
