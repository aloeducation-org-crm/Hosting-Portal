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
    const type = searchParams.get('type');

    const where: any = {};
    if (auth.role !== ROLES.SUPER_ADMIN) {
      where.userId = auth.id;
    }
    if (status) {
      where.status = status;
    }
    if (type) {
      where.type = type;
    }

    const applications = await db.application.findMany({
      where,
      include: { website: true },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    return NextResponse.json(apiSuccess(applications));
  } catch (e) {
    return handleErr(e);
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireSession(request);
    const body = await request.json();

    if (!body.name || !body.type) {
      return NextResponse.json(apiError('name and type are required', 'VALIDATION_ERROR', undefined, 400), { status: 400 });
    }

    const app = await db.application.create({
      data: {
        name: body.name,
        websiteId: body.websiteId ?? undefined,
        type: body.type,
        status: body.status ?? 'active',
        runtime: body.runtime ?? undefined,
        version: body.version ?? undefined,
        config: body.config ?? undefined,
        userId: auth.id,
      },
    });

    return NextResponse.json(apiSuccess(app));
  } catch (e) {
    return handleErr(e);
  }
}
