import { NextRequest, NextResponse } from 'next/server';
import { apiSuccess, apiError, type ApiResponse } from '@/lib/response';

function handleErr(e: unknown): NextResponse {
  if (e && typeof e === 'object' && 'status' in e) {
    const a = e as ApiResponse;
    return NextResponse.json(a, { status: a.status });
  }
  return NextResponse.json(apiError('Internal server error'), { status: 500 });
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const q = searchParams.get('q') ?? '';

    const suggestions = [
      `${q}.com`,
      `${q}.io`,
      `${q}.dev`,
      `${q}.app`,
      `get${q}.com`,
      `${q}-hosting.com`,
      `my${q}.io`,
      `${q}-cloud.dev`,
    ];

    return NextResponse.json(apiSuccess(suggestions));
  } catch (e) {
    return handleErr(e);
  }
}
