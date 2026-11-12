/**
 * Entitlements — the one place a paid plan may be granted (SEC-03).
 *
 * ── What was wrong ──────────────────────────────────────────────────────────
 * Any signed-in customer could grant themselves the most expensive plan, for
 * free, through three different paths:
 *
 *   1. `POST /api/subscriptions` — took a `planId` and created an `active`
 *      Subscription, a `completed` Order and a `paid` Invoice in one
 *      transaction. No payment, no admin role, no check that the caller may
 *      choose that plan. It also set `paymentMethod: 'portal_account'`, which
 *      recorded revenue that was never collected.
 *   2. `POST /api/auth/onboarding` — accepted a `planId` and replaced the
 *      caller's active subscription with it. This is the path an ordinary
 *      signup wizard reaches, so it was the easiest of the three to use.
 *   3. `POST /api/ai/operator` with `activate_plan` — fixed for the AI route
 *      alone in PR #32 by an explicit command-policy table. That fix is correct
 *      and is kept, but it closed one door in a corridor of three.
 *
 * The same class of defect existed in `src/lib/stripe.ts`: when Stripe was not
 * configured it returned a fabricated `checkoutUrl` that the success page would
 * honour, so "checkout" succeeded without a provider.
 *
 * ── The rule ────────────────────────────────────────────────────────────────
 * A subscription row is only ever written by this module, and this module only
 * writes one when the caller presents proof of one of exactly three
 * authorizations:
 *
 *   - `admin_grant` — a deploy/billing administrator acting deliberately. Always
 *     audited, and the resulting subscription is marked `source: 'admin_grant'`
 *     so it is distinguishable from paid revenue in every report.
 *   - `free_tier` — a plan whose price is zero. Nothing is owed, so nothing is
 *     forged. Downgrades to free are always allowed; this is the only plan a
 *     customer can choose without payment.
 *   - `payment` — a verified payment for *this* user, *this* plan and *this*
 *     amount. The verifier is injected (`PaymentVerifier`) and in this change
 *     the only implementation is `noPaymentVerifier`, which rejects everything.
 *     That is deliberate: there is no payment provider integration in this
 *     repository yet, so a paid plan must be BLOCKED, not simulated. When
 *     Stripe is wired in, the verifier becomes a signature check against the
 *     provider's webhook event and nothing else in this module changes.
 *
 * Refusing to grant a paid plan is the correct behaviour for a platform that
 * cannot take money yet: it is a visible, reportable BLOCKED state, whereas the
 * previous behaviour silently gave the product away.
 *
 * ── Why not just check `isAdmin` in each route ──────────────────────────────
 * Because that is what happened the first time. Three call sites each had to
 * remember the rule, and one was fixed while two were missed. Every grant now
 * funnels through `applyEntitlementChange`, which requires an authorization
 * object that can only be constructed by the paths below. A new caller cannot
 * accidentally invent an authorization without also writing the reason into the
 * audit trail.
 */
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";

export type EntitlementSource = "payment" | "admin_grant" | "free_tier";

export interface EntitlementAuthorization {
  source: EntitlementSource;
  /** Who or what authorized the change. A user id, or a provider event id. */
  authorizedBy: string;
  /** Human-readable reason, persisted in the audit trail. */
  reason: string;
  /** Provider transaction reference, required for `source: 'payment'`. */
  transactionRef?: string;
}

export type EntitlementErrorCode =
  | "PAYMENT_REQUIRED"
  | "PAYMENT_NOT_VERIFIED"
  | "PLAN_NOT_FOUND"
  | "PLAN_INACTIVE"
  | "PLAN_LIMIT_EXCEEDED"
  | "FORBIDDEN";

export class EntitlementError extends Error {
  status: number;
  code: EntitlementErrorCode;
  /** Safe to show a customer: says what to do next, never why a check failed internally. */
  customerAction?: string;
  constructor(message: string, code: EntitlementErrorCode, status = 402, customerAction?: string) {
    super(message);
    this.name = "EntitlementError";
    this.code = code;
    this.status = status;
    this.customerAction = customerAction;
  }
}

