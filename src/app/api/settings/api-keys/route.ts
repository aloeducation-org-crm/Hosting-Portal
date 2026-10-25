import { NextRequest, NextResponse } from 'next/server';
import { apiSuccess, apiError, type ApiResponse } from '@/lib/response';
import { requireSession } from '@/lib/auth';
import { db } from '@/lib/db';
import { hashPassword } from '@/lib/password';
import { z } from 'zod';
import crypto from 'crypto';

function handleErr(e: unknown): NextResponse {
  if (e && typeof e === 'object' && 'status' in e) {
    const a = e as ApiResponse;
    return NextResponse.json(a, { status: a.status });
  }
  return NextResponse.json(apiError('Internal server error'), { status: 500 });
}

const createApiKeySchema = z.object({
  name: z.string().min(1, 'Name is required').max(100),
  expiresAt: z.string().datetime({ offset: true }).optional(),
});

function generateApiKey(): { fullKey: string; prefix: string } {
  const randomPart = crypto.randomBytes(32).toString('hex');
  const fullKey = `alo_${randomPart}`;
  const prefix = `alo_${randomPart.slice(0, 8)}`;
  return { fullKey, prefix };
}

export async function GET(request: NextRequest) {
  try {
    const user = await requireSession(request);

    const apiKeys = await db.apiKey.findMany({
      where: { userId: user.id },
      select: {
        id: true,
        name: true,
        prefix: true,
        lastUsedAt: true,
        expiresAt: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json(apiSuccess(apiKeys));
  } catch (e) {
    return handleErr(e);
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireSession(request);

    const body = await request.json();
    const parsed = createApiKeySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        apiError('Validation failed', 'VALIDATION_ERROR', parsed.error.flatten().fieldErrors),
        { status: 400 },
      );
    }

    const { name, expiresAt } = parsed.data;
    const { fullKey, prefix } = generateApiKey();
    const keyHash = await hashPassword(fullKey);

    const apiKey = await db.apiKey.create({
      data: {
        userId: user.id,
        name,
        prefix,
        keyHash,
        expiresAt: expiresAt ? new Date(expiresAt) : null,
      },
    });

    const ip = request.headers.get('x-forwarded-for') ?? request.headers.get('x-real-ip');
    await db.auditLog.create({
      data: {
        actorUserId: user.id,
        actorEmail: user.email,
        actorRole: user.role,
        action: 'API_KEY_CREATE',
        resourceType: 'ApiKey',
        resourceId: apiKey.id,
        result: 'SUCCESS',
        ipAddress: ip,
      },
    });

    return NextResponse.json(
      apiSuccess(
        {
          id: apiKey.id,
          name: apiKey.name,
          prefix: apiKey.prefix,
          key: fullKey,
          expiresAt: apiKey.expiresAt,
          createdAt: apiKey.createdAt,
        },
        'API key created. Save this key — it will not be shown again.',
        201,
      ),
      { status: 201 },
    );
  } catch (e) {
    return handleErr(e);
  }
}
