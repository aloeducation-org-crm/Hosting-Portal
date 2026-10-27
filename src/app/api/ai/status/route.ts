import { NextRequest, NextResponse } from 'next/server';
import { requireSession, isAdminRole } from '@/lib/auth';
import { apiError, apiSuccess, type ApiResponse } from '@/lib/response';
import { redactProvider, resolveProviders } from '@/lib/ai/providers';
import { getProviderCircuitStates, probeChain } from '@/lib/ai/client';

/**
 * GET /api/ai/status            → configuration + circuit summary (no network calls)
 * GET /api/ai/status?probe=1    → configuration + a live round-trip per provider (60s TTL)
 *
 * Notice the distinction: without `probe=1` we report `CONFIGURED` or
 * `UNCONFIGURED`, never `HEALTHY`. Only an actual completion proves a provider
 * works. Force-bypassing the 60s probe cache (`?force=1`) is restricted to
 * Admin/DevOps roles so unprivileged tenants cannot exhaust free-tier quotas.
 */
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
    const isOperator = isAdminRole(user.role) || user.role === 'DEVOPS';
    const { searchParams } = new URL(request.url);
    const probe = searchParams.get('probe') === '1' || searchParams.get('probe') === 'true';
    const force = isOperator && (searchParams.get('force') === '1' || searchParams.get('force') === 'true');

    const resolution = resolveProviders(process.env);
    const active = resolution.providers.map((p) => redactProvider(p, { includeTopology: isOperator }));
    const circuits = getProviderCircuitStates(resolution.providers);
    const safeSkipped = resolution.skipped.map((s) => ({
      id: s.id,
      label: s.label,
      reason: isOperator ? s.reason : 'not configured',
    }));
    const safeWarnings = isOperator ? resolution.warnings : [];

    if (!probe) {
      return NextResponse.json(
        apiSuccess({
          state: active.length > 0 ? 'CONFIGURED' : 'UNCONFIGURED',
          probed: false,
          active,
          circuits,
          skipped: safeSkipped,
          warnings: safeWarnings,
        }),
      );
    }

    const probes = active.length > 0 ? await probeChain(force) : [];
    const anyHealthy = probes.some((entry) => entry.ok);
    return NextResponse.json(
      apiSuccess({
        state: active.length === 0 ? 'UNCONFIGURED' : anyHealthy ? 'HEALTHY' : 'UNREACHABLE',
        probed: true,
        active,
        circuits,
        probes,
        skipped: safeSkipped,
        warnings: safeWarnings,
      }),
    );
  } catch (e) {
    return handleErr(e);
  }
}
