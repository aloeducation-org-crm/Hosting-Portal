import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { apiSuccess, apiError } from '@/lib/response';
import { db } from '@/lib/db';
import { hashPassword } from '@/lib/password';

const registerSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  email: z.string().email('Invalid email'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const input = registerSchema.parse(body);

    const existing = await db.user.findUnique({ where: { email: input.email } });
    if (existing) {
      return NextResponse.json(apiError('Email already registered', 'CONFLICT', undefined, 409), { status: 409 });
    }

    let role = await db.role.findFirst({ where: { name: 'VIEWER' } });
    if (!role) {
      role = await db.role.findFirst();
    }
    if (!role) {
      return NextResponse.json(apiError('No roles configured. Contact admin.', 'SERVER_ERROR', undefined, 500), { status: 500 });
    }

    const passwordHash = await hashPassword(input.password);
    const user = await db.user.create({
      data: {
        name: input.name,
        email: input.email,
        passwordHash,
        roleId: role.id,
        emailVerified: new Date(),
      },
      select: { id: true, name: true, email: true, createdAt: true },
    });

    return NextResponse.json(apiSuccess(user, 'Account created', 201), { status: 201 });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json(apiError('Validation failed', 'VALIDATION_ERROR', e.flatten(), 400), { status: 400 });
    }
    return NextResponse.json(apiError('Internal server error'), { status: 500 });
  }
}
