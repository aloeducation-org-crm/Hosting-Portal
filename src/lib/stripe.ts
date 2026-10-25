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

export function isStripeConfigured(): boolean {
  return Boolean(env.STRIPE_SECRET_KEY && env.STRIPE_SECRET_KEY.startsWith("sk_"));
}

export async function createBillingCheckoutSession(
  input: CheckoutSessionInput
): Promise<CheckoutSessionResult> {
  if (!isStripeConfigured() || input.priceCents === 0) {
    return {
      sessionId: `cs_alo_${Date.now()}`,
      checkoutUrl: `${input.successUrl}?session_id=cs_alo_${Date.now()}&plan=${encodeURIComponent(input.planName)}`,
      mode: "free_tier",
    };
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
