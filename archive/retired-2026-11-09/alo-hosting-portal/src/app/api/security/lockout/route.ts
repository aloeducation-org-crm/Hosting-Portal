import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { apiSuccess, apiError, type ApiResponse } from '@/lib/response';
import { requireSuperAdmin } from '@/lib/auth';
import { db } from '@/lib/db';

const querySchema = z.object({
  email: z.string().email(),
});

const unlockSchema = z.object({
  userId: z.string().min(1),
});

function handleErr(e: unknown): NextResponse {
  if (e && typeof e === 'object' && 'status' in e) {
    const a = e as ApiResponse;
    return NextResponse.json(a, { status: a.status });
  }
  return NextResponse.json(apiError('Internal server error'), { status: 500 });
}

export async function GET(request: NextRequest) {
  try {
    const user = await requireSuperAdmin(request);
    void user;
    const { searchParams } = new URL(request.url);
    const input = querySchema.parse(Object.fromEntries(searchParams));

    const targetUser = await db.user.findUnique({
      where: { email: input.email },
      select: {
        id: true,
        email: true,
        isLocked: true,
        lockedUntil: true,
        failedLoginAttempts: true,
      },
    });

    if (!targetUser) {
      return NextResponse.json(apiError('User not found', 'NOT_FOUND', undefined, 404), { status: 404 });
    }

    const isLocked = targetUser.isLocked && targetUser.lockedUntil
      ? new Date() < targetUser.lockedUntil
      : targetUser.isLocked;

    return NextResponse.json(apiSuccess({
      userId: targetUser.id,
      email: targetUser.email,
      isLocked,
      lockedUntil: targetUser.lockedUntil,
      failedLoginAttempts: targetUser.failedLoginAttempts,
    }));
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json(apiError('Validation failed', 'VALIDATION_ERROR', e.flatten(), 400), { status: 400 });
    }
    return handleErr(e);
  }
}

export async function POST(request: NextRequest) {
  try {
    const actor = await requireSuperAdmin(request);
    const body = await request.json();
    const input = unlockSchema.parse(body);

    const targetUser = await db.user.findUnique({
      where: { id: input.userId },
      select: { id: true, email: true },
    });

    if (!targetUser) {
      return NextResponse.json(apiError('User not found', 'NOT_FOUND', undefined, 404), { status: 404 });
    }

    await db.user.update({
      where: { id: input.userId },
      data: {
        isLocked: false,
        lockedUntil: null,
        failedLoginAttempts: 0,
      },
    });

    // Create audit log
    await db.auditLog.create({
      data: {
        actorUserId: actor.id,
        actorEmail: actor.email,
        actorRole: actor.role,
        action: 'USER_UNLOCK',
        resourceType: 'User',
        resourceId: input.userId,
        result: 'success',
        ipAddress: request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || null,
        userAgent: request.headers.get('user-agent') || null,
      },
    });

    return NextResponse.json(apiSuccess(null, 'User unlocked successfully'));
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json(apiError('Validation failed', 'VALIDATION_ERROR', e.flatten(), 400), { status: 400 });
    }
    return handleErr(e);
  }
}
