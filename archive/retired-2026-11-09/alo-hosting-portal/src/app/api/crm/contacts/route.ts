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
    const search = searchParams.get('search');
    const status = searchParams.get('status');

    const where: any = {};
    if (auth.role !== ROLES.SUPER_ADMIN) {
      where.userId = auth.id;
    }
    if (status) {
      where.status = status;
    }
    if (search) {
      where.OR = [
        { firstName: { contains: search } },
        { lastName: { contains: search } },
        { email: { contains: search } },
        { company: { contains: search } },
      ];
    }

    const contacts = await db.crmContact.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    return NextResponse.json(apiSuccess(contacts));
  } catch (e) {
    return handleErr(e);
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireSession(request);
    const body = await request.json();

    if (!body.firstName) {
      return NextResponse.json(apiError('firstName is required', 'VALIDATION_ERROR', undefined, 400), { status: 400 });
    }

    const contact = await db.crmContact.create({
      data: {
        firstName: body.firstName,
        lastName: body.lastName ?? undefined,
        email: body.email ?? undefined,
        phone: body.phone ?? undefined,
        company: body.company ?? undefined,
        position: body.position ?? undefined,
        status: body.status ?? 'lead',
        source: body.source ?? undefined,
        notes: body.notes ?? undefined,
        tags: body.tags ?? undefined,
        userId: auth.id,
      },
    });

    return NextResponse.json(apiSuccess(contact));
  } catch (e) {
    return handleErr(e);
  }
}
