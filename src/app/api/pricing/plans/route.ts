import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { apiSuccess, apiError, type ApiResponse } from "@/lib/response";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";

const planSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(2, "Plan name is required"),
  slug: z.string().optional(),
  description: z.string().optional(),
  priceCents: z.coerce.number().int().min(0).default(0),
  interval: z.enum(["monthly", "yearly"]).default("monthly"),
  maxSites: z.coerce.number().int().min(1).default(5),
  maxBandwidthGb: z.coerce.number().int().min(1).default(100),
  maxStorageGb: z.coerce.number().int().min(1).default(1),
  maxDatabases: z.coerce.number().int().min(0).default(1),
  maxAiTokens: z.coerce.number().int().min(0).default(10000),
  resellerCommissionPct: z.coerce.number().min(0).max(100).default(0),
  isPopular: z.boolean().optional().default(false),
  features: z.union([z.string(), z.array(z.string())]).default([]),
  isActive: z.boolean().optional().default(true),
});

function handleErr(e: unknown): NextResponse {
  if (e && typeof e === "object" && "status" in e) {
    const a = e as ApiResponse;
    return NextResponse.json(a, { status: a.status });
  }
  return NextResponse.json(apiError("Internal server error"), { status: 500 });
}

export async function GET(request?: NextRequest) {
  try {
    const includeInactive =
      request?.nextUrl?.searchParams?.get("includeInactive") === "true";

    const plans = includeInactive
      ? await db.plan.findMany({ orderBy: { priceCents: "asc" } })
      : await db.plan.findMany({ where: { isActive: true } });

    return NextResponse.json(apiSuccess(plans));
  } catch (e) {
    return handleErr(e);
  }
}

export async function POST(request: NextRequest) {
  try {
    const admin = await requireAdmin(request);
    const body = await request.json();
    const input = planSchema.parse(body);

    const existing = await db.plan.findUnique({ where: { name: input.name } });
    if (existing) {
      return NextResponse.json(
        apiError("Plan with this name already exists", "CONFLICT", undefined, 409),
        { status: 409 }
      );
    }

    const featuresStr = Array.isArray(input.features)
      ? JSON.stringify(input.features)
      : input.features;

    const plan = await db.plan.create({
      data: {
        name: input.name,
        slug:
          input.slug ||
          input.name
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-|-$/g, ""),
        description: input.description,
        priceCents: input.priceCents,
        interval: input.interval,
        maxSites: input.maxSites,
        maxBandwidthGb: input.maxBandwidthGb,
        maxStorageGb: input.maxStorageGb,
        maxDatabases: input.maxDatabases,
        maxAiTokens: input.maxAiTokens,
        resellerCommissionPct: input.resellerCommissionPct,
        isPopular: input.isPopular,
        features: featuresStr,
        isActive: input.isActive,
      },
    });

    await db.auditLog.create({
      data: {
        actorUserId: admin.id,
        actorEmail: admin.email,
        actorRole: admin.role,
        action: "PLAN_CREATE",
        resourceType: "Plan",
        resourceId: plan.id,
        result: "SUCCESS",
      },
    });

    return NextResponse.json(apiSuccess(plan, "Plan created", 201), { status: 201 });
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

export async function PUT(request: NextRequest) {
  try {
    const admin = await requireAdmin(request);
    const body = await request.json();
    const { id, ...rest } = body;

    if (!id) {
      return NextResponse.json(
        apiError("Plan id is required", "VALIDATION_ERROR", undefined, 400),
        { status: 400 }
      );
    }

    const featuresStr =
      rest.features !== undefined
        ? Array.isArray(rest.features)
          ? JSON.stringify(rest.features)
          : String(rest.features)
        : undefined;

    const updated = await db.plan.update({
      where: { id },
      data: {
        ...(rest.name !== undefined ? { name: rest.name } : {}),
        ...(rest.description !== undefined ? { description: rest.description } : {}),
        ...(rest.priceCents !== undefined ? { priceCents: Number(rest.priceCents) } : {}),
        ...(rest.interval !== undefined ? { interval: rest.interval } : {}),
        ...(rest.maxSites !== undefined ? { maxSites: Number(rest.maxSites) } : {}),
        ...(rest.maxBandwidthGb !== undefined ? { maxBandwidthGb: Number(rest.maxBandwidthGb) } : {}),
        ...(rest.maxStorageGb !== undefined ? { maxStorageGb: Number(rest.maxStorageGb) } : {}),
        ...(rest.maxDatabases !== undefined ? { maxDatabases: Number(rest.maxDatabases) } : {}),
        ...(rest.maxAiTokens !== undefined ? { maxAiTokens: Number(rest.maxAiTokens) } : {}),
        ...(rest.resellerCommissionPct !== undefined
          ? { resellerCommissionPct: Number(rest.resellerCommissionPct) }
          : {}),
        ...(rest.isPopular !== undefined ? { isPopular: Boolean(rest.isPopular) } : {}),
        ...(featuresStr !== undefined ? { features: featuresStr } : {}),
        ...(rest.isActive !== undefined ? { isActive: Boolean(rest.isActive) } : {}),
      },
    });

    await db.auditLog.create({
      data: {
        actorUserId: admin.id,
        actorEmail: admin.email,
        actorRole: admin.role,
        action: "PLAN_UPDATE",
        resourceType: "Plan",
        resourceId: updated.id,
        result: "SUCCESS",
      },
    });

    return NextResponse.json(apiSuccess(updated, "Plan updated"));
  } catch (e) {
    return handleErr(e);
  }
}
