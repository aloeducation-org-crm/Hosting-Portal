import { NextRequest, NextResponse } from 'next/server';
import { apiSuccess, apiError, type ApiResponse } from '@/lib/response';
import { requireSession, isAdminRole, assertWebsiteAccess } from '@/lib/auth';
import { db } from '@/lib/db';
import { hashPassword } from '@/lib/password';
import { createAuditLog } from '@/lib/audit';
import { callHelper } from '@/lib/helpers';

function handleErr(e: unknown): NextResponse {
  if (e && typeof e === 'object' && 'status' in e) {
    const a = e as ApiResponse;
    return NextResponse.json(a, { status: a.status });
  }
  return NextResponse.json(apiError('Internal server error'), { status: 500 });
}

async function authorizeEmailAccount(accountDomain: string, user: { id: string; role: string }) {
  if (isAdminRole(user.role)) return;
  const domainRecord = await db.domain.findUnique({
    where: { domain: accountDomain },
    include: { website: true },
  });
  assertWebsiteAccess(user, domainRecord?.website);
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireSession(request);
    const { id } = await params;

    const account = await db.emailAccount.findUnique({ where: { id } });
    if (!account) {
      throw apiError('Email account not found', 'NOT_FOUND', undefined, 404);
    }

    await authorizeEmailAccount(account.domain, user);
    const { password: _, ...sanitized } = account;
    return NextResponse.json(apiSuccess(sanitized));
  } catch (e) {
    return handleErr(e);
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireSession(request);
    const { id } = await params;
    const body = await request.json();
    const { quotaMb, isActive, password } = body as {
      quotaMb?: number;
      isActive?: boolean;
      password?: string;
    };

    const existing = await db.emailAccount.findUnique({ where: { id } });
    if (!existing) {
      throw apiError('Email account not found', 'NOT_FOUND', undefined, 404);
    }

    await authorizeEmailAccount(existing.domain, user);

    const updateData: Record<string, unknown> = {};
    if (quotaMb !== undefined) updateData.quotaMb = Number(quotaMb);
    if (isActive !== undefined) updateData.isActive = Boolean(isActive);
    if (password) updateData.password = await hashPassword(password);

    if (quotaMb !== undefined) {
      const localPart = existing.address.split('@')[0] ?? '';
      await callHelper('alo-email-helper', ['set-quota', existing.domain, localPart, String(quotaMb)]).catch(
        () => {},
      );
    }

    const updated = await db.emailAccount.update({
      where: { id },
      data: updateData,
    });

    const { password: _, ...sanitized } = updated;

    await createAuditLog({
      actorId: user.id,
      actorEmail: user.email,
      actorRole: user.role,
      action: 'EMAIL_ACCOUNT_UPDATED',
      resourceType: 'EmailAccount',
      resourceId: id,
      domain: existing.domain,
      result: 'SUCCESS',
      metadata: { quotaMb, isActive, passwordChanged: Boolean(password) },
    });

    return NextResponse.json(apiSuccess(sanitized, 'Email account updated'));
  } catch (e) {
    return handleErr(e);
  }
}

export const PATCH = PUT;

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireSession(request);
    const { id } = await params;

    const account = await db.emailAccount.findUnique({ where: { id } });
    if (!account) {
      throw apiError('Email account not found', 'NOT_FOUND', undefined, 404);
    }

    await authorizeEmailAccount(account.domain, user);

    const localPart = account.address.split('@')[0] ?? '';
    await callHelper('alo-email-helper', ['delete-account', account.domain, localPart]).catch(() => {});

    await db.emailAccount.delete({ where: { id } });

    await createAuditLog({
      actorId: user.id,
      actorEmail: user.email,
      actorRole: user.role,
      action: 'EMAIL_ACCOUNT_DELETED',
      resourceType: 'EmailAccount',
      resourceId: id,
      domain: account.domain,
      result: 'SUCCESS',
    });

    return NextResponse.json(apiSuccess(null, 'Email account deleted'));
  } catch (e) {
    return handleErr(e);
  }
}
