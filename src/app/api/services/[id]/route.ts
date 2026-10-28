import { NextRequest, NextResponse } from "next/server";
import { apiSuccess, apiError, type ApiResponse } from "@/lib/response";
import { requireSession, isAdminRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { createAuditLog } from "@/lib/audit";
import { updateServiceSchema, MAPPING_RELATIONS } from "@/lib/factory/catalog";
import { z } from "zod";

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

const mappingListSchema = z.array(
  z.object({ industry: z.string().min(2).max(64), relation: z.enum(MAPPING_RELATIONS) })
);

async function findService(idOrSlug: string) {
  return db.serviceDefinition.findFirst({
    where: { OR: [{ id: idOrSlug }, { slug: idOrSlug }] },
    include: { industries: { include: { industry: { select: { slug: true, name: true } } } } },
  });
}

/** GET /api/services/[id] — one service with its industry mappings (admins only). */
export async function GET(request: NextRequest, { params }: Params) {
  try {
    const auth = await requireSession(request);
    if (!isAdminRole(auth.role)) {
      return NextResponse.json(apiError("Administrators only", "FORBIDDEN", undefined, 403), { status: 403 });
    }
    const { id } = await params;
    const service = await findService(id);
    if (!service) {
      return NextResponse.json(apiError("Service not found", "NOT_FOUND", undefined, 404), { status: 404 });
    }
    return NextResponse.json(apiSuccess({ service }));
  } catch (e) {
    return handleErr(e);
  }
}

/**
 * PATCH /api/services/[id] — edit fields and optionally REPLACE the industry
 * mapping set (pass `industries: [...]`). Approval/pricing rules are intact:
 * priceMode cannot be changed to anything that implies stored prices.
 */
export async function PATCH(request: NextRequest, { params }: Params) {
  try {
    const auth = await requireSession(request);
    if (!isAdminRole(auth.role)) {
      return NextResponse.json(apiError("Administrators only", "FORBIDDEN", undefined, 403), { status: 403 });
    }
    const { id } = await params;
    const existing = await findService(id);
    if (!existing) {
      return NextResponse.json(apiError("Service not found", "NOT_FOUND", undefined, 404), { status: 404 });
    }

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const parsed = updateServiceSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        apiError("Invalid service update", "VALIDATION_ERROR", { issues: zodIssues(parsed.error) }, 400),
        { status: 400 },
      );
    }

    const data = parsed.data;
    const wantsMappingReplace = body && Object.prototype.hasOwnProperty.call(body, "industries");

    let mappingCount: number | undefined;
    if (wantsMappingReplace) {
      const maps = mappingListSchema.safeParse(body!.industries);
      if (!maps.success) {
        return NextResponse.json(
          apiError("Invalid industries mapping", "VALIDATION_ERROR", { issues: zodIssues(maps.error) }, 400),
          { status: 400 },
        );
      }
      const slugs = [...new Set(maps.data.map((m) => m.industry))];
      const rows = slugs.length
        ? await db.industrySystem.findMany({ where: { slug: { in: slugs } }, select: { id: true, slug: true } })
        : [];
      const found = new Map(rows.map((r) => [r.slug, r.id]));
      const missing = slugs.filter((s) => !found.has(s));
      if (missing.length > 0) {
        return NextResponse.json(
          apiError(`Unknown industry slug(s): ${missing.join(", ")}`, "VALIDATION_ERROR", { missing }, 400),
          { status: 400 },
        );
      }
      await db.serviceIndustry.deleteMany({ where: { serviceId: existing.id } });
      for (const map of maps.data) {
        await db.serviceIndustry.create({
          data: { serviceId: existing.id, industryId: found.get(map.industry)!, relation: map.relation },
        });
      }
      mappingCount = maps.data.length;
    }

    const service = await db.serviceDefinition.update({
      where: { id: existing.id },
      data: {
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.category !== undefined ? { category: data.category } : {}),
        ...(data.summary !== undefined ? { summary: data.summary } : {}),
        ...(data.description !== undefined ? { description: data.description } : {}),
        ...(data.deliverables !== undefined ? { deliverables: data.deliverables as object[] } : {}),
        ...(data.prerequisites !== undefined ? { prerequisites: data.prerequisites } : {}),
        ...(data.exclusions !== undefined ? { exclusions: data.exclusions } : {}),
        ...(data.requiredApps !== undefined ? { requiredApps: data.requiredApps } : {}),
        ...(data.status !== undefined ? { status: data.status } : {}),
        ...(data.order !== undefined ? { order: data.order } : {}),
      },
      include: { industries: true },
    });

    await createAuditLog({
      actorId: auth.id,
      actorEmail: auth.email,
      actorRole: auth.role,
      action: "SERVICE_UPDATE",
      resourceType: "service_definition",
      resourceId: service.id,
      domain: "software-factory",
      result: "success",
      metadata: {
        slug: service.slug,
        changed: Object.keys(data),
        ...(mappingCount !== undefined ? { mappingsReplaced: mappingCount } : {}),
      },
    });

    return NextResponse.json(
      apiSuccess({ service, mappingCount: mappingCount ?? service.industries.length }, "Service updated"),
    );
  } catch (e) {
    return handleErr(e);
  }
}

/**
 * DELETE /api/services/[id] — remove an unmapped catalog row (admins only).
 * Refuses (409) while industry mappings exist; retire via PATCH
 * status=retired for the reversible path.
 */
export async function DELETE(request: NextRequest, { params }: Params) {
  try {
    const auth = await requireSession(request);
    if (!isAdminRole(auth.role)) {
      return NextResponse.json(apiError("Administrators only", "FORBIDDEN", undefined, 403), { status: 403 });
    }
    const { id } = await params;
    const existing = await findService(id);
    if (!existing) {
      return NextResponse.json(apiError("Service not found", "NOT_FOUND", undefined, 404), { status: 404 });
    }

    const mappings = existing.industries.length;
    if (mappings > 0) {
      return NextResponse.json(
        apiError(
          `Retire this service instead — ${mappings} industry mapping(s) still reference it`,
          "CONFLICT",
          { mappings },
          409,
        ),
        { status: 409 },
      );
    }

    await db.serviceDefinition.delete({ where: { id: existing.id } });

    await createAuditLog({
      actorId: auth.id,
      actorEmail: auth.email,
      actorRole: auth.role,
      action: "SERVICE_DELETE",
      resourceType: "service_definition",
      resourceId: existing.id,
      domain: "software-factory",
      result: "success",
      metadata: { slug: existing.slug },
    });

    return NextResponse.json(apiSuccess({ deleted: existing.slug }, "Service deleted"));
  } catch (e) {
    return handleErr(e);
  }
}
