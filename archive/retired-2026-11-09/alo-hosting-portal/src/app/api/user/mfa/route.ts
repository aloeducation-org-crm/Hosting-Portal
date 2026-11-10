import { NextRequest, NextResponse } from 'next/server';
import { apiSuccess, apiError, type ApiResponse } from '@/lib/response';
import { requireSession } from '@/lib/auth';
import { db } from '@/lib/db';
import { TOTP, Secret } from 'otpauth';
import { hashPassword } from '@/lib/password';
import crypto from 'crypto';

function handleErr(e: unknown): NextResponse {
  if (e && typeof e === 'object' && 'status' in e) {
    const a = e as ApiResponse;
    return NextResponse.json(a, { status: a.status });
  }
  return NextResponse.json(apiError('Internal server error'), { status: 500 });
}

function generateBackupCode(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let code = '';
  for (let i = 0; i < 8; i++) {
    code += chars[crypto.randomInt(chars.length)];
  }
  return code;
}

export async function GET(request: NextRequest) {
  try {
    const auth = await requireSession(request);

    const userMfa = await db.userMfa.findUnique({
      where: { userId: auth.id },
      select: {
        method: true,
        isVerified: true,
        isEnabled: true,
      },
    });

    return NextResponse.json(
      apiSuccess({
        enabled: userMfa?.isEnabled ?? false,
        method: userMfa?.method ?? null,
        verified: userMfa?.isVerified ?? false,
      }),
    );
  } catch (e) {
    return handleErr(e);
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireSession(request);
    const body = await request.json();
    const { method } = body as { method?: string };

    if (method !== 'totp') {
      throw apiError('Only TOTP method is supported', 'INVALID_INPUT', undefined, 400);
    }

    const totp = new TOTP({
      issuer: 'ALO Labs Hosting',
      label: auth.email,
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
      secret: new Secret({ size: 20 }),
    });

    const unhashedCodes: string[] = [];
    const hashedCodes: string[] = [];
    for (let i = 0; i < 10; i++) {
      const code = generateBackupCode();
      unhashedCodes.push(code);
      hashedCodes.push(await hashPassword(code));
    }

    await db.userMfa.upsert({
      where: { userId: auth.id },
      create: {
        userId: auth.id,
        method: 'totp',
        secret: totp.secret.base32,
        backupCodes: JSON.stringify(hashedCodes),
        isVerified: false,
        isEnabled: false,
      },
      update: {
        method: 'totp',
        secret: totp.secret.base32,
        backupCodes: JSON.stringify(hashedCodes),
        isVerified: false,
        isEnabled: false,
      },
    });

    return NextResponse.json(
      apiSuccess({
        secret: totp.secret.base32,
        qrUrl: totp.toString(),
        backupCodes: unhashedCodes,
      }),
    );
  } catch (e) {
    return handleErr(e);
  }
}
