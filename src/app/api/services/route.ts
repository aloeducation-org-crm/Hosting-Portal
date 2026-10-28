import { NextRequest, NextResponse } from "next/server";
import { apiSuccess, apiError, type ApiResponse } from "@/lib/response";
import { requireSession, isAdminRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { createAuditLog } from "@/lib/audit";
import { createServiceSchema, SERVICE_CATEGORY_LABELS } from "@/lib/factory/catalog";

function handleErr(e: unknown): NextResponse {
  if (e && typeof e === "object" && "status" in e) {
    const a = e as ApiResponse;
    return NextResponse.json(a, { status: a.status });
  }
  return NextResponse.json(apiError("Internal server error"), { status: 500 });
}

function zodIssues(e: { issues: Array<{ path: PropertyKey[]; message: string }> }) {
  return e.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
}

/**
 * GET /api/services — Super Admin view of the Service Catalog (admins only).
 * Pricing is never returned because none is stored: `priceMode` is
 * "quotation" for every record by policy.
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await requireSession(request);
    if (!isAdminRole(auth.role)) {
      return NextResponse.json(apiError("Administrators only", "FORBIDDEN", undefined, 403), { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const category = searchParams.get("category");
    const status = searchParams.get("status");
    const search = (searchParams.get("q") ?? "").trim().toLowerCase();

    const where: Record<string, unknown> = {};
    if (category) where.category = category;
    if (status && ["draft", "published", "retired"].includes(status)) where.status = status;

    const services = await db.serviceDefinition.findMany({
      where,
      orderBy: [{ category: "asc" }, { order: "asc" }],
      include: {
        industries: { include: { industry: { select: { slug: true, name: true } } } },
      },
    });

    const rows = services
      .map((svc) => ({
        id: svc.id,
        slug: svc.slug,
        name: svc.name,
        category: svc.category,
        categoryLabel: SERVICE_CATEGORY_LABELS[svc.category as keyof typeof SERVICE_CATEGORY_LABELS] ?? svc.category,
        summary: svc.summary,
        priceMode: svc.priceMode,
        version: svc.version,
        status: svc.status,
        order: svc.order,
        requiredApps: svc.requiredApps,
        deliverableCount: Array.isArray(svc.deliverables) ? svc.deliverables.length : 0,
        industries: svc.industries.map((m) => ({
          slug: m.industry.slug,
          name: m.industry.name,
          relation: m.relation,
        })),
        createdAt: svc.createdAt,
        updatedAt: svc.updatedAt,
      }))
      .filter((svc) => !search || svc.name.toLowerCase().includes(search) || svc.slug.includes(search));

    return NextResponse.json(apiSuccess({ services: rows, categories: SERVICE_CATEGORY_LABELS }));
  } catch (e) {
    return handleErr(e);
  }
}

/** POST /api/services — add a service to the catalog (admins only). */
export async function POST(request: NextRequest) {
  try {
    const auth = await requireSession(request);
    if (!isAdminRole(auth.role)) {
      return NextResponse.json(apiError("Administrators only", "FORBIDDEN", undefined, 403), { status: 403 });
    }

    const body = await request.json().catch(() => null);
    const parsed = createServiceSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        apiError("Invalid service definition", "VALIDATION_ERROR", { issues: zodIssues(parsed.error) }, 400),
        { status: 400 },
      );
    }

    const input = parsed.data;
    const existing = await db.serviceDefinition.findUnique({ where: { slug: input.slug }, select: { id: true } });
    if (existing) {
      return NextResponse.json(
        apiError(`A service with slug "${input.slug}" already exists`, "CONFLICT", undefined, 409),
        { status: 409 },
      );
    }

    // Resolve industry mappings up front so an unknown slug fails the whole
    // request instead of silently creating an unmapped service.
    const industrySlugs = [...new Set(input.industries.map((m) => m.industry))];
    const industryRows =
      industrySlugs.length > 0
        ? await db.industrySystem.findMany({ where: { slug: { in: industrySlugs } }, select: { id: true, slug: true } })
        : [];
    const found = new Map(industryRows.map((r) => [r.slug, r.id]));
    const missing = industrySlugs.filter((s) => !found.has(s));
    if (missing.length > 0) {
      return NextResponse.json(
        apiError(`Unknown industry slug(s): ${missing.join(", ")}`, "VALIDATION_ERROR", { missing }, 400),
        { status: 400 },
      );
    }

    const service = await db.serviceDefinition.create({
      data: {
        slug: input.slug,
        name: input.name,
        category: input.category,
        summary: input.summary,
        description: input.description,
        deliverables: input.deliverables as object[],
        prerequisites: input.prerequisites,
        exclusions: input.exclusions,
        requiredApps: input.requiredApps,
        priceMode: "quotation",
        status: input.status,
        order: input.order,
      },
    });

    for (const map of input.industries) {
      await db.serviceIndustry.create({
        data: { serviceId: service.id, industryId: found.get(map.industry)!, relation: map.relation },
      });
    }

    await createAuditLog({
      actorId: auth.id,
      actorEmail: auth.email,
      actorRole: auth.role,
      action: "SERVICE_CREATE",
      resourceType: "service_definition",
      resourceId: service.id,
      domain: "software-factory",
      result: "success",
      metadata: { slug: service.slug, name: service.name, category: service.category, mappings: input.industries.length },
    });

    return NextResponse.json(apiSuccess({ service }, "Service created"), { status: 201 });
  } catch (e) {
    return handleErr(e);
  }
}
