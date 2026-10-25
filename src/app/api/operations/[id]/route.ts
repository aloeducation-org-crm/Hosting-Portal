import { NextRequest, NextResponse } from 'next/server';
import { apiSuccess, apiError, type ApiResponse } from '@/lib/response';
import { requireSession, ROLES, isRoleAtLeast } from '@/lib/auth';
import { getOperationById, retryOperation, cancelOperation } from '@/lib/operations';
import { createAuditLog } from '@/lib/audit';

function handleErr(e: unknown): NextResponse {
  if (e && typeof e === 'object' && 'status' in e) {
    const a = e as ApiResponse;
    return NextResponse.json(a, { status: a.status });
  }
  return NextResponse.json(apiError('Internal server error'), { status: 500 });
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireSession(request);
    const { id } = await params;

    const op = await getOperationById(id);
    if (!op) {
      return NextResponse.json(apiError('Operation not found', 'NOT_FOUND', undefined, 404), {
        status: 404,
      });
    }

    // Non-admin users can only see their own operations
    if (!isRoleAtLeast(user.role, ROLES.DEVOPS) && op.actorId !== user.id) {
      return NextResponse.json(apiError('Forbidden', 'FORBIDDEN', undefined, 403), { status: 403 });
    }

    return NextResponse.json(apiSuccess(op));
  } catch (e) {
    return handleErr(e);
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireSession(request);
    const { id } = await params;

    const op = await getOperationById(id);
    if (!op) {
      return NextResponse.json(apiError('Operation not found', 'NOT_FOUND', undefined, 404), {
        status: 404,
      });
    }

    if (op.status !== 'FAILED') {
      return NextResponse.json(
        apiError(`Cannot retry operation in status: ${op.status}`, 'INVALID_STATE', undefined, 409),
        { status: 409 },
      );
    }

    const retried = await retryOperation(id);

    const ip = request.headers.get('x-forwarded-for') ?? request.headers.get('x-real-ip');
    await createAuditLog({
      actorId: user.id,
      actorEmail: user.email,
      actorRole: user.role,
      action: 'OPERATION_RETRY',
      resourceType: 'Operation',
      resourceId: id,
      result: 'SUCCESS',
      ipAddress: ip ?? undefined,
    });

    return NextResponse.json(apiSuccess(retried, 'Operation re-queued for retry'));
  } catch (e) {
    if (e instanceof Error && e.message.includes('Cannot retry')) {
      return NextResponse.json(
        apiError(e.message, 'INVALID_STATE', undefined, 409),
        { status: 409 },
      );
    }
    return handleErr(e);
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireSession(request);
    const { id } = await params;

    const op = await getOperationById(id);
    if (!op) {
      return NextResponse.json(apiError('Operation not found', 'NOT_FOUND', undefined, 404), {
        status: 404,
      });
    }

    // Only SUPER_ADMIN or the actor can cancel
    if (!isRoleAtLeast(user.role, ROLES.SUPER_ADMIN) && op.actorId !== user.id) {
      return NextResponse.json(apiError('Forbidden', 'FORBIDDEN', undefined, 403), { status: 403 });
    }

    const cancelled = await cancelOperation(id);

    const ip = request.headers.get('x-forwarded-for') ?? request.headers.get('x-real-ip');
    await createAuditLog({
      actorId: user.id,
      actorEmail: user.email,
      actorRole: user.role,
      action: 'OPERATION_CANCEL',
      resourceType: 'Operation',
      resourceId: id,
      result: 'SUCCESS',
      ipAddress: ip ?? undefined,
    });

    return NextResponse.json(apiSuccess(cancelled, 'Operation cancelled'));
  } catch (e) {
    if (e instanceof Error && e.message.includes('Cannot cancel')) {
      return NextResponse.json(
        apiError(e.message, 'INVALID_STATE', undefined, 409),
        { status: 409 },
      );
    }
    return handleErr(e);
  }
}
