import { env } from "@/lib/env";

export interface CheckoutSessionInput {
  userId: string;
  userEmail: string;
  planId: string;
  planName: string;
  priceCents: number;
  interval: "monthly" | "yearly";
  successUrl: string;
  cancelUrl: string;
}

export interface CheckoutSessionResult {
  sessionId: string;
  checkoutUrl: string;
  mode: "live" | "free_tier";
}

/**
 * Raised when a paid checkout is requested but no payment provider can be
 * reached. SEC-03: this used to return a synthetic `checkoutUrl` pointing at a
 * success page, so the caller believed checkout had succeeded and the success
 * page would activate a plan that was never paid for. A provider that is not
 * configured is a BLOCKED integration, not a free tier.
 */
export class PaymentProviderUnavailableError extends Error {
  code = "PAYMENT_PROVIDER_UNAVAILABLE";
  status = 503;
  constructor(message = "Payment provider is not configured on this platform") {
    super(message);
    this.name = "PaymentProviderUnavailableError";
  }
}

export function isStripeConfigured(): boolean {
  return Boolean(env.STRIPE_SECRET_KEY && env.STRIPE_SECRET_KEY.startsWith("sk_"));
}

export async function createBillingCheckoutSession(
  input: CheckoutSessionInput
): Promise<CheckoutSessionResult> {
  // A zero-price plan needs no checkout at all: entitlement is granted locally.
  if (input.priceCents === 0) {
    return {
      sessionId: `free_${Date.now()}`,
      checkoutUrl: `${input.successUrl}?plan=${encodeURIComponent(input.planName)}&mode=free`,
      mode: "free_tier",
    };
  }
  // A paid plan without a provider is a hard stop. Never fabricate a session.
  if (!isStripeConfigured()) {
    throw new PaymentProviderUnavailableError(
      "Paid plans cannot be purchased because no payment provider is configured on this platform.",
    );
  }

  const params = new URLSearchParams();
  params.set("mode", "subscription");
  params.set("customer_email", input.userEmail);
  params.set("success_url", input.successUrl);
  params.set("cancel_url", input.cancelUrl);
  params.set("line_items[0][price_data][currency]", "usd");
  params.set("line_items[0][price_data][unit_amount]", String(input.priceCents));
  params.set(
    "line_items[0][price_data][recurring][interval]",
    input.interval === "yearly" ? "year" : "month"
  );
  params.set("line_items[0][price_data][product_data][name]", `ALO Labs ${input.planName} Plan`);
  params.set("line_items[0][quantity]", "1");
  params.set("metadata[userId]", input.userId);
  params.set("metadata[planId]", input.planId);

  const response = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
  });

  if (!response.ok) {
    throw new Error(`Stripe checkout session creation failed with status ${response.status}`);
  }

  const data = (await response.json()) as { id: string; url: string };
  return {
    sessionId: data.id,
    checkoutUrl: data.url,
    mode: "live",
  };
}
