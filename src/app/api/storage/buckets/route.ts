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

    const where: any = { kind: "bucket" };
    if (auth.role !== ROLES.SUPER_ADMIN) {
      where.userId = auth.id;
    }

    const buckets = await db.storageBucket.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    return NextResponse.json(apiSuccess(buckets));
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

    const existing = await db.storageBucket.findUnique({ where: { name: body.name } });
    if (existing) {
      return NextResponse.json(apiError('Bucket name already exists', 'CONFLICT', undefined, 409), { status: 409 });
    }

    const bucket = await db.storageBucket.create({
      data: {
        name: body.name,
        provider: body.provider ?? 'local',
        region: body.region ?? undefined,
        accessKey: body.accessKey ?? undefined,
        secretKey: body.secretKey ?? undefined,
        endpoint: body.endpoint ?? undefined,
        bucketPath: body.bucketPath ?? undefined,
        isActive: body.isActive ?? true,
        userId: auth.id,
      },
    });

    return NextResponse.json(apiSuccess(bucket));
  } catch (e) {
    return handleErr(e);
  }
}
