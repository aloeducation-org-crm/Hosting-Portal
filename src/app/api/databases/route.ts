import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { apiSuccess, apiError, type ApiResponse } from '@/lib/response';
import { requireSession, requirePermission, ROLES } from '@/lib/auth';
import { callHelper } from '@/lib/helpers';
import { db } from '@/lib/db';
import { hashPassword } from '@/lib/password';
import { v4 as uuidv4 } from 'uuid';
import { env } from '@/lib/env';

const createSchema = z.object({
  websiteId: z.string().uuid(),
  engine: z.enum(['MARIADB', 'POSTGRESQL']),
  name: z.string().min(1).max(63).regex(/^[a-zA-Z0-9_]+$/),
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
    const { searchParams } = new URL(request.url);
    const websiteId = searchParams.get('websiteId');

    const where: any = { deletedAt: null };
    if (websiteId) where.websiteId = websiteId;
    if (user.role !== ROLES.SUPER_ADMIN) {
      // VIEWER can only see databases for their websites
      const userWebsites = await db.website.findMany({
        where: { ownerId: user.id, deletedAt: null },
        select: { id: true },
      });
      where.websiteId = { in: userWebsites.map((w) => w.id) };
    }

    const databases = await db.databaseInstance.findMany({
      where,
      include: {
        credentials: { select: { id: true, username: true, privileges: true, createdAt: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json(apiSuccess(databases));
  } catch (e) { return handleErr(e); }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requirePermission(request, 'DATABASE_CREATE');
    const body = await request.json();
    const input = createSchema.parse(body);

    // Verify website exists
    const website = await db.website.findUnique({ where: { id: input.websiteId } });
    if (!website || website.deletedAt) {
      return NextResponse.json(apiError('Website not found', 'NOT_FOUND', undefined, 404), { status: 404 });
    }

    // Call real helper
    const helperCmd = input.engine === 'MARIADB' ? 'create-mariadb' : 'create-postgresql';
    const result = await callHelper('alo-database-helper', [helperCmd, website.domain, input.name]);
    if (!result.success) {
      return NextResponse.json(apiError('Database creation failed', 'DATABASE_ERROR', { stderr: result.stderr }), { status: 500 });
    }

    let helperData;
    try {
      helperData = JSON.parse(result.stdout);
    } catch {
      return NextResponse.json(apiError('Failed to parse database helper output', 'DATABASE_ERROR', undefined, 500), { status: 500 });
    }

    const pwHash = await hashPassword(helperData.password);

    const dbInstance = await db.databaseInstance.create({
      data: {
        websiteId: input.websiteId,
        engine: input.engine as any,
        name: input.name,
        host: helperData.host,
        port: helperData.port,
        username: helperData.username,
        credentials: {
          create: {
            username: helperData.username,
            passwordHash: pwHash,
            privileges: JSON.stringify(['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'CREATE', 'ALTER', 'INDEX']),
          },
        },
      },
      include: { credentials: true },
    });

    // Audit log
    const ip = request.headers.get('x-forwarded-for') ?? request.headers.get('x-real-ip');
    await db.auditLog.create({
      data: {
        actorUserId: user.id, actorEmail: user.email, actorRole: user.role,
        action: 'DATABASE_CREATE', resourceType: 'DatabaseInstance', resourceId: dbInstance.id,
        domain: website.domain, result: 'SUCCESS', ipAddress: ip,
      },
    });

    // Return with plain password (only time it's visible)
    const response = { ...dbInstance, password: helperData.password };
    return NextResponse.json(apiSuccess(response, 'Database created', 201), { status: 201 });
  } catch (e) {
    if (e instanceof z.ZodError) return NextResponse.json(apiError('Validation failed', 'VALIDATION_ERROR', e.flatten(), 400), { status: 400 });
    return handleErr(e);
  }
}
