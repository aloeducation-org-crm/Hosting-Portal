import { NextRequest, NextResponse } from 'next/server';
import { apiSuccess, apiError, type ApiResponse } from '@/lib/response';
import { requireSession, ROLES, isRoleAtLeast } from '@/lib/auth';
import { db } from '@/lib/db';
import { createAuditLog } from '@/lib/audit';
import { callHelper } from '@/lib/helpers';

function handleErr(e: unknown): NextResponse {
  if (e && typeof e === 'object' && 'status' in e) {
    const a = e as ApiResponse;
    return NextResponse.json(a, { status: a.status });
  }
  return NextResponse.json(apiError('Internal server error'), { status: 500 });
}

/**
 * Basic cron expression validator: 5 parts separated by spaces.
 */
function isValidCron(expr: string): boolean {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return false;

  const patterns = [
    /^(\*|[0-5]?\d)(-[0-5]?\d)?(\/[0-9]+)?(,[0-5]?d(,-[0-5]?\d)?(\/[0-9]+)?)*$/,
    /^(\*|[01]?\d|2[0-3])(-[01]?\d|2[0-3])?(\/[0-9]+)?(,([01]?\d|2[0-3])(,-([01]?\d|2[0-3]))?(\/[0-9]+)?)*$/,
    /^(\*|[1-2]?\d|3[01])(-[1-2]?\d|3[01])?(\/[0-9]+)?(,([1-2]?\d|3[01])(,-([1-2]?\d|3[01]))?(\/[0-9]+)?)*$/,
    /^(\*|[1-9]|1[0-2])(-[1-9]|1[0-2])?(\/[0-9]+)?(,([1-9]|1[0-2])(,-([1-9]|1[0-2]))?(\/[0-9]+)?)*$/,
    /^(\*|[0-6])(-[0-6])?(\/[0-9]+)?(,[0-6](,-[0-6])?(\/[0-9]+)?)*$/,
  ];

  return parts.every((part, i) => patterns[i]?.test(part) ?? false);
}

/**
 * Calculate next run time from a cron expression.
 */
function calculateNextRun(schedule: string): Date {
  const parts = schedule.trim().split(/\s+/);
  const now = new Date();
  const next = new Date(now);
  next.setMinutes(next.getMinutes() + 1, 0, 0);

  const minutePart = parts[0];
  const hourPart = parts[1];
  const domPart = parts[2];
  const monthPart = parts[3];
  const dowPart = parts[4];

  for (let i = 0; i < 525960; i++) {
    const m = next.getMinutes();
    const h = next.getHours();
    const dom = next.getDate();
    const month = next.getMonth() + 1;
    const dow = next.getDay();

    if (
      matchesField(minutePart!, m, 0, 59) &&
      matchesField(hourPart!, h, 0, 23) &&
      matchesField(domPart!, dom, 1, 31) &&
      matchesField(monthPart!, month, 1, 12) &&
      matchesField(dowPart!, dow, 0, 6)
    ) {
      return new Date(next);
    }
    next.setMinutes(next.getMinutes() + 1);
  }

  return new Date(now.getTime() + 60 * 60 * 1000);
}

function matchesField(field: string, value: number, min: number, max: number): boolean {
  if (field === '*') return true;
  const segments = field.split(',');
  return segments.some((seg) => {
    if (seg.includes('/')) {
      const [range, stepStr] = seg.split('/');
      const step = parseInt(stepStr!, 10);
      if (isNaN(step) || step <= 0) return false;
      let rangeMin = min;
      let rangeMax = max;
      const safeRange = range ?? '*';
      if (safeRange !== '*') {
        if (safeRange.includes('-')) {
          const rangeParts = safeRange.split('-').map(Number);
          rangeMin = rangeParts[0] ?? min;
          rangeMax = rangeParts[1] ?? rangeMin;
        } else {
          rangeMin = parseInt(safeRange, 10);
          rangeMax = rangeMin;
        }
      }
      if (value < rangeMin || value > rangeMax) return false;
      return (value - rangeMin) % step === 0;
    }
    if (seg.includes('-')) {
      const rangeParts = seg.split('-').map(Number);
      return value >= (rangeParts[0] ?? 0) && value <= (rangeParts[1] ?? 0);
    }
    const num = parseInt(seg, 10);
    return !isNaN(num) && value === num;
  });
}

