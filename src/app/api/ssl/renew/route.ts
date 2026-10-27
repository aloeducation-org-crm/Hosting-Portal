import { NextRequest, NextResponse } from 'next/server';
import { apiSuccess, apiError, type ApiResponse } from '@/lib/response';
import { requirePermission, assertWebsiteAccess } from '@/lib/auth';
import { db } from '@/lib/db';
import { callHelper } from '@/lib/helpers';
import { createAuditLog } from '@/lib/audit';

function handleErr(e: unknown): NextResponse {
  if (e && typeof e === 'object' && 'status' in e) {
    const a = e as ApiResponse;
    return NextResponse.json(a, { status: a.status });
  }
  return NextResponse.json(apiError('Internal server error'), { status: 500 });
}

export async function POST(request: NextRequest) {
  try {
    const user = await requirePermission(request, 'SSL_MANAGE');
    const body = await request.json();
    const { domainId } = body as { domainId: string };

    if (!domainId) {
      throw apiError('domainId is required', 'VALIDATION_ERROR', undefined, 400);
    }

    const certificate = await db.sslCertificate.findUnique({
      where: { domainId },
      include: { domain: { include: { website: true } } },
    });

    if (!certificate) {
      throw apiError('No existing certificate found for this domain', 'NOT_FOUND', undefined, 404);
    }
    assertWebsiteAccess(user, certificate.domain.website);

    const domain = certificate.domain.domain;

    // Update domain to RENEWING
    await db.domain.update({
      where: { id: domainId },
      data: { sslStatus: 'RENEWING' },
    });

    // Call real certbot renewal via alo-ssl-helper
    const result = await callHelper('alo-ssl-helper', ['renew', domain]);

    if (!result.success) {
      // Renewal failed — mark domain accordingly
      await db.domain.update({
        where: { id: domainId },
        data: { sslStatus: 'FAILED' },
      });

      await createAuditLog({
        actorId: user.id,
        actorEmail: user.email,
        actorRole: user.role,
        action: 'SSL_CERTIFICATE_RENEW_FAILED',
        resourceType: 'SslCertificate',
        resourceId: certificate.id,
        domain,
        result: 'FAILED',
        metadata: { domainId, error: result.stderr },
      });

      throw apiError(
        `SSL renewal failed: ${result.stderr || 'Unknown error'}`,
        'HELPER_ERROR',
        undefined,
        500,
      );
    }

    // Parse helper output for certificate metadata
    let helperData: { notBefore?: string; notAfter?: string; issuer?: string } = {};
    try {
      helperData = JSON.parse(result.stdout);
    } catch {
      // If helper doesn't return JSON, use defaults
    }

    const now = new Date();
    const notAfter = helperData.notAfter ? new Date(helperData.notAfter) : new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);

    // Update certificate with real renewal data
    const updated = await db.sslCertificate.update({
      where: { domainId },
      data: {
        issuer: helperData.issuer || "Let's Encrypt Authority X3",
        notBefore: helperData.notBefore ? new Date(helperData.notBefore) : now,
        notAfter,
      },
      include: { domain: true },
    });

    // Update domain status
    await db.domain.update({
      where: { id: domainId },
      data: {
        sslEnabled: true,
        sslStatus: 'ISSUED',
        certificateExpiry: notAfter,
      },
    });

    await createAuditLog({
      actorId: user.id,
      actorEmail: user.email,
      actorRole: user.role,
      action: 'SSL_CERTIFICATE_RENEWED',
      resourceType: 'SslCertificate',
      resourceId: updated.id,
      domain,
      result: 'SUCCESS',
      metadata: { domainId, notAfter: notAfter.toISOString() },
    });

    return NextResponse.json(
      apiSuccess({
        id: updated.id,
        domainId: updated.domainId,
        domain: updated.domain.domain,
        issuer: updated.issuer,
        notBefore: updated.notBefore,
        notAfter: updated.notAfter,
        autoRenew: updated.autoRenew,
      }, 'SSL certificate renewed successfully'),
    );
  } catch (e) {
    return handleErr(e);
  }
}
