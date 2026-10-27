import { NextRequest, NextResponse } from 'next/server';
import { apiSuccess, apiError, type ApiResponse } from '@/lib/response';
import { isAdminRole, requireSession, requirePermission } from '@/lib/auth';
import { db } from '@/lib/db';
import { callHelper } from '@/lib/helpers';
import { createAuditLog } from '@/lib/audit';
import {
  ContainerValidationError,
  normalizeSafePortMapping,
  redactContainerRecord,
  validateContainerImage,
  validateContainerName,
  validateEnvVarMap,
} from '@/lib/containers/security';

function handleErr(e: unknown): NextResponse {
  if (e instanceof ContainerValidationError) {
    return NextResponse.json(apiError(e.message, 'VALIDATION_ERROR', undefined, 400), { status: 400 });
  }
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

    // Tenant isolation: non-admin users only see containers attached to websites they own.
    if (websiteId && !isAdminRole(user.role)) {
      const ownedSite = await db.website.findFirst({
        where: { id: websiteId, ownerId: user.id, deletedAt: null },
        select: { id: true },
      });
      if (!ownedSite) {
        throw apiError('Forbidden: website does not belong to your account', 'FORBIDDEN', undefined, 403);
      }
    }

    const where: Record<string, unknown> = isAdminRole(user.role)
      ? (websiteId ? { websiteId } : {})
      : {
          websiteId: websiteId ? websiteId : { not: null },
          website: { ownerId: user.id, deletedAt: null },
        };

    const containers = await db.dockerContainer.findMany({
      where,
      take: 100,
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json(apiSuccess(containers.map(redactContainerRecord)));
  } catch (e) {
    return handleErr(e);
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requirePermission(request, 'SERVER_MANAGE');
    const body = (await request.json().catch(() => ({}))) as {
      name?: unknown;
      image?: unknown;
      portMapping?: unknown;
      envVars?: unknown;
      websiteId?: unknown;
    };

    const name = validateContainerName(body.name);
    const image = validateContainerImage(body.image);
    const portMapping = normalizeSafePortMapping(body.portMapping);
    const envVars = validateEnvVarMap(body.envVars);
    const websiteId = typeof body.websiteId === 'string' && body.websiteId.trim() ? body.websiteId.trim() : null;

    if (websiteId && !isAdminRole(user.role)) {
      const ownedSite = await db.website.findFirst({
        where: { id: websiteId, ownerId: user.id, deletedAt: null },
        select: { id: true },
      });
      if (!ownedSite) {
        throw apiError('Forbidden: website does not belong to your account', 'FORBIDDEN', undefined, 403);
      }
    }

    // Check name uniqueness
    const existing = await db.dockerContainer.findUnique({
      where: { name },
    });
    if (existing) {
      throw apiError('A container with this name already exists', 'CONFLICT', undefined, 409);
    }

    const container = await db.dockerContainer.create({
      data: {
        name,
        image,
        status: 'running',
        portMapping,
        envVars: envVars ?? undefined,
        websiteId,
      },
    });

    // Run hardened container via alo-docker-helper (never pass unvalidated flags)
    const args = ['run-hardened', name, image, portMapping ?? '-'];
    if (envVars) {
      for (const [key, value] of Object.entries(envVars)) {
        args.push(`${key}=${value}`);
      }
    }

    const result = await callHelper('alo-docker-helper', args, 60_000);
    if (!result.success) {
      await db.dockerContainer.update({
        where: { id: container.id },
        data: { status: 'error' },
      });
      throw apiError(`Container creation failed: ${result.stderr || 'Host Docker helper failed'}`, 'HELPER_ERROR', undefined, 502);
    }

    await createAuditLog({
      actorId: user.id,
      actorEmail: user.email,
      actorRole: user.role,
      action: 'DOCKER_CONTAINER_CREATED',
      resourceType: 'DockerContainer',
      resourceId: container.id,
      result: 'SUCCESS',
      metadata: { name, image, portMapping, websiteId, envVarKeys: envVars ? Object.keys(envVars) : [] },
    });

    return NextResponse.json(apiSuccess(redactContainerRecord(container), 'Container created'), { status: 201 });
  } catch (e) {
    return handleErr(e);
  }
}

export async function PUT(request: NextRequest) {
  try {
    const user = await requirePermission(request, 'SERVER_MANAGE');
    const body = (await request.json().catch(() => ({}))) as {
      id?: unknown;
      status?: unknown;
      envVars?: unknown;
    };

    const id = typeof body.id === 'string' ? body.id.trim() : '';
    const status = typeof body.status === 'string' ? body.status.trim() : undefined;
    const envVars = validateEnvVarMap(body.envVars);

    if (!id) {
      throw apiError('id is required', 'VALIDATION_ERROR', undefined, 400);
    }

    const container = await db.dockerContainer.findUnique({
      where: { id },
      include: { website: { select: { ownerId: true } } },
    });
    if (!container) {
      throw apiError('Container not found', 'NOT_FOUND', undefined, 404);
    }
    if (!isAdminRole(user.role) && container.website?.ownerId !== user.id) {
      throw apiError('Forbidden', 'FORBIDDEN', undefined, 403);
    }

    if (status && ['stopped', 'running', 'restarted'].includes(status)) {
      const action = status === 'restarted' ? 'restart' : status === 'running' ? 'start' : 'stop';
      const result = await callHelper('alo-docker-helper', [action, container.name], 30_000);
      if (!result.success) {
        throw apiError(`Container ${action} failed: ${result.stderr || 'Host Docker helper failed'}`, 'HELPER_ERROR', undefined, 502);
      }
    }

    const updateData: Record<string, unknown> = {};
    if (envVars) updateData.envVars = envVars;
    if (status) updateData.status = status === 'restarted' ? 'running' : status;

    const updated = await db.dockerContainer.update({
      where: { id },
      data: updateData,
    });

    await createAuditLog({
      actorId: user.id,
      actorEmail: user.email,
      actorRole: user.role,
      action: 'DOCKER_CONTAINER_UPDATED',
      resourceType: 'DockerContainer',
      resourceId: id,
      result: 'SUCCESS',
      metadata: { name: container.name, status, envVarsChanged: !!envVars },
    });

    return NextResponse.json(apiSuccess(redactContainerRecord(updated), 'Container updated'));
  } catch (e) {
    return handleErr(e);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const user = await requirePermission(request, 'SERVER_MANAGE');
    const { searchParams } = new URL(request.url);
    const containerId = searchParams.get('containerId');

    if (!containerId) {
      throw apiError('containerId query parameter is required', 'VALIDATION_ERROR', undefined, 400);
    }

    const container = await db.dockerContainer.findUnique({
      where: { id: containerId },
      include: { website: { select: { ownerId: true } } },
    });
    if (!container) {
      throw apiError('Container not found', 'NOT_FOUND', undefined, 404);
    }
    if (!isAdminRole(user.role) && container.website?.ownerId !== user.id) {
      throw apiError('Forbidden', 'FORBIDDEN', undefined, 403);
    }

    const result = await callHelper('alo-docker-helper', ['remove-force', container.name], 30_000);
    if (!result.success) {
      throw apiError(`Container removal failed: ${result.stderr || 'Host Docker helper failed'}`, 'HELPER_ERROR', undefined, 502);
    }

    await db.dockerContainer.delete({
      where: { id: containerId },
    });

    await createAuditLog({
      actorId: user.id,
      actorEmail: user.email,
      actorRole: user.role,
      action: 'DOCKER_CONTAINER_DELETED',
      resourceType: 'DockerContainer',
      resourceId: containerId,
      result: 'SUCCESS',
      metadata: { name: container.name },
    });

    return NextResponse.json(apiSuccess(null, 'Container deleted'));
  } catch (e) {
    return handleErr(e);
  }
}
