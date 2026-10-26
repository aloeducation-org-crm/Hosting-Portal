import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { isAdminRole, requireSession } from '@/lib/auth';
import { apiError, apiSuccess, type ApiResponse } from '@/lib/response';
import { WorkflowValidationError } from '@/lib/ai/automation/graph';
import { executeStoredWorkflow } from '@/lib/ai/automation/runner';
import { AIProviderError } from '@/lib/ai/client';
import { recordAIUsage } from '@/lib/ai/usage';
import { createAuditLog } from '@/lib/audit';

function handleErr(e: unknown): NextResponse {
  if (e && typeof e === 'object' && 'status' in e) {
    const a = e as ApiResponse;
    return NextResponse.json(a, { status: a.status });
  }
  if (e instanceof WorkflowValidationError) {
    return NextResponse.json(apiError(e.message, 'INVALID_WORKFLOW', e.issues, 422), { status: 422 });
  }
  if (e instanceof AIProviderError) {
    return NextResponse.json({ ...apiError(e.message, e.code, e.attempts, e.status) }, { status: e.status });
  }
  return NextResponse.json(apiError('Internal server error'), { status: 500 });
}

/**
 * POST /api/ai/workflows/:id/run
 *
 * Body: { input?: unknown, dryRun?: boolean, continueOnError?: boolean }
 *
 * Runs the stored graph server-side against the real provider chain and the
 * read-only hosting tools, then persists an AiWorkflowRun (status, per-step
 * log, provider, token usage). `dryRun` validates the graph and returns the plan
 * without calling any provider or tool.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const startedAt = Date.now();
  try {
    const user = await requireSession(request);
    const { id } = await params;

    const workflow = await db.aiWorkflow.findUnique({ where: { id } });
    if (!workflow) {
      return NextResponse.json(apiError('Workflow not found', 'NOT_FOUND', undefined, 404), { status: 404 });
    }
    if (!isAdminRole(user.role) && workflow.userId !== user.id) {
      return NextResponse.json(apiError('Forbidden', 'FORBIDDEN', undefined, 403), { status: 403 });
    }
    if (workflow.status === 'archived') {
      return NextResponse.json(apiError('Workflow is archived', 'VALIDATION_ERROR', undefined, 409), { status: 409 });
    }

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    if (body.input !== undefined && JSON.stringify(body.input).length > 100_000) {
      return NextResponse.json(apiError('Input is too large (max 100KB)', 'VALIDATION_ERROR', undefined, 413), { status: 413 });
    }

    const outcome = await executeStoredWorkflow(workflow, {
      input: body.input ?? null,
      dryRun: body.dryRun === true,
      continueOnError: body.continueOnError === true,
      trigger: 'manual',
      userId: user.id,
      isAdmin: isAdminRole(user.role),
      signal: request.signal,
    });

    if (!outcome.result.steps.every((step) => step.dryRun)) {
      await recordAIUsage({
        userId: user.id,
        model: outcome.result.providers.join(',') || null,
        totalTokens: outcome.result.tokensUsed,
        requestId: outcome.runId,
      });
    }

    await createAuditLog({
      actorId: user.id,
      actorEmail: user.email,
      actorRole: user.role,
      action: 'AI_WORKFLOW_RUN',
      resourceType: 'ai_workflow',
      resourceId: id,
      result: outcome.result.status,
      durationMs: Date.now() - startedAt,
      metadata: {
        runId: outcome.runId,
        dryRun: body.dryRun === true,
        aiCalls: outcome.result.aiCalls,
        tokensUsed: outcome.result.tokensUsed,
        providers: outcome.result.providers,
      },
    });

    return NextResponse.json(apiSuccess({
      runId: outcome.runId,
      status: outcome.result.status,
      dryRun: body.dryRun === true,
      output: outcome.result.output,
      steps: outcome.result.steps,
      error: outcome.result.error ?? null,
      durationMs: outcome.result.durationMs,
      aiCalls: outcome.result.aiCalls,
      tokensUsed: outcome.result.tokensUsed,
      providers: outcome.result.providers,
    }));
  } catch (e) {
    return handleErr(e);
  }
}
