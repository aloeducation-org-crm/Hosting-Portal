import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { v4 as uuidv4 } from "uuid";
import { apiSuccess, apiError } from "@/lib/response";
import { db } from "@/lib/db";
import { sendEmail } from "@/lib/smtp";
import { env } from "@/lib/env";
import { signupApprovalRequired } from "@/lib/account-status";

const verifyPostSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("verify").default("verify"),
    token: z.string().trim().min(1, "Verification token is required").max(128),
    email: z.string().email().optional(),
  }),
  z.object({
    action: z.literal("resend"),
    email: z.string().email("Valid email address is required"),
  }),
]);

/** Proof is bound to the email-verification purpose, the account ID and its
 * current email. Consume the token and record verification in one transaction. */
async function verify(token: string) {
  const result = await db.$transaction(async (tx) => {
    const record = await tx.verificationToken.findUnique({
      where: { token }, include: { user: { include: { role: true } } },
    });
    if (record?.type !== "EMAIL_VERIFICATION" || !record.user || record.user.email !== record.identifier) return null;
    const user = record.user;
    const response = { verified: true, email: user.email, approvalRequired: signupApprovalRequired(user) };
    if (record.usedAt) return user.emailVerified ? { ...response, alreadyVerified: true } : null;
    const now = new Date();
    if (now > record.expiresAt) return { expired: true } as const;
    await tx.verificationToken.update({ where: { id: record.id }, data: { usedAt: now } });
    await tx.user.update({ where: { id: user.id }, data: { emailVerified: now } });
    await tx.auditLog.create({ data: {
      actorUserId: user.id, actorEmail: user.email, action: "EMAIL_VERIFIED", resourceType: "User",
      resourceId: user.id, result: "SUCCESS",
    } });
    return response;
  });
  const headers = { "Cache-Control": "no-store" };
  if (!result) return NextResponse.json(apiError("Invalid verification code", "INVALID_TOKEN", undefined, 400), { status: 400, headers });
  if ("expired" in result) return NextResponse.json(apiError("Verification code has expired. Please request a new one.", "TOKEN_EXPIRED", undefined, 400), { status: 400, headers });
  return NextResponse.json(apiSuccess(result, "Email verified successfully"), { headers });
}

export async function GET(request: NextRequest) {
  try {
    const token = request.nextUrl.searchParams.get("token")?.trim();
    if (!token || token.length > 128) return NextResponse.json(apiError("Invalid verification code", "INVALID_TOKEN", undefined, 400), { status: 400 });
    return await verify(token);
  } catch {
    return NextResponse.json(apiError("Internal server error"), { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const raw = await request.json();
    const body = raw?.action ? raw : { ...raw, action: "verify" };
    const parsed = verifyPostSchema.parse(body);

    if (parsed.action === "resend") {
      const normalizedEmail = parsed.email.toLowerCase().trim();
      const user = await db.user.findUnique({ where: { email: normalizedEmail }, include: { role: true } });

      if (!user) {
        return NextResponse.json(
          apiError("No account found with that email", "NOT_FOUND", undefined, 404),
          { status: 404 }
        );
      }

      if (user.emailVerified) {
        return NextResponse.json(
          apiSuccess({ sent: false, alreadyVerified: true, approvalRequired: signupApprovalRequired(user) }, "Email is already verified")
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
        html: `<p>Verify your email address.</p><p>Click <a href="${verifyUrl}">here to verify your email</a> or enter token: <strong>${newToken}</strong></p>`,
      });

      return NextResponse.json(
        apiSuccess(
          {
            sent: emailResult.sent,
            messageId: emailResult.messageId,
            verificationToken:
              process.env.NODE_ENV !== "production" ? newToken : undefined,
          },
          emailResult.sent ? "Verification email sent" : "Verification email was not sent. Check SMTP configuration or use the development token below."
        )
      );
    }

    return await verify(parsed.token);
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
