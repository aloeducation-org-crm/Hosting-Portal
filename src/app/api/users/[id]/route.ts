import { NextRequest, NextResponse } from "next/server";
import { apiSuccess, apiError, type ApiResponse } from "@/lib/response";
import { requireSession, isAdminRole } from "@/lib/auth";
import { db } from "@/lib/db";
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

    const existing = await db.user.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json(
        apiError("User not found", "NOT_FOUND", undefined, 404),
        { status: 404 }
      );
    }

    const updateData: Record<string, unknown> = {};
    if (body.name !== undefined) updateData.name = body.name;
    if (body.companyName !== undefined) updateData.companyName = body.companyName;
    if (body.isActive !== undefined) updateData.isActive = body.isActive;
    if (body.isLocked !== undefined) {
      updateData.isLocked = body.isLocked;
      updateData.lockedUntil = body.isLocked
        ? new Date(Date.now() + 24 * 60 * 60 * 1000)
        : null;
      if (!body.isLocked) {
        updateData.failedLoginAttempts = 0;
      }
    }
    if (body.roleId || body.role) {
      const role = body.roleId
        ? await db.role.findUnique({ where: { id: body.roleId } })
        : await db.role.findUnique({ where: { name: body.role } });
      if (!role) {
        return NextResponse.json(
          apiError("Role not found", "NOT_FOUND", undefined, 404),
          { status: 404 }
        );
      }
      updateData.roleId = role.id;
    }
    if (body.password) {
      updateData.passwordHash = await hashPassword(body.password);
    }

    const user = await db.user.update({
      where: { id },
      data: updateData,
      include: { role: true },
    });

    await db.auditLog.create({
      data: {
        actorUserId: auth.id,
        actorEmail: auth.email,
        actorRole: auth.role,
        action: "USER_UPDATE",
        resourceType: "User",
        resourceId: user.id,
        result: "SUCCESS",
      },
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

    const existing = await db.user.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json(
        apiError("User not found", "NOT_FOUND", undefined, 404),
        { status: 404 }
      );
    }

    await db.user.delete({ where: { id } });

    await db.auditLog.create({
      data: {
        actorUserId: auth.id,
        actorEmail: auth.email,
        actorRole: auth.role,
        action: "USER_DELETE",
        resourceType: "User",
        resourceId: id,
        result: "SUCCESS",
      },
    });

    return NextResponse.json(apiSuccess({ deleted: true }));
  } catch (e) {
    return handleErr(e);
  }
}
