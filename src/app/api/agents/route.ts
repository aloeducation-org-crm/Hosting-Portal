import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { requireSession } from '@/lib/auth';
import { ensureDefaultAgentsSeeded } from '@/lib/seed-agents';
import { apiError, apiSuccess, type ApiResponse } from '@/lib/response';
import { requireAdmin } from '@/lib/auth';
import { describeAgents, dispatchTask, AGENT_SCOPES } from '@/lib/agents/agent';
import { allowlistCatalogue } from '@/lib/agents/allowlist';

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

    // ?kind=server returns the enrolled Linux host agents (control-plane view:
    // connectivity, last heartbeat, version, capabilities, recent task results).
    if (request.nextUrl.searchParams.get('kind') === 'server') {
      await requireAdmin(request);
      const agents = await describeAgents();
      return NextResponse.json(
        apiSuccess({ agents, allowlist: allowlistCatalogue() }),
      );
    }

    const existingCount = await db.aiAgent.count();
    if (existingCount === 0) {
      await ensureDefaultAgentsSeeded();
    }

    const { searchParams } = new URL(request.url);
    const category = searchParams.get('category');
    const search = searchParams.get('search')?.trim().slice(0, 120);

    const where: Record<string, unknown> = { isActive: true };
    if (category && category !== 'All') {
      where.category = category.toLowerCase();
    }
    if (search) {
      where.OR = [
        { name: { contains: search } },
        { description: { contains: search } },
      ];
    }

    const agents = await db.aiAgent.findMany({
      where,
      take: 100,
      orderBy: { createdAt: 'asc' },
      include: {
        _count: { select: { runs: true } },
      },
    });

    const formatted = agents.map((a) => ({
      id: a.id,
      name: a.name,
      slug: a.slug,
      description: a.description ?? '',
      category: a.category ?? 'utility',
      icon: a.icon ?? 'Code2',
      isFree: true,
      usageCount: a._count.runs,
    }));

    return NextResponse.json({ success: true, agents: formatted });
  } catch (e) {
    return handleErr(e);
  }
}

const dispatchSchema = z.object({
  agentId: z.string().min(1).max(64),
  command: z.string().min(1).max(64),
  args: z.record(z.string(), z.union([z.string().max(300), z.number(), z.boolean()])).optional(),
  correlationId: z.string().max(64).optional(),
});

/**
 * Dispatch an allowlisted task to an enrolled agent. Admin only.
 *
 * Authorization is enforced twice — here and again inside `dispatchTask`, which
 * re-checks the allowlist, the agent's granted capabilities and the argument
 * schema. A refusal is recorded as an audit event, never executed.
 */
export async function POST(request: NextRequest) {
  try {
    const admin = await requireAdmin(request);
    const parsed = dispatchSchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json(apiError('Validation failed', 'VALIDATION_ERROR', parsed.error.flatten(), 400), { status: 400 });
    }
    const task = await dispatchTask({
      agentId: parsed.data.agentId,
      command: parsed.data.command,
      args: parsed.data.args ?? {},
      correlationId: parsed.data.correlationId,
      actorEmail: admin.email,
      actorScopes: [...AGENT_SCOPES],
    });
    if (task.status === 'REFUSED') {
      return NextResponse.json(apiError(task.refuseReason ?? 'Task refused', 'TASK_REFUSED', { taskId: task.id }, 403), { status: 403 });
    }
    return NextResponse.json(
      apiSuccess(task, task.requiresApproval ? 'Task queued and waiting for approval' : 'Task queued for the agent', 201),
      { status: 201 },
    );
  } catch (e) {
    return handleErr(e);
  }
}
