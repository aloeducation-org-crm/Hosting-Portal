import { NextRequest, NextResponse } from 'next/server';
import { apiSuccess, apiError, type ApiResponse } from '@/lib/response';
import { requireSession, ROLES } from '@/lib/auth';
import { db } from '@/lib/db';

function handleErr(e: unknown): NextResponse {
  if (e && typeof e === 'object' && 'status' in e) {
    const a = e as ApiResponse;
    return NextResponse.json(a, { status: a.status });
  }
  return NextResponse.json(apiError('Internal server error'), { status: 500 });
}

export async function GET(request: NextRequest) {
  try {
    const user = await requireSession(request);

    const profile = await db.user.findUnique({
      where: { id: user.id },
      select: {
        id: true,
        email: true,
        name: true,
        isActive: true,
        isLocked: true,
        lastLoginAt: true,
        createdAt: true,
        updatedAt: true,
        role: { select: { name: true } },
      },
    });

    return NextResponse.json(apiSuccess(profile));
  } catch (e) {
    return handleErr(e);
  }
}

export async function PUT(request: NextRequest) {
  try {
    const user = await requireSession(request);
    const body = await request.json();
    const { name, email } = body;

    const updated = await db.user.update({
      where: { id: user.id },
      data: {
        ...(name !== undefined && { name }),
        ...(email !== undefined && { email }),
      },
      select: {
        id: true,
        email: true,
        name: true,
        isActive: true,
        lastLoginAt: true,
        createdAt: true,
        updatedAt: true,
        role: { select: { name: true } },
      },
    });

    return NextResponse.json(apiSuccess(updated, 'Profile updated'));
  } catch (e) {
    return handleErr(e);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const user = await requireSession(request);

    if (user.role === ROLES.SUPER_ADMIN) {
      return NextResponse.json(
        apiError('Super admin accounts cannot be deleted'),
        { status: 403 },
      );
    }

    await db.user.delete({ where: { id: user.id } });

    return NextResponse.json(apiSuccess(null, 'Account deleted'));
  } catch (e) {
    return handleErr(e);
  }
}
