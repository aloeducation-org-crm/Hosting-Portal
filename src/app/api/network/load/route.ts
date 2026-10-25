import { NextRequest, NextResponse } from 'next/server';
import { apiSuccess, apiError, type ApiResponse } from '@/lib/response';
import { requireSession } from '@/lib/auth';
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

    const loadavg = os.loadavg();
    const freemem = os.freemem();
    const totalmem = os.totalmem();
    const cpus = os.cpus();
    const uptime = os.uptime();

    const usedMemPercent = ((totalmem - freemem) / totalmem) * 100;
    const freeMemPercent = (freemem / totalmem) * 100;

    return NextResponse.json(apiSuccess({
      load1: loadavg[0],
      load5: loadavg[1],
      load15: loadavg[2],
      cpuCount: cpus.length,
      cpuModel: cpus[0]?.model ?? 'unknown',
      totalMemoryBytes: totalmem,
      freeMemoryBytes: freemem,
      usedMemoryBytes: totalmem - freemem,
      usedMemoryPercent: Math.round(usedMemPercent * 100) / 100,
      freeMemoryPercent: Math.round(freeMemPercent * 100) / 100,
      uptimeSeconds: uptime,
      hostname: os.hostname(),
      platform: os.platform(),
      arch: os.arch(),
    }));
  } catch (e) {
    return handleErr(e);
  }
}
