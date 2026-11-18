import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { apiSuccess, apiError, type ApiResponse } from '@/lib/response';
import { requireSession, ROLES } from '@/lib/auth';
import { createAuditLog } from '@/lib/audit';
import { db } from '@/lib/db';
import {
  findSelectablePlan,
  applyEntitlementChange,
  freeTierAuthorization,
  adminGrantAuthorization,
  paymentAuthorization,
  isPaidPlan,
  EntitlementError,
} from '@/lib/billing/entitlements';

/**
 * Subscription self-service.
 *
 * SEC-03: this route used to activate any plan — including the most expensive —
 * for free, for the caller, with a `paid` invoice and a `completed` order, in
 * one transaction. It now asks `src/lib/billing/entitlements.ts` for a grant, and
 * that module only writes a subscription when the caller proves an
 * authorization:
 *
 *   - a zero-price plan      → granted (nothing is owed)
 *   - a paid plan            → `402 PAYMENT_REQUIRED` until a payment provider
 *                              adapter can verify a provider event for it
 *   - an administrator       → granted, audited, invoice left `pending`
 *
 * The amount is always derived from the `Plan` row. It is never taken from the
 * request body, so a client cannot name its own price.
 */
const SubscribeSchema = z.object({
  planId: z.string().min(1).optional(),
  planSlug: z.string().min(1).optional(),
  billingCycle: z.enum(['monthly', 'yearly']).optional(),
  /** Provider checkout reference. Verified against the provider, never trusted. */
  transactionRef: z.string().min(1).max(200).optional(),
});

function handleErr(e: unknown): NextResponse {
  if (e instanceof z.ZodError) {
    return NextResponse.json(
      apiError('Validation failed', 'VALIDATION_ERROR', e.flatten(), 400),
      { status: 400 },
    );
  }
  if (e instanceof EntitlementError) {
    return NextResponse.json(
      apiError(e.message, e.code, e.customerAction ? { customerAction: e.customerAction } : undefined, e.status),
      { status: e.status },
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
    const where = user.role === ROLES.SUPER_ADMIN || user.role === ROLES.ADMIN
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

    const plan = await findSelectablePlan({ id: parsed.planId, slug: parsed.planSlug });
    const isAdmin = user.role === ROLES.SUPER_ADMIN || user.role === ROLES.ADMIN;

    // The authorization the caller is able to prove decides the outcome.
    // There is deliberately no branch that grants a paid plan to a customer.
    let authorization;
    if (!isPaidPlan(plan)) {
      authorization = freeTierAuthorization();
    } else if (isAdmin) {
      authorization = adminGrantAuthorization(
        { id: user.id, role: user.role },
        `Administrative plan assignment to ${plan.name}`,
      );
    } else if (parsed.transactionRef) {
      // `applyEntitlementChange` verifies this against the configured provider;
      // with no provider configured it refuses. A client-supplied reference is
      // never sufficient on its own.
      authorization = paymentAuthorization(parsed.transactionRef);
    } else {
      throw new EntitlementError(
        `${plan.name} is a paid plan. Use checkout to pay for it.`,
        'PAYMENT_REQUIRED',
        402,
        'Start checkout for this plan, or choose the free plan.',
      );
    }

    const result = await applyEntitlementChange({
      userId: user.id,
      plan,
      authorization,
      billingCycle: parsed.billingCycle,
    });

    await createAuditLog({
      actorId: user.id,
      actorEmail: user.email,
      actorRole: user.role,
      action: 'SUBSCRIPTION_ACTIVATED',
      resourceType: 'Subscription',
      resourceId: result.subscriptionId,
      result: 'SUCCESS',
      metadata: {
        planId: result.planId,
        planName: result.planName,
        amountCents: result.amountCents,
        currency: result.currency,
        entitlementSource: result.source,
        invoiceId: result.invoiceId ?? null,
        orderId: result.orderId ?? null,
      },
    });

    return NextResponse.json(
      apiSuccess(result, `Activated ${result.planName}`),
      { status: 201 },
    );
  } catch (e) {
    return handleErr(e);
  }
}
