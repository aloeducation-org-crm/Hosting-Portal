import { NextRequest, NextResponse } from "next/server";
import { createHash } from "crypto";
import { z } from "zod";
import { apiSuccess, apiError } from "@/lib/response";
import { db } from "@/lib/db";
import { hashPassword } from "@/lib/password";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  token: z.string().min(16, "Invalid reset token").max(512),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters long")
    .max(128, "Password must be at most 128 characters long"),
});

const INVALID_TOKEN_RESPONSE = () =>
  NextResponse.json(
    apiError("This reset link is invalid or has expired. Request a new one.", "INVALID_TOKEN", undefined, 400),
    { status: 400 },
  );

export async function POST(request: NextRequest) {
  let input: z.infer<typeof bodySchema>;
  try {
    const body = await request.json();
    input = bodySchema.parse(body);
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json(
        apiError("Please provide a valid reset link and a password of at least 8 characters.", "VALIDATION_ERROR", e.flatten(), 400),
        { status: 400 },
      );
    }
    return NextResponse.json(
      apiError("Invalid request body", "VALIDATION_ERROR", undefined, 400),
      { status: 400 },
    );
  }

  try {
    const hashedToken = createHash("sha256").update(input.token, "utf8").digest("hex");
    const record = await db.verificationToken.findUnique({ where: { token: hashedToken } });

    if (
      !record ||
      record.type !== "PASSWORD_RESET" ||
      record.usedAt !== null ||
      new Date() > record.expiresAt
    ) {
      return INVALID_TOKEN_RESPONSE();
    }

    const user = await db.user.findUnique({
      where: { email: record.identifier },
      select: { id: true, email: true, name: true, isActive: true },
    });
    if (!user || !user.isActive) {
      return INVALID_TOKEN_RESPONSE();
    }

    const passwordHash = await hashPassword(input.password);

    await db.$transaction([
      // Burn the single-use token (and any siblings outstanding for this account).
      db.verificationToken.updateMany({
        where: { identifier: record.identifier, type: "PASSWORD_RESET", usedAt: null },
        data: { usedAt: new Date() },
      }),
      db.user.update({
        where: { id: user.id },
        data: {
          passwordHash,
          // A successful reset is proof of account control: clear brute-force
          // lockout state so the owner can sign back in immediately.
          failedLoginAttempts: 0,
          isLocked: false,
          lockedUntil: null,
        },
      }),
    ]);

    try {
      await db.auditLog.create({
        data: {
          actorUserId: user.id,
          actorEmail: user.email,
          action: "PASSWORD_RESET_COMPLETED",
          resourceType: "User",
          resourceId: user.id,
          result: "SUCCESS",
          ipAddress:
            request.headers.get("x-forwarded-for") ?? request.headers.get("x-real-ip") ?? undefined,
        },
      });
    } catch (auditError) {
      logger.warn({ err: auditError }, "Failed to record PASSWORD_RESET_COMPLETED audit log");
    }

    return NextResponse.json(
      apiSuccess({ reset: true }, "Password updated. You can now sign in with your new password."),
    );
  } catch (error) {
    logger.error({ err: error }, "Password reset failed");
    return NextResponse.json(apiError("Internal server error"), { status: 500 });
  }
}
