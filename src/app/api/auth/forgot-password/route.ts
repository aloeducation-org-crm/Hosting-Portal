import { NextRequest, NextResponse } from "next/server";
import { createHash, randomBytes } from "crypto";
import { z } from "zod";
import { apiSuccess, apiError } from "@/lib/response";
import { db } from "@/lib/db";
import { sendEmail } from "@/lib/smtp";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RESET_TOKEN_TTL_MS = 30 * 60 * 1000; // 30 minutes
const GENERIC_MESSAGE =
  "If an account exists for that email, a password reset link is on its way.";

const bodySchema = z.object({
  email: z.string().email("A valid email address is required").max(320),
});

// Constant-time-shape response for every outcome that could reveal whether an
// account exists: same status, same message, same requestId shape.
const genericResponse = () => apiSuccess({ sent: true }, GENERIC_MESSAGE);

export async function POST(request: NextRequest) {
  let email: string;
  try {
    const body = await request.json();
    email = bodySchema.parse(body).email.toLowerCase().trim();
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json(
        apiError("A valid email address is required", "VALIDATION_ERROR", e.flatten(), 400),
        { status: 400 },
      );
    }
    return NextResponse.json(
      apiError("Invalid request body", "VALIDATION_ERROR", undefined, 400),
      { status: 400 },
    );
  }

  try {
    const user = await db.user.findUnique({
      where: { email },
      select: { id: true, email: true, name: true, isActive: true },
    });

    // Unknown or disabled account: return the generic response so the endpoint
    // cannot be used to enumerate registered emails.
    if (!user || !user.isActive) {
      return NextResponse.json(genericResponse());
    }

    // Single outstanding reset token per account: invalidate previous ones so
    // only the newest link works.
    await db.verificationToken.deleteMany({
      where: { identifier: email, type: "PASSWORD_RESET", usedAt: null },
    });

    const rawToken = randomBytes(32).toString("hex");
    const hashedToken = createHash("sha256").update(rawToken, "utf8").digest("hex");

    await db.verificationToken.create({
      data: {
        identifier: email,
        // Only the SHA-256 digest is stored; the raw token travels exclusively
        // in the reset URL. A database read never yields a usable link.
        token: hashedToken,
        type: "PASSWORD_RESET",
        userId: user.id,
        expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS),
      },
    });

    const resetUrl = `${env.APP_URL}/reset-password?token=${rawToken}`;
    const greeting = user.name || "there";
    const emailResult = await sendEmail({
      to: email,
      subject: "Reset your ALO Labs Hosting Portal password",
      text:
        `Hi ${greeting},\n\n` +
        `We received a request to reset your password. This link expires in 30 minutes:\n${resetUrl}\n\n` +
        `If you did not request a password reset, you can safely ignore this email — your password stays unchanged.`,
      html:
        `<p>Hi ${greeting},</p>` +
        `<p>We received a request to reset your password. This link expires in <strong>30 minutes</strong>:</p>` +
        `<p><a href="${resetUrl}">Reset your password</a></p>` +
        `<p>If you did not request a password reset, you can safely ignore this email — your password stays unchanged.</p>`,
    });

    try {
      await db.auditLog.create({
        data: {
          actorUserId: user.id,
          actorEmail: user.email,
          action: "PASSWORD_RESET_REQUESTED",
          resourceType: "User",
          resourceId: user.id,
          result: "SUCCESS",
          ipAddress:
            request.headers.get("x-forwarded-for") ?? request.headers.get("x-real-ip") ?? undefined,
        },
      });
    } catch (auditError) {
      // Auditing must never break the reset flow.
      logger.warn({ err: auditError }, "Failed to record PASSWORD_RESET_REQUESTED audit log");
    }

    return NextResponse.json(
      apiSuccess(
        {
          sent: emailResult.sent,
          // Development convenience only — mirrors the verify-email pattern.
          // Never present in production responses.
          ...(process.env.NODE_ENV !== "production" ? { devToken: rawToken } : {}),
        },
        GENERIC_MESSAGE,
      ),
    );
  } catch (error) {
    logger.error({ err: error }, "Password reset request failed");
    // Still return the generic response: an internal failure must not be
    // distinguishable from "no account" for an outside observer.
    return NextResponse.json(genericResponse());
  }
}
