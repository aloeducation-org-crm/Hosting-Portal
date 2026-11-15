import { NextRequest, NextResponse } from "next/server";
import { encode } from "next-auth/jwt";
import { apiSuccess, apiError, type ApiResponse } from "@/lib/response";
import { db } from "@/lib/db";
import { verifyPassword } from "@/lib/password";
import { env } from "@/lib/env";
import { sessionCookieName, sessionCookieOptions } from "@/lib/session-cookie";
import {
  verifyMfaChallengeToken,
  verifyUserMfaCode,
  openMfaSecret,
  sealMfaSecret,
} from "@/lib/mfa-challenge";
import { needsSealing } from "@/lib/secret-store";

function handleErr(e: unknown): NextResponse {
  if (e && typeof e === "object" && "status" in e) {
    const a = e as ApiResponse;
    return NextResponse.json(a, { status: a.status });
  }
  return NextResponse.json(apiError("Internal server error"), { status: 500 });
}

async function recordFailedAttempt(userId: string, currentAttempts: number, email: string, ip: string | null) {
  const nextAttempts = currentAttempts + 1;
  await db.user.update({
    where: { id: userId },
    data: {
      failedLoginAttempts: nextAttempts,
      ...(nextAttempts >= 5
        ? { isLocked: true, lockedUntil: new Date(Date.now() + 15 * 60 * 1000) }
        : {}),
    },
  });
  await db.auditLog.create({
    data: {
      actorUserId: userId,
      actorEmail: email,
      action: "LOGIN_MFA_FAILED",
      resourceType: "User",
      resourceId: userId,
      result: "FAILURE",
      ipAddress: ip,
    },
  });
}

