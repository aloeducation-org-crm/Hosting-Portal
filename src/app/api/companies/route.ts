import { NextRequest, NextResponse } from "next/server";
import { apiSuccess, apiError, type ApiResponse } from "@/lib/response";
import { requireSession, isAdminRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { createAuditLog } from "@/lib/audit";
import { z } from "zod";

function handleErr(e: unknown): NextResponse {
  if (e && typeof e === "object" && "status" in e) {
    const a = e as ApiResponse;
    return NextResponse.json(a, { status: a.status });
  }
  return NextResponse.json(apiError("Internal server error"), { status: 500 });
}

const createCompanySchema = z.object({
  name: z.string().trim().min(2, "Company name must be at least 2 characters").max(80),
  logoUrl: z.string().url().max(500).optional(),
});

/**
 * GET /api/companies — the companies this user may switch between.
 * Platform admins see every company (the multi-tenant reuse view); everyone
 * else sees companies they own or belong to. `appCount` shows how many apps
 * each company currently has installed.
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await requireSession(request);

    const where = isAdminRole(auth.role)
      ? {}
      : {
          OR: [
            { ownerId: auth.id },
            { memberships: { some: { userId: auth.id } } },
          ],
        };

    const companies = await db.organization.findMany({
      where,
      select: {
        id: true,
        name: true,
        slug: true,
        logoUrl: true,
        customDomain: true,
        ownerId: true,
        isWhiteLabel: true,
        createdAt: true,
        memberships: {
          where: { userId: auth.id },
          select: { role: true },
        },
        _count: { select: { companyApps: true } },
      },
      orderBy: { createdAt: "asc" },
    });

    const shaped = companies.map((c) => ({
      id: c.id,
      name: c.name,
      slug: c.slug,
      logoUrl: c.logoUrl,
      customDomain: c.customDomain,
      isWhiteLabel: c.isWhiteLabel,
      createdAt: c.createdAt,
      /** The caller's role inside this company (platform admins get OWNER view). */
      role: isAdminRole(auth.role)
        ? "OWNER"
        : (c.memberships[0]?.role ?? (c.ownerId === auth.id ? "OWNER" : "MEMBER")),
      appCount: c._count.companyApps,
    }));

    return NextResponse.json(apiSuccess({ companies: shaped }));
  } catch (e) {
    return handleErr(e);
  }
}

/**
 * POST /api/companies — create a company (tenant) and become its OWNER.
 * Slug follows the onboarding convention: name-slug + user-id suffix, so two
 * users can pick the same company name without colliding.
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await requireSession(request);

    const body = await request.json().catch(() => null);
    const parsed = createCompanySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        apiError(
          "Invalid company",
          "VALIDATION_ERROR",
          { issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) },
          400,
        ),
        { status: 400 },
      );
    }

    const baseSlug =
      parsed.data.name
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 40) || "company";
    const slug = `${baseSlug}-${auth.id.slice(0, 6)}`;

    const existing = await db.organization.findUnique({ where: { slug }, select: { id: true } });
    if (existing) {
      return NextResponse.json(
        apiError(
          "You already created a company with this name — pick a slightly different one",
          "CONFLICT",
          undefined,
          409,
        ),
        { status: 409 },
      );
    }

    const company = await db.organization.create({
      data: {
        name: parsed.data.name,
        slug,
        logoUrl: parsed.data.logoUrl,
        ownerId: auth.id,
        memberships: {
          create: {
            userId: auth.id,
            role: "OWNER",
            acceptedAt: new Date(),
          },
        },
      },
      select: {
        id: true,
        name: true,
        slug: true,
        logoUrl: true,
        customDomain: true,
        isWhiteLabel: true,
        createdAt: true,
      },
    });

    await createAuditLog({
      actorId: auth.id,
      actorEmail: auth.email,
      actorRole: auth.role,
      action: "COMPANY_CREATE",
      resourceType: "organization",
      resourceId: company.id,
      domain: "app-center",
      result: "success",
      metadata: { name: company.name, slug: company.slug },
    });

    return NextResponse.json(
      apiSuccess({ company: { ...company, role: "OWNER", appCount: 0 } }, "Company created"),
      { status: 201 },
    );
  } catch (e) {
    return handleErr(e);
  }
}
