import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { apiSuccess, apiError, type ApiResponse } from '@/lib/response';
import { requireSession, ROLES } from '@/lib/auth';
import { db } from '@/lib/db';

const updateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  threshold: z.number().optional(),
  isActive: z.boolean().optional(),
  cooldownMin: z.number().int().min(1).optional(),
});

function handleErr(e: unknown): NextResponse {
  if (e && typeof e === 'object' && 'status' in e) {
    const a = e as ApiResponse;
    return NextResponse.json(a, { status: a.status });
  }
  return NextResponse.json(apiError('Internal server error'), { status: 500 });
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireSession(request);
    const { id } = await params;

    const rule = await db.alertRule.findUnique({
      where: { id },
      include: {
        _count: { select: { alerts: true } },
        alerts: {
          orderBy: { createdAt: 'desc' },
          take: 10,
        },
      },
    });

    if (!rule) {
      return NextResponse.json(apiError('Alert rule not found', 'NOT_FOUND', undefined, 404), { status: 404 });
    }

    if (user.role !== ROLES.SUPER_ADMIN && rule.userId !== user.id) {
      return NextResponse.json(apiError('Forbidden', 'FORBIDDEN', undefined, 403), { status: 403 });
    }

    return NextResponse.json(apiSuccess(rule));
  } catch (e) {
    return handleErr(e);
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireSession(request);
    const { id } = await params;
    const body = await request.json();
    const input = updateSchema.parse(body);

    const existing = await db.alertRule.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json(apiError('Alert rule not found', 'NOT_FOUND', undefined, 404), { status: 404 });
    }
    if (user.role !== ROLES.SUPER_ADMIN && existing.userId !== user.id) {
      return NextResponse.json(apiError('Forbidden', 'FORBIDDEN', undefined, 403), { status: 403 });
    }

    const updated = await db.alertRule.update({
      where: { id },
      data: input,
      include: {
        _count: { select: { alerts: true } },
      },
    });

    return NextResponse.json(apiSuccess(updated));
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json(apiError('Validation failed', 'VALIDATION_ERROR', e.flatten(), 400), { status: 400 });
    }
    return handleErr(e);
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireSession(request);
    const { id } = await params;

    const existing = await db.alertRule.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json(apiError('Alert rule not found', 'NOT_FOUND', undefined, 404), { status: 404 });
    }
    if (user.role !== ROLES.SUPER_ADMIN && existing.userId !== user.id) {
      return NextResponse.json(apiError('Forbidden', 'FORBIDDEN', undefined, 403), { status: 403 });
    }

    await db.alertRule.delete({ where: { id } });

    return NextResponse.json(apiSuccess(null, 'Alert rule deleted'));
  } catch (e) {
    return handleErr(e);
  }
}
