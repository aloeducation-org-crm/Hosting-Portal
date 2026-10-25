import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { encode } from "next-auth/jwt";
import { apiSuccess, apiError, type ApiResponse } from "@/lib/response";
import { db } from "@/lib/db";
import { verifyPassword } from "@/lib/password";
import { env } from "@/lib/env";

const loginSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(1, "Password is required"),
});

function handleErr(e: unknown): NextResponse {
  if (e && typeof e === "object" && "status" in e) {
    const a = e as ApiResponse;
    return NextResponse.json(a, { status: a.status });
  }
  return NextResponse.json(apiError("Internal server error"), { status: 500 });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email, password } = loginSchema.parse(body);
    const normalizedEmail = email.toLowerCase().trim();

    const user = await db.user.findUnique({
      where: { email: normalizedEmail },
      include: {
        role: { include: { permissions: { include: { permission: true } } } },
        mfa: true,
        subscriptions: {
          where: { status: "active" },
          include: { plan: true },
          take: 1,
        },
      },
    });

    if (!user || !user.passwordHash) {
      await db.auditLog.create({
        data: {
          actorEmail: normalizedEmail,
          action: "LOGIN_FAILED",
          resourceType: "User",
          result: "FAILURE",
          ipAddress:
            request.headers.get("x-forwarded-for") ??
            request.headers.get("x-real-ip"),
        },
      });
      return NextResponse.json(
        apiError("Invalid email or password", "INVALID_CREDENTIALS", undefined, 401),
        { status: 401 }
      );
    }

    if (user.isLocked && user.lockedUntil) {
      if (new Date() > user.lockedUntil) {
        await db.user.update({
          where: { id: user.id },
          data: { isLocked: false, lockedUntil: null, failedLoginAttempts: 0 },
        });
      } else {
        return NextResponse.json(
          apiError(
            "Account is temporarily locked due to multiple failed login attempts",
            "ACCOUNT_LOCKED",
            undefined,
            423
          ),
          { status: 423 }
        );
      }
    }

    if (!user.isActive) {
      return NextResponse.json(
        apiError("Account is disabled", "ACCOUNT_DISABLED", undefined, 403),
        { status: 403 }
      );
    }

    const valid = await verifyPassword(password, user.passwordHash);
    if (!valid) {
      const nextAttempts = user.failedLoginAttempts + 1;
      await db.user.update({
        where: { id: user.id },
        data: {
          failedLoginAttempts: nextAttempts,
          ...(nextAttempts >= 5
            ? {
                isLocked: true,
                lockedUntil: new Date(Date.now() + 15 * 60 * 1000),
              }
            : {}),
        },
      });

      await db.auditLog.create({
        data: {
          actorUserId: user.id,
          actorEmail: user.email,
          action: "LOGIN_FAILED",
          resourceType: "User",
          resourceId: user.id,
          result: "FAILURE",
          ipAddress:
            request.headers.get("x-forwarded-for") ??
            request.headers.get("x-real-ip"),
        },
      });

      return NextResponse.json(
        apiError("Invalid email or password", "INVALID_CREDENTIALS", undefined, 401),
        { status: 401 }
      );
    }

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
        action: "LOGIN_SUCCESS",
        resourceType: "User",
        resourceId: user.id,
        result: "SUCCESS",
        ipAddress:
          request.headers.get("x-forwarded-for") ??
          request.headers.get("x-real-ip"),
      },
    });

    const jwtToken = await encode({
      token: {
        sub: user.id,
        userId: user.id,
        email: user.email,
        name: user.name,
        role: user.role.name,
        mfaEnabled: user.mfa?.isEnabled ?? false,
        emailVerified: !!user.emailVerified,
        onboardingCompleted: user.onboardingCompleted ?? false,
      },
      secret: env.NEXTAUTH_SECRET,
      maxAge: 86400,
    });

    const permissions = user.role.permissions.map((rp) => rp.permission.name);
    const activePlan = user.subscriptions?.[0]?.plan?.name?.toLowerCase() || "starter";

    const payload = {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role.name,
      permissions,
      plan: activePlan,
      emailVerified: !!user.emailVerified,
      onboardingCompleted: user.onboardingCompleted ?? false,
      onboardingStep: user.onboardingStep ?? 0,
      token: jwtToken,
    };

    const response = NextResponse.json(apiSuccess(payload, "Login successful"));
    response.cookies.set("next-auth.session-token", jwtToken, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 86400,
    });

    return response;
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json(
        apiError("Validation failed", "VALIDATION_ERROR", e.flatten(), 400),
        { status: 400 }
      );
    }
    return handleErr(e);
  }
}
