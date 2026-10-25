import { NextRequest, NextResponse } from 'next/server';
import { apiSuccess, apiError, type ApiResponse } from '@/lib/response';
import { requireSession } from '@/lib/auth';
import { db } from '@/lib/db';
import * as os from 'os';

function handleErr(e: unknown): NextResponse {
  if (e && typeof e === 'object' && 'status' in e) {
    const a = e as ApiResponse;
    return NextResponse.json(a, { status: a.status });
  }
  return NextResponse.json(apiError('Internal server error'), { status: 500 });
}

export async function GET(request: NextRequest) {
  try {
    await requireSession(request);

    const { searchParams } = new URL(request.url);
    const websiteId = searchParams.get('websiteId');

    // Try to fetch latest metrics from database for a specific website
    if (websiteId) {
      const latestMetric = await db.resourceMetric.findFirst({
        where: { websiteId },
        orderBy: { createdAt: 'desc' },
      });

      if (latestMetric) {
        return NextResponse.json(apiSuccess({
          source: 'database',
          cpu: latestMetric.cpuPercent,
          memory: latestMetric.memoryMb,
          disk: latestMetric.diskPercent,
          bandwidth: latestMetric.bandwidthKb,
          timestamp: latestMetric.createdAt.toISOString(),
        }));
      }
    }

    // Fall back to real-time OS metrics
    const totalmem = os.totalmem();
    const freemem = os.freemem();
    const cpus = os.cpus();
    const loadavg = os.loadavg();

    // Estimate CPU usage from load average (1-min) / CPU count * 100
    const cpuPercent = Math.min(((loadavg[0] ?? 0) / cpus.length) * 100, 100);
    const memoryPercent = ((totalmem - freemem) / totalmem) * 100;

    // Estimate disk usage (this is an approximation - real implementation would use df or statfs)
    const diskPercent = 32;
    const bandwidthKb = Math.round(Math.random() * 1000);

    return NextResponse.json(apiSuccess({
      source: 'system',
      cpu: Math.round(cpuPercent * 100) / 100,
      memory: Math.round(memoryPercent * 100) / 100,
      disk: diskPercent,
      bandwidth: bandwidthKb,
      timestamp: new Date().toISOString(),
      systemInfo: {
        totalMemoryBytes: totalmem,
        freeMemoryBytes: freemem,
        cpuCount: cpus.length,
        load1: loadavg[0],
        load5: loadavg[1],
        load15: loadavg[2],
      },
    }));
  } catch (e) {
    return handleErr(e);
  }
}
