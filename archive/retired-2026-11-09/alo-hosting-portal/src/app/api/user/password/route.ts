import { NextRequest, NextResponse } from 'next/server';
import { apiSuccess, apiError, type ApiResponse } from '@/lib/response';
import { requireSession, ROLES } from '@/lib/auth';
import { hashPassword, verifyPassword } from '@/lib/password';
import { db } from '@/lib/db';

function handleErr(e: unknown): NextResponse {
  if (e && typeof e === 'object' && 'status' in e) {
    const a = e as ApiResponse;
    return NextResponse.json(a, { status: a.status });
  }
  return NextResponse.json(apiError('Internal server error'), { status: 500 });
}

export async function PUT(request: NextRequest) {
  try {
    const user = await requireSession(request);

    const body = await request.json();
    const { currentPassword, newPassword, confirmPassword } = body as {
      currentPassword?: string;
      newPassword?: string;
      confirmPassword?: string;
    };

    // Validate all required fields are present
    if (!currentPassword || typeof currentPassword !== 'string') {
      return NextResponse.json(
        apiError('Current password is required', 'VALIDATION_ERROR', undefined, 400),
        { status: 400 },
      );
    }
    if (!newPassword || typeof newPassword !== 'string') {
      return NextResponse.json(
        apiError('New password is required', 'VALIDATION_ERROR', undefined, 400),
        { status: 400 },
      );
    }
    if (!confirmPassword || typeof confirmPassword !== 'string') {
      return NextResponse.json(
        apiError('Password confirmation is required', 'VALIDATION_ERROR', undefined, 400),
        { status: 400 },
      );
    }

    // Validate new password matches confirmation
    if (newPassword !== confirmPassword) {
      return NextResponse.json(
        apiError('New password and confirmation do not match', 'VALIDATION_ERROR', undefined, 400),
        { status: 400 },
      );
    }

    // Validate minimum password length
    if (newPassword.length < 8) {
      return NextResponse.json(
        apiError('New password must be at least 8 characters long', 'VALIDATION_ERROR', undefined, 400),
        { status: 400 },
      );
    }

    // Fetch user with password hash from database
    const dbUser = await db.user.findUnique({
      where: { id: user.id },
      select: { id: true, passwordHash: true },
    });

    if (!dbUser || !dbUser.passwordHash) {
      return NextResponse.json(
        apiError('User account not configured for password authentication', 'NOT_FOUND', undefined, 404),
        { status: 404 },
      );
    }

    // Verify current password against stored hash
    const isCurrentPasswordValid = await verifyPassword(currentPassword, dbUser.passwordHash);
    if (!isCurrentPasswordValid) {
      return NextResponse.json(
        apiError('Current password is incorrect', 'INVALID_PASSWORD', undefined, 401),
        { status: 401 },
      );
    }

    // Hash the new password and update the database
    const newHash = await hashPassword(newPassword);
    await db.user.update({
      where: { id: user.id },
      data: { passwordHash: newHash },
    });

    return NextResponse.json(apiSuccess(null, 'Password updated successfully'));
  } catch (e) {
    return handleErr(e);
  }
}
