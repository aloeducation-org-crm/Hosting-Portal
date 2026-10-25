import { NextRequest, NextResponse } from 'next/server';
import { apiSuccess, apiError, type ApiResponse } from '@/lib/response';
import { requireSession, requirePermission, ROLES } from '@/lib/auth';
import { db } from '@/lib/db';
import { createAuditLog } from '@/lib/audit';
import { callHelper } from '@/lib/helpers';

const VALID_ACTIONS = ['allow', 'deny', 'reject', 'limit'];
const VALID_PROTOCOLS = ['tcp', 'udp', 'icmp', 'any'];

function handleErr(e: unknown): NextResponse {
  if (e && typeof e === 'object' && 'status' in e) {
    const a = e as ApiResponse;
    return NextResponse.json(a, { status: a.status });
  }
  return NextResponse.json(apiError('Internal server error'), { status: 500 });
}

function parseHelperJson(stdout: string): Record<string, unknown> {
  try {
    return JSON.parse(stdout.trim());
  } catch {
    return { raw: stdout };
  }
}

export async function GET(request: NextRequest) {
  try {
    const auth = await requireSession(request);

    // === REAL: Get UFW status from the system ===
    const result = await callHelper('alo-firewall-helper', ['status']);

    if (!result.success) {
      return NextResponse.json(apiError(`Failed to get firewall status: ${result.stderr}`), { status: 500 });
    }

    const ufwData = parseHelperJson(result.stdout);

    // Also return DB rules for reference
    const where: Record<string, unknown> = {};
    if (auth.role !== ROLES.SUPER_ADMIN) {
      where.userId = auth.id;
    }
    const dbRules = await db.firewallRule.findMany({
      where,
      orderBy: { priority: 'asc' },
      take: 200,
    });

    return NextResponse.json(apiSuccess({
      ufwStatus: ufwData,
      managedRules: dbRules,
    }));
  } catch (e) {
    return handleErr(e);
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requirePermission(request, 'FIREWALL_MANAGE');
    const body = await request.json();

    if (!body.name) {
      return NextResponse.json(apiError('name is required', 'VALIDATION_ERROR', undefined, 400), { status: 400 });
    }

    const action = body.action ?? 'allow';
    const protocol = body.protocol ?? 'tcp';
    const port = body.port;
    const source = body.source;

    if (!VALID_ACTIONS.includes(action)) {
      return NextResponse.json(
        apiError(`action must be one of: ${VALID_ACTIONS.join(', ')}`, 'VALIDATION_ERROR', undefined, 400),
        { status: 400 },
      );
    }

    if (!VALID_PROTOCOLS.includes(protocol)) {
      return NextResponse.json(
        apiError(`protocol must be one of: ${VALID_PROTOCOLS.join(', ')}`, 'VALIDATION_ERROR', undefined, 400),
        { status: 400 },
      );
    }

    if (body.port !== undefined && typeof body.port !== 'number') {
      return NextResponse.json(apiError('port must be a number', 'VALIDATION_ERROR', undefined, 400), { status: 400 });
    }

    // === REAL: Execute UFW command via alo-firewall-helper ===
    const helperArgs: string[] = [];
    if (action === 'limit') {
      helperArgs.push('limit');
    } else if (action === 'allow') {
      helperArgs.push('allow');
    } else if (action === 'deny') {
      helperArgs.push('deny');
    } else {
      // reject maps to deny in UFW
      helperArgs.push('deny');
    }

    if (port) {
      helperArgs.push(String(port));
      if (protocol !== 'any' && protocol !== 'icmp') {
        helperArgs.push(protocol);
      }
    }

    if (source) {
      helperArgs.push(source);
    }

    const result = await callHelper('alo-firewall-helper', helperArgs);

    if (!result.success) {
      return NextResponse.json(
        apiError(`Firewall rule failed: ${result.stderr}`, 'FIREWALL_ERROR', undefined, 500),
        { status: 500 },
      );
    }

    const helperResult = parseHelperJson(result.stdout);

    // Also save to DB for tracking/audit
    const rule = await db.firewallRule.create({
      data: {
        name: body.name,
        action,
        direction: body.direction ?? 'ingress',
        protocol,
        port: port ?? undefined,
        portRange: body.portRange ?? undefined,
        source: source ?? undefined,
        dest: body.dest ?? undefined,
        isActive: body.isActive ?? true,
        priority: body.priority ?? 1000,
        userId: auth.id,
      },
    });

    await createAuditLog({
      actorId: auth.id,
      actorEmail: auth.email,
      actorRole: auth.role,
      action: 'FIREWALL_RULE_CREATED',
      resourceType: 'FirewallRule',
      resourceId: rule.id,
      result: 'SUCCESS',
      metadata: { name: body.name, action, protocol, port, source, helperResult },
    });

    return NextResponse.json(apiSuccess({
      dbRule: rule,
      ufwResult: helperResult,
    }, 'Firewall rule applied to UFW'));
  } catch (e) {
    return handleErr(e);
  }
}
