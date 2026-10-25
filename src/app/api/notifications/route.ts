import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { apiSuccess, apiError, type ApiResponse } from '@/lib/response';
import { requireSession, requireSuperAdmin } from '@/lib/auth';
import { db } from '@/lib/db';
import { Prisma } from '@prisma/client';

const createSchema = z.object({
  userId: z.string().min(1),
  title: z.string().min(1).max(255),
  message: z.string().min(1),
  type: z.string().optional(),
  link: z.string().optional(),
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
    const user = await requireSession(request);
    const { searchParams } = new URL(request.url);

    const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') ?? '25', 10) || 25));
    const unreadOnly = searchParams.get('unread') === 'true';

    const where: Prisma.NotificationWhereInput = {
      userId: user.id,
    };

    if (unreadOnly) {
      where.read = false;
    }

    const [items, total] = await Promise.all([
      db.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      db.notification.count({ where }),
    ]);

    return NextResponse.json(
      apiSuccess({
        items,
        total,
        page,
        limit,
      }),
    );
  } catch (e) {
    return handleErr(e);
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireSuperAdmin(request);
    const body = await request.json();
    const input = createSchema.parse(body);

    const targetUser = await db.user.findUnique({ where: { id: input.userId } });
    if (!targetUser) {
      return NextResponse.json(
        apiError('Target user not found', 'NOT_FOUND', undefined, 404),
        { status: 404 },
      );
    }

    const notification = await db.notification.create({
      data: {
        userId: input.userId,
        title: input.title,
        message: input.message,
        type: input.type,
        link: input.link,
      },
    });

    return NextResponse.json(
      apiSuccess(notification, 'Notification created', 201),
      { status: 201 },
    );
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json(
        apiError('Validation failed', 'VALIDATION_ERROR', e.flatten(), 400),
        { status: 400 },
      );
    }
    return handleErr(e);
  }
}
