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

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requirePermission(request, 'WEBSITE_DEPLOY');
    const { id } = await params;

    const website = await db.website.findUnique({ where: { id } });
    if (!website || website.deletedAt) {
      return NextResponse.json(apiError('Website not found', 'NOT_FOUND', undefined, 404), { status: 404 });
    }

    // Set status to DEPLOYING
    await db.website.update({
      where: { id },
      data: { status: 'DEPLOYING' },
    });

    const ip = request.headers.get('x-forwarded-for') ?? request.headers.get('x-real-ip');

    // Audit: deploy start
    await db.auditLog.create({
      data: {
        actorUserId: user.id, actorEmail: user.email, actorRole: user.role,
        action: 'DEPLOY_START', resourceType: 'Website', resourceId: id,
        domain: website.domain, result: 'SUCCESS', ipAddress: ip,
      },
    });

    // Create Deployment record
    const deployment = await db.deployment.create({
      data: {
        websiteId: id,
        status: 'RUNNING',
        startedAt: new Date(),
        actorId: user.id,
      },
    });

    // Create initial DeploymentLog entry
    await db.deploymentLog.create({
      data: {
        deploymentId: deployment.id,
        level: 'INFO',
        message: 'Deployment initiated',
      },
    });

    // Call the deploy helper
    const result = await callHelper('alo-hosting-helper', ['deploy', website.domain]);

    // Create result log entry
    await db.deploymentLog.create({
      data: {
        deploymentId: deployment.id,
        level: result.success ? 'INFO' : 'ERROR',
        message: result.success ? 'Deployment completed successfully' : `Deployment failed: ${result.stderr}`,
      },
    });

    if (!result.success) {
      // Rollback status on failure
      await db.website.update({
        where: { id },
        data: { status: 'ACTIVE' },
      });

      await db.deployment.update({
        where: { id: deployment.id },
        data: {
          status: 'FAILED',
          finishedAt: new Date(),
          buildOutput: result.stderr,
        },
      });

      await db.auditLog.create({
        data: {
          actorUserId: user.id, actorEmail: user.email, actorRole: user.role,
          action: 'DEPLOY_FAIL', resourceType: 'Deployment', resourceId: deployment.id,
          domain: website.domain, result: 'FAILURE', ipAddress: ip,
          errorCode: 'HELPER_ERROR',
        },
      });

      return NextResponse.json(apiError('Deployment failed', 'HELPER_ERROR', { stderr: result.stderr }), { status: 500 });
    }

    // Update deployment record as success
    const updatedDeployment = await db.deployment.update({
      where: { id: deployment.id },
      data: {
        status: 'SUCCESS',
        finishedAt: new Date(),
        buildOutput: result.stdout,
      },
    });

    // Set website status back to ACTIVE
    await db.website.update({
      where: { id },
      data: { status: 'ACTIVE' },
    });

    return NextResponse.json(apiSuccess(updatedDeployment, 'Deployment completed', 201), { status: 201 });
  } catch (e) { return handleErr(e); }
}
