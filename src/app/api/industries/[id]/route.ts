import { NextRequest, NextResponse } from "next/server";
import { apiSuccess, apiError, type ApiResponse } from "@/lib/response";
import { requireSession, isAdminRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { createAuditLog } from "@/lib/audit";
import { updateIndustrySchema } from "@/lib/factory/catalog";

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

type Params = { params: Promise<{ id: string }> };

async function findIndustry(idOrSlug: string) {
  return db.industrySystem.findFirst({
    where: { OR: [{ id: idOrSlug }, { slug: idOrSlug }] },
    include: { _count: { select: { services: true } } },
  });
}

/** GET /api/industries/[id] — full registry record (admins only). */
export async function GET(request: NextRequest, { params }: Params) {
  try {
    const auth = await requireSession(request);
    if (!isAdminRole(auth.role)) {
      return NextResponse.json(apiError("Administrators only", "FORBIDDEN", undefined, 403), { status: 403 });
    }
    const { id } = await params;
    const industry = await findIndustry(id);
    if (!industry) {
      return NextResponse.json(apiError("Industry not found", "NOT_FOUND", undefined, 404), { status: 404 });
    }
    return NextResponse.json(apiSuccess({ industry }));
  } catch (e) {
    return handleErr(e);
  }
}

/** PATCH /api/industries/[id] — edit content/status (admins only). */
export async function PATCH(request: NextRequest, { params }: Params) {
  try {
    const auth = await requireSession(request);
    if (!isAdminRole(auth.role)) {
      return NextResponse.json(apiError("Administrators only", "FORBIDDEN", undefined, 403), { status: 403 });
    }
    const { id } = await params;
    const existing = await findIndustry(id);
    if (!existing) {
      return NextResponse.json(apiError("Industry not found", "NOT_FOUND", undefined, 404), { status: 404 });
    }

    const body = await request.json().catch(() => null);
    const parsed = updateIndustrySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        apiError("Invalid industry update", "VALIDATION_ERROR", { issues: zodIssues(parsed.error) }, 400),
        { status: 400 },
      );
    }

    const data = parsed.data;
    const industry = await db.industrySystem.update({
      where: { id: existing.id },
      data: {
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.tagline !== undefined ? { tagline: data.tagline } : {}),
        ...(data.summary !== undefined ? { summary: data.summary } : {}),
        ...(data.icon !== undefined ? { icon: data.icon } : {}),
        ...(data.accentFrom !== undefined ? { accentFrom: data.accentFrom } : {}),
        ...(data.accentTo !== undefined ? { accentTo: data.accentTo } : {}),
        ...(data.order !== undefined ? { order: data.order } : {}),
        ...(data.status !== undefined ? { status: data.status } : {}),
        ...(data.modules !== undefined ? { modules: data.modules as object[] } : {}),
        ...(data.features !== undefined ? { features: data.features as object[] } : {}),
        ...(data.challenges !== undefined ? { challenges: data.challenges as object[] } : {}),
        ...(data.workflow !== undefined ? { workflow: data.workflow } : {}),
        ...(data.faqs !== undefined ? { faqs: data.faqs as object[] } : {}),
        ...(data.reports !== undefined ? { reports: data.reports } : {}),
      },
    });

    await createAuditLog({
      actorId: auth.id,
      actorEmail: auth.email,
      actorRole: auth.role,
      action: "INDUSTRY_UPDATE",
      resourceType: "industry_system",
      resourceId: industry.id,
      domain: "software-factory",
      result: "success",
      metadata: { slug: industry.slug, changed: Object.keys(data) },
    });

    return NextResponse.json(apiSuccess({ industry }, "Industry updated"));
  } catch (e) {
    return handleErr(e);
  }
}

/**
 * DELETE /api/industries/[id] — remove an unmapped industry record.
 * Refuses (409) while service mappings exist so the §9 map stays truthful;
 * unpublish via PATCH status=hidden/retired for reversible changes.
 */
export async function DELETE(request: NextRequest, { params }: Params) {
  try {
    const auth = await requireSession(request);
    if (!isAdminRole(auth.role)) {
      return NextResponse.json(apiError("Administrators only", "FORBIDDEN", undefined, 403), { status: 403 });
    }
    const { id } = await params;
    const existing = await findIndustry(id);
    if (!existing) {
      return NextResponse.json(apiError("Industry not found", "NOT_FOUND", undefined, 404), { status: 404 });
    }

    const mappings = existing._count.services;
    if (mappings > 0) {
      return NextResponse.json(
        apiError(
          `Unpublish this industry instead — ${mappings} service mapping(s) still reference it`,
          "CONFLICT",
          { mappings },
          409,
        ),
        { status: 409 },
      );
    }

    await db.industrySystem.delete({ where: { id: existing.id } });

    await createAuditLog({
      actorId: auth.id,
      actorEmail: auth.email,
      actorRole: auth.role,
      action: "INDUSTRY_DELETE",
      resourceType: "industry_system",
      resourceId: existing.id,
      domain: "software-factory",
      result: "success",
      metadata: { slug: existing.slug },
    });

    return NextResponse.json(apiSuccess(undefined, "Industry deleted"));
  } catch (e) {
    return handleErr(e);
  }
}
