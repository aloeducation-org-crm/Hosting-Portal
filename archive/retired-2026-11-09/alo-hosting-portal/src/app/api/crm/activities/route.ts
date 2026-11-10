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
    const type = searchParams.get('type');
    const contactId = searchParams.get('contactId');

    const where: any = {};
    if (auth.role !== ROLES.SUPER_ADMIN) {
      where.userId = auth.id;
    }
    if (type) {
      where.type = type;
    }
    if (contactId) {
      where.contactId = contactId;
    }

    const activities = await db.crmActivity.findMany({
      where,
      include: { contact: true, deal: true },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    return NextResponse.json(apiSuccess(activities));
  } catch (e) {
    return handleErr(e);
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireSession(request);
    const body = await request.json();

    if (!body.type || !body.subject) {
      return NextResponse.json(apiError('type and subject are required', 'VALIDATION_ERROR', undefined, 400), { status: 400 });
    }

    const activity = await db.crmActivity.create({
      data: {
        type: body.type,
        subject: body.subject,
        description: body.description ?? undefined,
        contactId: body.contactId ?? undefined,
        dealId: body.dealId ?? undefined,
        userId: auth.id,
        scheduledAt: body.scheduledAt ? new Date(body.scheduledAt) : undefined,
      },
    });

    return NextResponse.json(apiSuccess(activity));
  } catch (e) {
    return handleErr(e);
  }
}
