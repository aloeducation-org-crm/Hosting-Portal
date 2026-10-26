import { NextResponse } from 'next/server';
import { apiSuccess, apiError } from '@/lib/response';
import { db } from '@/lib/db';

const startTime = Date.now();

export async function GET() {
  const basePayload = {
    uptime: Math.floor((Date.now() - startTime) / 1000),
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV ?? 'unknown',
    version: process.env.npm_package_version ?? '1.0.0',
  };

  try {
    // Probe both connectivity and the current hosting schema. SELECT 1 alone
    // reports healthy for an old SQLite file whose app queries still fail.
    await db.$queryRaw`SELECT "ipAddress", "cpuUsage", "memoryUsage", "diskUsage" FROM "servers" LIMIT 0`;
    await db.$queryRaw`SELECT "domainName", "sslStatus", "vhostPath", "serverId" FROM "hosting_sites" LIMIT 0`;
    return NextResponse.json(
      apiSuccess({
        ...basePayload,
        databaseStatus: 'connected' as const,
        schemaStatus: 'current' as const,
      }),
    );
  } catch {
    const errBody = apiError(
      'Database connectivity or schema check failed',
      'DATABASE_UNAVAILABLE',
      {
        ...basePayload,
        databaseStatus: 'disconnected' as const,
        schemaStatus: 'unavailable' as const,
      },
      503,
    );
    return NextResponse.json(errBody, { status: 503 });
  }
}
