import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { apiSuccess, apiError } from '@/lib/response';
import { requireSuperAdmin } from '@/lib/auth';
import { db } from '@/lib/db';
import { hashPassword } from '@/lib/password';

const signupSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(8),
  role: z.enum(['ADMIN', 'DEVOPS', 'SUPPORT', 'VIEWER']).default('VIEWER'),
});

export async function POST(request: NextRequest) {
  try {
    const user = await requireSuperAdmin(request);
    const body = await request.json();
    const input = signupSchema.parse(body);

    const existing = await db.user.findUnique({ where: { email: input.email } });
    if (existing) {
      return NextResponse.json(apiError('Email already in use', 'CONFLICT', undefined, 409), { status: 409 });
    }

    const role = await db.role.findUnique({ where: { name: input.role } });
    if (!role) {
      return NextResponse.json(apiError('Invalid role', 'VALIDATION_ERROR', undefined, 400), { status: 400 });
    }

    const passwordHash = await hashPassword(input.password);
    const newUser = await db.user.create({
      data: {
        name: input.name,
        email: input.email,
        passwordHash,
        roleId: role.id,
        emailVerified: new Date(),
      },
      select: { id: true, name: true, email: true, createdAt: true },
    });

    await db.auditLog.create({
      data: {
        actorUserId: user.id, actorEmail: user.email, actorRole: user.role,
        action: 'USER_CREATE', resourceType: 'User', resourceId: newUser.id,
        result: 'SUCCESS',
        ipAddress: request.headers.get('x-forwarded-for') ?? request.headers.get('x-real-ip'),
      },
    });

    return NextResponse.json(apiSuccess(newUser, 'User created', 201), { status: 201 });
  } catch (e) {
    if (e instanceof z.ZodError) return NextResponse.json(apiError('Validation failed', 'VALIDATION_ERROR', e.flatten(), 400), { status: 400 });
    if (e && typeof e === 'object' && 'status' in e) {
      const a = e as any;
      return NextResponse.json(a, { status: a.status });
    }
    return NextResponse.json(apiError('Internal server error'), { status: 500 });
  }
}
