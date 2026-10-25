import { NextRequest, NextResponse } from 'next/server';
import { apiSuccess, apiError, type ApiResponse } from '@/lib/response';
import { requireSession, requirePermission, ROLES } from '@/lib/auth';
import { callHelper } from '@/lib/helpers';
import { db } from '@/lib/db';

function handleErr(e: unknown): NextResponse {
  if (e && typeof e === 'object' && 'status' in e) {
    const a = e as ApiResponse;
    return NextResponse.json(a, { status: a.status });
  }
  return NextResponse.json(apiError('Internal server error'), { status: 500 });
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requirePermission(request, 'DATABASE_READ');
    const { id } = await params;

    const dbInst = await db.databaseInstance.findUnique({
      where: { id },
      include: {
        credentials: { select: { id: true, username: true, privileges: true, createdAt: true } },
        website: { select: { id: true, ownerId: true } },
      },
    });
    if (!dbInst || dbInst.deletedAt) {
      return NextResponse.json(apiError('Database not found', 'NOT_FOUND', undefined, 404), { status: 404 });
    }

    // Ownership check: verify the database's website belongs to the requesting user
    if (user.role !== ROLES.SUPER_ADMIN && dbInst.website.ownerId !== user.id) {
      return NextResponse.json(apiError('Forbidden', 'FORBIDDEN', undefined, 403), { status: 403 });
    }

    return NextResponse.json(apiSuccess(dbInst));
  } catch (e) { return handleErr(e); }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requirePermission(request, 'DATABASE_DELETE');
    const { id } = await params;

    const dbInst = await db.databaseInstance.findUnique({
      where: { id },
      include: { website: true },
    });
    if (!dbInst || dbInst.deletedAt) {
      return NextResponse.json(apiError('Database not found', 'NOT_FOUND', undefined, 404), { status: 404 });
    }

    // Ownership check: verify the database's website belongs to the requesting user
    if (user.role !== ROLES.SUPER_ADMIN && dbInst.website.ownerId !== user.id) {
      return NextResponse.json(apiError('Forbidden', 'FORBIDDEN', undefined, 403), { status: 403 });
    }

    const helperCmd = dbInst.engine === 'MARIADB' ? 'delete-mariadb' : 'delete-postgresql';
    const result = await callHelper('alo-database-helper', [helperCmd, dbInst.website.domain, dbInst.name]);
    if (!result.success) {
      return NextResponse.json(apiError('Database deletion failed', 'DATABASE_ERROR', { stderr: result.stderr }), { status: 500 });
    }

    const deleted = await db.databaseInstance.update({
      where: { id },
      data: { deletedAt: new Date() },
    });

    const ip = request.headers.get('x-forwarded-for') ?? request.headers.get('x-real-ip');
    await db.auditLog.create({
      data: {
        actorUserId: user.id, actorEmail: user.email, actorRole: user.role,
        action: 'DATABASE_DELETE', resourceType: 'DatabaseInstance', resourceId: id,
        domain: dbInst.website.domain, result: 'SUCCESS', ipAddress: ip,
      },
    });

    return NextResponse.json(apiSuccess(deleted, 'Database deleted'));
  } catch (e) { return handleErr(e); }
}
