import { NextRequest, NextResponse } from 'next/server';
import { apiSuccess, apiError, type ApiResponse } from '@/lib/response';
import { requireSession, requirePermission, assertWebsiteAccess } from '@/lib/auth';
import { callHelper } from '@/lib/helpers';
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

    const website = await db.website.findUnique({ where: { id } });
    if (!website || website.deletedAt) {
      return NextResponse.json(apiError('Website not found', 'NOT_FOUND', undefined, 404), { status: 404 });
    }
    assertWebsiteAccess(user, website);

    const domain = await db.domain.findFirst({
      where: { websiteId: id, primary: true },
      include: { certificate: true },
    });

    if (!domain) {
      return NextResponse.json(apiError('Primary domain not found', 'NOT_FOUND', undefined, 404), { status: 404 });
    }

    return NextResponse.json(apiSuccess(domain));
  } catch (e) { return handleErr(e); }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requirePermission(request, 'SSL_MANAGE');
    const { id } = await params;

    const website = await db.website.findUnique({ where: { id } });
    if (!website || website.deletedAt) {
      return NextResponse.json(apiError('Website not found', 'NOT_FOUND', undefined, 404), { status: 404 });
    }
    assertWebsiteAccess(user, website);

    const domain = await db.domain.findFirst({
      where: { websiteId: id, primary: true },
    });

    if (!domain) {
      return NextResponse.json(apiError('Primary domain not found', 'NOT_FOUND', undefined, 404), { status: 404 });
    }

    const ip = request.headers.get('x-forwarded-for') ?? request.headers.get('x-real-ip');

    // Update SSL status to PENDING
    await db.domain.update({
      where: { id: domain.id },
      data: { sslStatus: 'PENDING' },
    });

    const result = await callHelper('alo-domain-helper', ['request-ssl', domain.domain]);

    if (!result.success) {
      await db.domain.update({
        where: { id: domain.id },
        data: { sslStatus: 'FAILED' },
      });

      await db.auditLog.create({
        data: {
          actorUserId: user.id, actorEmail: user.email, actorRole: user.role,
          action: 'SSL_REQUEST_FAIL', resourceType: 'Domain', resourceId: domain.id,
          domain: domain.domain, result: 'FAILURE', ipAddress: ip,
          errorCode: 'HELPER_ERROR',
        },
      });

      return NextResponse.json(apiError('SSL request failed', 'HELPER_ERROR', { stderr: result.stderr }), { status: 500 });
    }

    // Parse result to get expiry if available
    let parsed: Record<string, unknown> = {};
    try {
      parsed = JSON.parse(result.stdout);
    } catch {
      parsed = { raw: result.stdout };
    }

    const notAfter = parsed.notAfter ? new Date(String(parsed.notAfter)) : null;

    // Update domain SSL fields
    const updatedDomain = await db.domain.update({
      where: { id: domain.id },
      data: {
        sslEnabled: true,
        sslStatus: 'ISSUED',
        certificateExpiry: notAfter,
      },
    });

    // Create or update SSL certificate record
    if (parsed.issuer || notAfter) {
      await db.sslCertificate.upsert({
        where: { domainId: domain.id },
        create: {
          domainId: domain.id,
          issuer: String(parsed.issuer ?? 'Let\'s Encrypt'),
          notBefore: parsed.notBefore ? new Date(String(parsed.notBefore)) : new Date(),
          notAfter: notAfter ?? new Date(),
        },
        update: {
          issuer: String(parsed.issuer ?? 'Let\'s Encrypt'),
          notBefore: parsed.notBefore ? new Date(String(parsed.notBefore)) : undefined,
          notAfter: notAfter ?? undefined,
        },
      });
    }

    await db.auditLog.create({
      data: {
        actorUserId: user.id, actorEmail: user.email, actorRole: user.role,
        action: 'SSL_REQUEST', resourceType: 'Domain', resourceId: domain.id,
        domain: domain.domain, result: 'SUCCESS', ipAddress: ip,
      },
    });

    return NextResponse.json(apiSuccess(updatedDomain, 'SSL certificate requested', 201), { status: 201 });
  } catch (e) { return handleErr(e); }
}
