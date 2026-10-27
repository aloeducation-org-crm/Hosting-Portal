import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { apiSuccess, apiError, type ApiResponse } from '@/lib/response';
import { requireSession, ROLES } from '@/lib/auth';
import { createAuditLog } from '@/lib/audit';
import { db } from '@/lib/db';

const SubscribeSchema = z.object({
  planId: z.string().min(1).optional(),
  planSlug: z.string().min(1).optional(),
  billingCycle: z.enum(['monthly', 'yearly']).optional(),
});

function handleErr(e: unknown): NextResponse {
  if (e instanceof z.ZodError) {
    return NextResponse.json(
      apiError('Validation failed', 'VALIDATION_ERROR', e.flatten(), 400),
      { status: 400 },
    );
  }
  if (e && typeof e === 'object' && 'status' in e) {
    const a = e as ApiResponse;
    return NextResponse.json(a, { status: a.status });
  }
  return NextResponse.json(apiError('Internal server error'), { status: 500 });
}

export async function GET(request: NextRequest) {
  try {
    const user = await requireSession(request);
    const where = user.role === ROLES.SUPER_ADMIN
      ? {}
      : { userId: user.id };
    const subscriptions = await db.subscription.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: { plan: true, user: { select: { id: true, email: true, name: true } } },
    });
    return NextResponse.json(apiSuccess(subscriptions));
  } catch (e) {
    return handleErr(e);
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireSession(request);
    const parsed = SubscribeSchema.parse(await request.json());

    if (!parsed.planId && !parsed.planSlug) {
      return NextResponse.json(
        apiError('planId or planSlug is required', 'VALIDATION_ERROR', undefined, 400),
        { status: 400 },
      );
    }

    const requestedKey = (parsed.planSlug || parsed.planId || '').trim().toLowerCase();
    const aliasSlug = requestedKey === 'premium' ? 'business' : requestedKey;

    const plan =
      (await db.plan.findFirst({
        where: {
          isActive: true,
          OR: [
            ...(parsed.planId ? [{ id: parsed.planId }, { slug: parsed.planId.toLowerCase() }] : []),
            ...(parsed.planSlug ? [{ slug: parsed.planSlug.toLowerCase() }, { slug: aliasSlug }] : []),
            { slug: aliasSlug },
          ],
        },
      })) ?? null;

    if (!plan) {
      return NextResponse.json(
        apiError('Hosting plan not found or inactive', 'PLAN_NOT_FOUND', undefined, 404),
        { status: 404 },
      );
    }

    const cycle = parsed.billingCycle ?? (plan.interval === 'yearly' ? 'yearly' : 'monthly');
    const now = new Date();
    const periodEnd = new Date(now);
    if (cycle === 'yearly') {
      periodEnd.setFullYear(periodEnd.getFullYear() + 1);
    } else {
      periodEnd.setMonth(periodEnd.getMonth() + 1);
    }

    const amountCents = Math.max(
      0,
      cycle === 'yearly' && plan.interval !== 'yearly' ? plan.priceCents * 10 : plan.priceCents,
    );
    const orderNumber = `ORD-${Date.now().toString(36).toUpperCase()}-${randomUUID().slice(0, 4).toUpperCase()}`;

    const result = await db.$transaction(async (tx) => {
      await tx.subscription.updateMany({
        where: { userId: user.id, status: 'active' },
        data: { status: 'cancelled', cancelledAt: now },
      });

      const subscription = await tx.subscription.create({
        data: {
          userId: user.id,
          planId: plan.id,
          status: 'active',
          currentPeriodStart: now,
          currentPeriodEnd: periodEnd,
        },
        include: { plan: true },
      });

      const order = await tx.order.create({
        data: {
          orderNumber,
          userId: user.id,
          status: 'completed',
          totalCents: amountCents,
          currency: 'USD',
          paymentMethod: 'portal_account',
          completedAt: now,
          notes: `Subscription activated: ${plan.name} (${cycle})`,
          items: {
            create: [
              {
                type: 'plan_upgrade',
                description: `${plan.name} (${cycle})`,
                quantity: 1,
                unitPriceCents: amountCents,
                totalCents: amountCents,
              },
            ],
          },
        },
      });

      const invoice = await tx.invoice.create({
        data: {
          userId: user.id,
          subscriptionId: subscription.id,
          amountCents,
          currency: 'USD',
          status: 'paid',
          dueDate: periodEnd,
          paidAt: now,
        },
      });

      return { subscription, order, invoice };
    });

    await createAuditLog({
      actorId: user.id,
      actorEmail: user.email,
      actorRole: user.role,
      action: 'SUBSCRIPTION_ACTIVATED',
      resourceType: 'Subscription',
      resourceId: result.subscription.id,
      result: 'SUCCESS',
      metadata: {
        planId: plan.id,
        planSlug: plan.slug,
        planName: plan.name,
        amountCents,
        orderNumber,
        invoiceId: result.invoice.id,
      },
    });

    return NextResponse.json(
      apiSuccess(result, `Successfully activated ${plan.name}`),
      { status: 201 },
    );
  } catch (e) {
    return handleErr(e);
  }
}