export async function GET(request: NextRequest) {
  try {
    const user = await requireSession(request);
    const { searchParams } = new URL(request.url);
    const websiteId = searchParams.get('websiteId');

    const where: Record<string, unknown> = {};
    if (websiteId) where.websiteId = websiteId;

    if (!isRoleAtLeast(user.role, ROLES.SUPER_ADMIN)) {
      const userWebsites = await db.website.findMany({
        where: { ownerId: user.id },
        select: { id: true },
      });
      const websiteIds = userWebsites.map((w) => w.id);
      if (websiteId && !websiteIds.includes(websiteId)) {
        throw apiError('Access denied', 'FORBIDDEN', undefined, 403);
      }
      if (!websiteId) where.websiteId = { in: websiteIds };
    }

    const jobs = await db.cronJob.findMany({
      where,
      include: { website: { select: { id: true, domain: true } } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    return NextResponse.json(apiSuccess(jobs));
  } catch (e) {
    return handleErr(e);
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireSession(request);
    const body = await request.json();
    const { websiteId, name, schedule, command, isActive = true } = body as {
      websiteId: string;
      name: string;
      schedule: string;
      command: string;
      isActive?: boolean;
    };

    if (!websiteId || !name || !schedule || !command) {
      throw apiError('websiteId, name, schedule, and command are required', 'VALIDATION_ERROR', undefined, 400);
    }

    if (!isValidCron(schedule)) {
      throw apiError('Invalid cron expression. Must be 5 parts: minute hour day-of-month month day-of-week', 'VALIDATION_ERROR', undefined, 400);
    }

    const website = await db.website.findUnique({ where: { id: websiteId } });
    if (!website) {
      throw apiError('Website not found', 'NOT_FOUND', undefined, 404);
    }

    const nextRunAt = calculateNextRun(schedule);

    // === REAL: Create cron job in /etc/cron.d/ via alo-cron-helper ===
    const domain = website.domain || 'unknown';
    const helperResult = await callHelper('alo-cron-helper', [
      'add', domain, name, schedule, command,
    ]);

    if (!helperResult.success) {
      throw apiError(`Failed to create cron job on server: ${helperResult.stderr}`, 'CRON_CREATE_FAILED', undefined, 500);
    }

    if (!isActive) {
      await callHelper('alo-cron-helper', ['disable', domain]).catch(() => {});
    }

    const job = await db.cronJob.create({
      data: {
        websiteId,
        name,
        schedule,
        command,
        isActive,
        nextRunAt,
      },
    });

    await createAuditLog({
      actorId: user.id,
      actorEmail: user.email,
      actorRole: user.role,
      action: 'CRON_JOB_CREATED',
      resourceType: 'CronJob',
      resourceId: job.id,
      result: 'SUCCESS',
      metadata: { websiteId, name, schedule, command, isActive, nextRunAt, cronFile: `/etc/cron.d/alo-${domain}` },
    });

    return NextResponse.json(apiSuccess(job, 'Cron job created on server'), { status: 201 });
  } catch (e) {
    return handleErr(e);
  }
}

export async function PUT(request: NextRequest) {
  try {
    const user = await requireSession(request);
    const body = await request.json();
    const { id, schedule, command, isActive } = body as {
      id: string;
      schedule?: string;
      command?: string;
      isActive?: boolean;
    };

    if (!id) {
      throw apiError('id is required', 'VALIDATION_ERROR', undefined, 400);
    }

    const existing = await db.cronJob.findUnique({ where: { id }, include: { website: true } });
    if (!existing) {
      throw apiError('Cron job not found', 'NOT_FOUND', undefined, 404);
    }

    const updateData: Record<string, unknown> = {};
    if (schedule !== undefined) {
      if (!isValidCron(schedule)) {
        throw apiError('Invalid cron expression', 'VALIDATION_ERROR', undefined, 400);
      }
      updateData.schedule = schedule;
      updateData.nextRunAt = calculateNextRun(schedule);
    }
    if (command !== undefined) updateData.command = command;
    if (isActive !== undefined) updateData.isActive = isActive;

    // === REAL: Update cron job on server ===
    const domain = existing.website.domain || 'unknown';
    const finalSchedule = schedule || existing.schedule;
    const finalCommand = command || existing.command;

    await callHelper('alo-cron-helper', [
      'update', domain, existing.name, finalSchedule, finalCommand,
    ]).catch(() => {
      // If update fails, try remove + add
      callHelper('alo-cron-helper', ['remove', domain, existing.name]).catch(() => {});
      return callHelper('alo-cron-helper', ['add', domain, existing.name, finalSchedule, finalCommand]);
    });

    if (isActive === false) {
      await callHelper('alo-cron-helper', ['disable', domain]).catch(() => {});
    } else if (isActive === true) {
      await callHelper('alo-cron-helper', ['enable', domain]).catch(() => {});
    }

    const updated = await db.cronJob.update({ where: { id }, data: updateData });

    await createAuditLog({
      actorId: user.id,
      actorEmail: user.email,
      actorRole: user.role,
      action: 'CRON_JOB_UPDATED',
      resourceType: 'CronJob',
      resourceId: id,
      result: 'SUCCESS',
      metadata: { schedule, command, isActive },
    });

    return NextResponse.json(apiSuccess(updated, 'Cron job updated on server'));
  } catch (e) {
    return handleErr(e);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const user = await requireSession(request);
    const { searchParams } = new URL(request.url);
    const jobId = searchParams.get('jobId');

    if (!jobId) {
      throw apiError('jobId query parameter is required', 'VALIDATION_ERROR', undefined, 400);
    }

    const job = await db.cronJob.findUnique({
      where: { id: jobId },
      include: { website: true },
    });
    if (!job) {
      throw apiError('Cron job not found', 'NOT_FOUND', undefined, 404);
    }

    if (!isRoleAtLeast(user.role, ROLES.SUPER_ADMIN)) {
      if (job.website.ownerId !== user.id) {
        throw apiError('You do not have permission to delete this cron job', 'FORBIDDEN', undefined, 403);
      }
    }

    // === REAL: Remove cron job from /etc/cron.d/ ===
    const domain = job.website.domain || 'unknown';
    await callHelper('alo-cron-helper', ['remove', domain, job.name]).catch(() => {
      // Non-fatal if helper fails
    });

    await db.cronJob.delete({ where: { id: jobId } });

    await createAuditLog({
      actorId: user.id,
      actorEmail: user.email,
      actorRole: user.role,
      action: 'CRON_JOB_DELETED',
      resourceType: 'CronJob',
      resourceId: jobId,
      result: 'SUCCESS',
    });

    return NextResponse.json(apiSuccess(null, 'Cron job deleted from server'));
  } catch (e) {
    return handleErr(e);
  }
}
