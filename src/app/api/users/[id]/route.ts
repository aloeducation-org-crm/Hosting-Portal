import { NextRequest, NextResponse } from "next/server";
import { apiSuccess, apiError, type ApiResponse } from "@/lib/response";
import { requireSession, isAdminRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { canManageUserRole, signupApprovalRequired } from "@/lib/account-status";
import { hashPassword } from "@/lib/password";

function handleErr(e: unknown): NextResponse {
  if (e && typeof e === "object" && "status" in e) {
    const a = e as ApiResponse;
    return NextResponse.json(a, { status: a.status });
  }
  return NextResponse.json(apiError("Internal server error"), { status: 500 });
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireSession(request);
    const { id } = await params;

    if (!isAdminRole(auth.role)) {
      return NextResponse.json(
        apiError("Only administrators can view user details", "FORBIDDEN", undefined, 403),
        { status: 403 }
      );
    }

    const user = await db.user.findUnique({
      where: { id },
      include: {
        role: {
          include: { permissions: { include: { permission: true } } },
        },
      },
    });

    if (!user) {
      return NextResponse.json(
        apiError("User not found", "NOT_FOUND", undefined, 404),
        { status: 404 }
      );
    }

    const { passwordHash: _, ...safeUser } = user;

    return NextResponse.json(apiSuccess(safeUser));
  } catch (e) {
    return handleErr(e);
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireSession(request);
    const { id } = await params;

    if (!isAdminRole(auth.role)) {
      return NextResponse.json(
        apiError("Only administrators can update users", "FORBIDDEN", undefined, 403),
        { status: 403 }
      );
    }

    const body = await request.json();
    const passwordHash = body.password ? await hashPassword(body.password) : undefined;
    const user = await db.$transaction(async (tx) => {
      const existing = await tx.user.findUnique({ where: { id }, include: { role: true } });
      if (!existing) throw apiError("User not found", "NOT_FOUND", undefined, 404);
      if (!canManageUserRole(auth.role, existing.role.name) || (auth.role !== "SUPER_ADMIN" && signupApprovalRequired(existing))) {
        throw apiError("Account requires a super administrator", "FORBIDDEN", undefined, 403);
      }
      if (body.isActive === true && signupApprovalRequired(existing)) {
        throw apiError("Use the signup review to approve this account", "PENDING_APPROVAL", undefined, 409);
      }
      const role = body.roleId || body.role
        ? await tx.role.findUnique({ where: body.roleId ? { id: body.roleId } : { name: body.role } })
        : existing.role;
      if (!role) throw apiError("Role not found", "NOT_FOUND", undefined, 404);
      if (!canManageUserRole(auth.role, role.name)) throw apiError("Role change not permitted", "FORBIDDEN", undefined, 403);

      const updated = await tx.user.update({
        where: { id },
        data: {
          name: body.name,
          companyName: body.companyName,
          isActive: body.isActive,
          passwordHash,
          roleId: role.id,
          ...(typeof body.isLocked === "boolean" ? {
            isLocked: body.isLocked,
            lockedUntil: body.isLocked ? new Date(Date.now() + 24 * 60 * 60 * 1000) : null,
            ...(body.isLocked ? {} : { failedLoginAttempts: 0 }),
          } : {}),
        },
        include: { role: true },
      });
      await tx.auditLog.create({ data: {
        actorUserId: auth.id, actorEmail: auth.email, actorRole: auth.role,
        action: "USER_UPDATE", resourceType: "User", resourceId: id, result: "SUCCESS",
      } });
      return updated;
    });

    const { passwordHash: _, ...safeUser } = user;

    return NextResponse.json(apiSuccess(safeUser));
  } catch (e) {
    return handleErr(e);
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireSession(request);
    const { id } = await params;

    if (!isAdminRole(auth.role)) {
      return NextResponse.json(
        apiError("Only administrators can delete users", "FORBIDDEN", undefined, 403),
        { status: 403 }
      );
    }

    if (auth.id === id) {
      return NextResponse.json(
        apiError("Cannot delete your own account", "FORBIDDEN", undefined, 403),
        { status: 403 }
      );
    }

    await db.$transaction(async (tx) => {
      const existing = await tx.user.findUnique({ where: { id }, include: { role: true } });
      if (!existing) throw apiError("User not found", "NOT_FOUND", undefined, 404);
      if (!canManageUserRole(auth.role, existing.role.name) || (auth.role !== "SUPER_ADMIN" && signupApprovalRequired(existing))) {
        throw apiError("Account requires a super administrator", "FORBIDDEN", undefined, 403);
      }
      await tx.user.delete({ where: { id } });
      await tx.auditLog.create({ data: {
        actorUserId: auth.id, actorEmail: auth.email, actorRole: auth.role,
        action: "USER_DELETE", resourceType: "User", resourceId: id, result: "SUCCESS",
      } });
    });

    return NextResponse.json(apiSuccess({ deleted: true }));
  } catch (e) {
    return handleErr(e);
  }
}
