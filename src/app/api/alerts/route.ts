import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { apiSuccess, apiError, type ApiResponse } from '@/lib/response';
import { requireSession, ROLES } from '@/lib/auth';
import { db } from '@/lib/db';

const querySchema = z.object({
  severity: z.string().optional(),
  isRead: z.string().optional(),
  ruleId: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

const acknowledgeSchema = z.object({
  alertId: z.string().min(1),
});

const markReadSchema = z.object({
  alertIds: z.array(z.string().min(1)).min(1),
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
    const input = querySchema.parse(Object.fromEntries(searchParams));

    const where: Record<string, unknown> = {};

    if (user.role !== ROLES.SUPER_ADMIN) {
      where.rule = {
        userId: user.id,
      };
    }

    if (input.severity) {
      where.severity = input.severity;
    }
    if (input.isRead !== undefined) {
      where.isRead = input.isRead === 'true';
    }
    if (input.ruleId) {
      where.ruleId = input.ruleId;
    }

    const [alerts, total] = await Promise.all([
      db.alert.findMany({
        where,
        include: {
          rule: {
            select: { name: true, metric: true },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: (input.page - 1) * input.limit,
        take: input.limit,
      }),
      db.alert.count({ where }),
    ]);

    return NextResponse.json(apiSuccess({
      alerts,
      pagination: {
        page: input.page,
        limit: input.limit,
        total,
        totalPages: Math.ceil(total / input.limit),
      },
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
    const user = await requireSession(request);
    const body = await request.json();
    const input = acknowledgeSchema.parse(body);

    const alert = await db.alert.findUnique({
      where: { id: input.alertId },
      include: { rule: true },
    });

    if (!alert) {
      return NextResponse.json(apiError('Alert not found', 'NOT_FOUND', undefined, 404), { status: 404 });
    }

    if (user.role !== ROLES.SUPER_ADMIN && alert.rule?.userId !== user.id) {
      return NextResponse.json(apiError('Forbidden', 'FORBIDDEN', undefined, 403), { status: 403 });
    }

    const updated = await db.alert.update({
      where: { id: input.alertId },
      data: { acknowledgedAt: new Date() },
    });

    return NextResponse.json(apiSuccess(updated));
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json(apiError('Validation failed', 'VALIDATION_ERROR', e.flatten(), 400), { status: 400 });
    }
    return handleErr(e);
  }
}

export async function PUT(request: NextRequest) {
  try {
    const user = await requireSession(request);
    const body = await request.json();
    const input = markReadSchema.parse(body);

    const alerts = await db.alert.findMany({
      where: { id: { in: input.alertIds } },
      include: { rule: true },
    });

    const accessibleIds = alerts
      .filter((a) => user.role === ROLES.SUPER_ADMIN || a.rule?.userId === user.id)
      .map((a) => a.id);

    if (accessibleIds.length === 0) {
      return NextResponse.json(apiSuccess({ updated: 0 }, 'No accessible alerts to update'));
    }

    const result = await db.alert.updateMany({
      where: { id: { in: accessibleIds } },
      data: { isRead: true },
    });

    return NextResponse.json(apiSuccess({ updated: result.count }));
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json(apiError('Validation failed', 'VALIDATION_ERROR', e.flatten(), 400), { status: 400 });
    }
    return handleErr(e);
  }
}
