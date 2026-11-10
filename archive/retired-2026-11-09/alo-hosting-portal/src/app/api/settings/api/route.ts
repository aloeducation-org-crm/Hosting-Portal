import { NextRequest, NextResponse } from 'next/server';
import { apiSuccess, apiError, type ApiResponse } from '@/lib/response';
import { requireSession, ROLES } from '@/lib/auth';
import { db } from '@/lib/db';
import { hashPassword } from '@/lib/password';
import crypto from 'crypto';

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
    const where = user.role === ROLES.SUPER_ADMIN
      ? {}
      : { userId: user.id };
    const apiKeys = await db.apiKey.findMany({
      where,
      take: 50,
      select: {
        id: true,
        name: true,
        prefix: true,
        lastUsedAt: true,
        expiresAt: true,
        createdAt: true,
      },
    });
    return NextResponse.json(apiSuccess(apiKeys));
  } catch (e) {
    return handleErr(e);
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireSession(request);
    const body = await request.json();
    const { name, expiresAt } = body as { name?: string; expiresAt?: string };

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      throw apiError('API key name is required', 'INVALID_INPUT', undefined, 400);
    }

    if (name.length > 100) {
      throw apiError('API key name must be 100 characters or less', 'INVALID_INPUT', undefined, 400);
    }

    const rawKey = `alo_sk_${crypto.randomUUID().replace(/-/g, '')}${crypto.randomUUID().replace(/-/g, '')}`;
    const prefix = rawKey.slice(0, 12);
    const keyHash = await hashPassword(rawKey);

    const parsedExpiresAt = expiresAt ? new Date(expiresAt) : null;

    if (parsedExpiresAt && isNaN(parsedExpiresAt.getTime())) {
      throw apiError('Invalid expiresAt date', 'INVALID_INPUT', undefined, 400);
    }

    const apiKey = await db.apiKey.create({
      data: {
        userId: auth.id,
        name: name.trim(),
        keyHash,
        prefix,
        expiresAt: parsedExpiresAt,
      },
    });

    return NextResponse.json(
      apiSuccess({
        id: apiKey.id,
        name: apiKey.name,
        key: rawKey,
        prefix: apiKey.prefix,
        expiresAt: apiKey.expiresAt,
        createdAt: apiKey.createdAt,
      }, 'API key created. Save the key now — it will not be shown again.'),
    );
  } catch (e) {
    return handleErr(e);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const auth = await requireSession(request);
    const keyId = request.nextUrl.searchParams.get('keyId');

    if (!keyId) {
      throw apiError('keyId query parameter is required', 'INVALID_INPUT', undefined, 400);
    }

    const existingKey = await db.apiKey.findUnique({
      where: { id: keyId },
    });

    if (!existingKey) {
      throw apiError('API key not found', 'NOT_FOUND', undefined, 404);
    }

    if (existingKey.userId !== auth.id && auth.role !== ROLES.SUPER_ADMIN) {
      throw apiError('You do not have permission to delete this API key', 'FORBIDDEN', undefined, 403);
    }

    await db.apiKey.delete({
      where: { id: keyId },
    });

    return NextResponse.json(apiSuccess(null, 'API key deleted successfully'));
  } catch (e) {
    return handleErr(e);
  }
}
