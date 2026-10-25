import { NextResponse } from 'next/server';
import { apiSuccess } from '@/lib/response';
import { db } from '@/lib/db';

const startTime = Date.now();

export async function GET() {
  try {
    await db.$queryRaw`SELECT 1`;
    return NextResponse.json(
      apiSuccess({
        uptime: Math.floor((Date.now() - startTime) / 1000),
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV ?? 'unknown',
        version: process.env.npm_package_version ?? '0.0.0',
        databaseStatus: 'connected' as const,
      }),
    );
  } catch {
    return NextResponse.json(
      apiSuccess({
        uptime: Math.floor((Date.now() - startTime) / 1000),
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV ?? 'unknown',
        version: process.env.npm_package_version ?? '0.0.0',
        databaseStatus: 'disconnected' as const,
      }),
    );
  }
}
