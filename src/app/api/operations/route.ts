import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { apiSuccess, apiError, type ApiResponse } from '@/lib/response';
import { requireSession, ROLES, isRoleAtLeast } from '@/lib/auth';
import { enqueueOperation, listOperations, type OperationType } from '@/lib/operations';
import { createAuditLog } from '@/lib/audit';

const VALID_TYPES: string[] = [
  'WEBSITE_CREATE',
  'SSL_ISSUE',
  'DATABASE_CREATE',
  'FIREWALL_ADD',
  'DOCKER_RUN',
  'SITE_SUSPEND',
  'SITE_RESUME',
];

const createSchema = z.object({
  type: z.string().refine((t) => VALID_TYPES.includes(t), {
    message: `Invalid operation type. Must be one of: ${VALID_TYPES.join(', ')}`,
  }),
  resourceId: z.string().optional(),
  resourceType: z.string().optional(),
  input: z.record(z.string(), z.unknown()).default({}),
  priority: z.number().int().min(0).max(1000).optional().default(100),
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

    const status = searchParams.get('status') || undefined;
    const type = searchParams.get('type') || undefined;
    const page = parseInt(searchParams.get('page') || '1', 10);
    const limit = parseInt(searchParams.get('limit') || '20', 10);

    const canSeeAll = isRoleAtLeast(user.role, ROLES.DEVOPS);

    const result = await listOperations({
      status,
      type,
      page,
      limit: Math.min(limit, 100),
      isSuperAdminOrDevops: canSeeAll,
      requestingUserId: user.id,
    });

    return NextResponse.json(apiSuccess(result));
  } catch (e) {
    return handleErr(e);
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireSession(request);
    const body = await request.json();
    const input = createSchema.parse(body);

    const op = await enqueueOperation(
      input.type,
      input.input,
      { id: user.id, email: user.email, role: user.role },
      {
        resourceId: input.resourceId,
        resourceType: input.resourceType,
        priority: input.priority,
      },
    );

    const ip = request.headers.get('x-forwarded-for') ?? request.headers.get('x-real-ip');
    await createAuditLog({
      actorId: user.id,
      actorEmail: user.email,
      actorRole: user.role,
      action: 'OPERATION_ENQUEUE',
      resourceType: 'Operation',
      resourceId: op.id,
      result: 'SUCCESS',
      ipAddress: ip ?? undefined,
      metadata: { type: op.type, priority: op.priority },
    });

    return NextResponse.json(apiSuccess(op, 'Operation enqueued', 201), { status: 201 });
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
