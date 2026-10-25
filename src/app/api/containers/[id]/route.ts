import { NextRequest, NextResponse } from 'next/server';
import { apiSuccess, apiError, type ApiResponse } from '@/lib/response';
import { requirePermission, requireSession } from '@/lib/auth';
import { db } from '@/lib/db';
import { callHelper } from '@/lib/helpers';
import { createAuditLog } from '@/lib/audit';

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

    const container = await db.dockerContainer.findFirst({
      where: { id },
    });

    if (!container) {
      throw apiError('Container not found', 'NOT_FOUND', undefined, 404);
    }

    // Get real container stats via alo-hosting-helper
    let stats = { cpuUsage: 0, memoryUsage: 0 };
    try {
      const result = await callHelper('alo-hosting-helper', ['docker-stats', container.name], 10_000);
      if (result.success) {
        const parsed = JSON.parse(result.stdout);
        if (parsed.cpuPercent !== undefined) stats.cpuUsage = parsed.cpuPercent;
        if (parsed.memoryPercent !== undefined) stats.memoryUsage = parsed.memoryPercent;
      }
    } catch {
      // Stats unavailable — use DB values
    }

    return NextResponse.json(
      apiSuccess({ ...container, ...stats }),
    );
  } catch (e) {
    return handleErr(e);
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requirePermission(request, 'SERVER_MANAGE');
    const { id } = await params;
    const body = await request.json();
    const { action } = body as { action: string };

    if (!action || !['start', 'stop', 'restart'].includes(action)) {
      throw apiError('Action must be start, stop, or restart', 'VALIDATION_ERROR', undefined, 400);
    }

    const container = await db.dockerContainer.findFirst({ where: { id } });
    if (!container) {
      throw apiError('Container not found', 'NOT_FOUND', undefined, 404);
    }

    // Execute real Docker action via alo-hosting-helper
    const result = await callHelper('alo-hosting-helper', [action, container.name], 60_000);

    if (!result.success) {
      throw apiError(
        `Container ${action} failed: ${result.stderr || 'Unknown error'}`,
        'HELPER_ERROR',
        undefined,
        500,
      );
    }

    const statusMap: Record<string, string> = {
      start: 'running',
      stop: 'stopped',
      restart: 'running',
    };

    const updated = await db.dockerContainer.update({
      where: { id },
      data: {
        status: statusMap[action],
      },
    });

    await createAuditLog({
      actorId: user.id,
      actorEmail: user.email,
      actorRole: user.role,
      action: `DOCKER_CONTAINER_${action.toUpperCase()}`,
      resourceType: 'DockerContainer',
      resourceId: id,
      result: 'SUCCESS',
      metadata: { name: container.name, action },
    });

    return NextResponse.json(apiSuccess(updated, `Container ${action}ed successfully`));
  } catch (e) {
    return handleErr(e);
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requirePermission(request, 'SERVER_MANAGE');
    const { id } = await params;

    const container = await db.dockerContainer.findFirst({ where: { id } });
    if (!container) {
      throw apiError('Container not found', 'NOT_FOUND', undefined, 404);
    }

    // Remove real Docker container via alo-hosting-helper
    const result = await callHelper('alo-hosting-helper', ['rm', '-f', container.name], 60_000);

    if (!result.success) {
      throw apiError(
        `Container removal failed: ${result.stderr || 'Unknown error'}`,
        'HELPER_ERROR',
        undefined,
        500,
      );
    }

    await db.dockerContainer.delete({ where: { id } });

    await createAuditLog({
      actorId: user.id,
      actorEmail: user.email,
      actorRole: user.role,
      action: 'DOCKER_CONTAINER_DELETED',
      resourceType: 'DockerContainer',
      resourceId: id,
      result: 'SUCCESS',
      metadata: { name: container.name },
    });

    return NextResponse.json(apiSuccess(null, 'Container deleted'));
  } catch (e) {
    return handleErr(e);
  }
}
