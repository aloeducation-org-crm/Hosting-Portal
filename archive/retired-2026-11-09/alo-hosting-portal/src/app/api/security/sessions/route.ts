import { NextRequest, NextResponse } from 'next/server';
import { apiSuccess, apiError, type ApiResponse } from '@/lib/response';
import { requireSession } from '@/lib/auth';
import { db } from '@/lib/db';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/nextauth';

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

    const sessions = await db.session.findMany({
      where: {
        userId: user.id,
        expiresAt: { gt: new Date() },
      },
      select: {
        id: true,
        ipAddress: true,
        userAgent: true,
        expiresAt: true,
        createdAt: true,
        token: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    // Try to identify the current session token
    let currentToken: string | undefined;
    try {
      const nextAuthSession = await getServerSession(authOptions);
      // The current session doesn't directly give us the DB token,
      // so we'll use the Authorization header or session token cookie
      const authHeader = request.headers.get('authorization');
      if (authHeader?.startsWith('Bearer ')) {
        currentToken = authHeader.slice(7);
      }
      // Also check for session token cookie
      const cookies = request.headers.get('cookie');
      if (!currentToken && cookies) {
        const match = cookies.match(/next-auth\.session-token=([^;]+)/);
        if (match) {
          currentToken = match[1];
        }
      }
    } catch {
      // Ignore - current session identification is best-effort
    }

    const result = sessions.map((s) => ({
      id: s.id,
      ipAddress: s.ipAddress,
      userAgent: s.userAgent,
      expiresAt: s.expiresAt,
      createdAt: s.createdAt,
      isCurrent: currentToken ? s.token === currentToken : false,
    }));

    return NextResponse.json(apiSuccess(result));
  } catch (e) {
    return handleErr(e);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const user = await requireSession(request);
    const { searchParams } = new URL(request.url);
    const sessionId = searchParams.get('sessionId');
    const revokeAll = searchParams.get('all') === 'true';

    if (!sessionId && !revokeAll) {
      return NextResponse.json(
        apiError('Provide sessionId or all=true', 'VALIDATION_ERROR', undefined, 400),
        { status: 400 },
      );
    }

    let deletedCount: number;

    if (revokeAll) {
      // Revoke all except current session - find current session token
      let currentToken: string | undefined;
      try {
        const cookies = request.headers.get('cookie');
        if (cookies) {
          const match = cookies.match(/next-auth\.session-token=([^;]+)/);
          if (match) {
            currentToken = match[1];
          }
        }
        const authHeader = request.headers.get('authorization');
        if (!currentToken && authHeader?.startsWith('Bearer ')) {
          currentToken = authHeader.slice(7);
        }
      } catch {
        // Ignore
      }

      const whereClause: Record<string, unknown> = {
        userId: user.id,
        expiresAt: { gt: new Date() },
      };

      // If we have a current token, exclude it
      if (currentToken) {
        whereClause.token = { not: currentToken };
      }

      const result = await db.session.deleteMany({
        where: whereClause,
      });
      deletedCount = result.count;
    } else {
      // Revoke a single session
      const session = await db.session.findFirst({
        where: {
          id: sessionId!,
          userId: user.id,
        },
      });

      if (!session) {
        return NextResponse.json(
          apiError('Session not found', 'NOT_FOUND', undefined, 404),
          { status: 404 },
        );
      }

      await db.session.delete({
        where: { id: session.id },
      });
      deletedCount = 1;
    }

    return NextResponse.json(apiSuccess({ revoked: deletedCount }));
  } catch (e) {
    return handleErr(e);
  }
}
