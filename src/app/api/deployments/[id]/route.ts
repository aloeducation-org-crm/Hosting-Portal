import { NextRequest, NextResponse } from 'next/server';
import { apiSuccess, apiError, type ApiResponse } from '@/lib/response';
import { requireSession, assertWebsiteAccess } from '@/lib/auth';
import { db } from '@/lib/db';

function handleErr(e: unknown): NextResponse {
  if (e && typeof e === 'object' && 'status' in e) {
    const a = e as ApiResponse;
    return NextResponse.json(a, { status: a.status });
  }
  return NextResponse.json(apiError('Internal server error'), { status: 500 });
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireSession(request);
    const { id } = await params;

    const deployment = await db.deployment.findUnique({
      where: { id },
      include: {
        website: { select: { id: true, domain: true, ownerId: true } },
        logs: {
          orderBy: { timestamp: 'asc' },
        },
      },
    });

    if (!deployment) {
      return NextResponse.json(
        apiError('Deployment not found', 'NOT_FOUND', undefined, 404),
        { status: 404 },
      );
    }

    assertWebsiteAccess(user, deployment.website);

    return NextResponse.json(apiSuccess({
      ...deployment,
      website: { id: deployment.website.id, domain: deployment.website.domain },
    }));
  } catch (e) {
    return handleErr(e);
  }
}
