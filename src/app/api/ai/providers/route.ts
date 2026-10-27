import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { isAdminRole, requireSession } from '@/lib/auth';
import { apiError, apiSuccess, type ApiResponse } from '@/lib/response';
import { AI_PROVIDER_CATALOG, aiRuntimeConfig, redactProviderForRole, resolveProviders } from '@/lib/ai/providers';

function handleErr(e: unknown, requestId: string): NextResponse {
  if (e && typeof e === 'object' && 'status' in e) {
    const a = e as ApiResponse;
    return NextResponse.json(a, { status: a.status, headers: { 'X-Request-Id': requestId } });
  }
  return NextResponse.json(apiError('Internal server error'), {
    status: 500,
    headers: { 'X-Request-Id': requestId },
  });
}

/**
 * GET /api/ai/providers
 *
 * Reports the resolved failover chain without any secret material: provider ids,
 * tiers, models, whether a key is present, and (for admins) why other providers were skipped.
 */
export async function GET(request: NextRequest) {
  const requestId = request.headers.get('x-request-id') || randomUUID();
  try {
    const user = await requireSession(request);
    const admin = isAdminRole(user.role);
    const resolution = resolveProviders(process.env);
    const config = aiRuntimeConfig();

    return NextResponse.json(
      apiSuccess({
        requestId,
        ready: resolution.providers.length > 0,
        order: resolution.order,
        chain: resolution.providers.map((p) => redactProviderForRole(p, admin)),
        skipped: admin ? resolution.skipped : [],
        warnings: admin ? resolution.warnings : [],
        limits: {
          timeoutMs: config.timeoutMs,
          retriesPerProvider: config.retriesPerProvider,
          breakerThreshold: config.breakerThreshold,
          breakerCooldownMs: config.breakerCooldownMs,
        },
        catalog: AI_PROVIDER_CATALOG.map((definition) => ({
          id: definition.id,
          label: definition.label,
          tier: definition.tier,
          requiresKey: definition.requiresKey,
          anonymousAccess: definition.anonymousAccess,
          apiKeyEnv: admin ? definition.apiKeyEnv : undefined,
          baseUrlEnv: admin ? definition.baseUrlEnv : undefined,
          defaultModel: definition.defaultModel,
          docs: definition.docs,
          notes: definition.notes,
          baseUrlVerified: definition.baseUrlVerified,
        })),
      }),
      { headers: { 'X-Request-Id': requestId } },
    );
  } catch (e) {
    return handleErr(e, requestId);
  }
}
