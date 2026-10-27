import { NextRequest, NextResponse } from 'next/server';
import { apiSuccess, apiError, type ApiResponse } from '@/lib/response';
import { requireSession } from '@/lib/auth';

function handleErr(e: unknown): NextResponse {
  if (e && typeof e === 'object' && 'status' in e) {
    const a = e as ApiResponse;
    return NextResponse.json(a, { status: a.status });
  }
  return NextResponse.json(apiError('Internal server error'), { status: 500 });
}

const PROMPT_TEMPLATES = [
  {
    id: 'website-copy',
    name: 'Website Copy Generator',
    description: 'Generate professional website copy for landing pages, about pages, etc.',
    category: 'content',
  },
  {
    id: 'seo-meta',
    name: 'SEO Meta Description',
    description: 'Generate SEO-optimized meta descriptions for your web pages.',
    category: 'seo',
  },
  {
    id: 'bug-fix',
    name: 'Bug Fix Assistant',
    description: 'Get help diagnosing and fixing code bugs.',
    category: 'development',
  },
  {
    id: 'config-help',
    name: 'Server Config Helper',
    description: 'Get help with Nginx, Apache, or Caddy configuration.',
    category: 'devops',
  },
  {
    id: 'sql-query',
    name: 'SQL Query Builder',
    description: 'Generate SQL queries based on natural language descriptions.',
    category: 'database',
  },
];

export async function GET(request: NextRequest) {
  try {
    await requireSession(request);
    return NextResponse.json(apiSuccess(PROMPT_TEMPLATES));
  } catch (e) {
    return handleErr(e);
  }
}
