import { NextRequest, NextResponse } from 'next/server';
import { apiSuccess, apiError, type ApiResponse } from '@/lib/response';
import { requireSession, isAdminRole, canAccessWebsite } from '@/lib/auth';
import { db } from '@/lib/db';
import { callHelper } from '@/lib/helpers';

function handleErr(e: unknown): NextResponse {
  if (e && typeof e === 'object' && 'status' in e) {
    const a = e as ApiResponse;
    return NextResponse.json(a, { status: a.status });
  }
  return NextResponse.json(apiError('Internal server error'), { status: 500 });
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireSession(request);
    const { id } = await params;

    const app = await db.application.findUnique({
      where: { id },
      include: { website: true },
    });

    if (!app) {
      return NextResponse.json(apiError('Application not found', 'NOT_FOUND', undefined, 404), { status: 404 });
    }

    const authorized =
      isAdminRole(user.role) ||
      app.userId === user.id ||
      (app.website ? canAccessWebsite(user, app.website) : false);

    if (!authorized) {
      return NextResponse.json(apiError('Forbidden', 'FORBIDDEN', undefined, 403), { status: 403 });
    }

    const lines: string[] = [];

    if (app.websiteId) {
      const recentDeployments = await db.deployment.findMany({
        where: { websiteId: app.websiteId },
        orderBy: { createdAt: 'desc' },
        take: 3,
        include: {
          logs: {
            orderBy: { timestamp: 'asc' },
            take: 200,
          },
        },
      });

      for (const dep of recentDeployments.reverse()) {
        for (const entry of dep.logs) {
          lines.push(`[${entry.timestamp.toISOString()}] [${entry.level}] ${entry.message}`);
        }
      }

      if (app.website?.domain) {
        const helperRes = await callHelper('alo-log-helper', ['website-logs', app.website.domain, '100']).catch(
          () => null,
        );
        if (helperRes?.success && helperRes.stdout.trim()) {
          lines.push(helperRes.stdout.trim());
        }
      }
    }

    const output =
      lines.length > 0
        ? lines.join('\n')
        : `[${app.updatedAt.toISOString()}] [INFO] Application "${app.name}" (${app.type}) status=${app.status}`;

    return NextResponse.json(
      apiSuccess({
        applicationId: app.id,
        status: app.status,
        logs: output,
        entries: lines,
      }),
    );
  } catch (e) {
    return handleErr(e);
  }
}
