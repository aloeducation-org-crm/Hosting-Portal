import { NextRequest, NextResponse } from 'next/server';
import { apiSuccess, apiError, type ApiResponse } from '@/lib/response';
import { requireSession, requirePermission, isAdminRole, assertWebsiteAccess } from '@/lib/auth';
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

function parseHelperJson(stdout: string): Record<string, unknown> {
  try {
    return JSON.parse(stdout.trim());
  } catch {
    return { raw: stdout };
  }
}

export async function GET(request: NextRequest) {
  try {
    const user = await requireSession(request);
    const { searchParams } = new URL(request.url);
    const domain = searchParams.get('domain');

    const where: Record<string, unknown> = {};
    if (!isAdminRole(user.role)) {
      const ownedDomains = await db.domain.findMany({
        where: { website: { ownerId: user.id } },
        select: { domain: true },
      });
      const allowedNames = ownedDomains.map((d) => d.domain);
      if (domain) {
        if (!allowedNames.includes(domain)) {
          return NextResponse.json(apiError('Forbidden', 'FORBIDDEN', undefined, 403), { status: 403 });
        }
        where.domain = domain;
      } else {
        where.domain = { in: allowedNames };
      }
    } else if (domain) {
      where.domain = domain;
    }

    const accounts = await db.emailAccount.findMany({
      where,
      take: 50,
      orderBy: { createdAt: 'desc' },
    });

    // Strip password from response
    const sanitized = accounts.map(({ password: _, ...rest }) => rest);

    return NextResponse.json(apiSuccess(sanitized));
  } catch (e) {
    return handleErr(e);
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requirePermission(request, 'SERVER_MANAGE');
    const body = await request.json();
    const { domain, address, password, quotaMb } = body as {
      domain: string;
      address: string;
      password: string;
      quotaMb?: number;
    };

    if (!domain || !address || !password) {
      throw apiError('domain, address, and password are required', 'VALIDATION_ERROR', undefined, 400);
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(address)) {
      throw apiError('Invalid email address format', 'VALIDATION_ERROR', undefined, 400);
    }

    const addressDomain = address.split('@')[1];
    if (addressDomain !== domain) {
      throw apiError('Email address domain must match the specified domain', 'VALIDATION_ERROR', undefined, 400);
    }

    const domainRecord = await db.domain.findUnique({ where: { domain } });
    if (!domainRecord) {
      throw apiError('Domain not found in system', 'NOT_FOUND', undefined, 404);
    }

    const existing = await db.emailAccount.findUnique({ where: { address } });
    if (existing) {
      throw apiError('An email account with this address already exists', 'CONFLICT', undefined, 409);
    }

    const localPart = address.split('@')[0] ?? '';
    const quota = quotaMb ?? 500;

    // === REAL: Ensure email domain is configured in Postfix/Dovecot ===
    await callHelper('alo-email-helper', ['add-domain', domain]).catch(() => {
      // Non-fatal: domain may already be configured
    });

    // === REAL: Create mail account via Postfix/Dovecot ===
    const addResult = await callHelper('alo-email-helper', [
      'add-account', domain, localPart, password, String(quota),
    ]);

    if (!addResult.success) {
      throw apiError(
        `Failed to create email account on server: ${addResult.stderr}`,
        'EMAIL_PROVISIONING_FAILED',
        undefined,
        500,
      );
    }

    const passwordHash = await hashPassword(password);

    const account = await db.emailAccount.create({
      data: {
        domain,
        address,
        password: passwordHash,
        quotaMb: quota,
        isActive: true,
      },
    });

    const { password: _, ...sanitized } = account;

    await createAuditLog({
      actorId: user.id,
      actorEmail: user.email,
      actorRole: user.role,
      action: 'EMAIL_ACCOUNT_CREATED',
      resourceType: 'EmailAccount',
      resourceId: account.id,
      domain,
      result: 'SUCCESS',
      metadata: { address, quotaMb: quota, serverResult: parseHelperJson(addResult.stdout) },
    });

    return NextResponse.json(apiSuccess(sanitized, 'Email account created on server (Postfix/Dovecot)'), { status: 201 });
  } catch (e) {
    return handleErr(e);
  }
}

export async function PUT(request: NextRequest) {
  try {
    const user = await requireSession(request);
    const body = await request.json();
    const { accountId, quotaMb, isActive, password } = body as {
      accountId: string;
      quotaMb?: number;
      isActive?: boolean;
      password?: string;
    };

    if (!accountId) {
      throw apiError('accountId is required', 'VALIDATION_ERROR', undefined, 400);
    }

    const existing = await db.emailAccount.findUnique({ where: { id: accountId } });
    if (!existing) {
      throw apiError('Email account not found', 'NOT_FOUND', undefined, 404);
    }

    if (!isAdminRole(user.role)) {
      const domainRecord = await db.domain.findUnique({
        where: { domain: existing.domain },
        include: { website: true },
      });
      assertWebsiteAccess(user, domainRecord?.website);
    }

    const updateData: Record<string, unknown> = {};
    if (quotaMb !== undefined) updateData.quotaMb = quotaMb;
    if (isActive !== undefined) updateData.isActive = isActive;
    if (password) updateData.password = await hashPassword(password);

    // === REAL: Update quota on Dovecot ===
    if (quotaMb !== undefined) {
      const localPart = existing.address.split('@')[0] ?? '';
      await callHelper('alo-email-helper', ['set-quota', existing.domain, localPart, String(quotaMb)]).catch(() => {
        // Non-fatal: quota update on server failed but DB update continues
      });
    }

    const updated = await db.emailAccount.update({
      where: { id: accountId },
      data: updateData,
    });

    const { password: _, ...sanitized } = updated;

    await createAuditLog({
      actorId: user.id,
      actorEmail: user.email,
      actorRole: user.role,
      action: 'EMAIL_ACCOUNT_UPDATED',
      resourceType: 'EmailAccount',
      resourceId: accountId,
      domain: existing.domain,
      result: 'SUCCESS',
      metadata: { quotaMb, isActive, passwordChanged: !!password },
    });

    return NextResponse.json(apiSuccess(sanitized, 'Email account updated'));
  } catch (e) {
    return handleErr(e);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const user = await requireSession(request);
    const { searchParams } = new URL(request.url);
    const accountId = searchParams.get('accountId');

    if (!accountId) {
      throw apiError('accountId query parameter is required', 'VALIDATION_ERROR', undefined, 400);
    }

    const account = await db.emailAccount.findUnique({ where: { id: accountId } });
    if (!account) {
      throw apiError('Email account not found', 'NOT_FOUND', undefined, 404);
    }

    if (!isAdminRole(user.role)) {
      const domainRecord = await db.domain.findUnique({
        where: { domain: account.domain },
        include: { website: true },
      });
      assertWebsiteAccess(user, domainRecord?.website);
    }

    // === REAL: Remove mail account from Postfix/Dovecot ===
    const localPart = account.address.split('@')[0] ?? '';
    await callHelper('alo-email-helper', ['delete-account', account.domain, localPart]).catch(() => {
      // Non-fatal: account may not exist on server
    });

    await db.emailAccount.delete({ where: { id: accountId } });

    await createAuditLog({
      actorId: user.id,
      actorEmail: user.email,
      actorRole: user.role,
      action: 'EMAIL_ACCOUNT_DELETED',
      resourceType: 'EmailAccount',
      resourceId: accountId,
      domain: account.domain,
      result: 'SUCCESS',
    });

    return NextResponse.json(apiSuccess(null, 'Email account deleted from server (Postfix/Dovecot)'));
  } catch (e) {
    return handleErr(e);
  }
}
