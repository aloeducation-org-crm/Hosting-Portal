import { NextRequest, NextResponse } from "next/server";
import { apiSuccess, apiError, type ApiResponse } from "@/lib/response";
import { requireSession, isAdminRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { createAuditLog } from "@/lib/audit";
import {
  brandOverridesSchema,
  configureInstallSchema,
  installSchema,
  validateSettings,
  canManageCompany,
  mergeOverrides,
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

async function findDefinition(idOrSlug: string) {
  const byId = await db.appDefinition.findUnique({ where: { id: idOrSlug } }).catch(() => null);
  if (byId) return byId;
  return db.appDefinition.findUnique({ where: { slug: idOrSlug } });
}

/**
 * POST /api/apps/[id]/install — install (or re-configure) an app for a company.
 *
 * The catalog definition is untouched; this only creates/updates this
 * company's `company_apps` row, so the same app is reused across tenants with
 * fully independent branding and settings. Upsert on (appId, organizationId)
 * makes retries and re-installs safe. Authorization: platform admin, company
 * owner, or OWNER/ADMIN member of that company.
 */
export async function POST(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireSession(request);
    const { id } = await ctx.params;

    const app = await findDefinition(id);
    if (!app) {
      return NextResponse.json(apiError("App not found", "NOT_FOUND", undefined, 404), { status: 404 });
    }

    const body = await request.json().catch(() => null);
    const parsed = installSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        apiError("Invalid install request", "VALIDATION_ERROR", { issues: zodIssues(parsed.error) }, 400),
        { status: 400 },
      );
    }
    const { organizationId, branding, settings, enabled } = parsed.data;

    if (!(await canManageCompany(db, auth, organizationId))) {
      return NextResponse.json(
        apiError("You cannot install apps for that company", "FORBIDDEN", undefined, 403),
        { status: 403 },
      );
    }

    const org = await db.organization.findUnique({
      where: { id: organizationId },
      select: { id: true },
    });
    if (!org) {
      return NextResponse.json(apiError("Company not found", "NOT_FOUND", undefined, 404), { status: 404 });
    }

    if (branding) {
      const b = brandOverridesSchema.safeParse(branding);
      if (!b.success) {
        return NextResponse.json(
          apiError("Invalid branding", "VALIDATION_ERROR", { issues: zodIssues(b.error) }, 400),
          { status: 400 },
        );
      }
    }

    let validatedSettings: Record<string, string | number | boolean> | undefined;
    if (settings !== undefined) {
      const check = validateSettings(app.configSchema, settings);
      if (!check.ok) {
        return NextResponse.json(
          apiError("Invalid settings", "VALIDATION_ERROR", { settings: check.errors }, 400),
          { status: 400 },
        );
      }
      validatedSettings = check.value;
    }

    const existing = await db.companyApp.findUnique({
      where: { appId_organizationId: { appId: app.id, organizationId } },
    });

    const data = {
      branding: mergeOverrides(existing?.branding, branding),
      settings: mergeOverrides(existing?.settings, validatedSettings),
      ...(enabled !== undefined ? { enabled } : {}),
    };

    const installation = existing
      ? await db.companyApp.update({
          where: { id: existing.id },
          data: { ...data, installedBy: auth.id },
        })
      : await db.companyApp.create({
          data: {
            appId: app.id,
            organizationId,
            installedBy: auth.id,
            enabled: enabled ?? true,
            ...(data.branding !== undefined ? { branding: data.branding } : {}),
            ...(data.settings !== undefined ? { settings: data.settings } : {}),
          },
        });

    await createAuditLog({
      actorId: auth.id,
      actorEmail: auth.email,
      actorRole: auth.role,
      action: existing ? "APP_CONFIGURE" : "APP_INSTALL",
      resourceType: "company_app",
      resourceId: installation.id,
      domain: "app-center",
      result: "success",
      metadata: { appSlug: app.slug, organizationId, enabled: installation.enabled },
    });

    return NextResponse.json(
      apiSuccess({ installation }, existing ? "App configuration saved" : "App installed"),
      { status: existing ? 200 : 201 },
    );
  } catch (e) {
    return handleErr(e);
  }
}

/**
 * PATCH /api/apps/[id]/install?organizationId=… — reconfigure
 * branding/settings/enabled for one company (404 when not installed).
 * Same authorization as install.
 */
