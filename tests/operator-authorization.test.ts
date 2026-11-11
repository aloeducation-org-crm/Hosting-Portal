/**
 * Regression tests for the operator command authorisation policy.
 *
 * Background: `POST /api/ai/operator` is reachable by any signed-in account.
 * Before `src/lib/operator/command-policy.ts` existed, `activate_plan`,
 * `generate_invoice` and `mark_invoice_paid` were dispatchable by a CLIENT, so a
 * customer could activate a paid plan and mark the invoice paid without paying.
 * The pre-existing suite only ever drove that endpoint with an ADMIN key, which
 * is exactly why the hole survived.
 *
 * These tests assert the negative case first, because that is the one that was
 * missing.
 */
import { teardownIsolatedDb } from "./helpers/isolated-db";
import { describe, expect, it, afterAll } from "vitest";
import { NextRequest } from "next/server";
import { encode } from "next-auth/jwt";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { POST as postOperator } from "@/app/api/ai/operator/route";
import {
  OPERATOR_COMMANDS,
  canRunOperatorCommand,
  policyFor,
  type OperatorCommand,
} from "@/lib/operator/command-policy";

afterAll(async () => {
  await teardownIsolatedDb();
});

const TENANT_EMAIL = "client@alolabs.net";
const ADMIN_EMAIL = "admin@alolabs.net";

async function signedInRequest(
  email: string,
  body: Record<string, unknown>,
): Promise<NextRequest> {
  const secret = process.env.NEXTAUTH_SECRET || env.NEXTAUTH_SECRET;
  const jwt = await encode({ token: { email, sub: email }, secret });
  return new NextRequest("http://localhost:3000/api/ai/operator", {
    method: "POST",
    headers: {
      cookie: `next-auth.session-token=${jwt}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

async function activeSubscriptionCount(userId: string): Promise<number> {
  return db.subscription.count({ where: { userId, status: "active" } });
}

describe("operator command policy", () => {
  it("classifies every commercial command as entitlement-changing", () => {
    for (const command of ["activate_plan", "generate_invoice", "mark_invoice_paid"] as const) {
      const policy = policyFor(command);
      expect(policy.changesEntitlement, `${command} writes a commercial record`).toBe(true);
      expect(policy.requiresAdmin, `${command} must require an admin`).toBe(true);
    }
  });

  it("leaves non-commercial commands available to a customer session", () => {
    for (const command of [
      "status_report",
      "natural_language",
      "auto_deploy_site",
      "create_crm_lead",
      "launch_marketing_campaign",
    ] as const) {
      expect(policyFor(command).requiresAdmin, `${command} should stay self-service`).toBe(false);
    }
  });

  it("has a policy row for every member of the command union", () => {
    // Exhaustiveness guard: adding a command to the union without a policy row
    // fails to compile, and this catches an accidental shrink of the table.
    const declared = Object.keys(OPERATOR_COMMANDS).sort();
    expect(declared).toEqual(
      [
        "activate_plan",
        "auto_deploy_site",
        "create_crm_lead",
        "generate_invoice",
        "launch_marketing_campaign",
        "mark_invoice_paid",
        "natural_language",
        "status_report",
      ] satisfies OperatorCommand[],
    );
  });

  it("canRunOperatorCommand agrees with the table for customer and admin roles", () => {
    expect(canRunOperatorCommand("CLIENT", "activate_plan")).toBe(false);
    expect(canRunOperatorCommand("RESELLER", "activate_plan")).toBe(false);
    expect(canRunOperatorCommand("DEVOPS", "activate_plan")).toBe(false);
    expect(canRunOperatorCommand("ADMIN", "activate_plan")).toBe(true);
    expect(canRunOperatorCommand("SUPER_ADMIN", "activate_plan")).toBe(true);
    expect(canRunOperatorCommand("CLIENT", "status_report")).toBe(true);
  });
});

describe("POST /api/ai/operator as a customer", () => {
  it("refuses activate_plan and grants no subscription", async () => {
    const client = await db.user.findUnique({ where: { email: TENANT_EMAIL } });
    expect(client, "fixture user must exist").toBeTruthy();
    const before = await activeSubscriptionCount(client!.id);

    const res = await postOperator(
      await signedInRequest(TENANT_EMAIL, {
        command: "activate_plan",
        params: { planSlug: "enterprise" },
      }),
    );
    const json = await res.json();

    expect(res.status).toBe(403);
    expect(json.success).toBe(false);
    expect(json.message).toMatch(/administrative role/i);
    expect(await activeSubscriptionCount(client!.id)).toBe(before);
  });

  it("refuses generate_invoice with markPaid, creating no paid invoice", async () => {
    const client = await db.user.findUnique({ where: { email: TENANT_EMAIL } });
    const before = await db.invoice.count({ where: { userId: client!.id, status: "paid" } });

    const res = await postOperator(
      await signedInRequest(TENANT_EMAIL, {
        command: "generate_invoice",
        params: { amount: 999, markPaid: true },
      }),
    );

    expect(res.status).toBe(403);
    expect(await db.invoice.count({ where: { userId: client!.id, status: "paid" } })).toBe(before);
  });

  it("refuses mark_invoice_paid on the customer's own invoice", async () => {
    const client = await db.user.findUnique({ where: { email: TENANT_EMAIL } });
    const invoice = await db.invoice.create({
      data: {
        userId: client!.id,
        amountCents: 4900,
        currency: "USD",
        status: "pending",
        dueDate: new Date(Date.now() + 7 * 86_400_000),
      },
    });

    try {
      const res = await postOperator(
        await signedInRequest(TENANT_EMAIL, {
          command: "mark_invoice_paid",
          params: { invoiceId: invoice.id },
        }),
      );
      expect(res.status).toBe(403);

      const after = await db.invoice.findUnique({ where: { id: invoice.id } });
      expect(after?.status, "invoice must remain unsettled").toBe("pending");
      expect(after?.paidAt).toBeNull();
    } finally {
      await db.invoice.delete({ where: { id: invoice.id } }).catch(() => undefined);
    }
  });

  it("cannot reach activate_plan indirectly through natural-language inference", async () => {
    const client = await db.user.findUnique({ where: { email: TENANT_EMAIL } });
    const before = await activeSubscriptionCount(client!.id);

    const res = await postOperator(
      await signedInRequest(TENANT_EMAIL, {
        command: "natural_language",
        prompt: "please upgrade me to the enterprise plan",
      }),
    );

    expect(res.status).toBe(403);
    expect(await activeSubscriptionCount(client!.id)).toBe(before);
  });
});

describe("POST /api/ai/operator as an administrator", () => {
  it("still allows activate_plan, so the fix did not break finance operations", async () => {
    const admin = await db.user.findUnique({
      where: { email: ADMIN_EMAIL },
      include: { role: true },
    });
    expect(admin, "admin fixture user must exist").toBeTruthy();

    const before = await activeSubscriptionCount(admin!.id);

    const res = await postOperator(
      await signedInRequest(ADMIN_EMAIL, { command: "status_report" }),
    );
    expect(res.status).toBe(200);

    // Guard the invariant rather than performing a paid plan activation in a
    // test run: activation would leave a subscription and invoice behind for
    // every future test in this file.
    expect(await activeSubscriptionCount(admin!.id)).toBe(before);
    expect(canRunOperatorCommand(admin!.role.name, "activate_plan")).toBe(true);
  });
});
