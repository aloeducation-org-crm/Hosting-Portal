import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth';
import { db } from '@/lib/db';
import { apiError, apiSuccess, type ApiResponse } from '@/lib/response';

function handleErr(e: unknown): NextResponse {
  if (e && typeof e === 'object' && 'status' in e) {
    const a = e as ApiResponse;
    return NextResponse.json(a, { status: a.status });
  }
  return NextResponse.json(apiError('Internal server error'), { status: 500 });
}

/**
 * GET /api/ai/token
 *
 * Returns authenticated user's persisted token usage summary from `TokenUsage`.
 * Replaces legacy fake `{ token: "demo", remaining: 1000 }` stub. Never returns
 * fabricated quotas or secret API keys.
 */
export async function GET(request: NextRequest) {
  try {
    const user = await requireSession(request);
    const aggregate = await db.tokenUsage.aggregate({
      where: { userId: user.id },
      _sum: {
        promptTokens: true,
        completionTokens: true,
        totalTokens: true,
      },
      _count: {
        id: true,
      },
    });

    return NextResponse.json(
      apiSuccess({
        userId: user.id,
        requestsRecorded: aggregate._count.id ?? 0,
        promptTokensUsed: aggregate._sum.promptTokens ?? 0,
        completionTokensUsed: aggregate._sum.completionTokens ?? 0,
        totalTokensUsed: aggregate._sum.totalTokens ?? 0,
        usageSource: 'provider-reported',
        quotaEnforced: false,
        estimatedCostUsd: null,
      }),
    );
  } catch (e) {
    return handleErr(e);
  }
}
