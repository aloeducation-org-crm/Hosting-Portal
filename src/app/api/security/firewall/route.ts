import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { apiSuccess, apiError, type ApiResponse } from '@/lib/response';
import { requireSession, requirePermission, ROLES } from '@/lib/auth';
import { db } from '@/lib/db';
import { createAuditLog } from '@/lib/audit';
import { callHelper, classifyHelperFailure } from '@/lib/helpers';

function isIPv4Cidr(value: string): boolean {
  const [address, prefix, ...extra] = value.split('/');
  if (extra.length > 0 || !address) return false;
  const octets = address.split('.');
  if (octets.length !== 4 || octets.some((octet) => !/^\d{1,3}$/.test(octet) || Number(octet) > 255)) return false;
  return prefix === undefined || (/^\d{1,2}$/.test(prefix) && Number(prefix) <= 32);
}

const createFirewallRuleSchema = z.object({
  name: z.string().trim().min(1).max(64),
  action: z.enum(['allow', 'deny']).default('allow'),
  protocol: z.enum(['tcp', 'udp']).default('tcp'),
  port: z.number().int().min(1).max(65535),
  source: z.string().trim().max(64).optional().refine((value) => !value || isIPv4Cidr(value), 'source must be a valid IPv4 address or CIDR range'),
}).strict();

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
      const failure = classifyHelperFailure('alo-firewall-helper', result);
      return NextResponse.json(apiError(failure.message, failure.code), { status: failure.status });
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
    const input = createFirewallRuleSchema.safeParse(await request.json());
    if (!input.success) {
      return NextResponse.json(
        apiError('Validation failed', 'VALIDATION_ERROR', input.error.flatten().fieldErrors, 400),
        { status: 400 },
      );
    }
    const { name, action, protocol, port, source } = input.data;

    // === REAL: Execute UFW command via alo-firewall-helper ===
    const helperArgs: string[] = [action, String(port), protocol];

    if (source) {
      helperArgs.push(source);
    }

    const result = await callHelper('alo-firewall-helper', helperArgs);

    if (!result.success) {
      const failure = classifyHelperFailure('alo-firewall-helper', result);
      return NextResponse.json(apiError(failure.message, failure.code), { status: failure.status });
    }

    const helperResult = parseHelperJson(result.stdout);

    // Also save to DB for tracking/audit
    const rule = await db.firewallRule.create({
      data: {
        name,
        action,
        direction: 'ingress',
        protocol,
        port,
        source: source || null,
        isActive: true,
        priority: 1000,
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
      metadata: { name, action, protocol, port, source, helperResult },
    });

    return NextResponse.json(apiSuccess({
      dbRule: rule,
      ufwResult: helperResult,
    }, 'Firewall rule applied to UFW'));
  } catch (e) {
    return handleErr(e);
  }
}

export async function PUT(request: NextRequest) {
  try {
    const auth = await requirePermission(request, 'FIREWALL_MANAGE');
    const id = new URL(request.url).searchParams.get('id');
    const input = z.object({ enabled: z.boolean() }).strict().safeParse(await request.json());
    if (!id || !input.success) {
      return NextResponse.json(
        apiError('A rule id and boolean enabled value are required', 'VALIDATION_ERROR', undefined, 400),
        { status: 400 },
      );
    }

    const rule = await db.firewallRule.findFirst({
      where: { id, ...(auth.role === ROLES.SUPER_ADMIN ? {} : { userId: auth.id }) },
    });
    if (!rule) {
      return NextResponse.json(apiError('Firewall rule not found', 'NOT_FOUND', undefined, 404), { status: 404 });
    }
    if (rule.isActive === input.data.enabled) {
      return NextResponse.json(apiSuccess(rule, 'Firewall rule is already in the requested state'));
    }
    if (
      rule.direction !== 'ingress' ||
      rule.port === null ||
      rule.portRange !== null ||
      rule.dest !== null ||
      !['tcp', 'udp'].includes(rule.protocol) ||
      !['allow', 'deny'].includes(rule.action)
    ) {
      return NextResponse.json(
        apiError('This rule uses options that are not supported for live toggling', 'RULE_NOT_TOGGLEABLE', undefined, 409),
        { status: 409 },
      );
    }

    const args = input.data.enabled
      ? [rule.action, String(rule.port), rule.protocol, ...(rule.source ? [rule.source] : [])]
      : ['remove', rule.action, String(rule.port), rule.protocol, ...(rule.source ? [rule.source] : [])];
    const result = await callHelper('alo-firewall-helper', args);
    if (!result.success) {
      const failure = classifyHelperFailure('alo-firewall-helper', result);
      return NextResponse.json(apiError(failure.message, failure.code), { status: failure.status });
    }

    const updated = await db.firewallRule.update({ where: { id: rule.id }, data: { isActive: input.data.enabled } });
    await createAuditLog({
      actorId: auth.id,
      actorEmail: auth.email,
      actorRole: auth.role,
      action: input.data.enabled ? 'FIREWALL_RULE_ENABLED' : 'FIREWALL_RULE_DISABLED',
      resourceType: 'FirewallRule',
      resourceId: rule.id,
      result: 'SUCCESS',
      metadata: { action: rule.action, protocol: rule.protocol, port: rule.port, source: rule.source },
    });
    return NextResponse.json(apiSuccess(updated, 'Firewall rule state updated'));
  } catch (e) {
    return handleErr(e);
  }
}
