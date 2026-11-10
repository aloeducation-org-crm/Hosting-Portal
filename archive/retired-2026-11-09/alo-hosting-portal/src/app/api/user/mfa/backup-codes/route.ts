import { NextRequest, NextResponse } from 'next/server';
import { apiSuccess, apiError, type ApiResponse } from '@/lib/response';
import { requireSession } from '@/lib/auth';
import { db } from '@/lib/db';
import { TOTP } from 'otpauth';
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

export async function POST(request: NextRequest) {
  try {
    const auth = await requireSession(request);
    const body = await request.json();
    const { code } = body as { code?: string };

    if (!code || typeof code !== 'string' || code.length !== 6) {
      throw apiError('A valid 6-digit TOTP code is required', 'INVALID_INPUT', undefined, 400);
    }

    const userMfa = await db.userMfa.findUnique({
      where: { userId: auth.id },
    });

    if (!userMfa || !userMfa.secret) {
      throw apiError('MFA is not set up', 'MFA_NOT_SETUP', undefined, 400);
    }

    if (!userMfa.isEnabled) {
      throw apiError('MFA must be enabled to regenerate backup codes', 'MFA_NOT_ENABLED', undefined, 400);
    }

    const totp = new TOTP({
      issuer: 'ALO Labs Hosting',
      label: auth.email,
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
      secret: userMfa.secret,
    });

    const delta = totp.validate({ token: code, window: 1 });
    if (delta === null) {
      throw apiError('Invalid TOTP code', 'INVALID_MFA_CODE', undefined, 400);
    }

    const unhashedCodes: string[] = [];
    const hashedCodes: string[] = [];
    for (let i = 0; i < 10; i++) {
      const newCode = generateBackupCode();
      unhashedCodes.push(newCode);
      hashedCodes.push(await hashPassword(newCode));
    }

    await db.userMfa.update({
      where: { userId: auth.id },
      data: {
        backupCodes: JSON.stringify(hashedCodes),
      },
    });

    return NextResponse.json(
      apiSuccess({
        backupCodes: unhashedCodes,
      }, 'Backup codes regenerated successfully'),
    );
  } catch (e) {
    return handleErr(e);
  }
}
