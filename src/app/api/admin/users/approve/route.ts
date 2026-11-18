import { NextRequest, NextResponse } from "next/server";
import { apiSuccess, apiError, type ApiResponse } from "@/lib/response";
import { requireSession, isAdminRole } from "@/lib/auth";
import { db } from "@/lib/db";

function handleErr(e: unknown): NextResponse {
  if (e && typeof e === "object" && "status" in e) {
    const a = e as ApiResponse;
    return NextResponse.json(a, { status: a.status });
  }
  return NextResponse.json(apiError("Internal server error"), { status: 500 });
}

/**
 * PATCH /api/admin/users/approve
 * Body: { userId: string, action: "approve" | "reject" | "suspend" }
 *
 * Approve:   sets onboardingCompleted = true, isActive = true
 * Reject:    sets onboardingCompleted = false, isActive = false
 * Suspend:   sets isActive = false (keeps onboardingCompleted as-is)
 */
export async function PATCH(request: NextRequest) {
  try {
    const auth = await requireSession(request);

    if (!isAdminRole(auth.role)) {
      return NextResponse.json(
        apiError("Only administrators can approve users", "FORBIDDEN", undefined, 403),
        { status: 403 }
      );
    }

    const body = await request.json();
    const { userId, action } = body;

    if (!userId || typeof userId !== "string") {
      return NextResponse.json(
        apiError("userId is required", "VALIDATION_ERROR", undefined, 400),
        { status: 400 }
      );
    }

    if (!["approve", "reject", "suspend"].includes(action)) {
      return NextResponse.json(
        apiError("Invalid action. Must be 'approve', 'reject', or 'suspend'", "VALIDATION_ERROR", undefined, 400),
        { status: 400 }
      );
    }

    const user = await db.user.findUnique({ where: { id: userId }, include: { role: true } });
    if (!user) {
      return NextResponse.json(
        apiError("User not found", "NOT_FOUND", undefined, 404),
        { status: 404 }
      );
    }

    // Cannot modify your own account through this endpoint
    if (user.id === auth.id) {
      return NextResponse.json(
        apiError("Cannot modify your own account through this endpoint", "FORBIDDEN", undefined, 403),
        { status: 403 }
      );
    }

    let updateData: any = {};

    switch (action) {
      case "approve":
        updateData = {
          onboardingCompleted: true,
          isActive: true,
        };
        break;
      case "reject":
        updateData = {
          onboardingCompleted: false,
          isActive: false,
        };
        break;
      case "suspend":
        updateData = {
          isActive: false,
        };
        break;
    }

    const updated = await db.user.update({
      where: { id: userId },
      data: updateData,
      include: { role: true },
    });

    await db.auditLog.create({
      data: {
        actorUserId: auth.id,
        actorEmail: auth.email,
        actorRole: auth.role,
        action: `USER_${action.toUpperCase()}`,
        resourceType: "User",
        resourceId: userId,
        result: "SUCCESS",
      },
    });

    const { passwordHash: _, ...safeUser } = updated;

    return NextResponse.json(apiSuccess(safeUser, `User ${action}d`, 200));
  } catch (e) {
    return handleErr(e);
  }
}
