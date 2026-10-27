import { NextRequest, NextResponse } from 'next/server';
import { apiSuccess, apiError, type ApiResponse } from '@/lib/response';
import { requirePermission, assertWebsiteAccess } from '@/lib/auth';
import { callHelper } from '@/lib/helpers';
import { db } from '@/lib/db';

function handleErr(e: unknown): NextResponse {
  if (e && typeof e === 'object' && 'status' in e) {
    const a = e as ApiResponse;
    return NextResponse.json(a, { status: a.status });
  }
  return NextResponse.json(apiError('Internal server error'), { status: 500 });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requirePermission(request, 'WEBSITE_RESTART');
    const { id } = await params;

    const website = await db.website.findUnique({ where: { id } });
    if (!website || website.deletedAt) {
      return NextResponse.json(apiError('Website not found', 'NOT_FOUND', undefined, 404), { status: 404 });
    }
    assertWebsiteAccess(user, website);

    const result = await callHelper('alo-site-lifecycle', ['restart', website.domain]);
    if (!result.success) {
      return NextResponse.json(apiError('Restart failed', 'HELPER_ERROR', { stderr: result.stderr }), { status: 500 });
    }

    const ip = request.headers.get('x-forwarded-for') ?? request.headers.get('x-real-ip');
    await db.auditLog.create({
      data: {
        actorUserId: user.id, actorEmail: user.email, actorRole: user.role,
        action: 'WEBSITE_RESTART', resourceType: 'Website', resourceId: id,
        domain: website.domain, result: 'SUCCESS', ipAddress: ip,
      },
    });

    return NextResponse.json(apiSuccess(website, 'Website restarted'));
  } catch (e) { return handleErr(e); }
}
