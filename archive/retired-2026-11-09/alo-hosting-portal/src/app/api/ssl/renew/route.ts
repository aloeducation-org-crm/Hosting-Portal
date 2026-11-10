import { NextRequest, NextResponse } from 'next/server';
import { apiSuccess, apiError, type ApiResponse } from '@/lib/response';
import { requirePermission } from '@/lib/auth';
import { db } from '@/lib/db';
import crypto from 'crypto';
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
      include: { domain: true },
    });

    if (!certificate) {
      throw apiError('No existing certificate found for this domain', 'NOT_FOUND', undefined, 404);
    }

    // Update domain to RENEWING
    await db.domain.update({
      where: { id: domainId },
      data: { sslStatus: 'RENEWING' },
    });

    // Generate new key pair (simulation)
    crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
    });

    const now = new Date();
    const notAfter = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);

    // Update certificate
    const updated = await db.sslCertificate.update({
      where: { domainId },
      data: {
        issuer: 'ALO-Labs-Internal-CA',
        notBefore: now,
        notAfter,
      },
      include: { domain: true },
    });

    // Update domain
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
      domain: updated.domain.domain,
      result: 'SUCCESS',
      metadata: { domainId, notAfter },
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
