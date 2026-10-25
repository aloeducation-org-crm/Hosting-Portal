import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { signIn } from 'next-auth/react';
import { apiSuccess, apiError, type ApiResponse } from '@/lib/response';
import { db } from '@/lib/db';

const loginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
});

function handleErr(e: unknown): NextResponse {
  if (e && typeof e === 'object' && 'status' in e) {
    const a = e as ApiResponse;
    return NextResponse.json(a, { status: a.status });
  }
  return NextResponse.json(apiError('Internal server error'), { status: 500 });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email, password } = loginSchema.parse(body);

    const result = await signIn('credentials', {
      email,
      password,
      redirect: false,
    });

    if (result?.error) {
      await db.auditLog.create({
        data: {
          actorEmail: email,
          action: 'LOGIN_FAILED',
          resourceType: 'User',
          result: 'FAILURE',
          ipAddress: request.headers.get('x-forwarded-for') ?? request.headers.get('x-real-ip'),
        },
      });
      return NextResponse.json(apiError('Invalid credentials', 'INVALID_CREDENTIALS', undefined, 401), { status: 401 });
    }

    const user = await db.user.findUnique({
      where: { email },
      include: { role: { include: { permissions: { include: { permission: true } } } } },
    });

    if (!user) {
      return NextResponse.json(apiError('User not found after login', 'USER_NOT_FOUND', undefined, 401), { status: 401 });
    }

    await db.auditLog.create({
      data: {
        actorUserId: user.id,
        actorEmail: user.email,
        actorRole: user.role.name,
        action: 'LOGIN_SUCCESS',
        resourceType: 'User',
        resourceId: user.id,
        result: 'SUCCESS',
        ipAddress: request.headers.get('x-forwarded-for') ?? request.headers.get('x-real-ip'),
      },
    });

    return NextResponse.json(apiSuccess({
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role.name,
      permissions: user.role.permissions.map((rp) => rp.permission.name),
    }));
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json(apiError('Validation failed', 'VALIDATION_ERROR', e.flatten(), 400), { status: 400 });
    }
    return handleErr(e);
  }
}
