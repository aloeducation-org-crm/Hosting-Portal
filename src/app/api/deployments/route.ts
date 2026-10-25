import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { apiSuccess, apiError, type ApiResponse } from '@/lib/response';
import { requireSession, requirePermission, ROLES } from '@/lib/auth';
import { callHelper } from '@/lib/helpers';
import { db } from '@/lib/db';
import { Prisma } from '@prisma/client';

const createSchema = z.object({
  websiteId: z.string().min(1),
  source: z.string().optional(),
  commitHash: z.string().optional(),
});

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
    const { searchParams } = new URL(request.url);

    const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') ?? '25', 10) || 25));
    const websiteId = searchParams.get('websiteId') ?? undefined;
    const status = searchParams.get('status') ?? undefined;

    const where: Prisma.DeploymentWhereInput = {};

    if (websiteId) {
      where.websiteId = websiteId;
    }

    if (status) {
      where.status = status as Prisma.EnumDeploymentStatusFilter['equals'];
    }

    if (user.role !== ROLES.SUPER_ADMIN) {
      where.website = { ownerId: user.id };
    }

    const [items, total] = await Promise.all([
      db.deployment.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          website: { select: { id: true, domain: true } },
        },
      }),
      db.deployment.count({ where }),
    ]);

    return NextResponse.json(
      apiSuccess({
        items,
        total,
        page,
        limit,
      }),
    );
  } catch (e) {
    return handleErr(e);
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requirePermission(request, 'WEBSITE_DEPLOY');
    const body = await request.json();
    const input = createSchema.parse(body);

    const website = await db.website.findUnique({
      where: { id: input.websiteId },
    });

    if (!website || website.deletedAt) {
      return NextResponse.json(
        apiError('Website not found', 'NOT_FOUND', undefined, 404),
        { status: 404 },
      );
    }

    const deployment = await db.deployment.create({
      data: {
        websiteId: input.websiteId,
        source: input.source,
        commitHash: input.commitHash,
        status: 'PENDING',
        actorId: user.id,
        startedAt: new Date(),
      },
    });

    const ip = request.headers.get('x-forwarded-for') ?? request.headers.get('x-real-ip');
    await db.auditLog.create({
      data: {
        actorUserId: user.id,
        actorEmail: user.email,
        actorRole: user.role,
        action: 'DEPLOY_START',
        resourceType: 'Deployment',
        resourceId: deployment.id,
        domain: website.domain,
        result: 'SUCCESS',
        ipAddress: ip,
      },
    });

    const result = await callHelper('alo-hosting-helper', ['deploy', website.domain]);

    if (result.success) {
      await db.deployment.update({
        where: { id: deployment.id },
        data: {
          status: 'SUCCESS',
          finishedAt: new Date(),
          buildOutput: result.stdout,
        },
      });
    } else {
      await db.deployment.update({
        where: { id: deployment.id },
        data: {
          status: 'FAILED',
          finishedAt: new Date(),
          buildOutput: result.stderr,
        },
      });
    }

    const logEntries: { level: string; message: string }[] = [];

    logEntries.push({
      level: 'INFO',
      message: `Deployment started by ${user.email}`,
    });

    if (result.stdout) {
      logEntries.push({
        level: result.success ? 'INFO' : 'ERROR',
        message: result.stdout.trim(),
      });
    }

    if (result.stderr) {
      logEntries.push({
        level: 'ERROR',
        message: result.stderr.trim(),
      });
    }

    logEntries.push({
      level: result.success ? 'INFO' : 'ERROR',
      message: `Deployment ${result.success ? 'succeeded' : 'failed'} (exitCode: ${result.exitCode})`,
    });

    await db.deploymentLog.createMany({
      data: logEntries.map((entry) => ({
        deploymentId: deployment.id,
        level: entry.level,
        message: entry.message,
      })),
    });

    const updatedDeployment = await db.deployment.findUnique({
      where: { id: deployment.id },
      include: {
        website: { select: { id: true, domain: true } },
      },
    });

    return NextResponse.json(
      apiSuccess(updatedDeployment, 'Deployment created', 201),
      { status: 201 },
    );
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json(
        apiError('Validation failed', 'VALIDATION_ERROR', e.flatten(), 400),
        { status: 400 },
      );
    }
    return handleErr(e);
  }
}
