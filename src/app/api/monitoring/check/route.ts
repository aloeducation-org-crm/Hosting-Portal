import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { apiSuccess, apiError, type ApiResponse } from '@/lib/response';
import { requirePermission, assertWebsiteAccess } from '@/lib/auth';
import { db } from '@/lib/db';
import tls from 'node:tls';
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
  // Treat stored domains as untrusted too: TLS APIs avoid shell interpretation entirely.
  if (!/^(?=.{1,253}$)(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)(?:\\.(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?))*$/.test(domain)) {
    return { ok: false, daysUntilExpiry: null, error: 'Invalid domain stored for website' };
  }
  return new Promise((resolve) => {
    const socket = tls.connect({ host: domain, port: 443, servername: domain, rejectUnauthorized: true, timeout: 8000 }, () => {
      const validTo = socket.getPeerCertificate().valid_to;
      socket.end();
      const expiry = validTo ? new Date(validTo) : null;
      if (!expiry || Number.isNaN(expiry.getTime())) {
        resolve({ ok: false, daysUntilExpiry: null, error: 'Certificate expiry metadata unavailable' });
        return;
      }
      const daysUntilExpiry = Math.floor((expiry.getTime() - Date.now()) / 86400000);
      resolve({ ok: daysUntilExpiry > 0, daysUntilExpiry, error: null });
    });
    socket.setTimeout(8000, () => socket.destroy(new Error('TLS connection timed out')));
    socket.once('error', (e) => resolve({ ok: false, daysUntilExpiry: null, error: e.message }));
  });
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
    assertWebsiteAccess(user, website);

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
