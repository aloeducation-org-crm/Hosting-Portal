import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { isAdminRole, requireSession, type AuthUser } from '@/lib/auth';
import { apiError, apiSuccess, type ApiResponse } from '@/lib/response';
import { WorkflowValidationError, parseGraph } from '@/lib/ai/automation/graph';
import { createAuditLog } from '@/lib/audit';

function handleErr(e: unknown): NextResponse {
  if (e && typeof e === 'object' && 'status' in e) {
    const a = e as ApiResponse;
    return NextResponse.json(a, { status: a.status });
  }
  if (e instanceof WorkflowValidationError) {
    return NextResponse.json(apiError(e.message, 'INVALID_WORKFLOW', e.issues, 422), { status: 422 });
  }
  return NextResponse.json(apiError('Internal server error'), { status: 500 });
}

async function authorize(id: string, user: AuthUser) {
  const workflow = await db.aiWorkflow.findUnique({ where: { id } });
  if (!workflow) return { error: NextResponse.json(apiError('Workflow not found', 'NOT_FOUND', undefined, 404), { status: 404 }) };
  if (!isAdminRole(user.role) && workflow.userId !== user.id) {
    return { error: NextResponse.json(apiError('Forbidden', 'FORBIDDEN', undefined, 403), { status: 403 }) };
  }
  return { workflow };
}

/** GET /api/ai/workflows/:id — workflow + last 10 runs. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireSession(request);
    const { id } = await params;
    const authorized = await authorize(id, user);
    if (authorized.error) return authorized.error;

    const runs = await db.aiWorkflowRun.findMany({
      where: { workflowId: id },
      orderBy: { startedAt: 'desc' },
      take: 10,
    });
    return NextResponse.json(apiSuccess({ workflow: authorized.workflow, runs }));
  } catch (e) {
    return handleErr(e);
  }
}

/** PATCH /api/ai/workflows/:id — update name/description/graph/status. */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireSession(request);
    const { id } = await params;
    const authorized = await authorize(id, user);
    if (authorized.error) return authorized.error;

    const body = (await request.json()) as Record<string, unknown>;
    const data: Record<string, unknown> = {};

    if (typeof body.name === 'string' && body.name.trim()) data.name = body.name.trim().slice(0, 160);
    if (typeof body.description === 'string') data.description = body.description.slice(0, 2000);
    if (body.status === 'draft' || body.status === 'active' || body.status === 'archived') data.status = body.status;

    if (body.nodes !== undefined || body.edges !== undefined) {
      const existing = authorized.workflow;
      const graph = parseGraph({
        nodes: body.nodes !== undefined ? body.nodes : existing.nodes ?? '[]',
        edges: body.edges !== undefined ? body.edges : existing.edges ?? '[]',
      });
      data.nodes = JSON.stringify(graph.nodes);
      data.edges = JSON.stringify(graph.edges);
    }

    if (!Object.keys(data).length) {
      return NextResponse.json(apiError('Nothing to update', 'VALIDATION_ERROR', undefined, 400), { status: 400 });
    }

    const workflow = await db.aiWorkflow.update({ where: { id }, data });
    await createAuditLog({
      actorId: user.id,
      actorEmail: user.email,
      actorRole: user.role,
      action: 'AI_WORKFLOW_UPDATE',
      resourceType: 'ai_workflow',
      resourceId: id,
      result: 'success',
      metadata: { fields: Object.keys(data) },
    });
    return NextResponse.json(apiSuccess({ workflow }));
  } catch (e) {
    return handleErr(e);
  }
}

/** DELETE /api/ai/workflows/:id — cascade deletes its runs. */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireSession(request);
    const { id } = await params;
    const authorized = await authorize(id, user);
    if (authorized.error) return authorized.error;

    await db.aiWorkflow.delete({ where: { id } });
    await createAuditLog({
      actorId: user.id,
      actorEmail: user.email,
      actorRole: user.role,
      action: 'AI_WORKFLOW_DELETE',
      resourceType: 'ai_workflow',
      resourceId: id,
      result: 'success',
    });
    return NextResponse.json(apiSuccess({ deleted: id }));
  } catch (e) {
    return handleErr(e);
  }
}
