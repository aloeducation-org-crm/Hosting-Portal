import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth';
import { apiSuccess } from '@/lib/response';
import { redactProvider, resolveProviders } from '@/lib/ai/providers';
import { probeChain } from '@/lib/ai/client';

/**
 * GET /api/ai/status            → configuration summary (no network calls)
 * GET /api/ai/status?probe=1    → configuration + a live round-trip per provider
 *
 * `state` is CONFIGURED until a probe actually succeeds, because a resolved
 * provider only proves that environment variables were set.
 */
export async function GET(request: NextRequest) {
  try {
    await requireSession(request);
    const resolution = resolveProviders(process.env);
    const configured = resolution.providers.length > 0;
    const url = new URL(request.url);
    const wantProbe = url.searchParams.get('probe') === '1';

    const probes = wantProbe && configured ? await probeChain(false) : null;
    const healthy = probes ? probes.some((probe) => probe.ok) : null;

    return NextResponse.json(apiSuccess({
      configured,
      state: !configured ? 'NOT_CONFIGURED' : healthy === null ? 'CONFIGURED_NOT_CHECKED' : healthy ? 'HEALTHY' : 'UNHEALTHY',
      // Legacy fields kept for existing clients.
      providerType: configured ? 'openai-compatible-chain' : null,
      model: resolution.providers[0]?.model ?? null,
      chain: resolution.providers.map(redactProvider),
      skipped: resolution.skipped,
      warnings: resolution.warnings,
      probes,
    }));
  } catch {
    return NextResponse.json({ success: false, error: 'Authentication required' }, { status: 401 });
  }
}
