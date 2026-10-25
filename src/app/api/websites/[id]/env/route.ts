import { NextRequest, NextResponse } from 'next/server';
import { apiSuccess, apiError, type ApiResponse } from '@/lib/response';
import { requireSession, requirePermission } from '@/lib/auth';
import { db } from '@/lib/db';
import { z } from 'zod';

function handleErr(e: unknown): NextResponse {
  if (e && typeof e === 'object' && 'status' in e) {
    const a = e as ApiResponse;
    return NextResponse.json(a, { status: a.status });
  }
  return NextResponse.json(apiError('Internal server error'), { status: 500 });
}

const envVarSchema = z.object({
  key: z.string().min(1).max(255),
  value: z.string().max(8192),
  isSecret: z.boolean().optional().default(false),
});

const upsertEnvSchema = z.object({
  variables: z.array(envVarSchema).min(1).max(200),
});

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireSession(request);
    const { id } = await params;

    const website = await db.website.findUnique({ where: { id } });
    if (!website || website.deletedAt) {
      return NextResponse.json(apiError('Website not found', 'NOT_FOUND', undefined, 404), { status: 404 });
    }

    const environments = await db.websiteEnvironment.findMany({
      where: { websiteId: id },
      orderBy: { key: 'asc' },
    });

    // Mask secret values
    const masked = environments.map((env) => ({
      id: env.id,
      key: env.key,
      value: env.isSecret ? '********' : env.value,
      isSecret: env.isSecret,
      createdAt: env.createdAt,
      updatedAt: env.updatedAt,
    }));

    return NextResponse.json(apiSuccess(masked));
  } catch (e) { return handleErr(e); }
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requirePermission(request, 'WEBSITE_UPDATE');
    const { id } = await params;

    const website = await db.website.findUnique({ where: { id } });
    if (!website || website.deletedAt) {
      return NextResponse.json(apiError('Website not found', 'NOT_FOUND', undefined, 404), { status: 404 });
    }

    const body = await request.json();
    const parsed = upsertEnvSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(apiError('Validation failed', 'VALIDATION_ERROR', parsed.error.flatten()), { status: 400 });
    }

    const { variables } = parsed.data;

    // Delete all existing env vars for this website
    await db.websiteEnvironment.deleteMany({
      where: { websiteId: id },
    });

    // Create new env vars
    const created = await db.websiteEnvironment.createMany({
      data: variables.map((v) => ({
        websiteId: id,
        key: v.key,
        value: v.value,
        isSecret: v.isSecret,
      })),
    });

    const ip = request.headers.get('x-forwarded-for') ?? request.headers.get('x-real-ip');
    await db.auditLog.create({
      data: {
        actorUserId: user.id, actorEmail: user.email, actorRole: user.role,
        action: 'ENV_UPDATE', resourceType: 'Website', resourceId: id,
        domain: website.domain, result: 'SUCCESS', ipAddress: ip,
        metadata: { count: created.count },
      },
    });

    return NextResponse.json(apiSuccess({ count: created.count }, `Updated ${created.count} environment variables`));
  } catch (e) { return handleErr(e); }
}
