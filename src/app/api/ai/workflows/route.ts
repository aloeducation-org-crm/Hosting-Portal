import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { isAdminRole, requireSession } from '@/lib/auth';
import { apiError, apiSuccess, type ApiResponse } from '@/lib/response';
import { WorkflowValidationError, parseGraph } from '@/lib/ai/automation/graph';
import { WORKFLOW_TEMPLATES, findTemplate } from '@/lib/ai/automation/templates';
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

/**
 * GET /api/ai/workflows
 * GET /api/ai/workflows?templates=1   → starter templates (no DB access)
 *
 * Admins see every workflow; other users see the ones they own.
 */
export async function GET(request: NextRequest) {
  try {
    const user = await requireSession(request);
    const params = new URL(request.url).searchParams;

    if (params.get('templates') === '1') {
      return NextResponse.json(apiSuccess({ templates: WORKFLOW_TEMPLATES }));
    }

    const status = params.get('status');
    const workflows = await db.aiWorkflow.findMany({
      where: {
        ...(isAdminRole(user.role) ? {} : { userId: user.id }),
        ...(status ? { status } : {}),
      },
      orderBy: { updatedAt: 'desc' },
      take: 100,
      include: { _count: { select: { runs: true } } },
    });
    return NextResponse.json(apiSuccess({ workflows }));
  } catch (e) {
    return handleErr(e);
  }
}

/**
 * POST /api/ai/workflows
 *
 * Body: { name, description?, nodes?, edges?, status?, templateId? }
 * The graph is validated as a DAG before it is stored, so nothing can be saved
 * that the engine would refuse to execute.
 */
export async function POST(request: NextRequest) {
  try {
    const user = await requireSession(request);
    const body = (await request.json()) as Record<string, unknown>;

    const template = typeof body.templateId === 'string' ? findTemplate(body.templateId) : undefined;
    if (typeof body.templateId === 'string' && !template) {
      return NextResponse.json(apiError('Unknown template', 'NOT_FOUND', undefined, 404), { status: 404 });
    }

    const name = (typeof body.name === 'string' && body.name.trim()) || template?.name;
    if (!name) {
      return NextResponse.json(apiError('Name is required', 'VALIDATION_ERROR', undefined, 400), { status: 400 });
    }

    const graph = parseGraph({
      nodes: body.nodes ?? (template ? template.graph.nodes : []),
      edges: body.edges ?? (template ? template.graph.edges : []),
    });

    const status = body.status === 'active' || body.status === 'archived' ? body.status : 'draft';

    const workflow = await db.aiWorkflow.create({
      data: {
        userId: user.id,
        name: name.slice(0, 160),
        description: typeof body.description === 'string' ? body.description.slice(0, 2000) : template?.description ?? null,
        nodes: JSON.stringify(graph.nodes),
        edges: JSON.stringify(graph.edges),
        status,
      },
    });

    await createAuditLog({
      actorId: user.id,
      actorEmail: user.email,
      actorRole: user.role,
      action: 'AI_WORKFLOW_CREATE',
      resourceType: 'ai_workflow',
      resourceId: workflow.id,
      result: 'success',
      metadata: { name: workflow.name, template: body.templateId ?? null, nodes: graph.nodes.length },
    });

    return NextResponse.json(apiSuccess({ workflow }), { status: 201 });
  } catch (e) {
    return handleErr(e);
  }
}
