import { NextResponse } from 'next/server';
import { apiSuccess, apiError } from '@/lib/response';
import { readReleaseIdentity } from '@/lib/release-identity';
import { buildHealthReport, httpStatusFor, describeHealth } from '@/lib/health';

/**
 * Liveness and readiness for the control plane.
 *
 * SEC-13: this route previously reported one code, `DATABASE_UNAVAILABLE`, for
 * both "the database is unreachable" and "the schema is behind the code", and
 * its `uptime` counted from the first request to the route rather than from
 * process start. It now delegates to `src/lib/health.ts`, which distinguishes
 * those cases (DATABASE_UNREACHABLE / SCHEMA_MISSING / SCHEMA_OUT_OF_DATE) and
 * reports a real process uptime.
 *
 * `release` is `null` when the running process has no identity record — a
 * checkout that was never deployed through `scripts/deploy-release.sh`, or a dev
 * server. It is reported as unknown rather than guessed, and the deploy step
 * treats an absent record as a failed verification.
 */
export async function GET() {
  const release = readReleaseIdentity();
  const report = await buildHealthReport({
    release: release
      ? {
          commitSha: release.commitSha,
          mode: release.mode,
          activatedAt: release.activatedAt,
          deploymentId: release.deploymentId,
          artifactSha256: release.artifactSha256,
        }
      : null,
  });

  const status = httpStatusFor(report);
  const payload = {
    uptime: report.uptimeSeconds,
    startedAt: report.startedAt,
    timestamp: report.timestamp,
    environment: report.environment,
    version: report.version,
    release: (report as unknown as { release: unknown }).release ?? null,
    status: report.status,
    reason: report.reason,
    databaseStatus: report.databaseStatus,
    schemaStatus: report.schemaStatus,
    databaseConfigured: report.databaseConfigured,
    message: describeHealth(report),
  };

  if (status === 200) {
    return NextResponse.json(apiSuccess(payload));
  }
  return NextResponse.json(apiError(report.reason, 'UNHEALTHY', payload, status), { status });
}
