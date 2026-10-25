import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth';
import { apiError, apiSuccess, type ApiResponse } from '@/lib/response';
import { resolveProviders } from '@/lib/ai/providers';
import { listProviderModels } from '@/lib/ai/client';

function handleErr(e: unknown): NextResponse {
  if (e && typeof e === 'object' && 'status' in e) {
    const a = e as ApiResponse;
    return NextResponse.json(a, { status: a.status });
  }
  return NextResponse.json(apiError('Internal server error'), { status: 500 });
}

const CACHE_TTL_MS = 300_000;
let cache: { at: number; key: string; value: Awaited<ReturnType<typeof load>> } | null = null;

async function load(all: boolean) {
  const { providers, skipped, warnings } = resolveProviders(process.env);
  const targets = all ? providers : providers.slice(0, 1);
  const results = await Promise.all(targets.map((provider) => listProviderModels(provider)));
  return { ready: providers.length > 0, providers: results, skipped, warnings };
}

/**
 * GET /api/ai/models?all=1
 *
 * Live model catalogue from the provider(s) in the chain. Free tiers rotate model
 * IDs, so this is the only trustworthy source for a model picker.
 */
export async function GET(request: NextRequest) {
  try {
    await requireSession(request);
    const all = new URL(request.url).searchParams.get('all') === '1';
    const resolution = resolveProviders(process.env);
    const key = `${all ? 'all' : 'first'}:${resolution.providers.map((p) => `${p.id}:${p.baseUrl}`).join('|')}`;
    if (cache && cache.key === key && Date.now() - cache.at < CACHE_TTL_MS) {
      return NextResponse.json(apiSuccess({ ...cache.value, cached: true }));
    }
    const value = await load(all);
    cache = { at: Date.now(), key, value };
    return NextResponse.json(apiSuccess({ ...value, cached: false }));
  } catch (e) {
    return handleErr(e);
  }
}
