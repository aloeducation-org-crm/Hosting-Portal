import { NextRequest, NextResponse } from 'next/server';
import { apiSuccess, apiError, type ApiResponse } from '@/lib/response';
import { db } from '@/lib/db';
import { verifyInternalSecretValue } from '@/lib/auth';
import { createAuditLog } from '@/lib/audit';
import { handleGitHubWebhook } from '@/lib/deploy/webhook';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function handleErr(e: unknown): NextResponse {
  if (e && typeof e === 'object' && 'status' in e) {
    const a = e as ApiResponse;
    return NextResponse.json(a, { status: a.status });
  }
  return NextResponse.json(apiError('Internal server error'), { status: 500 });
}

/**
 * Retired nested app health probe. Preserved here so existing external monitors
 * aimed at /api/deploy/webhook keep working.
 */
export async function GET() {
  return NextResponse.json({ success: true, message: 'deploy webhook alive' });
}

export async function POST(request: NextRequest) {
  const githubEvent = request.headers.get('x-github-event');
  const githubSignature = request.headers.get('x-hub-signature-256');

  // Compatibility mode: the retired app accepted GitHub push, workflow_dispatch
  // and ping events on this exact path with X-Hub-Signature-256. Delegate to the
  // canonical HMAC/dedupe/queue implementation rather than duplicating it.
  if (githubEvent || githubSignature) {
    const raw = await request.text();
    const result = await handleGitHubWebhook(raw, request.headers);
    if (githubEvent === 'ping' && result.status === 200) {
      return NextResponse.json(
        { success: true, message: 'pong' },
        { status: 200, headers: { 'Cache-Control': 'no-store' } },
      );
    }
    return NextResponse.json(result.body, {
      status: result.status,
      headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
    });
  }

  try {
    // Webhook auth via constant-time header secret check (fails closed if secret is unset or weak)
    const configuredSecret = process.env.DEPLOY_WEBHOOK_SECRET ?? process.env.INTERNAL_SECRET;
    if (!configuredSecret || configuredSecret.trim().length < 16) {
      throw apiError('Deploy webhook secret is not configured', 'WEBHOOK_NOT_CONFIGURED', undefined, 503);
    }
    const webhookSecret = request.headers.get('x-webhook-secret');
    if (!verifyInternalSecretValue(webhookSecret, configuredSecret)) {
      throw apiError('Invalid or missing webhook secret', 'UNAUTHORIZED', undefined, 401);
    }

    const body = await request.json();
    const { websiteId, branch, commitHash, commitMessage } = body as {
      websiteId: string;
      branch?: string;
      commitHash?: string;
      commitMessage?: string;
    };

    if (!websiteId) {
      throw apiError('websiteId is required', 'VALIDATION_ERROR', undefined, 400);
    }

    // Verify website exists
    const website = await db.website.findUnique({
      where: { id: websiteId },
    });
    if (!website) {
      throw apiError('Website not found', 'NOT_FOUND', undefined, 404);
    }

    // Find or create CI pipeline
    let pipeline = await db.ciPipeline.findFirst({
      where: { websiteId },
    });

    if (!pipeline) {
      pipeline = await db.ciPipeline.create({
        data: {
          name: `${website.domain}-pipeline`,
          websiteId,
          branch: branch || 'main',
          status: 'active',
        },
      });
    }

    // Get next build number
    const lastBuild = await db.ciBuild.findFirst({
      where: { pipelineId: pipeline.id },
      orderBy: { number: 'desc' },
    });
    const nextNumber = (lastBuild?.number ?? 0) + 1;

    // Create CI build
    const build = await db.ciBuild.create({
      data: {
        pipelineId: pipeline.id,
        number: nextNumber,
        commitHash,
        commitMessage,
        branch: branch || 'main',
        status: 'pending',
        triggeredBy: 'webhook',
      },
    });

    // Create deployment record
    const deployment = await db.deployment.create({
      data: {
        websiteId,
        source: 'git-push',
        commitHash,
        status: 'PENDING',
      },
    });

    await createAuditLog({
      action: 'DEPLOYMENT_WEBHOOK_TRIGGERED',
      resourceType: 'Deployment',
      resourceId: deployment.id,
      result: 'SUCCESS',
      metadata: {
        websiteId,
        buildId: build.id,
        pipelineId: pipeline.id,
        branch,
        commitHash,
        commitMessage,
      },
    });

    return NextResponse.json(
      apiSuccess(
        {
          buildId: build.id,
          deploymentId: deployment.id,
          pipelineId: pipeline.id,
          status: 'triggered',
        },
        'Deployment triggered successfully',
      ),
    );
  } catch (e) {
    return handleErr(e);
  }
}
