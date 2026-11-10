import { NextRequest, NextResponse } from 'next/server';
import { apiSuccess, apiError, type ApiResponse } from '@/lib/response';
import { requireSession, ROLES } from '@/lib/auth';
import { db } from '@/lib/db';

const VALID_TYPES = ['A', 'AAAA', 'CNAME', 'MX', 'TXT', 'NS', 'SRV', 'CAA'];

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
    const domainId = searchParams.get('domainId');

    if (!domainId) {
      return NextResponse.json(apiError('domainId query parameter is required', 'VALIDATION_ERROR', undefined, 400), { status: 400 });
    }

    const domain = await db.domain.findUnique({
      where: { id: domainId },
      include: { website: true },
    });

    if (!domain) {
      return NextResponse.json(apiError('Domain not found', 'NOT_FOUND', undefined, 404), { status: 404 });
    }

    if (auth.role !== ROLES.SUPER_ADMIN && domain.website?.ownerId !== auth.id) {
      return NextResponse.json(apiError('Access denied', 'FORBIDDEN', undefined, 403), { status: 403 });
    }

    const records = await db.dnsRecord.findMany({
      where: { domainId },
      orderBy: { type: 'asc' },
      take: 200,
    });

    return NextResponse.json(apiSuccess(records));
  } catch (e) {
    return handleErr(e);
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireSession(request);
    const body = await request.json();

    if (!body.domainId || !body.type || !body.name || !body.value) {
      return NextResponse.json(apiError('domainId, type, name, and value are required', 'VALIDATION_ERROR', undefined, 400), { status: 400 });
    }

    if (!VALID_TYPES.includes(body.type)) {
      return NextResponse.json(apiError(`type must be one of: ${VALID_TYPES.join(', ')}`, 'VALIDATION_ERROR', undefined, 400), { status: 400 });
    }

    const record = await db.dnsRecord.create({
      data: {
        domainId: body.domainId,
        type: body.type,
        name: body.name,
        value: body.value,
        ttl: body.ttl ?? 3600,
        priority: body.priority ?? undefined,
        isActive: body.isActive ?? true,
      },
    });

    return NextResponse.json(apiSuccess(record));
  } catch (e) {
    return handleErr(e);
  }
}
