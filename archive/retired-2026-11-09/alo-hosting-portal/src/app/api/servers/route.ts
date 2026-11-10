import { NextRequest, NextResponse } from 'next/server';
import { apiSuccess, apiError } from '@/lib/response';
import { requireSuperAdmin } from '@/lib/auth';
import { callHelper } from '@/lib/helpers';
import { db } from '@/lib/db';

export async function GET(request: NextRequest) {
  try {
    await requireSuperAdmin(request);

    const sysResult = await callHelper('alo-health-helper', ['system-info']);
    if (!sysResult.success) {
      return NextResponse.json(apiError('Failed to get system info', 'SYSTEM_ERROR', { stderr: sysResult.stderr }), { status: 500 });
    }

    let systemData;
    try { systemData = JSON.parse(sysResult.stdout); } catch { systemData = {}; }

    // Get or create server record
    let server = await db.server.findFirst();
    if (!server) {
      server = await db.server.create({
        data: { hostname: systemData.hostname || 'unknown' },
      });
    }

    return NextResponse.json(apiSuccess({
      ...server,
      ...systemData,
    }));
  } catch (e) {
    if (e && typeof e === 'object' && 'status' in e) {
      const a = e as any;
      return NextResponse.json(a, { status: a.status });
    }
    return NextResponse.json(apiError('Internal server error'), { status: 500 });
  }
}