export async function PATCH(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireSession(request);
    const { id } = await ctx.params;

    const app = await findDefinition(id);
    if (!app) {
      return NextResponse.json(apiError("App not found", "NOT_FOUND", undefined, 404), { status: 404 });
    }

    const organizationId = new URL(request.url).searchParams.get("organizationId");
    if (!organizationId) {
      return NextResponse.json(
        apiError("organizationId query parameter is required", "VALIDATION_ERROR", undefined, 400),
        { status: 400 },
      );
    }

    const body = await request.json().catch(() => null);
    const parsed = configureInstallSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        apiError("Invalid configuration", "VALIDATION_ERROR", { issues: zodIssues(parsed.error) }, 400),
        { status: 400 },
      );
    }
    const { branding, settings, enabled } = parsed.data;

    if (!(await canManageCompany(db, auth, organizationId))) {
      return NextResponse.json(
        apiError("You cannot configure apps for that company", "FORBIDDEN", undefined, 403),
        { status: 403 },
      );
    }

    const existing = await db.companyApp.findUnique({
      where: { appId_organizationId: { appId: app.id, organizationId } },
    });
    if (!existing) {
      return NextResponse.json(
        apiError("App is not installed for that company", "NOT_FOUND", undefined, 404),
        { status: 404 },
      );
    }

    if (branding) {
      const b = brandOverridesSchema.safeParse(branding);
      if (!b.success) {
        return NextResponse.json(
          apiError("Invalid branding", "VALIDATION_ERROR", { issues: zodIssues(b.error) }, 400),
          { status: 400 },
        );
      }
    }

    let validatedSettings: Record<string, string | number | boolean> | undefined;
    if (settings !== undefined) {
      const check = validateSettings(app.configSchema, settings);
      if (!check.ok) {
        return NextResponse.json(
          apiError("Invalid settings", "VALIDATION_ERROR", { settings: check.errors }, 400),
          { status: 400 },
        );
      }
      validatedSettings = check.value;
    }

    const installation = await db.companyApp.update({
      where: { id: existing.id },
      data: {
        branding: mergeOverrides(existing.branding, branding),
        settings: mergeOverrides(existing.settings, validatedSettings),
        ...(enabled !== undefined ? { enabled } : {}),
      },
    });

    await createAuditLog({
      actorId: auth.id,
      actorEmail: auth.email,
      actorRole: auth.role,
      action: "APP_CONFIGURE",
      resourceType: "company_app",
      resourceId: installation.id,
      domain: "app-center",
      result: "success",
      metadata: { appSlug: app.slug, organizationId, changed: Object.keys(parsed.data) },
    });

    return NextResponse.json(apiSuccess({ installation }, "App configuration saved"));
  } catch (e) {
    return handleErr(e);
  }
}

/**
 * DELETE /api/apps/[id]/install?organizationId=… — uninstall for one company.
 * Only that company's row is removed; the shared definition stays (other
 * companies keep running the app) — that is the reuse invariant.
 */
export async function DELETE(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireSession(request);
    const { id } = await ctx.params;

    const app = await findDefinition(id);
    if (!app) {
      return NextResponse.json(apiError("App not found", "NOT_FOUND", undefined, 404), { status: 404 });
    }

    const organizationId = new URL(request.url).searchParams.get("organizationId");
    if (!organizationId) {
      return NextResponse.json(
        apiError("organizationId query parameter is required", "VALIDATION_ERROR", undefined, 400),
        { status: 400 },
      );
    }

    if (!(await canManageCompany(db, auth, organizationId))) {
      return NextResponse.json(
        apiError("You cannot uninstall apps for that company", "FORBIDDEN", undefined, 403),
        { status: 403 },
      );
    }

    const existing = await db.companyApp.findUnique({
      where: { appId_organizationId: { appId: app.id, organizationId } },
    });
    if (!existing) {
      return NextResponse.json(
        apiError("App is not installed for that company", "NOT_FOUND", undefined, 404),
        { status: 404 },
      );
    }

    await db.companyApp.delete({ where: { id: existing.id } });

    await createAuditLog({
      actorId: auth.id,
      actorEmail: auth.email,
      actorRole: auth.role,
      action: "APP_UNINSTALL",
      resourceType: "company_app",
      resourceId: existing.id,
      domain: "app-center",
      result: "success",
      metadata: { appSlug: app.slug, organizationId },
    });

    return NextResponse.json(apiSuccess({ uninstalled: true }, "App uninstalled"));
  } catch (e) {
    return handleErr(e);
  }
}
