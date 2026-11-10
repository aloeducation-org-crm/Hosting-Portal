import { NextRequest, NextResponse } from 'next/server';
import { apiSuccess, apiError, type ApiResponse } from '@/lib/response';
import { requireSession } from '@/lib/auth';
import { db } from '@/lib/db';
import { TOTP } from 'otpauth';
import { verifyPassword } from '@/lib/password';

function handleErr(e: unknown): NextResponse {
  if (e && typeof e === 'object' && 'status' in e) {
    const a = e as ApiResponse;
    return NextResponse.json(a, { status: a.status });
  }
  return NextResponse.json(apiError('Internal server error'), { status: 500 });
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireSession(request);
    const body = await request.json();
    const { code } = body as { code?: string };

    if (!code || typeof code !== 'string') {
      throw apiError('A valid TOTP code or backup code is required', 'INVALID_INPUT', undefined, 400);
    }

    const userMfa = await db.userMfa.findUnique({
      where: { userId: auth.id },
    });

    if (!userMfa || !userMfa.secret) {
      throw apiError('MFA is not set up', 'MFA_NOT_SETUP', undefined, 400);
    }

    if (!userMfa.isEnabled) {
      throw apiError('MFA is not currently enabled', 'MFA_NOT_ENABLED', undefined, 400);
    }

    // Try TOTP verification first
    const totp = new TOTP({
      issuer: 'ALO Labs Hosting',
      label: auth.email,
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
      secret: userMfa.secret,
    });

    const delta = totp.validate({ token: code, window: 1 });
    let isBackupCode = false;

    if (delta === null) {
      // TOTP failed, try backup codes
      const storedCodes: string[] = userMfa.backupCodes
        ? JSON.parse(userMfa.backupCodes as string)
        : [];

      let matchedIndex = -1;
      for (let i = 0; i < storedCodes.length; i++) {
        const stored = storedCodes[i];
        if (!stored) continue;
        const valid = await verifyPassword(code, stored);
        if (valid) {
          matchedIndex = i;
          break;
        }
      }

      if (matchedIndex === -1) {
        throw apiError('Invalid TOTP code or backup code', 'INVALID_MFA_CODE', undefined, 400);
      }

      isBackupCode = true;
      // Remove the used backup code
      storedCodes.splice(matchedIndex, 1);

      await db.userMfa.update({
        where: { userId: auth.id },
        data: {
          isEnabled: false,
          isVerified: false,
          secret: null,
          backupCodes: storedCodes.length > 0 ? JSON.stringify(storedCodes) : null,
        },
      });
    } else {
      // TOTP valid — disable MFA completely
      await db.userMfa.update({
        where: { userId: auth.id },
        data: {
          isEnabled: false,
          isVerified: false,
          secret: null,
          backupCodes: null,
        },
      });
    }

    return NextResponse.json(apiSuccess(null, 'MFA disabled successfully'));
  } catch (e) {
    return handleErr(e);
  }
}
