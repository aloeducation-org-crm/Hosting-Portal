import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { apiSuccess, apiError, type ApiResponse } from "@/lib/response";
import { requireSession, requirePermission, isAdminRole } from "@/lib/auth";
import { assertWithinPlanLimit, EntitlementError } from "@/lib/billing/entitlements";
import { db } from "@/lib/db";

const DOMAIN_REGEX = /^(?=.{3,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/;

const createSiteSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  domain: z.string().min(3, "Domain is required"),
  runtime: z.enum(["STATIC", "PHP82", "NODE", "NEXTJS"]).default("NEXTJS"),
  gitRepo: z.string().optional(),
  gitBranch: z.string().default("main"),
  buildCommand: z.string().optional(),
  outputDirectory: z.string().optional(),
  startupCommand: z.string().optional(),
});

function handleErr(e: unknown): NextResponse {
  if (e instanceof EntitlementError) {
    return NextResponse.json(apiError(e.message, e.code, undefined, e.status), { status: e.status });
  }
  if (e && typeof e === "object" && "status" in e) {
    const a = e as ApiResponse;
    return NextResponse.json(a, { status: a.status });
  }
  return NextResponse.json(apiError("Internal server error"), { status: 500 });
}

export async function GET(request: NextRequest) {
  try {
    const user = await requireSession(request);
    const isAdmin = isAdminRole(user.role);

    const sites = await db.website.findMany({
      where: {
        deletedAt: null,
        ...(!isAdmin ? { ownerId: user.id } : {}),
      },
      include: {
        domains: true,
        deployments: {
          orderBy: { createdAt: "desc" },
          take: 1,
        },
        owner: {
          select: { id: true, name: true, email: true },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json(apiSuccess({ sites, websites: sites }));
  } catch (e) {
    return handleErr(e);
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requirePermission(request, "WEBSITE_CREATE");
    const body = await request.json();
    const input = createSiteSchema.parse(body);

    const cleanDomain = input.domain
      .toLowerCase()
      .trim()
      .replace(/^https?:\/\//, "")
      .replace(/\/.*$/, "");

    if (!DOMAIN_REGEX.test(cleanDomain)) {
      return NextResponse.json(
        apiError("Invalid domain name format", "VALIDATION_ERROR", undefined, 400),
        { status: 400 },
      );
    }

    // Enforce the same SEC-03 plan limit guard as POST /api/websites
    if (!isAdminRole(user.role)) {
      await assertWithinPlanLimit(user.id, "sites");
    }

    const existing = await db.website.findUnique({ where: { domain: cleanDomain } });
    if (existing) {
      return NextResponse.json(
        apiError("A site with this domain already exists", "CONFLICT", undefined, 409),
        { status: 409 },
      );
    }

    // Never fabricate ACTIVE/HEALTHY before real host provisioning or deployment
    // has verified the site.
    const site = await db.website.create({
      data: {
        name: input.name || cleanDomain,
        domain: cleanDomain,
        runtime: input.runtime,
        gitRepo: input.gitRepo || null,
        gitBranch: input.gitBranch,
        buildCommand: input.buildCommand || null,
        outputDirectory: input.outputDirectory || null,
        startupCommand: input.startupCommand || null,
        documentRoot: `/srv/alo-sites/${cleanDomain}/current`,
        status: "DEPLOYING",
        healthStatus: "UNKNOWN",
        ownerId: user.id,
      },
    });

    await db.auditLog.create({
      data: {
        actorUserId: user.id,
        actorEmail: user.email,
        actorRole: user.role,
        action: "WEBSITE_CREATE",
        resourceType: "Website",
        resourceId: site.id,
        domain: site.domain,
        result: "SUCCESS",
      },
    });

    return NextResponse.json(
      apiSuccess(site, "Site registered (pending provisioning/deployment)", 201),
      { status: 201 },
    );
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json(
        apiError("Validation failed", "VALIDATION_ERROR", e.flatten(), 400),
        { status: 400 },
      );
    }
    return handleErr(e);
  }
}
