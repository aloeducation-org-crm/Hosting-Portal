import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth';
import { apiError, apiSuccess, type ApiResponse } from '@/lib/response';
import { AI_PROVIDER_CATALOG, aiRuntimeConfig, redactProvider, resolveProviders } from '@/lib/ai/providers';

function handleErr(e: unknown): NextResponse {
  if (e && typeof e === 'object' && 'status' in e) {
    const a = e as ApiResponse;
    return NextResponse.json(a, { status: a.status });
  }
  return NextResponse.json(apiError('Internal server error'), { status: 500 });
}

/**
 * GET /api/ai/providers
 *
 * Reports the resolved failover chain without any secret material: provider ids,
 * tiers, models, whether a key is present, and why other providers were skipped.
 * Configuration is NOT a health check — use ?probe=1 (or /api/ai/status?probe=1)
 * for a live call.
 */
export async function GET(request: NextRequest) {
  try {
    await requireSession(request);
    const resolution = resolveProviders(process.env);
    const config = aiRuntimeConfig();
    return NextResponse.json(apiSuccess({
      ready: resolution.providers.length > 0,
      order: resolution.order,
      chain: resolution.providers.map(redactProvider),
      skipped: resolution.skipped,
      warnings: resolution.warnings,
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
        apiKeyEnv: definition.apiKeyEnv,
        baseUrlEnv: definition.baseUrlEnv,
        defaultModel: definition.defaultModel,
        docs: definition.docs,
        notes: definition.notes,
        baseUrlVerified: definition.baseUrlVerified,
      })),
    }));
  } catch (e) {
    return handleErr(e);
  }
}
