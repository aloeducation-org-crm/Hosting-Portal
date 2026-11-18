import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { apiSuccess, apiError, type ApiResponse } from '@/lib/response';
import { requireSession, requirePermission, ROLES } from '@/lib/auth';
import { callHelper } from '@/lib/helpers';
import { db } from '@/lib/db';
import { assertWithinPlanLimit, EntitlementError } from '@/lib/billing/entitlements';
import { launchSite } from '@/lib/deploy/provision';

const createSchema = z.object({
  domain: z.string().min(1).max(253),
  runtime: z.enum(['STATIC', 'PHP82', 'NODE', 'NEXTJS']),
  documentRoot: z.string().optional(),
  applicationPort: z.number().int().min(1024).max(65535).optional(),
  startupCommand: z.string().max(500).optional(),
  healthPath: z.string().default('/'),
  environmentVariables: z.record(z.string(), z.string()).optional(),
});

function handleErr(e: unknown): NextResponse {
  if (e && typeof e === 'object' && 'status' in e) {
    const a = e as ApiResponse;
    return NextResponse.json(a, { status: a.status });
  }
  return NextResponse.json(apiError('Internal server error'), { status: 500 });
}

export async function GET(request: NextRequest) {
  try {
    const user = await requireSession(request);
    const where = user.role === ROLES.SUPER_ADMIN
      ? { deletedAt: null }
      : { ownerId: user.id, deletedAt: null };
    const websites = await db.website.findMany({
      where,
      include: { domains: true, databaseInstances: true },
      orderBy: { createdAt: 'desc' },
    });
    return NextResponse.json(apiSuccess(websites));
  } catch (e) { return handleErr(e); }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requirePermission(request, 'WEBSITE_CREATE');
    const body = await request.json();
    const input = createSchema.parse(body);

    const existing = await db.website.findUnique({ where: { domain: input.domain } });
    if (existing && !existing.deletedAt) {
      return NextResponse.json(apiError('Domain already in use', 'CONFLICT', undefined, 409), { status: 409 });
    }

    /**
     * SEC-03: plan limits were stored and displayed but never enforced here, so
     * every plan behaved like the largest one. The check runs BEFORE the
     * privileged provisioning helper, so a refused request costs nothing and
     * cannot leave a half-provisioned site behind.
     */
    try {
      await assertWithinPlanLimit(user.id, 'sites');
    } catch (error) {
      if (error instanceof EntitlementError) {
        return NextResponse.json(
          apiError(error.message, error.code, error.customerAction ? { customerAction: error.customerAction } : undefined, error.status),
          { status: error.status },
        );
      }
      throw error;
    }

    let port: number | undefined;
    let provisionSteps: unknown = null;

    if (input.runtime === 'STATIC') {
      const r = await callHelper('alo-hosting-helper', ['provision-static', input.domain]);
      if (!r.success) return NextResponse.json(apiError('Provision failed', 'PROVISION_FAILED', { stderr: r.stderr }), { status: 500 });
    } else if (input.runtime === 'PHP82') {
      const r = await callHelper('alo-hosting-helper', ['provision-php', input.domain, 'false']);
      if (!r.success) return NextResponse.json(apiError('Provision failed', 'PROVISION_FAILED', { stderr: r.stderr }), { status: 500 });
    } else {
      // NODE / NEXTJS: programmatic launch — allocate a free port (DB + OS
      // probe), register + start a PM2 process, write + enable + reload an
      // Nginx server block, and issue a Certbot certificate. Best-effort per
      // step; a host missing a helper still gets the site record created.
      const launch = await launchSite({
        domain: input.domain,
        startCommand: input.startupCommand ?? 'npm start',
        healthPath: input.healthPath,
        port: input.applicationPort,
      });
      port = launch.port;
      provisionSteps = launch.steps;
    }

    const website = await db.website.create({
      data: {
        domain: input.domain,
        runtime: input.runtime as any,
        documentRoot: input.documentRoot,
        status: 'ACTIVE',
        applicationPort: port,
        startupCommand: input.startupCommand,
        healthPath: input.healthPath,
        ownerId: user.id,
      },
    });

    if (input.environmentVariables && Object.keys(input.environmentVariables).length > 0) {
      await db.websiteEnvironment.createMany({
        data: Object.entries(input.environmentVariables).map(([key, value]) => ({
          websiteId: website.id, key, value, isSecret: false,
        })),
      });
    }

    const ip = request.headers.get('x-forwarded-for') ?? request.headers.get('x-real-ip');
    await db.auditLog.create({
      data: {
        actorUserId: user.id, actorEmail: user.email, actorRole: user.role,
        action: 'WEBSITE_CREATE', resourceType: 'Website', resourceId: website.id,
        domain: input.domain, result: 'SUCCESS', ipAddress: ip,
      },
    });

    return NextResponse.json(apiSuccess({ ...website, provisioning: provisionSteps }, 'Website created', 201), { status: 201 });
  } catch (e) {
    if (e instanceof z.ZodError) return NextResponse.json(apiError('Validation failed', 'VALIDATION_ERROR', e.flatten(), 400), { status: 400 });
    return handleErr(e);
  }
}
