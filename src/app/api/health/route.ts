import { NextResponse } from 'next/server';
import { apiSuccess, apiError } from '@/lib/response';
import { db } from '@/lib/db';
import { readReleaseIdentity } from '@/lib/release-identity';

const startTime = Date.now();

export async function GET() {
  /**
   * Which release is actually serving. `null` means the running process has no
   * identity record — a checkout that was never deployed through
   * `scripts/deploy-production.sh` / `scripts/deploy-release.sh`, or a dev
   * server. It is reported as unknown rather than guessed, and the deploy step
   * treats a mismatch (or an absent record) as a failed verification.
   */
  const release = readReleaseIdentity();
  const basePayload = {
    uptime: Math.floor((Date.now() - startTime) / 1000),
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV ?? 'unknown',
    version: process.env.npm_package_version ?? '1.0.0',
    release: release
      ? {
          commitSha: release.commitSha,
          mode: release.mode,
          activatedAt: release.activatedAt,
          deploymentId: release.deploymentId,
          artifactSha256: release.artifactSha256,
        }
      : null,
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
