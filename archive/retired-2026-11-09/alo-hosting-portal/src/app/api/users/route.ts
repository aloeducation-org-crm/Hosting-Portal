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

export async function GET(request: NextRequest) {
  try {
    const auth = await requireSession(request);

    if (auth.role !== ROLES.SUPER_ADMIN) {
      return NextResponse.json(apiError('Only SUPER_ADMIN can list users', 'FORBIDDEN', undefined, 403), { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') ?? '1', 10);
    const limit = parseInt(searchParams.get('limit') ?? '50', 10);
    const search = searchParams.get('search');

    const where: any = {};
    if (search) {
      where.OR = [
        { email: { contains: search } },
        { name: { contains: search } },
      ];
    }

    const [users, total] = await Promise.all([
      db.user.findMany({
        where,
        include: {
          role: true,
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      db.user.count({ where }),
    ]);

    // Remove passwordHash from response
    const safeUsers = users.map(({ passwordHash: _, ...user }) => user);

    return NextResponse.json(apiSuccess({
      users: safeUsers,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    }));
  } catch (e) {
    return handleErr(e);
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireSession(request);

    if (auth.role !== ROLES.SUPER_ADMIN) {
      return NextResponse.json(apiError('Only SUPER_ADMIN can create users', 'FORBIDDEN', undefined, 403), { status: 403 });
    }

    const body = await request.json();

    if (!body.email || !body.password || !body.roleId) {
      return NextResponse.json(apiError('email, password, and roleId are required', 'VALIDATION_ERROR', undefined, 400), { status: 400 });
    }

    const existing = await db.user.findUnique({ where: { email: body.email } });
    if (existing) {
      return NextResponse.json(apiError('User with this email already exists', 'CONFLICT', undefined, 409), { status: 409 });
    }

    const role = await db.role.findUnique({ where: { id: body.roleId } });
    if (!role) {
      return NextResponse.json(apiError('Role not found', 'NOT_FOUND', undefined, 404), { status: 404 });
    }

    const passwordHash = await hash(body.password, 12);

    const user = await db.user.create({
      data: {
        email: body.email,
        name: body.name ?? undefined,
        passwordHash,
        roleId: body.roleId,
        isActive: body.isActive ?? true,
      },
      include: { role: true },
    });

    const { passwordHash: _, ...safeUser } = user;

    return NextResponse.json(apiSuccess(safeUser));
  } catch (e) {
    return handleErr(e);
  }
}
