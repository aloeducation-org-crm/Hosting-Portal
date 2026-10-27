import { NextRequest, NextResponse } from 'next/server';
import { apiSuccess, apiError, type ApiResponse } from '@/lib/response';
import { isAdminRole, requirePermission, requireSession } from '@/lib/auth';
import { db } from '@/lib/db';
import { callHelper } from '@/lib/helpers';
import { createAuditLog } from '@/lib/audit';
import { redactContainerRecord } from '@/lib/containers/security';

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
      include: { website: { select: { ownerId: true } } },
    });

    if (!container) {
      throw apiError('Container not found', 'NOT_FOUND', undefined, 404);
    }
    if (!isAdminRole(user.role) && container.website?.ownerId !== user.id) {
      throw apiError('Forbidden', 'FORBIDDEN', undefined, 403);
    }

    // Get real container stats via alo-docker-helper
    const stats = { cpuUsage: 0, memoryUsage: 0 };
    try {
      const result = await callHelper('alo-docker-helper', ['stats-one', container.name], 10_000);
      if (result.success) {
        const parsed = JSON.parse(result.stdout) as { cpuPercent?: number; memoryPercent?: number };
        if (typeof parsed.cpuPercent === 'number') stats.cpuUsage = parsed.cpuPercent;
        if (typeof parsed.memoryPercent === 'number') stats.memoryUsage = parsed.memoryPercent;
      }
    } catch {
      // Stats unavailable — use default 0 values
    }

    const { website: _website, ...rest } = container;
    return NextResponse.json(
      apiSuccess({ ...redactContainerRecord(rest), ...stats }),
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
    const body = (await request.json().catch(() => ({}))) as { action?: string };
    const { action } = body;

    if (!action || !['start', 'stop', 'restart'].includes(action)) {
      throw apiError('Action must be start, stop, or restart', 'VALIDATION_ERROR', undefined, 400);
    }

    const container = await db.dockerContainer.findFirst({
      where: { id },
      include: { website: { select: { ownerId: true } } },
    });
    if (!container) {
      throw apiError('Container not found', 'NOT_FOUND', undefined, 404);
    }
    if (!isAdminRole(user.role) && container.website?.ownerId !== user.id) {
      throw apiError('Forbidden', 'FORBIDDEN', undefined, 403);
    }

    const result = await callHelper('alo-docker-helper', [action, container.name], 60_000);

    if (!result.success) {
      throw apiError(
        `Container ${action} failed: ${result.stderr || 'Host Docker helper failed'}`,
        'HELPER_ERROR',
        undefined,
        502,
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

    return NextResponse.json(apiSuccess(redactContainerRecord(updated), `Container ${action}ed successfully`));
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

    const container = await db.dockerContainer.findFirst({
      where: { id },
      include: { website: { select: { ownerId: true } } },
    });
    if (!container) {
      throw apiError('Container not found', 'NOT_FOUND', undefined, 404);
    }
    if (!isAdminRole(user.role) && container.website?.ownerId !== user.id) {
      throw apiError('Forbidden', 'FORBIDDEN', undefined, 403);
    }

    let result = await callHelper('alo-docker-helper', ['remove-force', container.name], 60_000);
    const combinedOut = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
    if (!result.success && /unknown command/i.test(combinedOut)) {
      await callHelper('alo-docker-helper', ['stop', container.name], 30_000);
      result = await callHelper('alo-docker-helper', ['remove', container.name], 30_000);
    }

    const finalOut = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
    if (!result.success && !/no such container/i.test(finalOut)) {
      throw apiError(
        `Container removal failed: ${result.stderr || 'Host Docker helper failed'}`,
        'HELPER_ERROR',
        undefined,
        502,
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
