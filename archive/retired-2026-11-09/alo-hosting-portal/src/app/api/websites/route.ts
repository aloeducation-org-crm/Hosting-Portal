import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { apiSuccess, apiError, type ApiResponse } from '@/lib/response';
import { requireSession, requirePermission, ROLES } from '@/lib/auth';
import { callHelper } from '@/lib/helpers';
import { db } from '@/lib/db';

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

    let port: number | undefined;

    if (input.runtime === 'STATIC') {
      const r = await callHelper('alo-hosting-helper', ['provision-static', input.domain]);
      if (!r.success) return NextResponse.json(apiError('Provision failed', 'PROVISION_FAILED', { stderr: r.stderr }), { status: 500 });
    } else if (input.runtime === 'PHP82') {
      const r = await callHelper('alo-hosting-helper', ['provision-php', input.domain, 'false']);
      if (!r.success) return NextResponse.json(apiError('Provision failed', 'PROVISION_FAILED', { stderr: r.stderr }), { status: 500 });
    } else {
      const pr = await callHelper('alo-hosting-helper', ['allocate-port']);
      if (!pr.success) return NextResponse.json(apiError('Port allocation failed', 'PORT_ERROR', { stderr: pr.stderr }), { status: 500 });
      port = input.applicationPort ?? parseInt(pr.stdout.trim(), 10);
      const nr = await callHelper('alo-node-app-helper', [
        'provision', input.domain, String(port),
        input.startupCommand ?? 'npm start', input.healthPath,
      ]);
      if (!nr.success) return NextResponse.json(apiError('Provision failed', 'PROVISION_FAILED', { stderr: nr.stderr }), { status: 500 });
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

    return NextResponse.json(apiSuccess(website, 'Website created', 201), { status: 201 });
  } catch (e) {
    if (e instanceof z.ZodError) return NextResponse.json(apiError('Validation failed', 'VALIDATION_ERROR', e.flatten(), 400), { status: 400 });
    return handleErr(e);
  }
}
