import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireSuperAdmin } from '@/lib/auth';
import { db } from '@/lib/db';
import { apiError, type ApiResponse } from '@/lib/response';

const querySchema = z.object({
  format: z.string().default('json'),
  action: z.string().optional(),
  resourceType: z.string().optional(),
  actorEmail: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(10000).default(1000),
});

function handleErr(e: unknown): NextResponse {
  if (e && typeof e === 'object' && 'status' in e) {
    const a = e as ApiResponse;
    return NextResponse.json(a, { status: a.status });
  }
  return NextResponse.json(apiError('Internal server error'), { status: 500 });
}

function escapeCsv(value: unknown): string {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function logToCsvRow(log: Record<string, unknown>): string {
  return [
    escapeCsv(log.id),
    escapeCsv(log.actorUserId),
    escapeCsv(log.actorEmail),
    escapeCsv(log.actorRole),
    escapeCsv(log.action),
    escapeCsv(log.resourceType),
    escapeCsv(log.resourceId),
    escapeCsv(log.domain),
    escapeCsv(log.result),
    escapeCsv(log.requestId),
    escapeCsv(log.ipAddress),
    escapeCsv(log.errorCode),
    escapeCsv(log.durationMs),
    escapeCsv(log.timestamp),
  ].join(',');
}

export async function GET(request: NextRequest) {
  try {
    const user = await requireSuperAdmin(request);
    void user;
    const { searchParams } = new URL(request.url);
    const input = querySchema.parse(Object.fromEntries(searchParams));

    const where: Record<string, unknown> = {};
    if (input.action) where.action = input.action;
    if (input.resourceType) where.resourceType = input.resourceType;
    if (input.actorEmail) where.actorEmail = { contains: input.actorEmail };
    if (input.startDate || input.endDate) {
      where.timestamp = {};
      if (input.startDate) (where.timestamp as Record<string, Date>).gte = new Date(input.startDate);
      if (input.endDate) (where.timestamp as Record<string, Date>).lte = new Date(input.endDate);
    }

    const logs = await db.auditLog.findMany({
      where,
      orderBy: { timestamp: 'desc' },
      skip: (input.page - 1) * input.limit,
      take: input.limit,
    });

    if (input.format === 'csv') {
      const headers = [
        'id', 'actorUserId', 'actorEmail', 'actorRole', 'action',
        'resourceType', 'resourceId', 'domain', 'result', 'requestId',
        'ipAddress', 'errorCode', 'durationMs', 'timestamp',
      ].join(',');

      const rows = logs.map((log) =>
        logToCsvRow(log as unknown as Record<string, unknown>),
      );

      const csv = [headers, ...rows].join('\n');

      return new NextResponse(csv, {
        status: 200,
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="audit-logs-${new Date().toISOString().split('T')[0]}.csv"`,
        },
      });
    }

    return new NextResponse(JSON.stringify({ success: true, data: logs, message: 'Success' }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="audit-logs-${new Date().toISOString().split('T')[0]}.json"`,
      },
    });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json(apiError('Validation failed', 'VALIDATION_ERROR', e.flatten(), 400), { status: 400 });
    }
    return handleErr(e);
  }
}
