import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { apiSuccess, apiError, type ApiResponse } from '@/lib/response';
import { requirePermission } from '@/lib/auth';
import { db } from '@/lib/db';
import { callHelper } from '@/lib/helpers';
import { readFileSync } from 'fs';
import { existsSync } from 'fs';

const checkSchema = z.object({
  websiteId: z.string().min(1),
});

function handleErr(e: unknown): NextResponse {
  if (e && typeof e === 'object' && 'status' in e) {
    const a = e as ApiResponse;
    return NextResponse.json(a, { status: a.status });
  }
  return NextResponse.json(apiError('Internal server error'), { status: 500 });
}

async function checkSystemdUnit(domain: string): Promise<{ state: string | null }> {
  try {
    const unitPath = `/etc/systemd/system/alo-${domain}.service`;
    if (!existsSync(unitPath)) {
      return { state: 'not_found' };
    }
    const content = readFileSync(unitPath, 'utf-8');
    return { state: 'exists' };
  } catch {
    return { state: 'error' };
  }
}

async function checkLocalPort(port: number, healthPath: string | null): Promise<{ ok: boolean; status: number | null; error: string | null }> {
  try {
    const path = healthPath || '/';
    const res = await fetch(`http://localhost:${port}${path}`, {
      signal: AbortSignal.timeout(5000),
    });
    return { ok: res.ok, status: res.status, error: null };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Connection refused';
    return { ok: false, status: null, error: msg };
  }
}

async function checkPublicUrl(domain: string): Promise<{ ok: boolean; status: number | null; error: string | null }> {
  try {
    const res = await fetch(`https://${domain}`, {
      signal: AbortSignal.timeout(10000),
      redirect: 'follow',
    });
    return { ok: res.ok, status: res.status, error: null };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Unreachable';
    return { ok: false, status: null, error: msg };
  }
}

async function checkSsl(domain: string): Promise<{ ok: boolean; daysUntilExpiry: number | null; error: string | null }> {
  try {
    const { execSync } = await import('child_process');
    const output = execSync(
      `echo | openssl s_client -connect ${domain}:443 -servername ${domain} 2>/dev/null | openssl x509 -noout -enddate 2>/dev/null`,
      { timeout: 10000 },
    ).toString().trim();

    if (!output) {
      return { ok: false, daysUntilExpiry: null, error: 'No certificate found' };
    }

    const match = output.match(/notAfter=(.+)/);
    if (!match?.[1]) {
      return { ok: false, daysUntilExpiry: null, error: 'Could not parse expiry' };
    }

    const expiryDate = new Date(match[1]);
    const now = new Date();
    const diffMs = expiryDate.getTime() - now.getTime();
    const daysUntilExpiry = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    return { ok: daysUntilExpiry > 0, daysUntilExpiry, error: null };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'SSL check failed';
    return { ok: false, daysUntilExpiry: null, error: msg };
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requirePermission(request, 'WEBSITE_READ');
    const body = await request.json();
    const input = checkSchema.parse(body);

    const website = await db.website.findUnique({
      where: { id: input.websiteId },
    });

    if (!website) {
      return NextResponse.json(apiError('Website not found', 'NOT_FOUND', undefined, 404), { status: 404 });
    }

    const results: Record<string, unknown> = {
      websiteId: website.id,
      domain: website.domain,
      checks: {},
    };

    // Try helper first
    let helperUsed = false;
    try {
      const helperResult = await callHelper('alo-health-helper', [website.id]);
      if (helperResult.success && helperResult.stdout) {
        try {
          const parsed = JSON.parse(helperResult.stdout);
          results.helperResult = parsed;
          helperUsed = true;
        } catch {
          results.helperRaw = helperResult.stdout;
        }
      }
    } catch {
      // Helpers not available, fall through to manual checks
    }

    // Manual checks
    if (!helperUsed) {
      const [systemdResult, localPortResult, publicUrlResult, sslResult] = await Promise.all([
        checkSystemdUnit(website.domain),
        website.applicationPort
          ? checkLocalPort(website.applicationPort, website.healthPath)
          : Promise.resolve({ ok: false, status: null, error: 'No port configured' }),
        checkPublicUrl(website.domain),
        checkSsl(website.domain),
      ]);

      results.checks = {
        systemd: systemdResult,
        localPort: localPortResult,
        publicUrl: publicUrlResult,
        ssl: sslResult,
      };
    }

    // Determine overall status
    const checks = results.checks as Record<string, { ok?: boolean }> | undefined;
    let overallStatus = 'HEALTHY';
    if (checks) {
      const allChecks = Object.values(checks);
      const hasDown = allChecks.some((c) => c.ok === false);
      const hasIssues = allChecks.some((c) => !c.ok);
      if (hasDown) {
        overallStatus = 'DOWN';
      } else if (hasIssues) {
        overallStatus = 'DEGRADED';
      }
    }
    results.overallStatus = overallStatus;

    // Upsert health check record
    await db.healthCheck.upsert({
      where: { websiteId: website.id },
      create: {
        websiteId: website.id,
        systemdState: (checks?.systemd as { state?: string })?.state ?? null,
        localHttp: (checks?.localPort as { ok?: boolean })?.ok ?? null,
        publicHttp: (checks?.publicUrl as { ok?: boolean })?.ok ?? null,
        ssl: (checks?.ssl as { ok?: boolean })?.ok ?? null,
        overallStatus: overallStatus as 'HEALTHY' | 'DEGRADED' | 'DOWN' | 'SUSPENDED' | 'DEPLOYING' | 'RESTORING' | 'UNKNOWN',
        checkedAt: new Date(),
      },
      update: {
        systemdState: (checks?.systemd as { state?: string })?.state ?? null,
        localHttp: (checks?.localPort as { ok?: boolean })?.ok ?? null,
        publicHttp: (checks?.publicUrl as { ok?: boolean })?.ok ?? null,
        ssl: (checks?.ssl as { ok?: boolean })?.ok ?? null,
        overallStatus: overallStatus as 'HEALTHY' | 'DEGRADED' | 'DOWN' | 'SUSPENDED' | 'DEPLOYING' | 'RESTORING' | 'UNKNOWN',
        checkedAt: new Date(),
      },
    });

    return NextResponse.json(apiSuccess(results));
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json(apiError('Validation failed', 'VALIDATION_ERROR', e.flatten(), 400), { status: 400 });
    }
    return handleErr(e);
  }
}
