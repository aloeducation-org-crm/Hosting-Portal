import { NextRequest, NextResponse } from 'next/server';
import { apiSuccess, apiError, type ApiResponse } from '@/lib/response';
import { requireSuperAdmin } from '@/lib/auth';
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
    await requireSuperAdmin(request);

    const thirtyDaysFromNow = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    const expiring = await db.sslCertificate.findMany({
      where: {
        notAfter: {
          lte: thirtyDaysFromNow,
          gt: new Date(),
        },
      },
      include: {
        domain: {
          include: {
            website: true,
          },
        },
      },
      orderBy: {
        notAfter: 'asc',
      },
    });

    const result = expiring.map((cert) => {
      const daysRemaining = Math.ceil(
        (cert.notAfter!.getTime() - Date.now()) / (1000 * 60 * 60 * 24),
      );
      return {
        id: cert.id,
        domainId: cert.domainId,
        domain: cert.domain.domain,
        issuer: cert.issuer,
        notAfter: cert.notAfter,
        autoRenew: cert.autoRenew,
        daysRemaining: Math.max(0, daysRemaining),
        websiteId: cert.domain.websiteId,
      };
    });

    return NextResponse.json(
      apiSuccess({
        total: result.length,
        certificates: result,
      }),
    );
  } catch (e) {
    return handleErr(e);
  }
}
