import { NextRequest, NextResponse } from 'next/server';
import { apiSuccess, apiError, type ApiResponse } from '@/lib/response';
import { requireSuperAdmin } from '@/lib/auth';
import { env } from '@/lib/env';
import { db } from '@/lib/db';
import { z } from 'zod';

function handleErr(e: unknown): NextResponse {
  if (e && typeof e === 'object' && 'status' in e) {
    const a = e as ApiResponse;
    return NextResponse.json(a, { status: a.status });
  }
  return NextResponse.json(apiError('Internal server error'), { status: 500 });
}

const SECRET_KEYS = ['NEXTAUTH_SECRET', 'JWT_SECRET', 'DATABASE_URL'] as const;

function maskSecret(value: string): string {
  if (value.length <= 4) return '****';
  return value.slice(0, 4) + '*'.repeat(value.length - 4);
}

function getPlatformSettings() {
  const raw = env as unknown as Record<string, unknown>;
  const masked: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(raw)) {
    if (SECRET_KEYS.includes(key as (typeof SECRET_KEYS)[number]) && typeof value === 'string') {
      masked[key] = maskSecret(value);
    } else {
      masked[key] = value;
    }
  }

  return masked;
}

const updateSettingsSchema = z.object({
  settings: z.record(z.string(), z.unknown()).optional(),
});

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
    const user = await requireSuperAdmin(request);

    const body = await request.json();
    const parsed = updateSettingsSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        apiError('Validation failed', 'VALIDATION_ERROR', parsed.error.flatten().fieldErrors),
        { status: 400 },
      );
    }

    // Placeholder: settings would be written to .env in production
    const ip = request.headers.get('x-forwarded-for') ?? request.headers.get('x-real-ip');
    await db.auditLog.create({
      data: {
        actorUserId: user.id,
        actorEmail: user.email,
        actorRole: user.role,
        action: 'SETTINGS_UPDATE',
        resourceType: 'Settings',
        result: 'SUCCESS',
        ipAddress: ip,
      },
    });

    return NextResponse.json(
      apiSuccess(null, 'Settings saved to .env. Restart the server for changes to take effect.'),
    );
  } catch (e) {
    return handleErr(e);
  }
}
