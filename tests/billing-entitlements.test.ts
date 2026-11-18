/**
 * SEC-03 regression tests — entitlement integrity.
 *
 * The defect: a signed-in customer could grant themselves any plan for free via
 * three independent paths (subscriptions, onboarding, the AI operator) plus a
 * fabricated Stripe checkout URL. Every path wrote `status: paid` invoices and
 * `completed` orders that recorded revenue never collected.
 *
 * What is proven here:
 *   1. a paid plan cannot be granted by a customer on any path — the single
 *      service refuses, and it is the only thing that writes a Subscription;
 *   2. a zero-price plan is still granted, so the product is not broken by the
 *      fix;
 *   3. an administrative grant works but leaves the invoice `pending`, so it
 *      appears in finance reports instead of vanishing as revenue;
 *   4. a payment grant requires a verifier, and the shipped verifier accepts
 *      nothing because no provider is configured — the honest BLOCKED state;
 *   5. plan limits are enforced on resource creation instead of only displayed;
 *   6. no route or helper writes a Subscription outside the service (source
 *      scan).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  applyEntitlementChange,
  adminGrantAuthorization,
  freeTierAuthorization,
  paymentAuthorization,
  isPaidPlan,
  amountFor,
  periodFor,
  assertWithinPlanLimit,
  noPaymentVerifier,
  setPaymentVerifier,
  findSelectablePlan,
  EntitlementError,
  type PlanRecord,
} from "../src/lib/billing/entitlements";
import { PaymentProviderUnavailableError } from "../src/lib/stripe";

const ROOT = path.resolve(__dirname, "..");

interface Writes {
  subscriptions: Array<Record<string, unknown>>;
  orders: Array<Record<string, unknown>>;
  invoices: Array<Record<string, unknown>>;
}

const writes: Writes = { subscriptions: [], orders: [], invoices: [] };
let planRows: PlanRecord[] = [];
let websiteCount = 0;
let databaseCount = 0;
let activeSubscription: { plan: PlanRecord } | null = null;

const tx = {
  subscription: {
    updateMany: async () => ({ count: 0 }),
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const record = { id: "sub-new", ...data };
      writes.subscriptions.push(record);
      return record;
    },
  },
  order: {
    create: async ({ data }: { data: Record<string, unknown> }) => {
      writes.orders.push(data);
      return { id: "ord-new", ...data };
    },
  },
  invoice: {
    create: async ({ data }: { data: Record<string, unknown> }) => {
      writes.invoices.push(data);
      return { id: "inv-new", ...data };
    },
  },
};

vi.mock("@/lib/db", () => ({
  db: {
    $transaction: async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
    plan: {
      findFirst: async ({ where }: { where: { isActive?: boolean; OR?: Array<Record<string, unknown>> } }) => {
        const active = planRows.filter((p) => (where?.isActive ? p.isActive : true));
        if (!where?.OR) return active[0] ?? null;
        return (
          active.find((p) =>
            where.OR!.some((clause) =>
              ("id" in clause && clause.id === p.id) ||
              ("slug" in clause && String(clause.slug).toLowerCase() === String(p.slug).toLowerCase()),
            ),
          ) ?? null
        );
      },
    },
    website: { count: async () => websiteCount },
    databaseInstance: { count: async () => databaseCount },
    subscription: {
      findFirst: async () => activeSubscription,
    },
  },
}));

const FREE: PlanRecord = {
  id: "plan-free",
  name: "Starter",
  slug: "starter",
  priceCents: 0,
  interval: "monthly",
  maxSites: 1,
  maxDatabases: 1,
  maxStorageGb: 1,
  maxBandwidthGb: 10,
  maxAiTokens: 1000,
  isActive: true,
};

const PAID: PlanRecord = {
  id: "plan-business",
  name: "Business",
  slug: "business",
  priceCents: 4900,
  interval: "monthly",
  maxSites: 10,
  maxDatabases: 5,
  maxStorageGb: 50,
  maxBandwidthGb: 500,
  maxAiTokens: 100_000,
  isActive: true,
};

beforeEach(() => {
  writes.subscriptions = [];
  writes.orders = [];
  writes.invoices = [];
  planRows = [FREE, PAID];
  websiteCount = 0;
  databaseCount = 0;
  activeSubscription = null;
  setPaymentVerifier(null);
});
afterEach(() => setPaymentVerifier(null));

describe("SEC-03 plan classification", () => {
  it("treats a positive price as paid and zero as free", () => {
    expect(isPaidPlan(FREE)).toBe(false);
    expect(isPaidPlan(PAID)).toBe(true);
    expect(isPaidPlan({ priceCents: 1 })).toBe(true);
  });

  it("bills a yearly cycle at ten monthly units, and a yearly-priced plan as-is", () => {
    expect(amountFor(PAID, "monthly")).toBe(4900);
    expect(amountFor(PAID, "yearly")).toBe(49000);
    expect(amountFor({ ...PAID, interval: "yearly" }, "yearly")).toBe(4900);
  });

  it("computes a period one cycle long", () => {
    const { start, end } = periodFor("monthly", new Date("2026-01-31T00:00:00Z"));
    expect(end.getTime()).toBeGreaterThan(start.getTime());
    const yearly = periodFor("yearly", new Date("2026-01-01T00:00:00Z"));
    expect(yearly.end.getUTCFullYear()).toBe(2027);
  });
});

describe("SEC-03 a customer cannot grant a paid plan", () => {
  it("refuses a free-tier authorization for a paid plan", async () => {
    const error = await applyEntitlementChange({
      userId: "user-1",
      plan: PAID,
      authorization: freeTierAuthorization(),
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(EntitlementError);
    expect((error as EntitlementError).code).toBe("PAYMENT_REQUIRED");
    expect((error as EntitlementError).status).toBe(402);
    // And nothing was written before the refusal.
    expect(writes.subscriptions).toHaveLength(0);
    expect(writes.invoices).toHaveLength(0);
  });

  it("refuses a payment authorization when no provider verifier is configured", async () => {
    const error = await applyEntitlementChange({
      userId: "user-1",
      plan: PAID,
      authorization: paymentAuthorization("cs_test_123"),
    }).catch((e: unknown) => e);
    expect((error as EntitlementError).code).toBe("PAYMENT_NOT_VERIFIED");
    expect(writes.subscriptions).toHaveLength(0);
  });

  it("the shipped verifier rejects everything rather than assuming success", async () => {
    const verdict = await noPaymentVerifier({ userId: "user-1", plan: PAID, transactionRef: "cs_test" });
    expect(verdict.verified).toBe(false);
  });

  it("refuses a payment authorization with no transaction reference", async () => {
    const error = await applyEntitlementChange({
      userId: "user-1",
      plan: PAID,
      authorization: { source: "payment", authorizedBy: "x", reason: "y" },
    }).catch((e: unknown) => e);
    expect((error as EntitlementError).code).toBe("PAYMENT_NOT_VERIFIED");
  });

  it("still grants a zero-price plan, so the fix does not break signup", async () => {
    const result = await applyEntitlementChange({
      userId: "user-1",
      plan: FREE,
      authorization: freeTierAuthorization(),
    });
    expect(result.source).toBe("free_tier");
    expect(result.amountCents).toBe(0);
    expect(writes.subscriptions).toHaveLength(1);
    // A zero-value invoice is not created: there is no money to demand.
    expect(writes.invoices).toHaveLength(0);
    expect(writes.orders[0]!.status).toBe("completed");
  });

  it("refuses an inactive plan even when the id is known", async () => {
    const error = await applyEntitlementChange({
      userId: "user-1",
      plan: { ...FREE, isActive: false },
      authorization: freeTierAuthorization(),
    }).catch((e: unknown) => e);
    expect((error as EntitlementError).code).toBe("PLAN_INACTIVE");
  });
});

describe("SEC-03 administrative grants are attributable and leave a receivable", () => {
  it("grants a paid plan and leaves the invoice pending", async () => {
    const result = await applyEntitlementChange({
      userId: "user-1",
      plan: PAID,
      authorization: adminGrantAuthorization({ id: "admin-1", role: "ADMIN" }, "Manual contract"),
    });
    expect(result.source).toBe("admin_grant");
    expect(result.amountCents).toBe(4900);
    expect(writes.invoices).toHaveLength(1);
    expect(writes.invoices[0]!.status).toBe("pending");
    expect(writes.invoices[0]!.paidAt).toBeNull();
    expect(writes.orders[0]!.paymentMethod).toBe("admin_grant");
    // The grant is attributed in the order notes, not silently applied.
    expect(String(writes.orders[0]!.notes)).toContain("Manual contract");
  });

  it("refuses an anonymous administrative grant", async () => {
    const error = await applyEntitlementChange({
      userId: "user-1",
      plan: PAID,
      authorization: { source: "admin_grant", authorizedBy: "", reason: "no actor" },
    }).catch((e: unknown) => e);
    expect((error as EntitlementError).code).toBe("FORBIDDEN");
  });
});

describe("SEC-03 verified payment grants", () => {
  it("marks the invoice paid only when the provider verifier confirms it", async () => {
    setPaymentVerifier(async () => ({ verified: true }));
    const result = await applyEntitlementChange({
      userId: "user-1",
      plan: PAID,
      authorization: paymentAuthorization("cs_live_abc"),
    });
    expect(result.source).toBe("payment");
    expect(writes.invoices[0]!.status).toBe("paid");
    expect(writes.invoices[0]!.paidAt).toBeInstanceOf(Date);
    expect(writes.orders[0]!.paymentMethod).toBe("provider");
  });

  it("does not consult a client-supplied amount — the plan row decides", async () => {
    setPaymentVerifier(async () => ({ verified: true }));
    const result = await applyEntitlementChange({
      userId: "user-1",
      plan: PAID,
      authorization: paymentAuthorization("cs_live_abc"),
      billingCycle: "yearly",
    });
    expect(result.amountCents).toBe(49000);
    expect(writes.invoices[0]!.amountCents).toBe(49000);
  });

  it("refuses when the verifier rejects the reference", async () => {
    setPaymentVerifier(async () => ({ verified: false, reason: "unknown reference" }));
    const error = await applyEntitlementChange({
      userId: "user-1",
      plan: PAID,
      authorization: paymentAuthorization("forged"),
    }).catch((e: unknown) => e);
    expect((error as EntitlementError).code).toBe("PAYMENT_NOT_VERIFIED");
    expect(writes.invoices).toHaveLength(0);
  });
});

describe("SEC-03 plan limits are enforced, not just displayed", () => {
  it("allows creation under the limit", async () => {
    activeSubscription = { plan: { ...FREE, maxSites: 2 } };
    websiteCount = 1;
    await expect(assertWithinPlanLimit("user-1", "sites")).resolves.toBeUndefined();
  });

  it("refuses creation that would exceed the site limit", async () => {
    activeSubscription = { plan: FREE };
    websiteCount = 1;
    const error = await assertWithinPlanLimit("user-1", "sites").catch((e: unknown) => e);
    expect((error as EntitlementError).code).toBe("PLAN_LIMIT_EXCEEDED");
    expect((error as EntitlementError).status).toBe(403);
  });

  it("refuses a database beyond the plan's database limit", async () => {
    activeSubscription = { plan: { ...FREE, maxDatabases: 1 } };
    databaseCount = 1;
    const error = await assertWithinPlanLimit("user-1", "databases").catch((e: unknown) => e);
    expect((error as EntitlementError).code).toBe("PLAN_LIMIT_EXCEEDED");
  });

  it("refuses a resource type the plan excludes entirely", async () => {
    activeSubscription = { plan: { ...FREE, maxDatabases: 0 } };
    const error = await assertWithinPlanLimit("user-1", "databases").catch((e: unknown) => e);
    expect((error as EntitlementError).code).toBe("PLAN_LIMIT_EXCEEDED");
    expect((error as EntitlementError).customerAction).toContain("Upgrade");
  });

  it("does not invent a limit when the caller has no subscription", async () => {
    activeSubscription = null;
    websiteCount = 999;
    await expect(assertWithinPlanLimit("user-1", "sites")).resolves.toBeUndefined();
  });
});

describe("SEC-03 plan lookup", () => {
  it("keeps the legacy premium -> business alias working", async () => {
    const plan = await findSelectablePlan({ slug: "premium" });
    expect(plan.slug).toBe("business");
  });

  it("does not resurrect an inactive plan by id", async () => {
    planRows = [{ ...PAID, isActive: false }];
    await expect(findSelectablePlan({ id: PAID.id })).rejects.toThrow(/not found or inactive/);
  });
});

describe("SEC-03 no fabrication in the payment adapter", () => {
  it("throws instead of returning a synthetic checkout URL for a paid plan", async () => {
    const { createBillingCheckoutSession } = await import("../src/lib/stripe");
    const error = await createBillingCheckoutSession({
      userId: "user-1",
      userEmail: "one@example.com",
      planId: PAID.id,
      planName: PAID.name,
      priceCents: 4900,
      interval: "monthly",
      successUrl: "https://panel.example.com/billing?ok=1",
      cancelUrl: "https://panel.example.com/pricing",
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PaymentProviderUnavailableError);
  });

  it("still returns a local completion for a genuinely free plan", async () => {
    const { createBillingCheckoutSession } = await import("../src/lib/stripe");
    const result = await createBillingCheckoutSession({
      userId: "user-1",
      userEmail: "one@example.com",
      planId: FREE.id,
      planName: FREE.name,
      priceCents: 0,
      interval: "monthly",
      successUrl: "https://panel.example.com/billing?ok=1",
      cancelUrl: "https://panel.example.com/pricing",
    });
    expect(result.mode).toBe("free_tier");
  });
});

describe("SEC-03 single writer", () => {
  const sources = (() => {
    const out: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) out.push(full);
      }
    };
    walk(path.join(ROOT, "src"));
    return out;
  })();

  it("only src/lib/billing/entitlements.ts creates a Subscription", () => {
    const writers = sources.filter((file) => {
      if (file.endsWith(path.join("lib", "billing", "entitlements.ts"))) return false;
      const source = fs.readFileSync(file, "utf8");
      return /\.subscription\.create\(/.test(source);
    });
    expect(writers).toEqual([]);
  });

  it("no route writes a paid invoice directly", () => {
    const offenders = sources.filter((file) => {
      const source = fs.readFileSync(file, "utf8");
      return /\.invoice\.create\(\s*\{[\s\S]{0,400}?status:\s*["']paid["']/.test(source);
    });
    expect(offenders).toEqual([]);
  });

  it("the operator policy table still marks entitlement commands as admin-only", () => {
    const source = fs.readFileSync(path.join(ROOT, "src/lib/operator/command-policy.ts"), "utf8");
    for (const command of ["activate_plan", "generate_invoice", "mark_invoice_paid"]) {
      const block = source.slice(source.indexOf(`${command}: {`));
      const policy = block.slice(0, block.indexOf("},"));
      expect(policy, command).toContain("requiresAdmin: true");
      expect(policy, command).toContain("changesEntitlement: true");
    }
  });
});
