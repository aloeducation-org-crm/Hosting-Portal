import { NextRequest, NextResponse } from 'next/server';
import { apiSuccess, apiError, type ApiResponse } from '@/lib/response';
import { requireSession, ROLES } from '@/lib/auth';
import { db } from '@/lib/db';
import { callHelper } from '@/lib/helpers';

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

    const where = user.role === ROLES.SUPER_ADMIN ? { deletedAt: null } : { ownerId: user.id, deletedAt: null };

    const [
      totalWebsites,
      activeWebsites,
      suspendedWebsites,
      totalDatabases,
      totalBackups,
      recentDeployments,
    ] = await Promise.all([
      db.website.count({ where }),
      db.website.count({ where: { ...where, status: 'ACTIVE' } }),
      db.website.count({ where: { ...where, status: 'SUSPENDED' } }),
      db.databaseInstance.count({ where: { deletedAt: null, website: { deletedAt: null, ...(user.role !== ROLES.SUPER_ADMIN ? { ownerId: user.id } : {}) } } }),
      db.backup.count({ where: { website: { deletedAt: null, ...(user.role !== ROLES.SUPER_ADMIN ? { ownerId: user.id } : {}) } } }),
      db.deployment.findMany({
        where: { website: where },
        take: 5,
        orderBy: { createdAt: 'desc' },
        select: { id: true, status: true, createdAt: true, website: { select: { domain: true } } },
      }),
    ]);

    // Get real system info if super admin
    let systemInfo = null;
    if (user.role === ROLES.SUPER_ADMIN) {
      const sysResult = await callHelper('alo-health-helper', ['system-info']);
      if (sysResult.success) {
        try { systemInfo = JSON.parse(sysResult.stdout); } catch {}
      }
    }

    return NextResponse.json(apiSuccess({
      websites: { total: totalWebsites, active: activeWebsites, suspended: suspendedWebsites },
      databases: totalDatabases,
      backups: totalBackups,
      recentDeployments,
      systemInfo,
    }));
  } catch (e) { return handleErr(e); }
}