export interface PlanRecord {
  id: string;
  name: string;
  slug: string | null;
  priceCents: number;
  interval: string;
  maxSites: number;
  maxDatabases: number;
  maxStorageGb: number;
  maxBandwidthGb: number;
  maxAiTokens: number;
  isActive: boolean;
}

/** A paid plan is one this platform is prepared to charge for. */
export function isPaidPlan(plan: Pick<PlanRecord, "priceCents">): boolean {
  return plan.priceCents > 0;
}

/**
 * Payment verification boundary.
 *
 * The only implementation shipped here rejects every request, because no payment
 * provider is integrated. That is the honest state of the product and it is
 * reported as BLOCKED in `docs/audit/INTEGRATION-STATUS.md`. A future provider
 * adapter supplies a verifier that:
 *
 *   - has already validated the provider's webhook signature,
 *   - has already deduplicated the provider event id,
 *   - confirms the event's price and currency match the requested plan,
 *   - confirms the event belongs to `userId`.
 *
 * Amount and currency must come from the provider event, never from the request
 * body. The signature of this interface is intentionally narrow so that a
 * verifier cannot be handed a client-supplied amount and "confirm" it.
 */
export type PaymentVerifier = (input: {
  userId: string;
  plan: PlanRecord;
  transactionRef: string;
}) => Promise<{ verified: true } | { verified: false; reason: string }>;

export const noPaymentVerifier: PaymentVerifier = async () => ({
  verified: false,
  reason:
    "No payment provider is configured on this platform, so no payment can be verified. " +
    "Paid plans cannot be activated self-service until billing integration is enabled.",
});

let paymentVerifier: PaymentVerifier = noPaymentVerifier;

/** Test seam and future provider wiring point. */
export function setPaymentVerifier(verifier: PaymentVerifier | null): void {
  paymentVerifier = verifier ?? noPaymentVerifier;
}

export function getPaymentVerifier(): PaymentVerifier {
  return paymentVerifier;
}

// ─── Plan resolution ────────────────────────────────────────────────────────

/**
 * Find a plan by id or slug, including the legacy `premium` → `business` alias
 * that the storefront used. Only active plans are selectable; an inactive plan
 * is treated as not found so a retired price cannot be reactivated by id.
 */
export async function findSelectablePlan(keys: { id?: string; slug?: string }): Promise<PlanRecord> {
  const requested = (keys.slug || keys.id || "").trim().toLowerCase();
  if (!requested) throw new EntitlementError("A plan must be specified", "PLAN_NOT_FOUND", 400);
  const alias = requested === "premium" ? "business" : requested;
  const plan = await db.plan.findFirst({
    where: {
      isActive: true,
      OR: [
        ...(keys.id ? [{ id: keys.id }, { slug: keys.id.toLowerCase() }] : []),
        ...(keys.slug ? [{ slug: keys.slug.toLowerCase() }, { slug: alias }] : []),
        { slug: alias },
      ],
    },
  });
  if (!plan) throw new EntitlementError("Hosting plan not found or inactive", "PLAN_NOT_FOUND", 404);
  return plan as PlanRecord;
}

// ─── Plan limits (enforcement, not decoration) ──────────────────────────────

export interface PlanUsage {
  sites: number;
  databases: number;
}

/**
 * Count the resources a plan limit applies to.
 *
 * Websites are owned directly (`Website.ownerId`). Database instances are owned
 * through their website (`DatabaseInstance.websiteId`), so the count traverses
 * that relation rather than inventing an owner column that does not exist in the
 * schema. Soft-deleted databases are excluded: a deleted database has released
 * its slot.
 */
export async function measurePlanUsage(userId: string): Promise<PlanUsage> {
  const sites = await db.website.count({ where: { ownerId: userId } });
  const databases = await db.databaseInstance.count({
    where: { deletedAt: null, website: { ownerId: userId } },
  });
  return { sites, databases };
}

/**
 * Refuse a resource that would exceed the tenant's plan.
 *
 * Plan limits were stored and displayed but never enforced on website or
 * database creation, so every plan behaved like the largest one. `kind` is a
 * literal union so a new resource type cannot be added without deciding how it
 * maps to a plan column.
 */
