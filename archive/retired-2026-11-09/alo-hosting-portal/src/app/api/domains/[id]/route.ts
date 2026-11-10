import { NextRequest, NextResponse } from 'next/server';
import { apiSuccess, apiError, type ApiResponse } from '@/lib/response';
import { requirePermission, requireSession } from '@/lib/auth';
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

    const domain = await db.domain.findUnique({
      where: { id },
      include: { website: true, certificate: true },
    });
    if (!domain) {
      return NextResponse.json(apiError('Domain not found', 'NOT_FOUND', undefined, 404), { status: 404 });
    }

    // Ownership check: only the website owner or SUPER_ADMIN can view
    if (user.role !== 'SUPER_ADMIN' && domain.website?.ownerId !== user.id) {
      return NextResponse.json(apiError('Forbidden', 'FORBIDDEN', undefined, 403), { status: 403 });
    }

    return NextResponse.json(apiSuccess(domain));
  } catch (e) { return handleErr(e); }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requirePermission(request, 'DOMAIN_DELETE');
    const { id } = await params;

    const domain = await db.domain.findUnique({
      where: { id },
      include: { website: true },
    });
    if (!domain) {
      return NextResponse.json(apiError('Domain not found', 'NOT_FOUND', undefined, 404), { status: 404 });
    }

    // Remove Caddy config
    await callHelper('alo-domain-helper', ['remove', domain.domain]).catch(() => {});

    await db.domain.delete({ where: { id } });

    const ip = request.headers.get('x-forwarded-for') ?? request.headers.get('x-real-ip');
    await db.auditLog.create({
      data: {
        actorUserId: user.id, actorEmail: user.email, actorRole: user.role,
        action: 'DOMAIN_DELETE', resourceType: 'Domain', resourceId: id,
        domain: domain.domain, result: 'SUCCESS', ipAddress: ip,
      },
    });

    return NextResponse.json(apiSuccess(null, 'Domain removed'));
  } catch (e) { return handleErr(e); }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requirePermission(request, 'DOMAIN_UPDATE');
    const { id } = await params;
    const body = await request.json();
    const { action } = body;

    const domain = await db.domain.findUnique({
      where: { id },
      include: { website: true },
    });
    if (!domain) {
      return NextResponse.json(apiError('Domain not found', 'NOT_FOUND', undefined, 404), { status: 404 });
    }

    if (action === 'verify-dns') {
      const result = await callHelper('alo-domain-helper', ['verify-dns', domain.domain]);
      if (!result.success) {
        return NextResponse.json(apiError('DNS verification failed', 'DNS_ERROR', { stderr: result.stderr }), { status: 500 });
      }
      let data;
      try { data = JSON.parse(result.stdout); } catch { data = {}; }
      await db.domain.update({ where: { id }, data: { dnsVerified: data.dnsVerified } });
      return NextResponse.json(apiSuccess(data));
    }

    if (action === 'check-ssl') {
      const result = await callHelper('alo-domain-helper', ['check-ssl', domain.domain]);
      if (!result.success) {
        return NextResponse.json(apiError('SSL check failed', 'SSL_ERROR', { stderr: result.stderr }), { status: 500 });
      }
      let data;
      try { data = JSON.parse(result.stdout); } catch { data = {}; }
      if (data.sslActive) {
        await db.domain.update({
          where: { id },
          data: {
            sslEnabled: true,
            sslStatus: data.status,
            certificateExpiry: data.notAfter ? new Date(data.notAfter) : null,
          },
        });
      }
      return NextResponse.json(apiSuccess(data));
    }

    return NextResponse.json(apiError('Unknown action', 'VALIDATION_ERROR', undefined, 400), { status: 400 });
  } catch (e) { return handleErr(e); }
}