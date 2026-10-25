import { NextRequest, NextResponse } from 'next/server';
import { apiSuccess, apiError, type ApiResponse } from '@/lib/response';
import { requireSession, requirePermission } from '@/lib/auth';
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

export async function GET(request: NextRequest) {
  try {
    await requireSession(request);
    const { searchParams } = new URL(request.url);
    const websiteId = searchParams.get('websiteId');

    const where: Record<string, unknown> = {};
    if (websiteId) {
      where.websiteId = websiteId;
    }

    const containers = await db.dockerContainer.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json(apiSuccess(containers));
  } catch (e) {
    return handleErr(e);
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requirePermission(request, 'SERVER_MANAGE');
    const body = await request.json();
    const { name, image, portMapping, envVars, websiteId } = body as {
      name: string;
      image: string;
      portMapping?: string;
      envVars?: Record<string, string>;
      websiteId?: string;
    };

    if (!name || !image) {
      throw apiError('name and image are required', 'VALIDATION_ERROR', undefined, 400);
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
        portMapping: portMapping ?? null,
        envVars: envVars ?? undefined,
        websiteId: websiteId ?? null,
      },
    });

    // Run docker container via helper — FAIL if helper fails (no silent simulation)
    const args = ['run', '-d', '--name', name];
    if (portMapping) {
      args.push('-p', portMapping);
    }
    if (envVars) {
      for (const [key, value] of Object.entries(envVars)) {
        args.push('-e', `${key}=${value}`);
      }
    }
    args.push(image);

    const result = await callHelper('alo-hosting-helper', args, 30_000);
    if (!result.success) {
      // Rollback: mark container as error
      await db.dockerContainer.update({
        where: { id: container.id },
        data: { status: 'error' },
      });
      throw apiError(`Container creation failed: ${result.stderr || 'Unknown error'}`, 'HELPER_ERROR', undefined, 500);
    }

    await createAuditLog({
      actorId: user.id,
      actorEmail: user.email,
      actorRole: user.role,
      action: 'DOCKER_CONTAINER_CREATED',
      resourceType: 'DockerContainer',
      resourceId: container.id,
      result: 'SUCCESS',
      metadata: { name, image, portMapping, websiteId },
    });

    return NextResponse.json(apiSuccess(container, 'Container created'), { status: 201 });
  } catch (e) {
    return handleErr(e);
  }
}

export async function PUT(request: NextRequest) {
  try {
    const user = await requirePermission(request, 'SERVER_MANAGE');
    const body = await request.json();
    const { id, status, envVars } = body as {
      id: string;
      status?: string;
      envVars?: Record<string, string>;
    };

    if (!id) {
      throw apiError('id is required', 'VALIDATION_ERROR', undefined, 400);
    }

    const container = await db.dockerContainer.findUnique({
      where: { id },
    });
    if (!container) {
      throw apiError('Container not found', 'NOT_FOUND', undefined, 404);
    }

    const updateData: Record<string, unknown> = {};
    if (envVars) updateData.envVars = envVars;
    if (status) updateData.status = status;

    const updated = await db.dockerContainer.update({
      where: { id },
      data: updateData,
    });

    // Control container via helper — FAIL if helper fails
    if (status && ['stopped', 'running', 'restarted'].includes(status)) {
      const action = status === 'restarted' ? 'restart' : status === 'running' ? 'start' : 'stop';
      const result = await callHelper('alo-hosting-helper', [action, container.name], 30_000);
      if (!result.success) {
        throw apiError(`Container ${action} failed: ${result.stderr || 'Unknown error'}`, 'HELPER_ERROR', undefined, 500);
      }
    }

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

    return NextResponse.json(apiSuccess(updated, 'Container updated'));
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
    });
    if (!container) {
      throw apiError('Container not found', 'NOT_FOUND', undefined, 404);
    }

    // Remove container via helper — FAIL if helper fails
    const result = await callHelper('alo-hosting-helper', ['rm', '-f', container.name], 30_000);
    if (!result.success) {
      throw apiError(`Container removal failed: ${result.stderr || 'Unknown error'}`, 'HELPER_ERROR', undefined, 500);
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
