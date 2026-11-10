import { NextRequest, NextResponse } from 'next/server';
import { apiSuccess, apiError, type ApiResponse } from '@/lib/response';
import { requireSession, ROLES } from '@/lib/auth';
import { db } from '@/lib/db';
import { hash } from 'bcryptjs';

function handleErr(e: unknown): NextResponse {
  if (e && typeof e === 'object' && 'status' in e) {
    const a = e as ApiResponse;
    return NextResponse.json(a, { status: a.status });
  }
  return NextResponse.json(apiError('Internal server error'), { status: 500 });
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireSession(request);
    const { id } = await params;

    if (auth.role !== ROLES.SUPER_ADMIN) {
      return NextResponse.json(apiError('Only SUPER_ADMIN can view user details', 'FORBIDDEN', undefined, 403), { status: 403 });
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
      return NextResponse.json(apiError('User not found', 'NOT_FOUND', undefined, 404), { status: 404 });
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

    if (auth.role !== ROLES.SUPER_ADMIN) {
      return NextResponse.json(apiError('Only SUPER_ADMIN can update users', 'FORBIDDEN', undefined, 403), { status: 403 });
    }

    const body = await request.json();

    const existing = await db.user.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json(apiError('User not found', 'NOT_FOUND', undefined, 404), { status: 404 });
    }

    const updateData: any = {};
    if (body.name !== undefined) updateData.name = body.name;
    if (body.isActive !== undefined) updateData.isActive = body.isActive;
    if (body.isLocked !== undefined) {
      updateData.isLocked = body.isLocked;
      updateData.lockedUntil = body.isLocked ? new Date(Date.now() + 24 * 60 * 60 * 1000) : null;
      if (!body.isLocked) {
        updateData.failedLoginAttempts = 0;
      }
    }
    if (body.roleId) {
      const role = await db.role.findUnique({ where: { id: body.roleId } });
      if (!role) {
        return NextResponse.json(apiError('Role not found', 'NOT_FOUND', undefined, 404), { status: 404 });
      }
      updateData.roleId = body.roleId;
    }
    if (body.password) {
      updateData.passwordHash = await hash(body.password, 12);
    }

    const user = await db.user.update({
      where: { id },
      data: updateData,
      include: { role: true },
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

    if (auth.role !== ROLES.SUPER_ADMIN) {
      return NextResponse.json(apiError('Only SUPER_ADMIN can delete users', 'FORBIDDEN', undefined, 403), { status: 403 });
    }

    if (auth.id === id) {
      return NextResponse.json(apiError('Cannot delete your own account', 'FORBIDDEN', undefined, 403), { status: 403 });
    }

    const existing = await db.user.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json(apiError('User not found', 'NOT_FOUND', undefined, 404), { status: 404 });
    }

    await db.user.delete({ where: { id } });

    return NextResponse.json(apiSuccess({ deleted: true }));
  } catch (e) {
    return handleErr(e);
  }
}
