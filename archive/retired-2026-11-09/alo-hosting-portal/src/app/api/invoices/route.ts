import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { apiSuccess, apiError, type ApiResponse } from '@/lib/response';
import { requireSession, ROLES } from '@/lib/auth';
import { db } from '@/lib/db';

const querySchema = z.object({
  status: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
});

const updateSchema = z.object({
  invoiceId: z.string().min(1),
  status: z.string().optional(),
  paidAt: z.string().optional(),
  paymentRef: z.string().optional(),
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

    const where: Record<string, unknown> = user.role === ROLES.SUPER_ADMIN
      ? {}
      : { userId: user.id };

    if (input.status) {
      where.status = input.status;
    }
    if (input.startDate || input.endDate) {
      where.dueDate = {};
      if (input.startDate) (where.dueDate as Record<string, Date>).gte = new Date(input.startDate);
      if (input.endDate) (where.dueDate as Record<string, Date>).lte = new Date(input.endDate);
    }

    const invoices = await db.invoice.findMany({
      where,
      orderBy: { dueDate: 'desc' },
      take: 50,
    });
    return NextResponse.json(apiSuccess(invoices));
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
    const input = updateSchema.parse(body);

    if (!input.status) {
      return NextResponse.json(apiError('Status is required', 'VALIDATION_ERROR', undefined, 400), { status: 400 });
    }

    // Only SUPER_ADMIN can update invoice status
    if (user.role !== ROLES.SUPER_ADMIN) {
      return NextResponse.json(apiError('Forbidden', 'FORBIDDEN', undefined, 403), { status: 403 });
    }

    const validStatuses = ['pending', 'paid', 'failed', 'refunded'];
    if (!validStatuses.includes(input.status)) {
      return NextResponse.json(
        apiError(`Invalid status. Must be one of: ${validStatuses.join(', ')}`, 'VALIDATION_ERROR', undefined, 400),
        { status: 400 },
      );
    }

    const updateData: Record<string, unknown> = { status: input.status };
    if (input.status === 'paid') {
      updateData.paidAt = input.paidAt ? new Date(input.paidAt) : new Date();
    }

    const invoice = await db.invoice.findUnique({ where: { id: input.invoiceId } });
    if (!invoice) {
      return NextResponse.json(apiError('Invoice not found', 'NOT_FOUND', undefined, 404), { status: 404 });
    }

    const updated = await db.invoice.update({
      where: { id: invoice.id },
      data: updateData,
    });

    return NextResponse.json(apiSuccess(updated));
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json(apiError('Validation failed', 'VALIDATION_ERROR', e.flatten(), 400), { status: 400 });
    }
    return handleErr(e);
  }
}
