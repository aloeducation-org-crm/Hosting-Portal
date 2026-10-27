import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { isAdminRole, requireSession } from '@/lib/auth';
import { apiError, apiSuccess } from '@/lib/response';
import { redactProviderForRole, resolveProviders } from '@/lib/ai/providers';
import { probeChain } from '@/lib/ai/client';

/**
 * GET /api/ai/status            → configuration summary (no network calls)
 * GET /api/ai/status?probe=1    → configuration + a live round-trip per provider (admin-only)
 *
 * `state` is CONFIGURED_NOT_CHECKED until a live probe actually succeeds, because
 * a resolved provider only proves that environment variables were set.
 */
export async function GET(request: NextRequest) {
  const requestId = request.headers.get('x-request-id') || randomUUID();
  try {
    const user = await requireSession(request);
    const admin = isAdminRole(user.role);
    const resolution = resolveProviders(process.env);
    const configured = resolution.providers.length > 0;
    const url = new URL(request.url);
    const wantProbe = url.searchParams.get('probe') === '1';

    if (wantProbe && !admin) {
      return NextResponse.json(
        apiError('Live provider probing requires administrator privileges', 'FORBIDDEN', undefined, 403),
        { status: 403, headers: { 'X-Request-Id': requestId } },
      );
    }

    const probes = wantProbe && configured ? await probeChain(false) : null;
    const healthy = probes ? probes.some((probe) => probe.ok) : null;

    return NextResponse.json(
      apiSuccess({
        requestId,
        configured,
        state: !configured
          ? 'NOT_CONFIGURED'
          : healthy === null
          ? 'CONFIGURED_NOT_CHECKED'
          : healthy
          ? 'HEALTHY'
          : 'UNHEALTHY',
        // Legacy fields kept for existing clients.
        providerType: configured ? 'openai-compatible-chain' : null,
        model: resolution.providers[0]?.model ?? null,
        chain: resolution.providers.map((p) => redactProviderForRole(p, admin)),
        skipped: admin ? resolution.skipped : [],
        warnings: admin ? resolution.warnings : [],
        probes,
      }),
      { headers: { 'X-Request-Id': requestId } },
    );
  } catch {
    return NextResponse.json(
      { success: false, error: 'Authentication required' },
      { status: 401, headers: { 'X-Request-Id': requestId } },
    );
  }
}
