import { NextRequest, NextResponse } from 'next/server';
import { apiSuccess, apiError, type ApiResponse } from '@/lib/response';
import { requireSession, ROLES } from '@/lib/auth';
import { db } from '@/lib/db';

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
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');

    const where: any = {};
    if (auth.role !== ROLES.SUPER_ADMIN) {
      where.userId = auth.id;
    }
    if (status) {
      where.status = status;
    }

    const orders = await db.order.findMany({
      where,
      include: { items: true },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    return NextResponse.json(apiSuccess(orders));
  } catch (e) {
    return handleErr(e);
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireSession(request);
    const body = await request.json();

    const { items, currency, paymentMethod, notes } = body;

    if (!items || !Array.isArray(items) || items.length === 0) {
      return NextResponse.json(apiError('Order must include at least one item', 'VALIDATION_ERROR', undefined, 400), { status: 400 });
    }

    for (const item of items) {
      if (!item.description || !item.type || !item.unitPriceCents) {
        return NextResponse.json(apiError('Each item must have description, type, and unitPriceCents', 'VALIDATION_ERROR', undefined, 400), { status: 400 });
      }
    }

    let totalCents = 0;
    const orderItems = items.map((item: any) => {
      const qty = item.quantity ?? 1;
      const unit = item.unitPriceCents;
      const lineTotal = qty * unit;
      totalCents += lineTotal;
      return {
        description: item.description,
        type: item.type,
        quantity: qty,
        unitPriceCents: unit,
        totalCents: lineTotal,
        metadata: item.metadata ?? undefined,
      };
    });

    const orderNumber = `ORD-${Date.now()}-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;

    const order = await db.order.create({
      data: {
        orderNumber,
        userId: auth.id,
        totalCents,
        currency: currency ?? 'USD',
        paymentMethod: paymentMethod ?? undefined,
        notes: notes ?? undefined,
        items: { create: orderItems },
      },
      include: { items: true },
    });

    return NextResponse.json(apiSuccess(order));
  } catch (e) {
    return handleErr(e);
  }
}
