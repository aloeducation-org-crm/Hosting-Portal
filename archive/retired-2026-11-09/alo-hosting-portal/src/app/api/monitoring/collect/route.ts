import { NextRequest, NextResponse } from 'next/server';
import { apiSuccess, apiError, type ApiResponse } from '@/lib/response';
import { requireSuperAdmin, ROLES } from '@/lib/auth';
import { db } from '@/lib/db';
import { env } from '@/lib/env';
import * as os from 'os';

type ConditionOp = 'gt' | 'lt' | 'gte' | 'lte' | 'eq';

function evaluateCondition(value: number, condition: string, threshold: number): boolean {
  const op = condition as ConditionOp;
  switch (op) {
    case 'gt':  return value > threshold;
    case 'lt':  return value < threshold;
    case 'gte': return value >= threshold;
    case 'lte': return value <= threshold;
    case 'eq':  return value === threshold;
    default:    return false;
  }
}

function handleErr(e: unknown): NextResponse {
  if (e && typeof e === 'object' && 'status' in e) {
    const a = e as ApiResponse;
    return NextResponse.json(a, { status: a.status });
  }
  return NextResponse.json(apiError('Internal server error'), { status: 500 });
}

export async function POST(request: NextRequest) {
  try {
    // Auth: either SUPER_ADMIN or internal secret
    const internalSecret = request.headers.get('X-Internal-Secret');
    let user;
    if (internalSecret && internalSecret === env.INTERNAL_SECRET) {
      // Internal auth passed
    } else {
      user = await requireSuperAdmin(request);
    }

    // Collect system-level metrics
    const cpuLoad1m = os.loadavg()[0] ?? 0;
    const cpuCount = os.cpus().length;
    const cpuPercent = Math.min((cpuLoad1m / cpuCount) * 100, 100);

    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const memoryPercent = ((totalMem - freeMem) / totalMem) * 100;
    const memoryMb = (totalMem - freeMem) / (1024 * 1024);

    const diskPercent = 0; // placeholder - would need df parsing in production
    const bandwidthKb = 0; // placeholder - would need network interface parsing

    // Get all active websites
    const websites = await db.website.findMany({
      where: { status: 'ACTIVE' },
      select: { id: true },
    });

    let collected = 0;

    // Store metrics per website
    for (const site of websites) {
      await db.resourceMetric.create({
        data: {
          websiteId: site.id,
          cpuPercent,
          memoryMb,
          diskPercent: diskPercent || null,
          bandwidthKb: bandwidthKb || null,
        },
      });
      collected++;
    }

    // Also store a server-level metric (no websiteId)
    await db.resourceMetric.create({
      data: {
        cpuPercent,
        memoryMb,
        diskPercent: diskPercent || null,
        bandwidthKb: bandwidthKb || null,
      },
    });
    collected++;

    // Check alert rules and trigger alerts
    const activeRules = await db.alertRule.findMany({
      where: { isActive: true },
      include: {
        alerts: {
          where: {
            createdAt: { gte: new Date(Date.now() - 5 * 60 * 1000) },
          },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    });

    let alertsTriggered = 0;
    const now = new Date();

    for (const rule of activeRules) {
      // Check cooldown
      if (rule.alerts.length > 0) {
        const lastAlert = rule.alerts[0];
        if (!lastAlert) continue;
        const cooldownMs = rule.cooldownMin * 60 * 1000;
        if (now.getTime() - lastAlert.createdAt.getTime() < cooldownMs) {
          continue;
        }
      }

      let metricValue: number | null = null;
      switch (rule.metric) {
        case 'cpu':
          metricValue = cpuPercent;
          break;
        case 'memory':
          metricValue = memoryPercent;
          break;
        case 'disk':
          metricValue = diskPercent;
          break;
        case 'bandwidth':
          metricValue = bandwidthKb;
          break;
        default:
          // ssl_expiry, downtime, request_rate, error_rate need website-specific logic
          continue;
      }

      if (metricValue === null) continue;

      const triggered = evaluateCondition(metricValue, rule.condition, rule.threshold);

      if (triggered) {
        const severity = metricValue > rule.threshold * 1.5 ? 'critical' : 'warning';
        await db.alert.create({
          data: {
            ruleId: rule.id,
            severity,
            message: `${rule.name}: ${rule.metric} is ${metricValue.toFixed(2)} (${rule.condition} ${rule.threshold})`,
            value: metricValue,
            threshold: rule.threshold,
          },
        });
        alertsTriggered++;
      }
    }

    return NextResponse.json(apiSuccess({ collected, alertsTriggered }));
  } catch (e) {
    return handleErr(e);
  }
}
