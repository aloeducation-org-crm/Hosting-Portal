import { NextRequest, NextResponse } from 'next/server';
import { apiSuccess, apiError, type ApiResponse } from '@/lib/response';
import { requireSession, requirePermission, ROLES, isRoleAtLeast } from '@/lib/auth';
import { db } from '@/lib/db';
import { hashPassword } from '@/lib/password';
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
    const domain = searchParams.get('domain');

    const where: Record<string, unknown> = {};
    if (domain) {
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
    const user = await requireSession(request);
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

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(address)) {
      throw apiError('Invalid email address format', 'VALIDATION_ERROR', undefined, 400);
    }

    // Check the address domain matches
    const addressDomain = address.split('@')[1];
    if (addressDomain !== domain) {
      throw apiError('Email address domain must match the specified domain', 'VALIDATION_ERROR', undefined, 400);
    }

    // Check domain exists
    const domainRecord = await db.domain.findUnique({
      where: { domain },
    });
    if (!domainRecord) {
      throw apiError('Domain not found in system', 'NOT_FOUND', undefined, 404);
    }

    // Check for duplicate address
    const existing = await db.emailAccount.findUnique({
      where: { address },
    });
    if (existing) {
      throw apiError('An email account with this address already exists', 'CONFLICT', undefined, 409);
    }

    const passwordHash = await hashPassword(password);

    const account = await db.emailAccount.create({
      data: {
        domain,
        address,
        password: passwordHash,
        quotaMb: quotaMb ?? 500,
        isActive: true,
      },
    });

    // Strip password from response
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
      metadata: { address, quotaMb: account.quotaMb },
    });

    return NextResponse.json(apiSuccess(sanitized, 'Email account created successfully'), { status: 201 });
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

    const existing = await db.emailAccount.findUnique({
      where: { id: accountId },
    });
    if (!existing) {
      throw apiError('Email account not found', 'NOT_FOUND', undefined, 404);
    }

    const updateData: Record<string, unknown> = {};
    if (quotaMb !== undefined) updateData.quotaMb = quotaMb;
    if (isActive !== undefined) updateData.isActive = isActive;
    if (password) updateData.password = await hashPassword(password);

    const updated = await db.emailAccount.update({
      where: { id: accountId },
      data: updateData,
    });

    // Strip password
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

    const account = await db.emailAccount.findUnique({
      where: { id: accountId },
    });

    if (!account) {
      throw apiError('Email account not found', 'NOT_FOUND', undefined, 404);
    }

    // Verify ownership: domain must belong to user's website or user is SUPER_ADMIN
    if (!isRoleAtLeast(user.role, ROLES.SUPER_ADMIN)) {
      const domainRecord = await db.domain.findUnique({
        where: { domain: account.domain },
        include: { website: true },
      });
      if (!domainRecord || domainRecord.website.ownerId !== user.id) {
        throw apiError('You do not have permission to delete this email account', 'FORBIDDEN', undefined, 403);
      }
    }

    await db.emailAccount.delete({
      where: { id: accountId },
    });

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

    return NextResponse.json(apiSuccess(null, 'Email account deleted successfully'));
  } catch (e) {
    return handleErr(e);
  }
}
