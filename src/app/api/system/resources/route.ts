import { NextRequest, NextResponse } from 'next/server';
import { apiSuccess, apiError, type ApiResponse } from '@/lib/response';
import { requireSession } from '@/lib/auth';
import { callHelper } from '@/lib/helpers';

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

    const result = await callHelper('alo-health-helper', ['resources']);
    if (!result.success) {
      return NextResponse.json(
        apiError('Failed to retrieve system resources', 'HELPER_ERROR', { stderr: result.stderr }),
        { status: 500 },
      );
    }

    let data;
    try {
      data = JSON.parse(result.stdout);
    } catch {
      return NextResponse.json(
        apiError('Failed to parse resources response', 'PARSE_ERROR', { stdout: result.stdout }),
        { status: 500 },
      );
    }

    return NextResponse.json(apiSuccess(data));
  } catch (e) {
    return handleErr(e);
  }
}
