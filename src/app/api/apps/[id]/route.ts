import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { apiSuccess, apiError, type ApiResponse } from "@/lib/response";
import { requireSession, isAdminRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { createAuditLog } from "@/lib/audit";
import { updateAppSchema, canViewCompany } from "@/lib/app-center";

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

/** Accept either the UUID or the slug — slugs make the API curl-friendly. */
async function findDefinition(idOrSlug: string) {
  const byId = await db.appDefinition.findUnique({ where: { id: idOrSlug } }).catch(() => null);
  if (byId) return byId;
  return db.appDefinition.findUnique({ where: { slug: idOrSlug } });
}

/**
 * GET /api/apps/[id] — one definition plus its installations.
 * Platform admins see every company it is installed in (the reuse view);
 * everyone else only sees installations for companies they belong to.
 */
export async function GET(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireSession(request);
    const { id } = await ctx.params;

    const app = await findDefinition(id);
    if (!app) {
      return NextResponse.json(apiError("App not found", "NOT_FOUND", undefined, 404), { status: 404 });
    }

    const installations = await db.companyApp.findMany({
      where: { appId: app.id },
      include: { organization: { select: { id: true, name: true, slug: true } } },
      orderBy: { installedAt: "asc" },
    });

    const visible = isAdminRole(auth.role)
      ? installations
      : (
          await Promise.all(
            installations.map(async (row) =>
              (await canViewCompany(db, auth, row.organizationId)) ? row : null,
            ),
          )
        ).filter((row): row is NonNullable<typeof row> => row !== null);

    return NextResponse.json(apiSuccess({ app, installations: visible }));
  } catch (e) {
    return handleErr(e);
  }
}

/**
 * PATCH /api/apps/[id] — update catalog metadata (platform admins only).
 * The slug is immutable (it is the identity ensureBuiltinApps keys on) and
 * isSystem/createdBy are not client-writable.
 */
export async function PATCH(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireSession(request);
    if (!isAdminRole(auth.role)) {
      return NextResponse.json(
        apiError("Only administrators can update apps", "FORBIDDEN", undefined, 403),
        { status: 403 },
      );
    }

    const { id } = await ctx.params;
    const app = await findDefinition(id);
    if (!app) {
      return NextResponse.json(apiError("App not found", "NOT_FOUND", undefined, 404), { status: 404 });
    }

    const body = await request.json().catch(() => null);
    const parsed = updateAppSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        apiError("Invalid app update", "VALIDATION_ERROR", { issues: zodIssues(parsed.error) }, 400),
        { status: 400 },
      );
    }

    const updated = await db.appDefinition.update({
      where: { id: app.id },
      data: {
        name: parsed.data.name,
        summary: parsed.data.summary,
        description: parsed.data.description,
        category: parsed.data.category,
        icon: parsed.data.icon,
        accentColor: parsed.data.accentColor,
        version: parsed.data.version,
        status: parsed.data.status,
        route: parsed.data.route,
        // Prisma Json columns take Prisma.JsonNull for an explicit clear —
        // plain null is rejected; undefined means "leave unchanged".
        configSchema:
          parsed.data.configSchema === null ? Prisma.JsonNull : parsed.data.configSchema,
        defaultSettings:
          parsed.data.defaultSettings === null ? Prisma.JsonNull : parsed.data.defaultSettings,
      },
    });

    await createAuditLog({
      actorId: auth.id,
      actorEmail: auth.email,
      actorRole: auth.role,
      action: "APP_UPDATE",
      resourceType: "app_definition",
      resourceId: app.id,
      domain: "app-center",
      result: "success",
      metadata: { slug: app.slug, changed: Object.keys(parsed.data) },
    });

    return NextResponse.json(apiSuccess({ app: updated }, "App updated"));
  } catch (e) {
    return handleErr(e);
  }
}

/**
 * DELETE /api/apps/[id] — remove a custom app (platform admins only).
 * Built-ins are permanent (403) and an app that companies still have
 * installed is refused (409) so nobody's tenant state is cascaded away
 * without an explicit uninstall first.
 */
export async function DELETE(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireSession(request);
    if (!isAdminRole(auth.role)) {
      return NextResponse.json(
        apiError("Only administrators can delete apps", "FORBIDDEN", undefined, 403),
        { status: 403 },
      );
    }

    const { id } = await ctx.params;
    const app = await findDefinition(id);
    if (!app) {
      return NextResponse.json(apiError("App not found", "NOT_FOUND", undefined, 404), { status: 404 });
    }

    if (app.isSystem) {
      return NextResponse.json(
        apiError(
          "Built-in apps cannot be deleted — hide them with status: hidden instead",
          "FORBIDDEN",
          undefined,
          403,
        ),
        { status: 403 },
      );
    }

    const installs = await db.companyApp.count({ where: { appId: app.id } });
    if (installs > 0) {
      return NextResponse.json(
        apiError(
          `App is still installed in ${installs} compan${installs === 1 ? "y" : "ies"} — uninstall it there first`,
          "CONFLICT",
          { installations: installs },
          409,
        ),
        { status: 409 },
      );
    }

    await db.appDefinition.delete({ where: { id: app.id } });

    await createAuditLog({
      actorId: auth.id,
      actorEmail: auth.email,
      actorRole: auth.role,
      action: "APP_DELETE",
      resourceType: "app_definition",
      resourceId: app.id,
      domain: "app-center",
      result: "success",
      metadata: { slug: app.slug, name: app.name },
    });

    return NextResponse.json(apiSuccess({ deleted: true }, "App deleted"));
  } catch (e) {
    return handleErr(e);
  }
}
