import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { apiSuccess, apiError, type ApiResponse } from '@/lib/response';
import { requirePermission, ROLES } from '@/lib/auth';
import { db } from '@/lib/db';

const querySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  action: z.string().optional(),
  resourceType: z.string().optional(),
  actorEmail: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
});

export async function GET(request: NextRequest) {
  try {
    const user = await requirePermission(request, 'AUDIT_READ');
    const { searchParams } = new URL(request.url);
    const input = querySchema.parse(Object.fromEntries(searchParams));

    const where: any = {};
    if (input.action) where.action = input.action;
    if (input.resourceType) where.resourceType = input.resourceType;
    if (input.actorEmail) where.actorEmail = { contains: input.actorEmail };
    if (input.startDate || input.endDate) {
      where.timestamp = {};
      if (input.startDate) where.timestamp.gte = new Date(input.startDate);
      if (input.endDate) where.timestamp.lte = new Date(input.endDate);
    }
    // Non-super-admins can only see their own audit logs
    if (user.role !== ROLES.SUPER_ADMIN) {
      where.actorUserId = user.id;
    }

    const [logs, total] = await Promise.all([
      db.auditLog.findMany({
        where,
        orderBy: { timestamp: 'desc' },
        skip: (input.page - 1) * input.limit,
        take: input.limit,
      }),
      db.auditLog.count({ where }),
    ]);

    return NextResponse.json(apiSuccess({
      logs,
      pagination: {
        page: input.page,
        limit: input.limit,
        total,
        totalPages: Math.ceil(total / input.limit),
      },
    }));
  } catch (e) {
    if (e instanceof z.ZodError) return NextResponse.json(apiError('Validation failed', 'VALIDATION_ERROR', e.flatten(), 400), { status: 400 });
    if (e && typeof e === 'object' && 'status' in e) {
      const a = e as ApiResponse;
      return NextResponse.json(a, { status: a.status });
    }
    return NextResponse.json(apiError('Internal server error'), { status: 500 });
  }
}
