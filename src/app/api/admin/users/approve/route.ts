import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { apiSuccess, apiError, type ApiResponse } from "@/lib/response";
import { requireSuperAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { signupApprovalRequired } from "@/lib/account-status";

const decision = z.object({
  userId: z.string().min(1).max(100),
  action: z.enum(["approve", "reject", "suspend"]),
});

/** A verified mailbox and a named human review enable sign-in, not onboarding completion. */
export async function PATCH(request: NextRequest) {
  try {
    const operator = await requireSuperAdmin(request);
    const parsed = decision.safeParse(await request.json().catch(() => null));
    if (!parsed.success) throw apiError("Invalid account review action", "VALIDATION_ERROR", undefined, 400);
    const { userId, action } = parsed.data;
    if (userId === operator.id) throw apiError("Cannot review your own account", "FORBIDDEN", undefined, 403);

    const updated = await db.$transaction(async (tx) => {
      const user = await tx.user.findUnique({ where: { id: userId }, include: { role: true } });
      if (!user) throw apiError("User not found", "NOT_FOUND", undefined, 404);
      if (action !== "suspend" && (!signupApprovalRequired(user) || user.signupApprovalStatus === "REJECTED")) {
        throw apiError("Account is not pending review", "CONFLICT", undefined, 409);
      }
      if (action === "approve" && !user.emailVerified) {
        throw apiError("Verify the account's email before approval", "EMAIL_NOT_VERIFIED", undefined, 409);
      }
      const account = await tx.user.update({
        where: { id: userId },
        data: action === "approve"
          ? { signupApprovalStatus: "APPROVED", isActive: true }
          : action === "reject" ? { signupApprovalStatus: "REJECTED", isActive: false } : { isActive: false },
        select: { id: true, signupApprovalStatus: true, isActive: true, onboardingCompleted: true },
      });
      await tx.auditLog.create({ data: {
        actorUserId: operator.id, actorEmail: operator.email, actorRole: operator.role,
        action: `USER_${action.toUpperCase()}`, resourceType: "User", resourceId: userId, result: "SUCCESS",
      } });
      return account;
    });
    return NextResponse.json(apiSuccess(updated, "Account review recorded"));
  } catch (error) {
    if (error && typeof error === "object" && "status" in error) {
      const response = error as ApiResponse;
      return NextResponse.json(response, { status: response.status });
    }
    return NextResponse.json(apiError("Internal server error"), { status: 500 });
  }
}