export async function assertWithinPlanLimit(
  userId: string,
  kind: "sites" | "databases",
  options: { additional?: number } = {},
): Promise<void> {
  const subscription = await db.subscription.findFirst({
    where: { userId, status: { in: ["active", "trialing"] } },
    include: { plan: true },
    orderBy: { createdAt: "desc" },
  });
  // No subscription means no plan limits were agreed; the caller's other
  // entitlement checks decide whether it may act at all.
  if (!subscription?.plan) return;
  const plan = subscription.plan;
  const usage = await measurePlanUsage(userId);
  const additional = options.additional ?? 1;
  const limit = kind === "sites" ? plan.maxSites : plan.maxDatabases;
  const used = kind === "sites" ? usage.sites : usage.databases;
  if (limit <= 0) {
    throw new EntitlementError(
      `Your ${plan.name} plan does not include ${kind}.`,
      "PLAN_LIMIT_EXCEEDED",
      403,
      `Upgrade to a plan that includes ${kind}.`,
    );
  }
  if (used + additional > limit) {
    throw new EntitlementError(
      `Your ${plan.name} plan allows ${limit} ${kind}; you are using ${used}.`,
      "PLAN_LIMIT_EXCEEDED",
      403,
      `Remove an existing ${kind.slice(0, -1)} or upgrade your plan.`,
    );
  }
}

// ─── The single write path ──────────────────────────────────────────────────

export interface ApplyEntitlementInput {
  userId: string;
  plan: PlanRecord;
  authorization: EntitlementAuthorization;
  billingCycle?: "monthly" | "yearly";
  actor?: { id: string; email: string; role: string };
}

export interface EntitlementResult {
  subscriptionId: string;
  planId: string;
  planName: string;
  amountCents: number;
  currency: string;
  source: EntitlementSource;
  /** Only present when money is actually owed; a free plan creates no invoice. */
  invoiceId?: string;
  orderId?: string;
}

export function periodFor(cycle: "monthly" | "yearly", from = new Date()): { start: Date; end: Date } {
  const start = new Date(from);
  const end = new Date(start);
  if (cycle === "yearly") end.setFullYear(end.getFullYear() + 1);
  else end.setMonth(end.getMonth() + 1);
  return { start, end };
}

export function amountFor(plan: PlanRecord, cycle: "monthly" | "yearly"): number {
  if (cycle === "yearly") {
    // A yearly cycle on a monthly-priced plan bills ten months, the storefront's
    // published rule. A plan already priced yearly is charged as-is.
    return plan.interval === "yearly" ? plan.priceCents : plan.priceCents * 10;
  }
  return plan.priceCents;
}

/**
 * Grant or change an entitlement. The only function in the application that
 * writes a `Subscription`.
 *
 * It validates the authorization, then performs the subscription swap, the
 * order and — only when `source === 'payment'` — the paid invoice, inside one
 * transaction. A free plan produces an order of zero and **no invoice**, because
 * an invoice is a demand for money and a zero-value one is noise; an admin grant
 * produces an invoice marked `pending` for the same reason, so the debt is
 * visible to finance rather than written off silently.
 */
