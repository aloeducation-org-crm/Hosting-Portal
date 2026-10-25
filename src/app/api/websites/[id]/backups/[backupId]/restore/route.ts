import { NextRequest, NextResponse } from 'next/server';
import { apiSuccess, apiError, type ApiResponse } from '@/lib/response';
import { requirePermission } from '@/lib/auth';
import { callHelper } from '@/lib/helpers';
import { db } from '@/lib/db';

function handleErr(e: unknown): NextResponse {
  if (e && typeof e === 'object' && 'status' in e) {
    const a = e as ApiResponse;
    return NextResponse.json(a, { status: a.status });
  }
  return NextResponse.json(apiError('Internal server error'), { status: 500 });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string; backupId: string }> }) {
  try {
    const user = await requirePermission(request, 'BACKUP_RESTORE');
    const { id, backupId } = await params;

    const website = await db.website.findUnique({ where: { id } });
    if (!website || website.deletedAt) {
      return NextResponse.json(apiError('Website not found', 'NOT_FOUND', undefined, 404), { status: 404 });
    }

    const backup = await db.backup.findUnique({ where: { id: backupId } });
    if (!backup || backup.websiteId !== id) {
      return NextResponse.json(apiError('Backup not found', 'NOT_FOUND', undefined, 404), { status: 404 });
    }

    const result = await callHelper('alo-site-restore', [website.domain, backup.filepath]);
    if (!result.success) {
      return NextResponse.json(apiError('Restore failed', 'HELPER_ERROR', { stderr: result.stderr }), { status: 500 });
    }

    const restoreJob = await db.restoreJob.create({
      data: {
        backupId: backup.id,
        websiteId: id,
        status: 'SUCCESS',
        actorId: user.id,
        startedAt: new Date(),
        finishedAt: new Date(),
      },
    });

    const ip = request.headers.get('x-forwarded-for') ?? request.headers.get('x-real-ip');
    await db.auditLog.create({
      data: {
        actorUserId: user.id, actorEmail: user.email, actorRole: user.role,
        action: 'BACKUP_RESTORE', resourceType: 'RestoreJob', resourceId: restoreJob.id,
        domain: website.domain, result: 'SUCCESS', ipAddress: ip,
      },
    });

    return NextResponse.json(apiSuccess(restoreJob, 'Restore completed'));
  } catch (e) { return handleErr(e); }
}
