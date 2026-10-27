import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { requireSession, isAdminRole } from '@/lib/auth';
import { apiError, apiSuccess, type ApiResponse } from '@/lib/response';
import { createAuditLog } from '@/lib/audit';
import { encryptSecret, decryptSecret } from '@/lib/encryption';
import {
  AI_PROVIDER_CATALOG,
  isPrivateOrInternalUrl,
  redactProvider,
  resolveProviders,
} from '@/lib/ai/providers';
import { getProviderCircuitStates } from '@/lib/ai/client';

const OPEN_SOURCE_SECRET_TYPE = 'ai_open_source_provider';

interface StoredOpenSourceProvider {
  engine: 'ollama' | 'localai' | 'vllm' | 'litellm' | 'openwebui' | 'gateway';
  label: string;
  baseUrl: string;
  defaultModel: string;
  hasApiKey: boolean;
  encryptedApiKey?: string | null;
}

const OpenSourceActionSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('register'),
    engine: z.enum(['ollama', 'localai', 'vllm', 'litellm', 'openwebui', 'gateway']),
    label: z.string().min(2).max(120),
    baseUrl: z.string().url().max(400),
    defaultModel: z.string().min(1).max(160),
    apiKey: z.string().max(400).optional(),
  }),
  z.object({
    action: z.literal('probe'),
    id: z.string().optional(),
    baseUrl: z.string().url().max(400).optional(),
    apiKey: z.string().max(400).optional(),
  }),
  z.object({
    action: z.literal('delete'),
    id: z.string().min(1),
  }),
]);

function assertSafeEndpointUrl(rawUrl: string): URL {
  const parsed = new URL(rawUrl);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Only http:// and https:// endpoints are permitted');
  }
  const host = parsed.hostname.toLowerCase();
  if (
    host === '169.254.169.254' ||
    host === 'metadata.google.internal' ||
    host === '100.100.100.200' ||
    host.startsWith('169.254.') ||
    host === '[fd00:ec2::254]'
  ) {
    throw new Error('Cloud metadata endpoints are blocked (SSRF protection)');
  }
  return parsed;
}

function handleErr(e: unknown): NextResponse {
  if (e instanceof z.ZodError) {
    return NextResponse.json(
      apiError('Validation failed', 'VALIDATION_ERROR', e.flatten(), 400),
      { status: 400 },
    );
  }
  if (e && typeof e === 'object' && 'status' in e) {
    const a = e as ApiResponse;
    return NextResponse.json(a, { status: a.status });
  }
  if (e instanceof Error) {
    return NextResponse.json(apiError(e.message, 'BAD_REQUEST', undefined, 400), { status: 400 });
  }
  return NextResponse.json(apiError('Internal server error'), { status: 500 });
}

function canViewTopology(role: string): boolean {
  return isAdminRole(role) || role === 'DEVOPS';
}

function parseStoredProvider(rawValue: string): StoredOpenSourceProvider | null {
  try {
    return JSON.parse(rawValue) as StoredOpenSourceProvider;
  } catch {
    return null;
  }
}

/**
 * GET /api/ai/providers
 *
 * Catalogue of every supported AI backend plus this server's resolved failover
 * chain, circuit-breaker snapshots, custom open-source connectors, and non-fatal
 * configuration warnings. Secrets are stripped; non-admin tenants receive masked
 * internal URLs and env variable names so private server topology is never leaked.
 */
export async function GET(request: NextRequest) {
  try {
    const user = await requireSession(request);
    const showTopology = canViewTopology(user.role);
    const resolution = resolveProviders(process.env);
    const circuits = getProviderCircuitStates(resolution.providers);

    const storedRows = await db.secret.findMany({
      where: { type: OPEN_SOURCE_SECRET_TYPE },
      orderBy: { createdAt: 'desc' },
      take: 30,
    });

    const openSourceConnectors = storedRows
      .map((row) => {
        const parsed = parseStoredProvider(row.value);
        if (!parsed) return null;
        return {
          id: row.id,
          engine: parsed.engine,
          label: parsed.label,
          baseUrl: showTopology
            ? parsed.baseUrl
            : isPrivateOrInternalUrl(parsed.baseUrl)
              ? 'internal-endpoint (redacted)'
              : parsed.baseUrl,
          defaultModel: parsed.defaultModel,
          hasApiKey: Boolean(parsed.hasApiKey),
          createdAt: row.createdAt,
        };
      })
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null);

    return NextResponse.json(
      apiSuccess({
        ready: resolution.providers.length > 0,
        order: resolution.order,
        active: resolution.providers.map((p) => redactProvider(p, { includeTopology: showTopology })),
        circuits,
        skipped: resolution.skipped.map((entry) => ({
          id: entry.id,
          label: entry.label,
          reason: showTopology ? entry.reason : 'not configured',
        })),
        warnings: showTopology ? resolution.warnings : [],
        openSourceConnectors,
        catalog: AI_PROVIDER_CATALOG.map((entry) => ({
          id: entry.id,
          label: entry.label,
          tier: entry.tier,
          kind: entry.kind,
          defaultBaseUrl: showTopology
            ? entry.baseUrl
            : isPrivateOrInternalUrl(entry.baseUrl)
              ? 'internal-endpoint (redacted)'
              : entry.baseUrl,
          baseUrlEnv: showTopology ? (entry.baseUrlEnv ?? null) : null,
          apiKeyEnv: showTopology ? entry.apiKeyEnv : 'configured-on-server',
          requiresKey: entry.requiresKey,
          anonymousAccess: entry.anonymousAccess,
          defaultModel: entry.defaultModel,
          capabilities: entry.capabilities,
          docs: entry.docs,
          notes: entry.notes,
          baseUrlVerified: entry.baseUrlVerified,
        })),
      }),
    );
  } catch (e) {
    return handleErr(e);
  }
}

