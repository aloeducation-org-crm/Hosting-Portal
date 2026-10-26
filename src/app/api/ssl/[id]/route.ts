import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { apiSuccess, apiError, type ApiResponse } from '@/lib/response';
import { requireSession, requirePermission, assertWebsiteAccess } from '@/lib/auth';
import { db } from '@/lib/db';
import { createAuditLog } from '@/lib/audit';
import { callHelper } from '@/lib/helpers';

const updateSslSchema = z.object({
  autoRenew: z.boolean(),
});

function handleErr(e: unknown): NextResponse {
  if (e instanceof z.ZodError) {
    return NextResponse.json(apiError('Validation failed', 'VALIDATION_ERROR', e.flatten(), 400), { status: 400 });
  }
  if (e && typeof e === 'object' && 'status' in e) {
    const a = e as ApiResponse;
    return NextResponse.json(a, { status: a.status });
  }
  return NextResponse.json(apiError('Internal server error'), { status: 500 });
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireSession(request);
    const { id } = await params;

    const cert = await db.sslCertificate.findUnique({
      where: { id },
      include: { domain: { include: { website: true } } },
    });
    if (!cert) {
      throw apiError('Certificate not found', 'NOT_FOUND', undefined, 404);
    }
    assertWebsiteAccess(user, cert.domain.website);

    return NextResponse.json(apiSuccess(cert));
  } catch (e) {
    return handleErr(e);
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requirePermission(request, 'SSL_MANAGE');
    const { id } = await params;
    const input = updateSslSchema.parse(await request.json());

    const cert = await db.sslCertificate.findUnique({
      where: { id },
      include: { domain: { include: { website: true } } },
    });
    if (!cert) {
      throw apiError('Certificate not found', 'NOT_FOUND', undefined, 404);
    }
    assertWebsiteAccess(user, cert.domain.website);

    const updated = await db.sslCertificate.update({
      where: { id },
      data: { autoRenew: input.autoRenew },
      include: { domain: true },
    });

    await createAuditLog({
      actorId: user.id,
      actorEmail: user.email,
      actorRole: user.role,
      action: 'SSL_AUTO_RENEWAL_TOGGLED',
      resourceType: 'SslCertificate',
      resourceId: updated.id,
      domain: updated.domain.domain,
      result: 'SUCCESS',
      metadata: { certificateId: id, domainId: updated.domainId, autoRenew: input.autoRenew },
    });

    return NextResponse.json(
      apiSuccess(
        {
          id: updated.id,
          domainId: updated.domainId,
          domain: updated.domain.domain,
          autoRenew: updated.autoRenew,
        },
        'Auto-renewal setting updated',
      ),
    );
  } catch (e) {
    return handleErr(e);
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requirePermission(request, 'SSL_MANAGE');
    const { id } = await params;

    const cert = await db.sslCertificate.findUnique({
      where: { id },
      include: { domain: { include: { website: true } } },
    });
    if (!cert) {
      throw apiError('Certificate not found', 'NOT_FOUND', undefined, 404);
    }
    assertWebsiteAccess(user, cert.domain.website);

    const result = await callHelper('alo-ssl-helper', ['revoke', cert.domain.domain], 120000);
    if (!result.success) {
      throw apiError(`Certificate revocation failed: ${result.stderr}`, 'SSL_REVOKE_FAILED', undefined, 500);
    }

    await db.sslCertificate.delete({ where: { id } });
    await db.domain.update({
      where: { id: cert.domainId },
      data: { sslEnabled: false, sslStatus: 'NONE', certificateExpiry: null },
    });

    await createAuditLog({
      actorId: user.id,
      actorEmail: user.email,
      actorRole: user.role,
      action: 'SSL_CERTIFICATE_REVOKED',
      resourceType: 'SslCertificate',
      resourceId: id,
      domain: cert.domain.domain,
      result: 'SUCCESS',
    });

    return NextResponse.json(apiSuccess(null, 'SSL certificate revoked successfully'));
  } catch (e) {
    return handleErr(e);
  }
}
