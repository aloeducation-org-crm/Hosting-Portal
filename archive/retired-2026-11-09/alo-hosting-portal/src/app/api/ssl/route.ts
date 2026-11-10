import { NextRequest, NextResponse } from 'next/server';
import { apiSuccess, apiError, type ApiResponse } from '@/lib/response';
import { requireSession, requirePermission, ROLES } from '@/lib/auth';
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

export async function GET(request: NextRequest) {
  try {
    const user = await requireSession(request);
    const { searchParams } = new URL(request.url);
    const domainId = searchParams.get('domainId');

    const where = domainId ? { domainId } : {};
    const certificates = await db.sslCertificate.findMany({
      where,
      include: { domain: true },
      take: 50,
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json(apiSuccess(certificates));
  } catch (e) {
    return handleErr(e);
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requirePermission(request, 'SSL_MANAGE');
    const body = await request.json();
    const { domainId, autoRenew = true } = body as { domainId: string; autoRenew?: boolean };

    if (!domainId) {
      throw apiError('domainId is required', 'VALIDATION_ERROR', undefined, 400);
    }

    // Verify domain exists
    const domain = await db.domain.findUnique({
      where: { id: domainId },
      include: { website: true },
    });

    if (!domain) {
      throw apiError('Domain not found', 'NOT_FOUND', undefined, 404);
    }

    // Check for existing certificate
    const existing = await db.sslCertificate.findUnique({
      where: { domainId },
    });
    if (existing) {
      throw apiError('Certificate already exists for this domain. Revoke it first or use the renew endpoint.', 'CONFLICT', undefined, 409);
    }

    // Update domain to PENDING
    await db.domain.update({
      where: { id: domainId },
      data: { sslStatus: 'PENDING' },
    });

    // Generate key pair (simulation of certificate issuance)
    crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
    });

    const now = new Date();
    const notAfter = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);

    // Create certificate record
    const certificate = await db.sslCertificate.create({
      data: {
        domainId,
        issuer: 'ALO-Labs-Internal-CA',
        notBefore: now,
        notAfter,
        autoRenew,
      },
      include: { domain: true },
    });

    // Update domain SSL status
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
      action: 'SSL_CERTIFICATE_ISSUED',
      resourceType: 'SslCertificate',
      resourceId: certificate.id,
      domain: domain.domain,
      result: 'SUCCESS',
      metadata: { domainId, autoRenew, issuer: certificate.issuer, notAfter },
    });

    return NextResponse.json(
      apiSuccess({
        id: certificate.id,
        domainId: certificate.domainId,
        domain: certificate.domain.domain,
        issuer: certificate.issuer,
        notBefore: certificate.notBefore,
        notAfter: certificate.notAfter,
        autoRenew: certificate.autoRenew,
        createdAt: certificate.createdAt,
      }, 'SSL certificate issued successfully'),
    );
  } catch (e) {
    return handleErr(e);
  }
}

export async function PUT(request: NextRequest) {
  try {
    const user = await requirePermission(request, 'SSL_MANAGE');
    const body = await request.json();
    const { domainId, autoRenew } = body as { domainId: string; autoRenew: boolean };

    if (!domainId || autoRenew === undefined) {
      throw apiError('domainId and autoRenew are required', 'VALIDATION_ERROR', undefined, 400);
    }

    const certificate = await db.sslCertificate.findUnique({
      where: { domainId },
    });

    if (!certificate) {
      throw apiError('Certificate not found for this domain', 'NOT_FOUND', undefined, 404);
    }

    const updated = await db.sslCertificate.update({
      where: { domainId },
      data: { autoRenew },
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
      metadata: { domainId, autoRenew },
    });

    return NextResponse.json(
      apiSuccess({
        id: updated.id,
        domainId: updated.domainId,
        domain: updated.domain.domain,
        autoRenew: updated.autoRenew,
      }, 'Auto-renewal setting updated'),
    );
  } catch (e) {
    return handleErr(e);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const user = await requirePermission(request, 'SSL_MANAGE');
    const { searchParams } = new URL(request.url);
    const domainId = searchParams.get('domainId');

    if (!domainId) {
      throw apiError('domainId query parameter is required', 'VALIDATION_ERROR', undefined, 400);
    }

    const certificate = await db.sslCertificate.findUnique({
      where: { domainId },
      include: { domain: true },
    });

    if (!certificate) {
      throw apiError('Certificate not found for this domain', 'NOT_FOUND', undefined, 404);
    }

    // Delete the certificate
    await db.sslCertificate.delete({
      where: { domainId },
    });

    // Update domain
    await db.domain.update({
      where: { id: domainId },
      data: {
        sslEnabled: false,
        sslStatus: 'NONE',
        certificateExpiry: null,
      },
    });

    await createAuditLog({
      actorId: user.id,
      actorEmail: user.email,
      actorRole: user.role,
      action: 'SSL_CERTIFICATE_REVOKED',
      resourceType: 'SslCertificate',
      resourceId: certificate.id,
      domain: certificate.domain.domain,
      result: 'SUCCESS',
      metadata: { domainId },
    });

    return NextResponse.json(apiSuccess(null, 'SSL certificate revoked successfully'));
  } catch (e) {
    return handleErr(e);
  }
}
