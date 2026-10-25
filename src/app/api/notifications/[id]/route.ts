import { NextRequest, NextResponse } from 'next/server';
import { apiSuccess, apiError, type ApiResponse } from '@/lib/response';
import { requireSession } from '@/lib/auth';
import { db } from '@/lib/db';

function handleErr(e: unknown): NextResponse {
  if (e && typeof e === 'object' && 'status' in e) {
    const a = e as ApiResponse;
    return NextResponse.json(a, { status: a.status });
  }
  return NextResponse.json(apiError('Internal server error'), { status: 500 });
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireSession(request);
    const { id } = await params;

    const notification = await db.notification.findUnique({ where: { id } });
    if (!notification) {
      return NextResponse.json(
        apiError('Notification not found', 'NOT_FOUND', undefined, 404),
        { status: 404 },
      );
    }

    if (notification.userId !== user.id) {
      return NextResponse.json(
        apiError('Notification not found', 'NOT_FOUND', undefined, 404),
        { status: 404 },
      );
    }

    const updated = await db.notification.update({
      where: { id },
      data: { read: true },
    });

    return NextResponse.json(apiSuccess(updated, 'Notification marked as read'));
  } catch (e) {
    return handleErr(e);
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireSession(request);
    const { id } = await params;

    const notification = await db.notification.findUnique({ where: { id } });
    if (!notification) {
      return NextResponse.json(
        apiError('Notification not found', 'NOT_FOUND', undefined, 404),
        { status: 404 },
      );
    }

    if (notification.userId !== user.id) {
      return NextResponse.json(
        apiError('Notification not found', 'NOT_FOUND', undefined, 404),
        { status: 404 },
      );
    }

    await db.notification.delete({ where: { id } });

    return NextResponse.json(apiSuccess(null, 'Notification deleted'));
  } catch (e) {
    return handleErr(e);
  }
}
