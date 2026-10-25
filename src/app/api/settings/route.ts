import { NextRequest, NextResponse } from 'next/server';
import { apiSuccess, apiError, type ApiResponse } from '@/lib/response';
import { requireSuperAdmin } from '@/lib/auth';
import { env } from '@/lib/env';
function handleErr(e: unknown): NextResponse {
  if (e && typeof e === 'object' && 'status' in e) {
    const a = e as ApiResponse;
    return NextResponse.json(a, { status: a.status });
  }
  return NextResponse.json(apiError('Internal server error'), { status: 500 });
}

const SECRET_KEY_PATTERN = /(?:SECRET|PASSWORD|_PASS(?:WORD)?$|TOKEN|API_KEY|_KEY$|DATABASE_URL)/i;

function maskSecret(): string {
  return '********';
}

function getPlatformSettings() {
  const raw = env as unknown as Record<string, unknown>;
  const masked: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(raw)) {
    if (SECRET_KEY_PATTERN.test(key) && typeof value === 'string' && value.length > 0) {
      masked[key] = maskSecret();
    } else {
      masked[key] = value;
    }
  }

  return masked;
}

export async function GET(request: NextRequest) {
  try {
    await requireSuperAdmin(request);
    const settings = getPlatformSettings();
    return NextResponse.json(apiSuccess(settings));
  } catch (e) {
    return handleErr(e);
  }
}

export async function PUT(request: NextRequest) {
  try {
    await requireSuperAdmin(request);
    return NextResponse.json(
      apiError(
        'Runtime configuration is deployment-managed. Update the service environment and restart the service.',
        'RUNTIME_CONFIGURATION_MANAGED_BY_DEPLOYMENT',
        undefined,
        501,
      ),
      { status: 501 },
    );
  } catch (e) {
    return handleErr(e);
  }
}
