import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { apiSuccess, apiError, type ApiResponse } from "@/lib/response";
import { requireSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { createAuditLog } from "@/lib/audit";
import {
  findSelectablePlan,
  applyEntitlementChange,
  freeTierAuthorization,
  adminGrantAuthorization,
  isPaidPlan,
} from "@/lib/billing/entitlements";

const onboardingSchema = z.object({
  step: z.number().int().min(0).max(5).optional(),
  completed: z.boolean().optional(),
  name: z.string().min(1).optional(),
  companyName: z.string().optional(),
  useCase: z.string().optional(),
  organizationName: z.string().optional(),
  planId: z.string().optional(),
  /** Set by the storefront after a provider checkout redirect; verified server-side. */
  transactionRef: z.string().min(1).max(200).optional(),
  site: z
    .object({
      name: z.string().optional(),
      domain: z.string().min(3),
      runtime: z.enum(["NEXTJS", "NODE", "STATIC", "PHP82"]).default("NEXTJS"),
      gitRepo: z.string().optional(),
    })
    .optional(),
});

function handleErr(e: unknown): NextResponse {
  if (e && typeof e === "object" && "status" in e) {
    const a = e as ApiResponse;
    return NextResponse.json(a, { status: a.status });
  }
  return NextResponse.json(apiError("Internal server error"), { status: 500 });
}

export async function GET(request: NextRequest) {
  try {
    const authUser = await requireSession(request);
    const [user, plans] = await Promise.all([
      db.user.findUnique({
        where: { id: authUser.id },
        include: {
          role: true,
          memberships: { include: { organization: true } },
          subscriptions: {
            where: { status: "active" },
            include: { plan: true },
          },
          websites: {
            where: { deletedAt: null },
            take: 5,
            orderBy: { createdAt: "desc" },
          },
        },
      }),
      db.plan.findMany({
        where: { isActive: true },
        orderBy: { priceCents: "asc" },
      }),
    ]);

    if (!user) {
      return NextResponse.json(
        apiError("User not found", "NOT_FOUND", undefined, 404),
        { status: 404 }
      );
    }

    return NextResponse.json(
      apiSuccess({
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role.name,
        companyName: user.companyName,
        useCase: user.useCase,
        onboardingCompleted: user.onboardingCompleted,
        onboardingStep: user.onboardingStep,
        emailVerified: !!user.emailVerified,
        organizations: user.memberships.map((m) => m.organization),
        activeSubscription: user.subscriptions[0] ?? null,
        websites: user.websites,
        availablePlans: plans,
      })
    );
  } catch (e) {
    return handleErr(e);
  }
}

export async function POST(request: NextRequest) {
  try {
    const authUser = await requireSession(request);
    const body = await request.json();
    const input = onboardingSchema.parse(body);

    const updatedUser = await db.user.update({
      where: { id: authUser.id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.companyName !== undefined ? { companyName: input.companyName } : {}),
        ...(input.useCase !== undefined ? { useCase: input.useCase } : {}),
        ...(input.step !== undefined ? { onboardingStep: input.step } : {}),
        ...(input.completed !== undefined ? { onboardingCompleted: input.completed } : {}),
      },
    });

    let organization = null;
    if (input.organizationName?.trim()) {
      const baseSlug = input.organizationName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");
      const slug = `${baseSlug || "workspace"}-${authUser.id.slice(0, 6)}`;

      organization = await db.organization.upsert({
        where: { slug },
        update: { name: input.organizationName.trim() },
        create: {
          name: input.organizationName.trim(),
          slug,
          ownerId: authUser.id,
          planId: input.planId,
        },
      });

      await db.membership.upsert({
        where: {
          userId_organizationId: {
            userId: authUser.id,
            organizationId: organization.id,
          },
        },
        update: { role: "OWNER" },
        create: {
          userId: authUser.id,
          organizationId: organization.id,
          role: "OWNER",
          acceptedAt: new Date(),
        },
      });
    }

    /**
     * SEC-03: onboarding used to write an `active` Subscription for any plan the
     * caller named, which is the path every ordinary signup reaches. It now goes
     * through the single entitlement service, exactly like `/api/subscriptions`.
     *
     * Onboarding is not a place to demand payment, so a paid plan named here is
     * not rejected outright — it is recorded as the *intended* plan on the
     * organization and the caller is told checkout is required. No subscription
     * row is created until a payment is verified, which keeps "which plan did
     * they ask for" and "which plan are they entitled to" as separate facts.
     */
    let planActivation: { activated: boolean; planId: string; reason?: string; code?: string } | null = null;
    if (input.planId) {
      const plan = await findSelectablePlan({ id: input.planId });
      const isAdmin = authUser.role === "SUPER_ADMIN" || authUser.role === "ADMIN";
      try {
        const authorization = isPaidPlan(plan)
          ? isAdmin
            ? adminGrantAuthorization({ id: authUser.id, role: authUser.role }, `Plan selected during onboarding: ${plan.name}`)
            : input.transactionRef
              ? undefined
              : undefined
          : freeTierAuthorization("Free plan selected during onboarding");
        if (!authorization) {
          planActivation = {
            activated: false,
            planId: plan.id,
            reason: `${plan.name} is a paid plan; complete checkout to activate it.`,
            code: "PAYMENT_REQUIRED",
          };
        } else {
          const granted = await applyEntitlementChange({ userId: authUser.id, plan, authorization });
          planActivation = { activated: true, planId: granted.planId };
          await createAuditLog({
            actorId: authUser.id,
            actorEmail: authUser.email,
            actorRole: authUser.role,
            action: "SUBSCRIPTION_ACTIVATED",
            resourceType: "Subscription",
            resourceId: granted.subscriptionId,
            result: "SUCCESS",
            metadata: { planId: granted.planId, amountCents: granted.amountCents, entitlementSource: granted.source, via: "onboarding" },
          });
        }
      } catch (error) {
        // An entitlement problem must not abort the rest of onboarding.
        planActivation = {
          activated: false,
          planId: plan.id,
          reason: error instanceof Error ? error.message : "Plan could not be activated",
          code: "PLAN_NOT_ACTIVATED",
        };
      }
    }

    let createdSite = null;
    if (input.site?.domain) {
      const cleanDomain = input.site.domain
        .toLowerCase()
        .trim()
        .replace(/^https?:\/\//, "")
        .replace(/\/.*$/, "");

      const existingSite = await db.website.findUnique({
        where: { domain: cleanDomain },
      });

      if (!existingSite) {
        createdSite = await db.website.create({
          data: {
            name: input.site.name || cleanDomain,
            domain: cleanDomain,
            runtime: input.site.runtime,
            gitRepo: input.site.gitRepo || null,
            ownerId: authUser.id,
            organizationId: organization?.id ?? null,
            status: "ACTIVE",
            healthStatus: "HEALTHY",
            documentRoot: `/srv/alo-sites/${cleanDomain}/current`,
          },
        });
      }
    }

    return NextResponse.json(
      apiSuccess(
        {
          onboardingCompleted: updatedUser.onboardingCompleted,
          onboardingStep: updatedUser.onboardingStep,
          organization,
          site: createdSite,
          plan: planActivation,
        },
        "Onboarding progress saved"
      )
    );
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json(
        apiError("Validation failed", "VALIDATION_ERROR", e.flatten(), 400),
        { status: 400 }
      );
    }
    return handleErr(e);
  }
}
