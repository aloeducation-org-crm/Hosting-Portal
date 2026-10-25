import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { apiSuccess, apiError, type ApiResponse } from '@/lib/response';
import { requireSession, ROLES } from '@/lib/auth';
import { db } from '@/lib/db';

const querySchema = z.object({
  userId: z.string().optional(),
});

function getBillingPeriod(): { start: Date; end: Date; dueDate: Date } {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
  const dueDate = new Date(now.getFullYear(), now.getMonth() + 1, 15);
  return { start, end, dueDate };
}

function handleErr(e: unknown): NextResponse {
  if (e && typeof e === 'object' && 'status' in e) {
    const a = e as ApiResponse;
    return NextResponse.json(a, { status: a.status });
  }
  return NextResponse.json(apiError('Internal server error'), { status: 500 });
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireSession(request);
    const { searchParams } = new URL(request.url);
    const query = querySchema.parse(Object.fromEntries(searchParams));

    const targetUserId = user.role === ROLES.SUPER_ADMIN && query.userId ? query.userId : user.id;

    const { start, end, dueDate } = getBillingPeriod();

    // Get unbilled records for this user in the current period
    const unbilledRecords = await db.usageRecord.findMany({
      where: {
        userId: targetUserId,
        billed: false,
        periodStart: { gte: start },
        periodEnd: { lte: end },
      },
      orderBy: { createdAt: 'asc' },
    });

    if (unbilledRecords.length === 0) {
      return NextResponse.json(
        apiError('No unbilled usage records found for this period', 'NO_RECORDS', undefined, 404),
        { status: 404 },
      );
    }

    // Calculate total
    const amountCents = Math.round(
      unbilledRecords.reduce((sum, r) => sum + r.totalCost, 0) * 100,
    );

    if (amountCents === 0) {
      return NextResponse.json(
        apiError('Total amount is zero, no invoice generated', 'ZERO_AMOUNT', undefined, 400),
        { status: 400 },
      );
    }

    // Create invoice and mark records as billed in a transaction
    const invoice = await db.$transaction(async (tx) => {
      const newInvoice = await tx.invoice.create({
        data: {
          userId: targetUserId,
          amountCents,
          currency: 'USD',
          status: 'pending',
          dueDate,
        },
      });

      await tx.usageRecord.updateMany({
        where: {
          id: { in: unbilledRecords.map((r) => r.id) },
        },
        data: { billed: true, invoiceId: newInvoice.id },
      });

      return newInvoice;
    });

    // Fetch the line items for the response
    const lineItems = unbilledRecords.map((r) => ({
      id: r.id,
      resource: r.resource,
      quantity: r.quantity,
      unitPrice: r.unitPrice,
      totalCost: r.totalCost,
      websiteId: r.websiteId,
      periodStart: r.periodStart,
      periodEnd: r.periodEnd,
    }));

    return NextResponse.json(
      apiSuccess(
        {
          ...invoice,
          amountCents,
          lineItems,
          itemCount: lineItems.length,
        },
        'Invoice generated',
        201,
      ),
      { status: 201 },
    );
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json(apiError('Validation failed', 'VALIDATION_ERROR', e.flatten(), 400), { status: 400 });
    }
    return handleErr(e);
  }
}