/**
 * POST /api/ai/providers
 *
 * Admin-only connector for registering, live-probing, and removing Open-Source
 * OpenAI-compatible AI providers (Ollama, LocalAI, vLLM, LiteLLM, Open WebUI,
 * or custom gateways) without modifying environment variables or restarting.
 */
export async function POST(request: NextRequest) {
  try {
    const user = await requireSession(request);
    if (!isAdminRole(user.role)) {
      return NextResponse.json(
        apiError('Administrator privileges required to manage AI providers', 'FORBIDDEN', undefined, 403),
        { status: 403 },
      );
    }

    const parsed = OpenSourceActionSchema.parse(await request.json());

    if (parsed.action === 'register') {
      const safeUrl = assertSafeEndpointUrl(parsed.baseUrl);
      const normalizedBaseUrl = safeUrl.toString().replace(/\/+$/, '');
      const trimmedKey = parsed.apiKey?.trim() || '';

      const payload: StoredOpenSourceProvider = {
        engine: parsed.engine,
        label: parsed.label.trim(),
        baseUrl: normalizedBaseUrl,
        defaultModel: parsed.defaultModel.trim(),
        hasApiKey: trimmedKey.length > 0,
        encryptedApiKey: trimmedKey.length > 0 ? encryptSecret(trimmedKey) : null,
      };

      const saved = await db.secret.create({
        data: {
          userId: user.id,
          name: `oss_ai_${parsed.engine}_${Date.now()}`,
          type: OPEN_SOURCE_SECRET_TYPE,
          value: JSON.stringify(payload),
        },
      });

      await createAuditLog({
        actorId: user.id,
        actorEmail: user.email,
        actorRole: user.role,
        action: 'OPEN_SOURCE_AI_PROVIDER_REGISTERED',
        resourceType: 'Secret',
        resourceId: saved.id,
        result: 'SUCCESS',
        metadata: {
          engine: payload.engine,
          label: payload.label,
          baseUrl: payload.baseUrl,
          defaultModel: payload.defaultModel,
          hasApiKey: payload.hasApiKey,
        },
      });

      return NextResponse.json(
        apiSuccess(
          {
            connector: {
              id: saved.id,
              engine: payload.engine,
              label: payload.label,
              baseUrl: payload.baseUrl,
              defaultModel: payload.defaultModel,
              hasApiKey: payload.hasApiKey,
              createdAt: saved.createdAt,
            },
          },
          `Open-source AI provider "${payload.label}" registered`,
        ),
        { status: 201 },
      );
    }

    if (parsed.action === 'probe') {
      let targetBaseUrl = parsed.baseUrl?.trim() || '';
      let bearerKey = parsed.apiKey?.trim() || '';

      if (parsed.id) {
        const row = await db.secret.findFirst({
          where: { id: parsed.id, type: OPEN_SOURCE_SECRET_TYPE },
        });
        if (!row) {
          return NextResponse.json(
            apiError('Open-source connector not found', 'NOT_FOUND', undefined, 404),
            { status: 404 },
          );
        }
        const stored = parseStoredProvider(row.value);
        if (!stored) {
          return NextResponse.json(
            apiError('Invalid connector payload', 'BAD_REQUEST', undefined, 400),
            { status: 400 },
          );
        }
        targetBaseUrl = stored.baseUrl;
        if (!bearerKey && stored.encryptedApiKey) {
          bearerKey = decryptSecret(stored.encryptedApiKey);
        }
      }

      if (!targetBaseUrl) {
        return NextResponse.json(
          apiError('Provide either connector id or baseUrl to probe', 'VALIDATION_ERROR', undefined, 400),
          { status: 400 },
        );
      }

      const safeUrl = assertSafeEndpointUrl(targetBaseUrl);
      const base = safeUrl.toString().replace(/\/+$/, '');
      const modelsEndpoint = base.endsWith('/v1') ? `${base}/models` : `${base}/v1/models`;

      const started = Date.now();
      try {
        const res = await fetch(modelsEndpoint, {
          method: 'GET',
          headers: bearerKey ? { Authorization: `Bearer ${bearerKey}` } : {},
          signal: AbortSignal.timeout(4000),
        });
        const latencyMs = Date.now() - started;
        const json = await res.json().catch(() => null);
        const models: string[] = Array.isArray(json?.data)
          ? json.data
              .map((m: { id?: unknown }) => (typeof m?.id === 'string' ? m.id : null))
              .filter((m: string | null): m is string => Boolean(m))
              .slice(0, 20)
          : [];
        return NextResponse.json(
          apiSuccess({
            reachable: res.ok,
            httpStatus: res.status,
            latencyMs,
            modelsEndpoint,
            discoveredModels: models,
          }),
        );
      } catch (probeErr) {
        return NextResponse.json(
          apiSuccess({
            reachable: false,
            httpStatus: null,
            latencyMs: Date.now() - started,
            modelsEndpoint,
            discoveredModels: [],
            reason: probeErr instanceof Error ? probeErr.message : 'Connection failed',
          }),
        );
      }
    }

    // delete
    const existing = await db.secret.findFirst({
      where: { id: parsed.id, type: OPEN_SOURCE_SECRET_TYPE },
    });
    if (!existing) {
      return NextResponse.json(
        apiError('Open-source connector not found', 'NOT_FOUND', undefined, 404),
        { status: 404 },
      );
    }
    await db.secret.delete({ where: { id: existing.id } });
    return NextResponse.json(apiSuccess({ deleted: true }, 'Open-source AI connector removed'));
  } catch (e) {
    return handleErr(e);
  }
}
