import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { v4 as uuidv4 } from "uuid";
import { apiSuccess, apiError } from "@/lib/response";
import { db } from "@/lib/db";
import { sendEmail } from "@/lib/smtp";
import { env } from "@/lib/env";

const verifyPostSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("verify").default("verify"),
    token: z.string().min(1, "Verification token is required"),
    email: z.string().email().optional(),
  }),
  z.object({
    action: z.literal("resend"),
    email: z.string().email("Valid email address is required"),
  }),
]);

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const token = searchParams.get("token");

    if (!token) {
      return NextResponse.json(
        apiError("Verification token is required", "VALIDATION_ERROR", undefined, 400),
        { status: 400 }
      );
    }

    const record = await db.verificationToken.findUnique({
      where: { token },
    });

    if (!record) {
      return NextResponse.json(
        apiError("Invalid verification token", "INVALID_TOKEN", undefined, 400),
        { status: 400 }
      );
    }

    if (record.usedAt) {
      return NextResponse.json(
        apiSuccess({ verified: true, email: record.identifier, alreadyVerified: true }, "Email already verified")
      );
    }

    if (new Date() > record.expiresAt) {
      return NextResponse.json(
        apiError("Verification token has expired", "TOKEN_EXPIRED", undefined, 400),
        { status: 400 }
      );
    }

    await db.verificationToken.update({
      where: { id: record.id },
      data: { usedAt: new Date() },
    });

    await db.user.updateMany({
      where: { email: record.identifier },
      data: { emailVerified: new Date() },
    });

    return NextResponse.json(
      apiSuccess({ verified: true, email: record.identifier }, "Email verified successfully")
    );
  } catch {
    return NextResponse.json(apiError("Internal server error"), { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const raw = await request.json();
    const body = raw.action ? raw : { ...raw, action: "verify" };
    const parsed = verifyPostSchema.parse(body);

    if (parsed.action === "resend") {
      const normalizedEmail = parsed.email.toLowerCase().trim();
      const user = await db.user.findUnique({ where: { email: normalizedEmail } });

      if (!user) {
        return NextResponse.json(
          apiError("No account found with that email", "NOT_FOUND", undefined, 404),
          { status: 404 }
        );
      }

      if (user.emailVerified) {
        return NextResponse.json(
          apiSuccess({ sent: false, alreadyVerified: true }, "Email is already verified")
        );
      }

      const newToken = uuidv4();
      await db.verificationToken.create({
        data: {
          identifier: normalizedEmail,
          token: newToken,
          type: "EMAIL_VERIFICATION",
          userId: user.id,
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        },
      });

      const verifyUrl = `${env.APP_URL}/verify-email?token=${newToken}&email=${encodeURIComponent(normalizedEmail)}`;
      const emailResult = await sendEmail({
        to: normalizedEmail,
        subject: "Verify your ALO Labs Hosting Portal email",
        text: `Hi ${user.name || "there"}, verify your email using this link: ${verifyUrl} or code: ${newToken}`,
        html: `<p>Hi ${user.name || "there"},</p><p>Click <a href="${verifyUrl}">here to verify your email</a> or enter token: <strong>${newToken}</strong></p>`,
      });

      return NextResponse.json(
        apiSuccess(
          {
            sent: emailResult.sent,
            messageId: emailResult.messageId,
            verificationToken:
              process.env.NODE_ENV !== "production" ? newToken : undefined,
          },
          "Verification email sent"
        )
      );
    }

    const record = await db.verificationToken.findUnique({
      where: { token: parsed.token.trim() },
    });

    if (!record) {
      return NextResponse.json(
        apiError("Invalid verification code", "INVALID_TOKEN", undefined, 400),
        { status: 400 }
      );
    }

    if (record.usedAt) {
      return NextResponse.json(
        apiSuccess({ verified: true, email: record.identifier, alreadyVerified: true }, "Email already verified")
      );
    }

    if (new Date() > record.expiresAt) {
      return NextResponse.json(
        apiError("Verification code has expired. Please request a new one.", "TOKEN_EXPIRED", undefined, 400),
        { status: 400 }
      );
    }

    await db.verificationToken.update({
      where: { id: record.id },
      data: { usedAt: new Date() },
    });

    const user = await db.user.findUnique({ where: { email: record.identifier } });
    if (user) {
      await db.user.update({
        where: { id: user.id },
        data: { emailVerified: new Date() },
      });

      await db.auditLog.create({
        data: {
          actorUserId: user.id,
          actorEmail: user.email,
          action: "EMAIL_VERIFIED",
          resourceType: "User",
          resourceId: user.id,
          result: "SUCCESS",
        },
      });
    }

    return NextResponse.json(
      apiSuccess({ verified: true, email: record.identifier }, "Email verified successfully")
    );
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json(
        apiError("Validation failed", "VALIDATION_ERROR", e.flatten(), 400),
        { status: 400 }
      );
    }
    return NextResponse.json(apiError("Internal server error"), { status: 500 });
  }
}
