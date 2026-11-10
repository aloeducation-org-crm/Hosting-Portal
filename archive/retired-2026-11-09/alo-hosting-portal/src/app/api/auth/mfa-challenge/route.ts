import { NextRequest, NextResponse } from 'next/server';
import { apiSuccess, apiError, type ApiResponse } from '@/lib/response';
import { db } from '@/lib/db';
import { verifyPassword } from '@/lib/password';
import { TOTP } from 'otpauth';

function handleErr(e: unknown): NextResponse {
  if (e && typeof e === 'object' && 'status' in e) {
    const a = e as ApiResponse;
    return NextResponse.json(a, { status: a.status });
  }
  return NextResponse.json(apiError('Internal server error'), { status: 500 });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email, password, mfaCode } = body as {
      email?: string;
      password?: string;
      mfaCode?: string;
    };

    if (!email || !password) {
      throw apiError('Email and password are required', 'INVALID_INPUT', undefined, 400);
    }

    const user = await db.user.findUnique({
      where: { email },
      include: { role: true, mfa: true },
    });

    if (!user || !user.passwordHash) {
      throw apiError('Invalid email or password', 'INVALID_CREDENTIALS', undefined, 401);
    }

    if (user.isLocked) {
      if (user.lockedUntil && new Date() > user.lockedUntil) {
        await db.user.update({
          where: { id: user.id },
          data: { isLocked: false, lockedUntil: null, failedLoginAttempts: 0 },
        });
      } else {
        throw apiError('Account is locked', 'ACCOUNT_LOCKED', undefined, 403);
      }
    }

    if (!user.isActive) {
      throw apiError('Account is disabled', 'ACCOUNT_DISABLED', undefined, 403);
    }

    const valid = await verifyPassword(password, user.passwordHash);
    if (!valid) {
      throw apiError('Invalid email or password', 'INVALID_CREDENTIALS', undefined, 401);
    }

    // Check if MFA is enabled
    if (!user.mfa || !user.mfa.isEnabled || !user.mfa.secret) {
      return NextResponse.json(
        apiSuccess({
          verified: true,
          mfaRequired: false,
          userId: user.id,
        }),
      );
    }

    // MFA is enabled — verify the code
    if (!mfaCode || typeof mfaCode !== 'string') {
      throw apiError('MFA code is required', 'MFA_CODE_REQUIRED', undefined, 400);
    }

    const totp = new TOTP({
      issuer: 'ALO Labs Hosting',
      label: user.email,
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
      secret: user.mfa.secret,
    });

    const delta = totp.validate({ token: mfaCode, window: 1 });
    if (delta === null) {
      throw apiError('Invalid MFA code', 'INVALID_MFA_CODE', undefined, 401);
    }

    await db.userMfa.update({
      where: { userId: user.id },
      data: { lastUsedAt: new Date() },
    });

    return NextResponse.json(
      apiSuccess({
        verified: true,
        mfaRequired: true,
        userId: user.id,
      }),
    );
  } catch (e) {
    return handleErr(e);
  }
}
