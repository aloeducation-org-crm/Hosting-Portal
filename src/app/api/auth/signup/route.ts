import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { v4 as uuidv4 } from "uuid";
import { encode, getToken } from "next-auth/jwt";
import { apiSuccess, apiError } from "@/lib/response";
import { db } from "@/lib/db";
import { applyEntitlementChange, freeTierAuthorization, type PlanRecord } from "@/lib/billing/entitlements";
import { logger } from "@/lib/logger";
import { hashPassword } from "@/lib/password";
import { sendEmail } from "@/lib/smtp";
import { env } from "@/lib/env";
import { sessionCookieName, sessionCookieOptions } from "@/lib/session-cookie";

const signupSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters"),
  email: z.string().email("Invalid email address"),
  password: z.string().min(8, "Password must be at least 8 characters"),
  role: z
    .enum(["SUPER_ADMIN", "ADMIN", "RESELLER", "CLIENT", "DEVOPS", "SUPPORT", "VIEWER"])
    .optional()
    .default("CLIENT"),
  companyName: z.string().optional(),
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const input = signupSchema.parse(body);
    const normalizedEmail = input.email.toLowerCase().trim();

    const existing = await db.user.findUnique({ where: { email: normalizedEmail } });
    if (existing) {
      return NextResponse.json(
        apiError("Email already in use", "CONFLICT", undefined, 409),
        { status: 409 }
      );
    }

    // Only allow privileged role assignment if caller is an authenticated admin
    let targetRoleName = input.role;
    const privilegedRoles = ["SUPER_ADMIN", "ADMIN", "DEVOPS", "SUPPORT"];
    if (privilegedRoles.includes(targetRoleName)) {
      const callerToken = await getToken({ req: request, secret: env.NEXTAUTH_SECRET }).catch(
        () => null
      );
      const callerRole = callerToken?.role as string | undefined;
      if (callerRole !== "SUPER_ADMIN" && callerRole !== "ADMIN") {
        targetRoleName = "CLIENT";
      }
    }

    let role = await db.role.findUnique({ where: { name: targetRoleName } });
    if (!role) {
      role = await db.role.findUnique({ where: { name: "VIEWER" } });
    }
    if (!role) {
      role = await db.role.create({
        data: {
          name: targetRoleName,
          description: `${targetRoleName} role`,
        },
      });
    }

    const passwordHash = await hashPassword(input.password);
    const newUser = await db.user.create({
      data: {
        name: input.name.trim(),
        email: normalizedEmail,
        passwordHash,
        roleId: role.id,
        companyName: input.companyName?.trim() || null,
        onboardingCompleted: false,
        onboardingStep: 0,
      },
      include: {
        role: { include: { permissions: { include: { permission: true } } } },
      },
    });

    /**
     * Provision the default free plan, if the platform has one.
     *
     * SEC-03: this used to write the Subscription row directly, which made it a
     * fourth place the entitlement rule was not applied. The plan is selected by
     * *price* first — the previous `OR: [{ name: "Starter" }, { priceCents: 0 }]`
     * would happily match a plan literally named "Starter" whatever it cost — and
     * the grant goes through the single entitlement service, which refuses any
     * non-zero plan.
     */
    const starterPlan = await db.plan.findFirst({
      where: { isActive: true, priceCents: 0 },
      orderBy: { priceCents: "asc" },
    });
    if (starterPlan) {
      await applyEntitlementChange({
        userId: newUser.id,
        plan: starterPlan as PlanRecord,
        authorization: freeTierAuthorization("Default free plan provisioned at signup"),
      }).catch((error: unknown) => {
        // A missing default plan must never roll back a successful registration;
        // the account simply starts with no subscription, which the plan-limit
        // check treats as "no limit agreed yet" rather than "unlimited".
        logger.error(
          { event: "signup_free_plan_failed", userId: newUser.id, error: error instanceof Error ? error.message : "unknown" },
          "default free plan could not be provisioned at signup",
        );
      });
    }

    // Create email verification token and send verification email via SMTP
    const verificationToken = uuidv4();
    await db.verificationToken.create({
      data: {
        identifier: normalizedEmail,
        token: verificationToken,
        type: "EMAIL_VERIFICATION",
        userId: newUser.id,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    });

    const verifyUrl = `${env.APP_URL}/verify-email?token=${verificationToken}&email=${encodeURIComponent(normalizedEmail)}`;
    const emailResult = await sendEmail({
      to: normalizedEmail,
      subject: "Verify your ALO Labs Hosting Portal account",
      text: `Welcome to ALO Labs, ${newUser.name}! Verify your email here: ${verifyUrl}`,
      html: `
        <div style="font-family: sans-serif; max-width: 560px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 12px;">
          <h2 style="color: #1e293b; margin-top: 0;">Welcome to ALO Labs Hosting Portal</h2>
          <p style="color: #475569; line-height: 1.6;">Hi ${newUser.name}, thank you for creating your account. Please confirm your email address to activate all hosting features.</p>
          <p style="margin: 24px 0;">
            <a href="${verifyUrl}" style="background: #E8501A; color: #ffffff; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 600; display: inline-block;">Verify Email Address</a>
          </p>
          <p style="color: #94a3b8; font-size: 12px;">Verification code: <code>${verificationToken}</code></p>
        </div>
      `,
    });

    await db.auditLog.create({
      data: {
        actorUserId: newUser.id,
        actorEmail: newUser.email,
        actorRole: newUser.role.name,
        action: "USER_REGISTER",
        resourceType: "User",
        resourceId: newUser.id,
        result: "SUCCESS",
        ipAddress:
          request.headers.get("x-forwarded-for") ??
          request.headers.get("x-real-ip"),
      },
    });

    const jwtToken = await encode({
      token: {
        sub: newUser.id,
        userId: newUser.id,
        email: newUser.email,
        name: newUser.name,
        role: newUser.role.name,
        emailVerified: false,
        onboardingCompleted: false,
      },
      secret: env.NEXTAUTH_SECRET,
      maxAge: 86400,
    });

    const permissions = newUser.role.permissions.map((rp) => rp.permission.name);

    const response = NextResponse.json(
      apiSuccess(
        {
          id: newUser.id,
          name: newUser.name,
          email: newUser.email,
          role: newUser.role.name,
          permissions,
          plan: "starter",
          emailVerified: false,
          emailSent: emailResult.sent,
          onboardingCompleted: false,
          onboardingStep: 0,
          verificationToken:
            process.env.NODE_ENV !== "production" ? verificationToken : undefined,
          token: jwtToken,
          createdAt: newUser.createdAt,
        },
        emailResult.sent ? "User registered successfully" : "User registered, but the verification email was not sent. Use resend verification after SMTP is configured.",
        201
      ),
      { status: 201 }
    );

    response.cookies.set(sessionCookieName(), jwtToken, sessionCookieOptions());

    return response;
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json(
        apiError("Validation failed", "VALIDATION_ERROR", e.flatten(), 400),
        { status: 400 }
      );
    }
    if (e && typeof e === "object" && "status" in e) {
      const a = e as { status: number };
      return NextResponse.json(a, { status: a.status });
    }
    return NextResponse.json(apiError("Internal server error"), { status: 500 });
  }
}
