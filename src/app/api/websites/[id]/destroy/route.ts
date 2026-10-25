import { NextRequest, NextResponse } from 'next/server';
import { apiSuccess, apiError, type ApiResponse } from '@/lib/response';
import { requireSuperAdmin } from '@/lib/auth';
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
    const user = await requireSuperAdmin(request);
    const { id } = await params;

    const website = await db.website.findUnique({ where: { id } });
    if (!website) {
      return NextResponse.json(apiError('Website not found', 'NOT_FOUND', undefined, 404), { status: 404 });
    }

    const ip = request.headers.get('x-forwarded-for') ?? request.headers.get('x-real-ip');

    // Call helper to destroy site files and configs
    const result = await callHelper('alo-site-lifecycle', ['destroy', website.domain]);

    if (!result.success) {
      await db.auditLog.create({
        data: {
          actorUserId: user.id, actorEmail: user.email, actorRole: user.role,
          action: 'WEBSITE_DESTROY_FAIL', resourceType: 'Website', resourceId: id,
          domain: website.domain, result: 'FAILURE', ipAddress: ip,
          errorCode: 'HELPER_ERROR',
          metadata: { stderr: result.stderr },
        },
      });

      return NextResponse.json(apiError('Destroy failed on server', 'HELPER_ERROR', { stderr: result.stderr }), { status: 500 });
    }

    // Hard delete the website and all cascading relations
    await db.website.delete({
      where: { id },
    });

    await db.auditLog.create({
      data: {
        actorUserId: user.id, actorEmail: user.email, actorRole: user.role,
        action: 'WEBSITE_DESTROY', resourceType: 'Website', resourceId: id,
        domain: website.domain, result: 'SUCCESS', ipAddress: ip,
        metadata: { domain: website.domain, runtime: website.runtime },
      },
    });

    return NextResponse.json(apiSuccess({ id, domain: website.domain }, 'Website permanently destroyed'));
  } catch (e) { return handleErr(e); }
}
