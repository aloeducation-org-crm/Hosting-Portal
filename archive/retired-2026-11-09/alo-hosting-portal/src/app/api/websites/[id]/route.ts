import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { apiSuccess, apiError, type ApiResponse } from '@/lib/response';
import { requireSession, requirePermission, ROLES } from '@/lib/auth';
import { callHelper } from '@/lib/helpers';
import { db } from '@/lib/db';

const updateSchema = z.object({
  domain: z.string().min(1).optional(),
  documentRoot: z.string().optional(),
  startupCommand: z.string().max(500).optional(),
  healthPath: z.string().optional(),
  applicationPort: z.number().int().min(1024).max(65535).optional(),
});

type UpdateInput = z.infer<typeof updateSchema>;

function handleErr(e: unknown): NextResponse {
  if (e && typeof e === 'object' && 'status' in e) {
    const a = e as ApiResponse;
    return NextResponse.json(a, { status: a.status });
  }
  return NextResponse.json(apiError('Internal server error'), { status: 500 });
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireSession(request);
    const { id } = await params;
    const website = await db.website.findUnique({
      where: { id },
      include: { domains: true, databaseInstances: true, environments: true, healthCheck: true },
    });
    if (!website) return NextResponse.json(apiError('Website not found', 'NOT_FOUND', undefined, 404), { status: 404 });
    if (user.role !== ROLES.SUPER_ADMIN && website.ownerId !== user.id) {
      return NextResponse.json(apiError('Forbidden', 'FORBIDDEN', undefined, 403), { status: 403 });
    }
    return NextResponse.json(apiSuccess(website));
  } catch (e) { return handleErr(e); }
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requirePermission(request, 'WEBSITE_UPDATE');
    const { id } = await params;
    const body = await request.json();
    const input = updateSchema.parse(body);

    const website = await db.website.findUnique({ where: { id } });
    if (!website || website.deletedAt) {
      return NextResponse.json(apiError('Website not found', 'NOT_FOUND', undefined, 404), { status: 404 });
    }

    // Ownership check: only the owner or SUPER_ADMIN can update
    if (user.role !== ROLES.SUPER_ADMIN && website.ownerId !== user.id) {
      return NextResponse.json(apiError('Forbidden', 'FORBIDDEN', undefined, 403), { status: 403 });
    }

    const updated = await db.website.update({
      where: { id },
      data: input as UpdateInput,
    });

    const ip = request.headers.get('x-forwarded-for') ?? request.headers.get('x-real-ip');
    await db.auditLog.create({
      data: { actorUserId: user.id, actorEmail: user.email, actorRole: user.role, action: 'WEBSITE_UPDATE', resourceType: 'Website', resourceId: id, result: 'SUCCESS', ipAddress: ip },
    });

    return NextResponse.json(apiSuccess(updated));
  } catch (e) {
    if (e instanceof z.ZodError) return NextResponse.json(apiError('Validation failed', 'VALIDATION_ERROR', e.flatten(), 400), { status: 400 });
    return handleErr(e);
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requirePermission(request, 'WEBSITE_DELETE');
    const { id } = await params;

    const website = await db.website.findUnique({ where: { id } });
    if (!website || website.deletedAt) {
      return NextResponse.json(apiError('Website not found', 'NOT_FOUND', undefined, 404), { status: 404 });
    }

    // Ownership check: only the owner or SUPER_ADMIN can delete
    if (user.role !== ROLES.SUPER_ADMIN && website.ownerId !== user.id) {
      return NextResponse.json(apiError('Forbidden', 'FORBIDDEN', undefined, 403), { status: 403 });
    }

    const result = await callHelper('alo-site-lifecycle', ['delete', website.domain]);
    if (!result.success) {
      return NextResponse.json(apiError('Delete failed', 'HELPER_ERROR', { stderr: result.stderr }), { status: 500 });
    }

    const deleted = await db.website.update({
      where: { id },
      data: { status: 'DELETED', deletedAt: new Date() },
    });

    const ip = request.headers.get('x-forwarded-for') ?? request.headers.get('x-real-ip');
    await db.auditLog.create({
      data: { actorUserId: user.id, actorEmail: user.email, actorRole: user.role, action: 'WEBSITE_DELETE', resourceType: 'Website', resourceId: id, domain: website.domain, result: 'SUCCESS', ipAddress: ip },
    });

    return NextResponse.json(apiSuccess(deleted, 'Website deleted'));
  } catch (e) { return handleErr(e); }
}
