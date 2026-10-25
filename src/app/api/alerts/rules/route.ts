import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { apiSuccess, apiError, type ApiResponse } from '@/lib/response';
import { requireSession, ROLES } from '@/lib/auth';
import { db } from '@/lib/db';

const VALID_METRICS = ['cpu', 'memory', 'disk', 'bandwidth', 'ssl_expiry', 'downtime', 'request_rate', 'error_rate'];
const VALID_CONDITIONS = ['gt', 'lt', 'gte', 'lte', 'eq'];

const querySchema = z.object({
  metric: z.string().optional(),
  isActive: z.string().optional(),
});

const createSchema = z.object({
  name: z.string().min(1).max(200),
  metric: z.string().refine((v) => VALID_METRICS.includes(v), {
    message: `metric must be one of: ${VALID_METRICS.join(', ')}`,
  }),
  condition: z.string().refine((v) => VALID_CONDITIONS.includes(v), {
    message: `condition must be one of: ${VALID_CONDITIONS.join(', ')}`,
  }),
  threshold: z.number(),
  serverId: z.string().optional(),
  websiteId: z.string().optional(),
  cooldownMin: z.number().int().min(1).default(5),
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
      where.userId = user.id;
    }
    if (input.metric) {
      where.metric = input.metric;
    }
    if (input.isActive !== undefined) {
      where.isActive = input.isActive === 'true';
    }

    const rules = await db.alertRule.findMany({
      where,
      include: {
        _count: { select: { alerts: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json(apiSuccess(rules));
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
    const input = createSchema.parse(body);

    const rule = await db.alertRule.create({
      data: {
        name: input.name,
        metric: input.metric,
        condition: input.condition,
        threshold: input.threshold,
        serverId: input.serverId ?? null,
        websiteId: input.websiteId ?? null,
        cooldownMin: input.cooldownMin,
        isActive: true,
        userId: user.id,
      },
      include: {
        _count: { select: { alerts: true } },
      },
    });

    return NextResponse.json(apiSuccess(rule, 'Alert rule created', 201), { status: 201 });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json(apiError('Validation failed', 'VALIDATION_ERROR', e.flatten(), 400), { status: 400 });
    }
    return handleErr(e);
  }
}
