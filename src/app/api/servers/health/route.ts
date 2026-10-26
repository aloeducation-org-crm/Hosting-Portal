import { NextRequest, NextResponse } from 'next/server';
import { apiSuccess, apiError, type ApiResponse } from '@/lib/response';
import { requireRole, ROLES } from '@/lib/auth';
import { db } from '@/lib/db';
import os from 'os';

function handleErr(e: unknown): NextResponse {
  if (e && typeof e === 'object' && 'status' in e) {
    const a = e as ApiResponse;
    return NextResponse.json(a, { status: a.status });
  }
  return NextResponse.json(apiError('Internal server error'), { status: 500 });
}

export async function GET(request: NextRequest) {
  try {
    await requireRole(request, [ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.DEVOPS]);

    // Local system info
    const totalmem = os.totalmem();
    const freemem = os.freemem();
    const cpus = os.cpus();
    const loadavg = os.loadavg();
    const uptime = os.uptime();
    const networkInterfaces = os.networkInterfaces();

    const cpuUsage = {
      model: cpus[0]?.model || 'Unknown',
      cores: cpus.length,
      speed: cpus[0]?.speed || 0,
      load1m: loadavg[0],
      load5m: loadavg[1],
      load15m: loadavg[2],
    };

    const memoryUsage = {
      totalMb: Math.round(totalmem / (1024 * 1024)),
      freeMb: Math.round(freemem / (1024 * 1024)),
      usedMb: Math.round((totalmem - freemem) / (1024 * 1024)),
      usedPercent: Math.round(((totalmem - freemem) / totalmem) * 1000) / 10,
    };

    const uptimeInfo = {
      seconds: Math.round(uptime),
      formatted: formatUptime(uptime),
    };

    // Collect network interface names
    const interfaces: string[] = [];
    if (networkInterfaces) {
      for (const name of Object.keys(networkInterfaces)) {
        interfaces.push(name);
      }
    }

    // Registered servers from DB
    const registeredServers = await db.server.findMany({
      select: {
        id: true,
        hostname: true,
        ip: true,
        tailscaleIp: true,
        os: true,
        cpuCores: true,
        ramGb: true,
        diskGb: true,
        uptime: true,
        updatedAt: true,
      },
    });

    // Latest resource metrics per server
    const latestMetrics: Record<string, unknown> = {};
    for (const server of registeredServers) {
 const metric = await db.resourceMetric.findFirst({
        where: { serverId: server.id },
        orderBy: { createdAt: 'desc' },
      });
      if (metric) {
        latestMetrics[server.id] = {
          cpuPercent: metric.cpuPercent,
          memoryMb: metric.memoryMb,
          diskPercent: metric.diskPercent,
          bandwidthKb: metric.bandwidthKb,
          measuredAt: metric.createdAt,
        };
      }
    }

    // Aggregate counts
    const [activeWebsiteCount, runningContainerCount, cronJobCount] = await Promise.all([
      db.website.count({
        where: { status: 'ACTIVE' },
      }),
      db.dockerContainer.count({
        where: { status: 'running' },
      }),
      db.cronJob.count({
        where: { isActive: true },
      }),
    ]);

    return NextResponse.json(
      apiSuccess({
        local: {
          platform: os.platform(),
          arch: os.arch(),
          hostname: os.hostname(),
          nodeVersion: process.version,
          cpu: cpuUsage,
          memory: memoryUsage,
          uptime: uptimeInfo,
          networkInterfaces: interfaces,
        },
        registeredServers,
        latestMetrics,
        stats: {
          activeWebsites: activeWebsiteCount,
          runningContainers: runningContainerCount,
          activeCronJobs: cronJobCount,
          totalRegisteredServers: registeredServers.length,
        },
      }),
    );
  } catch (e) {
    return handleErr(e);
  }
}

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (mins > 0) parts.push(`${mins}m`);
  return parts.join(' ') || '<1m';
}
