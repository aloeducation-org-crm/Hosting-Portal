import { NextRequest, NextResponse } from "next/server";
import { apiSuccess, apiError, type ApiResponse } from "@/lib/response";
import { requireSession, isAdminRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { createAuditLog } from "@/lib/audit";
import {
  APP_CATEGORIES,
  createAppSchema,
  effectiveBranding,
  effectiveSettings,
  ensureBuiltinApps,
  isValidSlug,
  slugify,
  canViewCompany,
} from "@/lib/app-center";

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
 * GET /api/apps — the App Center catalog.
 *
 * Every app is defined once here and reused by all companies. With
 * `?organizationId=` the response carries each company's installation row
 * plus the effective branding/settings a UI should render (catalog defaults
 * overlaid with that company's overrides). Without it, the bare catalog is
 * returned (platform admins additionally see reuse counts).
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await requireSession(request);
    const { searchParams } = new URL(request.url);
    const organizationId = searchParams.get("organizationId");
    const category = searchParams.get("category");
    const search = (searchParams.get("q") ?? "").trim().toLowerCase();

    // Production never runs the seed — self-seed the built-ins on read.
    await ensureBuiltinApps(db);

    if (organizationId && !(await canViewCompany(db, auth, organizationId))) {
      return NextResponse.json(
        apiError("You do not have access to that company", "FORBIDDEN", undefined, 403),
        { status: 403 },
      );
    }

    const where: Record<string, unknown> = {};
    if (!isAdminRole(auth.role)) {
      // Hidden apps are a platform-admin concept; tenants only see active ones.
      where.status = "active";
    }
    if (category && APP_CATEGORIES.some((c) => c.id === category)) {
      where.category = category;
    }

    const definitions = await db.appDefinition.findMany({
      where,
      orderBy: [{ category: "asc" }, { name: "asc" }],
      include: {
        installations: organizationId
          ? { where: { organizationId }, take: 1 }
          : { take: 0 },
        _count: { select: { installations: true } },
      },
    });

    const apps = definitions
      .map((app) => {
        const installation = app.installations[0] ?? null;
        const canSeeReuseCounts = isAdminRole(auth.role);
        return {
          id: app.id,
          slug: app.slug,
          name: app.name,
          summary: app.summary,
          description: app.description,
          category: app.category,
          icon: app.icon,
          accentColor: app.accentColor,
          version: app.version,
          status: app.status,
          isSystem: app.isSystem,
          route: app.route,
          configSchema: app.configSchema,
          defaultSettings: app.defaultSettings,
          createdAt: app.createdAt,
          updatedAt: app.updatedAt,
          installation,
          branding: effectiveBranding(app, installation),
          settings: organizationId ? effectiveSettings(app, installation) : undefined,
          installedCompanies: canSeeReuseCounts ? app._count.installations : undefined,
        };
      })
      .filter((app) => {
        if (!search) return true;
        return (
          app.name.toLowerCase().includes(search) ||
          (app.summary ?? "").toLowerCase().includes(search) ||
          app.slug.includes(search)
        );
      });

    return NextResponse.json(apiSuccess({ apps, categories: APP_CATEGORIES }));
  } catch (e) {
    return handleErr(e);
  }
}

/**
 * POST /api/apps — create a new catalog definition (platform admins only).
 * Built-ins cannot be created through this endpoint (isSystem stays false);
 * slug conflicts are a 409 so the admin gets a clear signal.
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await requireSession(request);

    if (!isAdminRole(auth.role)) {
      return NextResponse.json(
        apiError("Only administrators can create apps", "FORBIDDEN", undefined, 403),
        { status: 403 },
      );
    }

    const body = await request.json().catch(() => null);
    const parsed = createAppSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        apiError("Invalid app definition", "VALIDATION_ERROR", { issues: zodIssues(parsed.error) }, 400),
        { status: 400 },
      );
    }

    const input = parsed.data;
    const slug = input.slug ?? slugify(input.name);
    if (!isValidSlug(slug)) {
      return NextResponse.json(
        apiError(
          "slug must be lowercase words separated by hyphens (e.g. project-portal)",
          "VALIDATION_ERROR",
          undefined,
          400,
        ),
        { status: 400 },
      );
    }

    const existing = await db.appDefinition.findUnique({ where: { slug }, select: { id: true } });
    if (existing) {
      return NextResponse.json(
        apiError(`An app with slug "${slug}" already exists`, "CONFLICT", undefined, 409),
        { status: 409 },
      );
    }

    const app = await db.appDefinition.create({
      data: {
        slug,
        name: input.name,
        summary: input.summary,
        description: input.description,
        category: input.category,
        icon: input.icon ?? "LayoutGrid",
        accentColor: input.accentColor ?? "#E8501A",
        version: input.version ?? "1.0.0",
        status: input.status ?? "active",
        route: input.route ?? null,
        configSchema: input.configSchema ?? undefined,
        defaultSettings: input.defaultSettings ?? undefined,
        isSystem: false,
        createdBy: auth.id,
      },
    });

    await createAuditLog({
      actorId: auth.id,
      actorEmail: auth.email,
      actorRole: auth.role,
      action: "APP_CREATE",
      resourceType: "app_definition",
      resourceId: app.id,
      domain: "app-center",
      result: "success",
      metadata: { slug: app.slug, name: app.name, category: app.category },
    });

    return NextResponse.json(apiSuccess({ app }, "App created"), { status: 201 });
  } catch (e) {
    return handleErr(e);
  }
}
