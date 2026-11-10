import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { apiSuccess, apiError, type ApiResponse } from '@/lib/response';
import { requireSession } from '@/lib/auth';
import { db } from '@/lib/db';

const querySchema = z.object({
  compare: z.string().optional(),
});

function getPeriodDates(offsetMonths: number = 0): { start: Date; end: Date } {
  const now = new Date();
  const targetMonth = now.getMonth() - offsetMonths;
  const targetYear = now.getFullYear() + Math.floor(targetMonth / 12);
  const adjustedMonth = ((targetMonth % 12) + 12) % 12;
  const start = new Date(targetYear, adjustedMonth, 1);
  const end = new Date(targetYear, adjustedMonth + 1, 0, 23, 59, 59, 999);
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

    const currentPeriod = getPeriodDates(0);

    const currentWhere = {
      userId: user.id,
      periodStart: { gte: currentPeriod.start, lte: currentPeriod.end },
    };

    const currentGrouped = await db.usageRecord.groupBy({
      by: ['resource'],
      where: currentWhere,
      _sum: {
        quantity: true,
        totalCost: true,
      },
    });

    const currentByResource = currentGrouped.map((g) => ({
      resource: g.resource,
      totalQuantity: g._sum.quantity ?? 0,
      totalCost: g._sum.totalCost ?? 0,
    }));

    const currentTotalCost = currentByResource.reduce((acc, r) => acc + r.totalCost, 0);

    const result: Record<string, unknown> = {
      period: {
        start: currentPeriod.start.toISOString(),
        end: currentPeriod.end.toISOString(),
      },
      byResource: currentByResource,
      totalCost: currentTotalCost,
    };

    // Compare with previous period if requested
    if (input.compare === 'true') {
      const previousPeriod = getPeriodDates(1);

      const previousWhere = {
        userId: user.id,
        periodStart: { gte: previousPeriod.start, lte: previousPeriod.end },
      };

      const previousGrouped = await db.usageRecord.groupBy({
        by: ['resource'],
        where: previousWhere,
        _sum: {
          quantity: true,
          totalCost: true,
        },
      });

      const previousByResource = previousGrouped.map((g) => ({
        resource: g.resource,
        totalQuantity: g._sum.quantity ?? 0,
        totalCost: g._sum.totalCost ?? 0,
      }));

      const previousTotalCost = previousByResource.reduce((acc, r) => acc + r.totalCost, 0);

      // Calculate changes
      const comparison = currentByResource.map((curr) => {
        const prev = previousByResource.find((p) => p.resource === curr.resource);
        const prevCost = prev?.totalCost ?? 0;
        const prevQty = prev?.totalQuantity ?? 0;
        return {
          resource: curr.resource,
          currentCost: curr.totalCost,
          previousCost: prevCost,
          costChange: curr.totalCost - prevCost,
          costChangePercent: prevCost > 0 ? ((curr.totalCost - prevCost) / prevCost) * 100 : curr.totalCost > 0 ? 100 : 0,
          currentQuantity: curr.totalQuantity,
          previousQuantity: prevQty,
          quantityChange: curr.totalQuantity - prevQty,
        };
      });

      result.comparison = {
        period: {
          start: previousPeriod.start.toISOString(),
          end: previousPeriod.end.toISOString(),
        },
        byResource: comparison,
        totalCost: previousTotalCost,
        totalCostChange: currentTotalCost - previousTotalCost,
        totalCostChangePercent: previousTotalCost > 0
          ? ((currentTotalCost - previousTotalCost) / previousTotalCost) * 100
          : currentTotalCost > 0 ? 100 : 0,
      };
    }

    return NextResponse.json(apiSuccess(result));
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json(apiError('Validation failed', 'VALIDATION_ERROR', e.flatten(), 400), { status: 400 });
    }
    return handleErr(e);
  }
}
