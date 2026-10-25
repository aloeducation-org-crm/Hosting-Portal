import { NextRequest, NextResponse } from 'next/server';
import { apiSuccess, apiError, type ApiResponse } from '@/lib/response';
import { requireSession, ROLES } from '@/lib/auth';
import { db } from '@/lib/db';

const VALID_ACTIONS = ['allow', 'deny', 'reject'];
const VALID_DIRECTIONS = ['ingress', 'egress'];
const VALID_PROTOCOLS = ['tcp', 'udp', 'icmp', 'all'];

function handleErr(e: unknown): NextResponse {
  if (e && typeof e === 'object' && 'status' in e) {
    const a = e as ApiResponse;
    return NextResponse.json(a, { status: a.status });
  }
  return NextResponse.json(apiError('Internal server error'), { status: 500 });
}

export async function GET(request: NextRequest) {
  try {
    const auth = await requireSession(request);

    const where: any = {};
    if (auth.role !== ROLES.SUPER_ADMIN) {
      where.userId = auth.id;
    }

    const rules = await db.firewallRule.findMany({
      where,
      orderBy: { priority: 'asc' },
      take: 200,
    });

    return NextResponse.json(apiSuccess(rules));
  } catch (e) {
    return handleErr(e);
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireSession(request);
    const body = await request.json();

    if (!body.name) {
      return NextResponse.json(apiError('name is required', 'VALIDATION_ERROR', undefined, 400), { status: 400 });
    }

    if (body.action && !VALID_ACTIONS.includes(body.action)) {
      return NextResponse.json(apiError(`action must be one of: ${VALID_ACTIONS.join(', ')}`, 'VALIDATION_ERROR', undefined, 400), { status: 400 });
    }

    if (body.direction && !VALID_DIRECTIONS.includes(body.direction)) {
      return NextResponse.json(apiError(`direction must be one of: ${VALID_DIRECTIONS.join(', ')}`, 'VALIDATION_ERROR', undefined, 400), { status: 400 });
    }

    if (body.protocol && !VALID_PROTOCOLS.includes(body.protocol)) {
      return NextResponse.json(apiError(`protocol must be one of: ${VALID_PROTOCOLS.join(', ')}`, 'VALIDATION_ERROR', undefined, 400), { status: 400 });
    }

    if (body.port && typeof body.port !== 'number') {
      return NextResponse.json(apiError('port must be a number', 'VALIDATION_ERROR', undefined, 400), { status: 400 });
    }

    if (body.portRange) {
      const rangeRegex = /^\d{1,5}-\d{1,5}$/;
      if (!rangeRegex.test(body.portRange)) {
        return NextResponse.json(apiError('portRange must be in format "8000-9000"', 'VALIDATION_ERROR', undefined, 400), { status: 400 });
      }
    }

    const rule = await db.firewallRule.create({
      data: {
        name: body.name,
        action: body.action ?? 'allow',
        direction: body.direction ?? 'ingress',
        protocol: body.protocol ?? 'tcp',
        port: body.port ?? undefined,
        portRange: body.portRange ?? undefined,
        source: body.source ?? undefined,
        dest: body.dest ?? undefined,
        isActive: body.isActive ?? true,
        priority: body.priority ?? 1000,
        userId: auth.id,
      },
    });

    return NextResponse.json(apiSuccess(rule));
  } catch (e) {
    return handleErr(e);
  }
}