/**
 * POST /api/auth/mfa-challenge
 *
 * Completes step-2 MFA authentication:
 *   1. Preferred flow: `{ mfaToken, mfaCode }` issued by `POST /api/auth/login`
 *      when an account has MFA enabled. Verifies the TOTP or single-use backup
 *      code, increments lockout counters on failure, and mints the httpOnly
 *      NextAuth session cookie on success.
 *   2. Direct credentials flow: `{ email, password, mfaCode }` (for API callers
 *      verifying MFA with primary credentials in a single step).
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { mfaToken, email, password, mfaCode, code } = body as {
      mfaToken?: string;
      email?: string;
      password?: string;
      mfaCode?: string;
      code?: string;
    };

    const suppliedCode = (mfaCode ?? code ?? "").trim();
    const ip =
      request.headers.get("x-forwarded-for") ??
      request.headers.get("x-real-ip");

    const userInclude = {
      role: { include: { permissions: { include: { permission: true } } } },
      mfa: true,
      subscriptions: {
        where: { status: "active" },
        include: { plan: true },
        take: 1,
      },
    } as const;

    let user;
    let issueSessionCookie = false;

    if (mfaToken) {
      const ticket = verifyMfaChallengeToken(mfaToken);
      if (!ticket) {
        throw apiError("MFA challenge expired or invalid. Please sign in again.", "INVALID_MFA_TOKEN", undefined, 401);
      }
      user = await db.user.findUnique({
        where: { id: ticket.userId },
        include: userInclude,
      });
      if (!user || user.email.toLowerCase() !== ticket.email) {
        throw apiError("MFA challenge expired or invalid. Please sign in again.", "INVALID_MFA_TOKEN", undefined, 401);
      }
      issueSessionCookie = true;
    } else {
      if (!email || !password) {
        throw apiError("Either mfaToken or email and password are required", "INVALID_INPUT", undefined, 400);
      }
      user = await db.user.findUnique({
        where: { email: email.toLowerCase().trim() },
        include: userInclude,
      });
      if (!user || !user.passwordHash) {
        throw apiError("Invalid email or password", "INVALID_CREDENTIALS", undefined, 401);
      }
    }

    if (user.isLocked) {
      if (user.lockedUntil && new Date() > user.lockedUntil) {
        await db.user.update({
          where: { id: user.id },
          data: { isLocked: false, lockedUntil: null, failedLoginAttempts: 0 },
        });
      } else {
        throw apiError("Account is temporarily locked", "ACCOUNT_LOCKED", undefined, 423);
      }
    }

    if (!user.isActive) {
      throw apiError("Account is disabled", "ACCOUNT_DISABLED", undefined, 403);
    }

    const isAdminUser = user.role.name === "SUPER_ADMIN" || user.role.name === "ADMIN";
    if (!user.onboardingCompleted && !isAdminUser) {
      throw apiError(
        "Account pending admin approval. Please wait for an administrator to activate your account.",
        "PENDING_APPROVAL",
        undefined,
        403,
      );
    }

    if (!mfaToken) {
      const validPassword = await verifyPassword(password!, user.passwordHash!);
      if (!validPassword) {
        await recordFailedAttempt(user.id, user.failedLoginAttempts, user.email, ip);
        throw apiError("Invalid email or password", "INVALID_CREDENTIALS", undefined, 401);
      }
    }

    if (!user.mfa || !user.mfa.isEnabled || !user.mfa.secret) {
      return NextResponse.json(
        apiSuccess({
          verified: true,
          mfaRequired: false,
          userId: user.id,
        }),
      );
    }

    if (!suppliedCode) {
      throw apiError("MFA code is required", "MFA_CODE_REQUIRED", undefined, 400);
    }

    const check = await verifyUserMfaCode({
      storedSecret: user.mfa.secret,
      email: user.email,
      code: suppliedCode,
      backupCodesJson: user.mfa.backupCodes,
    });

    if (!check.valid) {
      await recordFailedAttempt(user.id, user.failedLoginAttempts, user.email, ip);
      throw apiError("Invalid MFA code", "INVALID_MFA_CODE", undefined, 401);
    }

    // Lazily seal legacy plaintext TOTP secret + consume used backup code if applicable
    const mfaUpdateData: Record<string, unknown> = { lastUsedAt: new Date() };
    if (needsSealing(user.mfa.secret)) {
      mfaUpdateData.secret = sealMfaSecret(openMfaSecret(user.mfa.secret));
    }
    if (check.method === "backup_code") {
      mfaUpdateData.backupCodes = check.remainingBackupCodesJson ?? null;
    }

    await db.userMfa.update({
      where: { userId: user.id },
      data: mfaUpdateData,
    });

    await db.user.update({
      where: { id: user.id },
      data: {
        failedLoginAttempts: 0,
        isLocked: false,
        lockedUntil: null,
        lastLoginAt: new Date(),
      },
    });

    await db.auditLog.create({
      data: {
        actorUserId: user.id,
        actorEmail: user.email,
        actorRole: user.role.name,
        action: "LOGIN_MFA_SUCCESS",
        resourceType: "User",
        resourceId: user.id,
        result: "SUCCESS",
        ipAddress: ip,
        metadata: JSON.stringify({ method: check.method }),
      },
    });

    if (!issueSessionCookie) {
      return NextResponse.json(
        apiSuccess({
          verified: true,
          mfaRequired: true,
          userId: user.id,
        }),
      );
    }

    const jwtToken = await encode({
      token: {
        sub: user.id,
        userId: user.id,
        email: user.email,
        name: user.name,
        role: user.role.name,
        mfaEnabled: true,
        emailVerified: !!user.emailVerified,
        onboardingCompleted: user.onboardingCompleted ?? false,
      },
      secret: env.NEXTAUTH_SECRET,
      maxAge: 86400,
    });

    const permissions = user.role.permissions.map((rp) => rp.permission.name);
    const activePlan = user.subscriptions?.[0]?.plan?.name?.toLowerCase() || "starter";

    const response = NextResponse.json(
      apiSuccess(
        {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role.name,
          permissions,
          plan: activePlan,
          emailVerified: !!user.emailVerified,
          onboardingCompleted: user.onboardingCompleted ?? false,
          onboardingStep: user.onboardingStep ?? 0,
          verified: true,
          mfaRequired: true,
        },
        "MFA verified and login successful",
      ),
    );
    response.cookies.set(sessionCookieName(), jwtToken, sessionCookieOptions());
    return response;
  } catch (e) {
    return handleErr(e);
  }
}
