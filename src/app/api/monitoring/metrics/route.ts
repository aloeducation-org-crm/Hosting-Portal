import { NextRequest, NextResponse } from 'next/server';
import { apiSuccess, apiError, type ApiResponse } from '@/lib/response';
import { requireSession } from '@/lib/auth';
import * as os from 'os';
import { statfs } from 'node:fs/promises';

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

    // Metrics are read directly from this host, never presented from stale per-site samples.
    const totalmem = os.totalmem();
    const freemem = os.freemem();
    const cpus = os.cpus();
    const loadavg = os.loadavg();

    // Estimate CPU usage from load average (1-min) / CPU count * 100
    const cpuPercent = Math.min(((loadavg[0] ?? 0) / cpus.length) * 100, 100);
    const memoryPercent = ((totalmem - freemem) / totalmem) * 100;

    // statfs reports the filesystem containing the application. Network throughput
    // requires sampled interface counters; do not invent a value in a point read.
    const disk = await statfs(process.cwd());
    const diskPercent = disk.blocks > 0
      ? Math.round(((disk.blocks - disk.bfree) / disk.blocks) * 10000) / 100
      : null;

    return NextResponse.json(apiSuccess({
      source: 'system',
      cpu: Math.round(cpuPercent * 100) / 100,
      memory: Math.round(memoryPercent * 100) / 100,
      disk: diskPercent,
      bandwidth: null,
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
