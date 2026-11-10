import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { apiSuccess, apiError, type ApiResponse } from '@/lib/response';
import { requireSession, ROLES } from '@/lib/auth';
import { db } from '@/lib/db';

const querySchema = z.object({
  resource: z.string().optional(),
  billed: z.string().optional(),
  periodStart: z.string().optional(),
  periodEnd: z.string().optional(),
  aggregate: z.string().optional(),
});

const createSchema = z.object({
  websiteId: z.string().optional(),
  resource: z.string().min(1),
  quantity: z.number().nonnegative(),
  unitPrice: z.number().default(0),
});

function getBillingPeriod(): { start: Date; end: Date } {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
  return { start, end };
}

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
    if (input.resource) {
      where.resource = input.resource;
    }
    if (input.billed !== undefined) {
      where.billed = input.billed === 'true';
    }
    if (input.periodStart || input.periodEnd) {
      where.periodStart = {};
      if (input.periodStart) (where.periodStart as Record<string, Date>).gte = new Date(input.periodStart);
      if (input.periodEnd) (where.periodStart as Record<string, Date>).lte = new Date(input.periodEnd);
    }

    // Aggregate mode
    if (input.aggregate === 'true') {
      const grouped = await db.usageRecord.groupBy({
        by: ['resource'],
        where,
        _sum: {
          quantity: true,
          totalCost: true,
        },
        _count: true,
      });

      const totals = grouped.map((g) => ({
        resource: g.resource,
        totalQuantity: g._sum.quantity ?? 0,
        totalCost: g._sum.totalCost ?? 0,
        recordCount: g._count,
      }));

      const grandTotal = totals.reduce((acc, t) => acc + t.totalCost, 0);

      return NextResponse.json(apiSuccess({
        byResource: totals,
        grandTotal,
      }));
    }

    const records = await db.usageRecord.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 200,
    });

    const calculatedTotals = records.reduce(
      (acc, r) => {
        acc.totalCost += r.totalCost;
        acc.totalQuantity += r.quantity;
        return acc;
      },
      { totalCost: 0, totalQuantity: 0 },
    );

    return NextResponse.json(apiSuccess({
      records,
      totals: calculatedTotals,
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
    const input = createSchema.parse(body);

    const { start, end } = getBillingPeriod();
    const totalCost = input.quantity * input.unitPrice;

    const record = await db.usageRecord.create({
      data: {
        userId: user.id,
        websiteId: input.websiteId ?? null,
        resource: input.resource,
        quantity: input.quantity,
        unitPrice: input.unitPrice,
        totalCost,
        periodStart: start,
        periodEnd: end,
      },
    });

    return NextResponse.json(apiSuccess(record, 'Usage recorded', 201), { status: 201 });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json(apiError('Validation failed', 'VALIDATION_ERROR', e.flatten(), 400), { status: 400 });
    }
    return handleErr(e);
  }
}
