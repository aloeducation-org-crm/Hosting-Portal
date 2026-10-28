import { NextRequest, NextResponse } from "next/server";
import { apiSuccess, apiError, type ApiResponse } from "@/lib/response";
import { requireSession, isAdminRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { createAuditLog } from "@/lib/audit";
import { createIndustrySchema } from "@/lib/factory/catalog";

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
 * GET /api/industries — Super Admin view of the Industry System Registry.
 * Public pages read the registry server-side; this API is admin-only and
 * includes drafts plus service-mapping counts.
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await requireSession(request);
    if (!isAdminRole(auth.role)) {
      return NextResponse.json(apiError("Administrators only", "FORBIDDEN", undefined, 403), { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status");
    const search = (searchParams.get("q") ?? "").trim().toLowerCase();

    const where: Record<string, unknown> = {};
    if (status && ["draft", "published", "hidden"].includes(status)) where.status = status;

    const industries = await db.industrySystem.findMany({
      where,
      orderBy: { order: "asc" },
      include: { _count: { select: { services: true } } },
    });

    const rows = industries
      .map((ind) => ({
        id: ind.id,
        slug: ind.slug,
        name: ind.name,
        tagline: ind.tagline,
        summary: ind.summary,
        icon: ind.icon,
        accentFrom: ind.accentFrom,
        accentTo: ind.accentTo,
        order: ind.order,
        status: ind.status,
        moduleCount: Array.isArray(ind.modules) ? ind.modules.length : 0,
        featureGroups: Array.isArray(ind.features) ? ind.features.length : 0,
        serviceMappings: ind._count.services,
        createdAt: ind.createdAt,
        updatedAt: ind.updatedAt,
      }))
      .filter((ind) => !search || ind.name.toLowerCase().includes(search) || ind.slug.includes(search));

    return NextResponse.json(apiSuccess({ industries: rows }));
  } catch (e) {
    return handleErr(e);
  }
}

/** POST /api/industries — register a new industry family (admins only). */
export async function POST(request: NextRequest) {
  try {
    const auth = await requireSession(request);
    if (!isAdminRole(auth.role)) {
      return NextResponse.json(apiError("Administrators only", "FORBIDDEN", undefined, 403), { status: 403 });
    }

    const body = await request.json().catch(() => null);
    const parsed = createIndustrySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        apiError("Invalid industry definition", "VALIDATION_ERROR", { issues: zodIssues(parsed.error) }, 400),
        { status: 400 },
      );
    }

    const existing = await db.industrySystem.findUnique({ where: { slug: parsed.data.slug }, select: { id: true } });
    if (existing) {
      return NextResponse.json(
        apiError(`An industry with slug "${parsed.data.slug}" already exists`, "CONFLICT", undefined, 409),
        { status: 409 },
      );
    }

    const industry = await db.industrySystem.create({
      data: {
        slug: parsed.data.slug,
        name: parsed.data.name,
        tagline: parsed.data.tagline,
        summary: parsed.data.summary,
        icon: parsed.data.icon,
        accentFrom: parsed.data.accentFrom,
        accentTo: parsed.data.accentTo,
        order: parsed.data.order,
        status: parsed.data.status,
        modules: parsed.data.modules as object[],
        features: parsed.data.features as object[],
        challenges: parsed.data.challenges as object[],
        workflow: parsed.data.workflow,
        faqs: parsed.data.faqs as object[],
        reports: parsed.data.reports,
      },
    });

    await createAuditLog({
      actorId: auth.id,
      actorEmail: auth.email,
      actorRole: auth.role,
      action: "INDUSTRY_CREATE",
      resourceType: "industry_system",
      resourceId: industry.id,
      domain: "software-factory",
      result: "success",
      metadata: { slug: industry.slug, name: industry.name },
    });

    return NextResponse.json(apiSuccess({ industry }, "Industry registered"), { status: 201 });
  } catch (e) {
    return handleErr(e);
  }
}
