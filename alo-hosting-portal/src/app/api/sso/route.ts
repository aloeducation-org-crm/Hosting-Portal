import { NextRequest, NextResponse } from 'next/server';
import { apiSuccess, apiError, type ApiResponse } from '@/lib/response';
import { requireSession, requireSuperAdmin } from '@/lib/auth';
import fs from 'fs/promises';
import path from 'path';

const SSO_CONFIG_PATH = path.join(process.cwd(), 'data', 'sso-config.json');

function handleErr(e: unknown): NextResponse {
  if (e && typeof e === 'object' && 'status' in e) {
    const a = e as ApiResponse;
    return NextResponse.json(a, { status: a.status });
  }
  return NextResponse.json(apiError('Internal server error'), { status: 500 });
}

function maskSecret(secret: string | undefined): string {
  if (!secret || secret.length === 0) return '';
  if (secret.length <= 8) return '****';
  return secret.slice(0, 4) + '****' + secret.slice(-4);
}

export async function GET(request: NextRequest) {
  try {
    await requireSession(request);

    let config: Record<string, unknown> = {};
    try {
      const raw = await fs.readFile(SSO_CONFIG_PATH, 'utf-8');
      config = JSON.parse(raw);
    } catch {
      // No config file exists yet — use defaults from env
    }

    return NextResponse.json(
      apiSuccess({
        enabled: (config.enabled as boolean) ?? (process.env.SSO_ENABLED === 'true'),
        provider: (config.provider as string) ?? process.env.SSO_PROVIDER ?? null,
        clientId: (config.clientId as string) ?? process.env.SSO_CLIENT_ID ?? null,
        clientSecret: maskSecret(
          (config.clientSecret as string) ?? process.env.SSO_CLIENT_SECRET ?? undefined,
        ),
        metadataUrl: (config.metadataUrl as string) ?? process.env.SSO_METADATA_URL ?? null,
      }),
    );
  } catch (e) {
    return handleErr(e);
  }
}

export async function POST(request: NextRequest) {
  try {
    await requireSuperAdmin(request);
    const body = await request.json();
    const { provider, clientId, clientSecret, metadataUrl, enabled } = body as {
      provider?: string;
      clientId?: string;
      clientSecret?: string;
      metadataUrl?: string;
      enabled?: boolean;
    };

    if (!provider || typeof provider !== 'string') {
      throw apiError('Provider is required', 'INVALID_INPUT', undefined, 400);
    }

    if (!clientId || typeof clientId !== 'string') {
      throw apiError('Client ID is required', 'INVALID_INPUT', undefined, 400);
    }

    if (!clientSecret || typeof clientSecret !== 'string') {
      throw apiError('Client secret is required', 'INVALID_INPUT', undefined, 400);
    }

    if (typeof enabled !== 'boolean') {
      throw apiError('Enabled status is required', 'INVALID_INPUT', undefined, 400);
    }

    const config = {
      provider,
      clientId,
      clientSecret,
      metadataUrl: metadataUrl ?? null,
      enabled,
      updatedAt: new Date().toISOString(),
    };

    await fs.mkdir(path.dirname(SSO_CONFIG_PATH), { recursive: true });
    await fs.writeFile(SSO_CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');

    return NextResponse.json(apiSuccess(null, 'SSO configuration updated successfully'));
  } catch (e) {
    return handleErr(e);
  }
}