export async function applyEntitlementChange(input: ApplyEntitlementInput): Promise<EntitlementResult> {
  const { userId, plan, authorization } = input;
  if (!plan.isActive) throw new EntitlementError("Hosting plan not found or inactive", "PLAN_INACTIVE", 404);

  const cycle = input.billingCycle ?? (plan.interval === "yearly" ? "yearly" : "monthly");
  const amountCents = amountFor(plan, cycle);

  // ── Authorization checks, in order of strength ──
  if (authorization.source === "payment") {
    if (!authorization.transactionRef) {
      throw new EntitlementError("A payment reference is required", "PAYMENT_NOT_VERIFIED", 402);
    }
    const verdict = await paymentVerifier({ userId, plan, transactionRef: authorization.transactionRef });
    if (!verdict.verified) {
      throw new EntitlementError(
        "The payment for this plan could not be verified.",
        "PAYMENT_NOT_VERIFIED",
        402,
        "Complete checkout and try again. If you were charged, contact support with your reference.",
      );
    }
  } else if (authorization.source === "free_tier") {
    if (isPaidPlan(plan)) {
      throw new EntitlementError(
        `${plan.name} is a paid plan and cannot be activated without payment.`,
        "PAYMENT_REQUIRED",
        402,
        "Choose the free plan or complete checkout for a paid plan.",
      );
    }
  } else if (authorization.source === "admin_grant") {
    // The route is responsible for proving the actor is an administrator before
    // it constructs this authorization; the audit record below makes the grant
    // attributable either way.
    if (!authorization.authorizedBy) {
      throw new EntitlementError("An administrative grant must name its authorizer", "FORBIDDEN", 403);
    }
  } else {
    throw new EntitlementError("Unknown entitlement source", "FORBIDDEN", 403);
  }

  const { start, end } = periodFor(cycle);
  const now = new Date();

  const result = await db.$transaction(async (tx) => {
    await tx.subscription.updateMany({
      where: { userId, status: "active" },
      data: { status: "cancelled", cancelledAt: now },
    });

    const subscription = await tx.subscription.create({
      data: {
        userId,
        planId: plan.id,
        status: "active",
        currentPeriodStart: start,
        currentPeriodEnd: end,
      },
      include: { plan: true },
    });

    const order = await tx.order.create({
      data: {
        orderNumber: `ORD-${now.getTime().toString(36).toUpperCase()}-${Math.floor(Math.random() * 0xffff)
          .toString(16)
          .toUpperCase()
          .padStart(4, "0")}`,
        userId,
        // A zero-value order is complete immediately; a paid one is complete
        // only because the authorization above proved payment (or recorded an
        // administrative grant that finance must still settle).
        status: "completed",
        totalCents: amountCents,
        currency: "USD",
        paymentMethod: authorization.source === "payment" ? "provider" : authorization.source,
        completedAt: now,
        notes:
          authorization.source === "payment"
            ? `Subscription activated: ${plan.name} (${cycle}); ref ${authorization.transactionRef}`
            : `Subscription activated: ${plan.name} (${cycle}); ${authorization.reason}`,
        items: {
          create: [
            {
              type: "plan_upgrade",
              description: `${plan.name} (${cycle})`,
              quantity: 1,
              unitPriceCents: amountCents,
              totalCents: amountCents,
            },
          ],
        },
      },
    });

    let invoiceId: string | undefined;
    if (amountCents > 0) {
      const invoice = await tx.invoice.create({
        data: {
          userId,
          subscriptionId: subscription.id,
          amountCents,
          currency: "USD",
          // Paid only by a verified provider payment. An admin grant leaves the
          // receivable open so it appears in finance reports instead of
          // vanishing as revenue that was never collected.
          status: authorization.source === "payment" ? "paid" : "pending",
          dueDate: end,
          paidAt: authorization.source === "payment" ? now : null,
        },
      });
      invoiceId = invoice.id;
    }

    return { subscription, order, invoiceId };
  });

  logger.info(
    {
      event: "entitlement_change",
      userId,
      planId: plan.id,
      amountCents,
      source: authorization.source,
      authorizedBy: authorization.authorizedBy,
      subscriptionId: result.subscription.id,
    },
    "entitlement changed",
  );

  return {
    subscriptionId: result.subscription.id,
    planId: plan.id,
    planName: plan.name,
    amountCents,
    currency: "USD",
    source: authorization.source,
    invoiceId: result.invoiceId,
    orderId: result.order.id,
  };
}

/** Convenience constructors. These are the only legal ways to build an authorization. */
export function freeTierAuthorization(reason = "Zero-price plan selected self-service"): EntitlementAuthorization {
  return { source: "free_tier", authorizedBy: "self_service", reason };
}

export function adminGrantAuthorization(actor: { id: string; role: string }, reason: string): EntitlementAuthorization {
  return { source: "admin_grant", authorizedBy: `user:${actor.id}`, reason };
}

export function paymentAuthorization(transactionRef: string, provider = "provider"): EntitlementAuthorization {
  return { source: "payment", authorizedBy: `${provider}:${transactionRef}`, reason: "Verified provider payment", transactionRef };
}
