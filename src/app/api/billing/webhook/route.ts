import { NextRequest, NextResponse } from "next/server";
import { apiError, apiSuccess } from "@/lib/response";
import { db } from "@/lib/db";
import { createAuditLog } from "@/lib/audit";
import { verifyStripeWebhookSignature } from "@/lib/stripe";
import {
  applyVerifiedStripeCheckout,
  recordVerifiedStripeInvoiceEvent,
  EntitlementError,
} from "@/lib/billing/entitlements";

interface StripeEventObject {
  id?: string;
  metadata?: Record<string, string>;
  amount_total?: number;
  amount_paid?: number;
  amount_due?: number;
  currency?: string;
  hosted_invoice_url?: string;
  status?: string;
}

interface StripeWebhookEvent {
  id: string;
  type: string;
  data?: {
    object?: StripeEventObject;
  };
}

/**
 * POST /api/billing/webhook
 *
 * Verified Stripe webhook receiver for completing subscription checkouts,
 * recording paid/failed invoices, and syncing cancellations. Fails closed
 * whenever STRIPE_WEBHOOK_SECRET is unset or signature verification fails,
 * and funnels all entitlement writes through `src/lib/billing/entitlements.ts`
 * (SEC-03 single-writer rule).
 */
export async function POST(request: NextRequest) {
  const secrets = [
    process.env.STRIPE_WEBHOOK_SECRET ?? "",
    process.env.STRIPE_WEBHOOK_SECRET_2 ?? "",
  ].filter(Boolean);

  if (secrets.length === 0) {
    return NextResponse.json(
      apiError("Stripe webhook secret is not configured", "WEBHOOK_NOT_CONFIGURED", undefined, 503),
      { status: 503 },
    );
  }

  const rawBody = await request.text();
  const signature = request.headers.get("stripe-signature");
  const verdict = verifyStripeWebhookSignature(rawBody, signature, secrets);

  if (!verdict.ok) {
    return NextResponse.json(
      apiError("Invalid webhook signature", verdict.reason ?? "INVALID_SIGNATURE", undefined, 400),
      { status: 400 },
    );
  }

  let event: StripeWebhookEvent;
  try {
    event = JSON.parse(rawBody) as StripeWebhookEvent;
  } catch {
    return NextResponse.json(
      apiError("Malformed JSON payload", "INVALID_PAYLOAD", undefined, 400),
      { status: 400 },
    );
  }

  if (!event?.id || !event?.type) {
    return NextResponse.json(
      apiError("Missing event id or type", "INVALID_EVENT", undefined, 400),
      { status: 400 },
    );
  }

  const obj = event.data?.object ?? {};
  const userId = obj.metadata?.userId;
  const planId = obj.metadata?.planId;

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        if (!userId || !planId) {
          return NextResponse.json(
            apiSuccess({ received: true, ignored: true, reason: "missing_metadata" }),
          );
        }

        const user = await db.user.findUnique({
          where: { id: userId },
          select: { id: true, email: true },
        });
        if (!user) {
          return NextResponse.json(
            apiError("Referenced user not found", "NOT_FOUND", undefined, 404),
            { status: 404 },
          );
        }

        const entitlement = await applyVerifiedStripeCheckout({
          stripeEventId: event.id,
          userId: user.id,
          planId,
          amountCents: typeof obj.amount_total === "number" ? obj.amount_total : undefined,
          currency: obj.currency,
        });

        await createAuditLog({
          actorId: user.id,
          actorEmail: user.email,
          actorRole: "SYSTEM",
          action: "STRIPE_CHECKOUT_COMPLETED",
          resourceType: "Subscription",
          resourceId: entitlement.subscriptionId,
          result: "SUCCESS",
          metadata: {
            stripeEventId: event.id,
            planId: entitlement.planId,
            amountCents: entitlement.amountCents,
          },
        });

        return NextResponse.json(
          apiSuccess({
            received: true,
            subscriptionId: entitlement.subscriptionId,
            status: "active",
          }),
        );
      }

      case "invoice.paid": {
        if (userId) {
          await recordVerifiedStripeInvoiceEvent({
            userId,
            outcome: "paid",
            amountCents: typeof obj.amount_paid === "number" ? obj.amount_paid : 0,
            currency: obj.currency,
            invoiceUrl: obj.hosted_invoice_url ?? null,
          });
        }
        return NextResponse.json(apiSuccess({ received: true, eventType: event.type }));
      }

      case "invoice.payment_failed": {
        if (userId) {
          await recordVerifiedStripeInvoiceEvent({
            userId,
            outcome: "failed",
            amountCents: typeof obj.amount_due === "number" ? obj.amount_due : 0,
            currency: obj.currency,
            invoiceUrl: obj.hosted_invoice_url ?? null,
          });
        }
        return NextResponse.json(apiSuccess({ received: true, eventType: event.type }));
      }

      case "customer.subscription.deleted": {
        if (userId) {
          await db.subscription.updateMany({
            where: { userId, status: { not: "cancelled" } },
            data: { status: "cancelled", cancelledAt: new Date() },
          });
        }
        return NextResponse.json(apiSuccess({ received: true, eventType: event.type }));
      }

      default:
        return NextResponse.json(apiSuccess({ received: true, ignored: true, eventType: event.type }));
    }
  } catch (err) {
    if (err instanceof EntitlementError) {
      return NextResponse.json(
        apiError(err.message, err.code, undefined, err.status),
        { status: err.status },
      );
    }
    return NextResponse.json(apiError("Webhook processing error", "WEBHOOK_ERROR", undefined, 500), {
      status: 500,
    });
  }
}
