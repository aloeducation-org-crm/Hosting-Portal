import { NextRequest, NextResponse } from 'next/server';
import { apiSuccess, apiError, type ApiResponse } from '@/lib/response';
import { requireSession } from '@/lib/auth';
import { callHelper, classifyHelperFailure } from '@/lib/helpers';
import { db } from '@/lib/db';
import { createAuditLog } from '@/lib/audit';

function handleErr(e: unknown): NextResponse {
  if (e && typeof e === 'object' && 'status' in e) {
    const a = e as ApiResponse;
    return NextResponse.json(a, { status: a.status });
  }
  return NextResponse.json(apiError('Internal server error'), { status: 500 });
}

/**
 * GET /api/servers/discover
 * Calls alo-health-helper system-info to perform real Ubuntu server discovery.
 * Returns live system information: OS, kernel, CPU, memory, disk, load, listening ports.
 * Upserts a Server record in the database with discovered data.
 */
export async function GET(request: NextRequest) {
  try {
    const user = await requireSession(request);

    // Call the real health helper to discover system information
    const result = await callHelper('alo-health-helper', ['system-info'], 30_000);

    if (!result.success) {
      const failure = classifyHelperFailure('alo-health-helper', result);
      return NextResponse.json(apiError(failure.message, failure.code), { status: failure.status });
    }

    let systemInfo: Record<string, unknown>;
    try {
      systemInfo = JSON.parse(result.stdout.trim());
    } catch {
      return NextResponse.json(
        apiError('Failed to parse discovery data', 'PARSE_ERROR', { raw: result.stdout.slice(0, 500) }),
        { status: 500 },
      );
    }

    // The helper wraps in {"success":true,"data":{...}}
    const data = (systemInfo.data ?? systemInfo) as Record<string, unknown>;
    const hostname = String(data.hostname || 'localhost');

    // Also get listening ports
    let ports: unknown[] = [];
    try {
      const portsResult = await callHelper('alo-health-helper', ['listening-ports'], 15_000);
      if (portsResult.success) {
        const portsData = JSON.parse(portsResult.stdout.trim());
        ports = ((portsData.ports ?? (portsData.data as Record<string, unknown>)?.ports) ?? []) as unknown[];
      }
    } catch {
      // Non-critical
    }

    // Detect running services
    const detectedServices: string[] = [];
    const criticalServices = ['caddy', 'nginx', 'mysql', 'mariadb', 'postgresql', 'php8.2-fpm', 'docker', 'redis-server', 'bind9', 'named', 'postfix', 'dovecot', 'rspamd'];

    for (const svc of criticalServices) {
      try {
        const svcResult = await callHelper('alo-health-helper', ['service-status', svc], 5_000);
        if (svcResult.success) {
          const svcData = JSON.parse(svcResult.stdout.trim());
          if (svcData.active === true || svcData.active === 'active') {
            detectedServices.push(svc);
          }
        }
      } catch {
        // Not installed or not running
      }
    }

    // Extract typed values from the helper output
    const memBytes = Number((data.memory as Record<string, unknown>)?.totalBytes) || 0;
    const diskBytes = Number((data.disk as Record<string, unknown>)?.totalBytes) || 0;
    const cpuCores = Number((data.cpu as Record<string, unknown>)?.cores) || 0;
    const uptimeStr = String(data.uptime || '');

    // Parse uptime string like "up 5 days, 3 hours, 20 minutes" to seconds
    let uptimeSeconds = 0;
    const dayMatch = uptimeStr.match(/(\d+)\s*day/);
    const hourMatch = uptimeStr.match(/(\d+)\s*hour/);
    const minMatch = uptimeStr.match(/(\d+)\s*min/);
    if (dayMatch) uptimeSeconds += parseInt(dayMatch[1] ?? '0', 10) * 86400;
    if (hourMatch) uptimeSeconds += parseInt(hourMatch[1] ?? '0', 10) * 3600;
    if (minMatch) uptimeSeconds += parseInt(minMatch[1] ?? '0', 10) * 60;

    // Upsert server record (only use fields that exist in the Prisma schema)
    const server = await db.server.upsert({
      where: { hostname },
      create: {
        hostname,
        ip: (data.ip as string) || null,
        os: (data.os as string) || null,
        cpuCores: cpuCores || null,
        ramGb: Math.round((memBytes / (1024 * 1024 * 1024)) * 100) / 100,
        diskGb: Math.round((diskBytes / (1024 * 1024 * 1024)) * 100) / 100,
        uptime: uptimeSeconds || null,
      },
      update: {
        os: (data.os as string) || undefined,
        cpuCores: cpuCores || undefined,
        ramGb: Math.round((memBytes / (1024 * 1024 * 1024)) * 100) / 100,
        diskGb: Math.round((diskBytes / (1024 * 1024 * 1024)) * 100) / 100,
        uptime: uptimeSeconds || undefined,
        updatedAt: new Date(),
      },
    });

    // Store resource metric snapshot
    const loadAvg = data.loadAverage as Record<string, unknown> | undefined;
    const usedMemBytes = Number((data.memory as Record<string, unknown>)?.usedBytes) || 0;
    const usedDiskPercent = Number((data.disk as Record<string, unknown>)?.usedPercent) || 0;

    await db.resourceMetric.create({
      data: {
        serverId: server.id,
        cpuPercent: Math.round(Number(loadAvg?.['1min'] || 0) * 100) / 100,
        memoryMb: Math.round(usedMemBytes / (1024 * 1024)),
        diskPercent: usedDiskPercent,
        bandwidthKb: 0,
      },
    });

    const ip = request.headers.get('x-forwarded-for') ?? request.headers.get('x-real-ip');
    await createAuditLog({
      actorId: user.id,
      actorEmail: user.email ?? '',
      actorRole: user.role ?? '',
      action: 'SERVER_DISCOVER',
      resourceType: 'Server',
      resourceId: server.id,
      result: 'SUCCESS',
      ipAddress: ip ?? undefined,
      metadata: { hostname, servicesCount: detectedServices.length },
    });

    return NextResponse.json(
      apiSuccess({
        server: {
          id: server.id,
          hostname: server.hostname,
          os: server.os,
          cpuCores: server.cpuCores,
          ramGb: server.ramGb,
          diskGb: server.diskGb,
          uptime: server.uptime,
        },
        systemInfo: data,
        listeningPorts: ports,
        detectedServices,
      }),
    );
  } catch (e) {
    return handleErr(e);
  }
}
