import { NextRequest, NextResponse } from 'next/server';
import { apiSuccess, apiError, type ApiResponse } from '@/lib/response';
import { requireSession, requirePermission, assertWebsiteAccess } from '@/lib/auth';
import { db } from '@/lib/db';
import { z } from 'zod';
import { maskSecretValue, needsSealing, sealSecretValue } from '@/lib/secret-store';

function handleErr(e: unknown): NextResponse {
  if (e && typeof e === 'object' && 'status' in e) {
    const a = e as ApiResponse;
    return NextResponse.json(a, { status: a.status });
  }
  return NextResponse.json(apiError('Internal server error'), { status: 500 });
}

const envVarSchema = z.object({
  key: z.string().trim().min(1).max(128).regex(/^[A-Z_][A-Z0-9_]*$/, 'Key must be an uppercase environment identifier'),
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
    assertWebsiteAccess(user, website);

    const environments = await db.websiteEnvironment.findMany({
      where: { websiteId: id },
      orderBy: { key: 'asc' },
    });

    // Mask secret values. Legacy secret rows are lazily converted to the
    // versioned AES-GCM envelope so an old plaintext value is never returned.
    const masked = [];
    for (const item of environments) {
      let stored = item.value;
      if (item.isSecret && needsSealing(stored)) {
        stored = sealSecretValue(stored);
        await db.websiteEnvironment.update({ where: { id: item.id }, data: { value: stored } });
      }
      masked.push({
        id: item.id,
        key: item.key,
        value: item.isSecret ? maskSecretValue(stored) : stored,
        isSecret: item.isSecret,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
      });
    }

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
    assertWebsiteAccess(user, website);

    const body = await request.json();
    const parsed = upsertEnvSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(apiError('Validation failed', 'VALIDATION_ERROR', parsed.error.flatten()), { status: 400 });
    }

    const { variables } = parsed.data;
    if (new Set(variables.map((v) => v.key)).size !== variables.length) {
      return NextResponse.json(apiError('Environment variable keys must be unique', 'VALIDATION_ERROR', undefined, 400), { status: 400 });
    }

    // Replacement is transactional. A masked secret means "keep the current
    // sealed value" rather than overwriting it with asterisks.
    const created = await db.$transaction(async (tx) => {
      const existing = await tx.websiteEnvironment.findMany({ where: { websiteId: id } });
      const byKey = new Map(existing.map((row) => [row.key, row]));
      const data = variables.map((variable) => {
        const previous = byKey.get(variable.key);
        const preserveMasked = variable.isSecret && variable.value === '********' && previous?.isSecret;
        return {
          websiteId: id,
          key: variable.key,
          value: preserveMasked ? previous!.value : variable.isSecret ? sealSecretValue(variable.value) : variable.value,
          isSecret: variable.isSecret,
        };
      });
      await tx.websiteEnvironment.deleteMany({ where: { websiteId: id } });
      return tx.websiteEnvironment.createMany({ data });
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
