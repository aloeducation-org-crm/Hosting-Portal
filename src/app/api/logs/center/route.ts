import { NextRequest, NextResponse } from 'next/server';
import { apiSuccess, apiError, type ApiResponse } from '@/lib/response';
import { requireSession, requirePermission } from '@/lib/auth';
import { db } from '@/lib/db';
import { callHelper } from '@/lib/helpers';
import { logger } from '@/lib/logger';
import { execFile } from 'child_process';

function handleErr(e: unknown): NextResponse {
  if (e && typeof e === 'object' && 'status' in e) {
    const a = e as ApiResponse;
    return NextResponse.json(a, { status: a.status });
  }
  logger.error({ err: e }, 'Log center error');
  return NextResponse.json(apiError('Internal server error'), { status: 500 });
}

/** Valid log sources */
const VALID_SOURCES = [
  'caddy-access',
  'caddy-error',
  'systemd',
  'php-fpm',
  'application',
  'security',
  'audit',
] as const;

type LogSource = (typeof VALID_SOURCES)[number];

function isValidSource(s: string): s is LogSource {
  return (VALID_SOURCES as readonly string[]).includes(s);
}

/** Run a command and return trimmed stdout */
function runCmd(cmd: string, args: string[], timeout = 15000): Promise<string> {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) resolve('');
      else resolve(stdout.trim());
    });
  });
}

type LogEntry = {
  timestamp: string;
  level: string;
  message: string;
  source: string;
  domain?: string;
  metadata?: Record<string, string | undefined>;
};

/** Parse Caddy access log lines (combined log format) */
function parseCaddyAccessLog(lines: string[], domain?: string): LogEntry[] {
  const entries: LogEntry[] = [];
  // Caddy combined log: remote_addr - - [timestamp] "method path proto" status size "referer" "user_agent"
  const pattern = /^(\S+)\s+\S+\s+\S+\s+\[([^\]]+)\]\s+"(\S+)\s+(\S+)\s+(\S+)"\s+(\d+)\s+(\d+)/;

  for (const line of lines) {
    const match = line.match(pattern);
    if (match) {
      entries.push({
        timestamp: match[2] ?? '',
        level: parseInt(match[6] ?? '200', 10) >= 400 ? 'warn' : 'info',
        message: `${match[3] ?? ''} ${match[4] ?? ''} ${match[5] ?? ''} → ${match[6] ?? '0'} (${match[7] ?? '0'} bytes)`,
        source: 'caddy-access',
        domain,
        metadata: {
          ip: match[1] ?? '',
          method: match[3] ?? '',
          path: match[4] ?? '',
          proto: match[5] ?? '',
          status: match[6] ?? '',
          size: match[7] ?? '',
        },
      });
    }
  }
  return entries;
}

/** Parse Caddy error log lines */
function parseCaddyErrorLog(lines: string[], domain?: string): LogEntry[] {
  return lines.map((line) => {
    const tsMatch = line.match(/^\[([^\]]+)\]/);
    const levelMatch = line.match(/(ERROR|WARN|INFO)/);
    return {
      timestamp: tsMatch?.[1] ?? '',
      level: (levelMatch?.[1] ?? 'error').toLowerCase(),
      message: line,
      source: 'caddy-error',
      domain,
    };
  });
}

/** Parse systemd journal output */
function parseSystemdLog(lines: string[]): LogEntry[] {
  return lines.map((line) => {
    // journalctl -o short-iso format: "YYYY-MM-DDTHH:MM:SS hostname service[pid]: message"
    const match = line.match(/^(\S+)\s+\S+\s+(\S+?):\s+(.*)$/);
    return {
      timestamp: match?.[1] ?? '',
      level: 'info',
      message: match?.[3] ?? line,
      source: 'systemd',
      metadata: match?.[2] ? { service: match[2] } : undefined,
    };
  });
}

/** Parse PHP-FPM log */
function parsePhpFpmLog(lines: string[]): LogEntry[] {
  return lines.map((line) => {
    const dateMatch = line.match(/^(\d{2}-\w{3}-\d{4}\s+\d{2}:\d{2}:\d{2})/);
    const levelMatch = line.match(/\[(notice|warning|error|alert)\]/i);
    return {
      timestamp: dateMatch?.[1] ?? '',
      level: levelMatch?.[1]?.toLowerCase() ?? 'info',
      message: line,
      source: 'php-fpm',
    };
  });
}

export async function GET(request: NextRequest) {
  try {
    const user = await requireSession(request);
    await requirePermission(request, 'LOGS_READ');

    const { searchParams } = new URL(request.url);
    const source = searchParams.get('source') || 'application';
    const domain = searchParams.get('domain') || undefined;
    const linesParam = searchParams.get('lines');
    const lines = Math.min(Math.max(parseInt(linesParam || '100', 10), 1), 10000);
    const search = searchParams.get('search') || undefined;

    if (!isValidSource(source)) {
      return NextResponse.json(
        apiError(
          `Invalid log source. Valid: ${VALID_SOURCES.join(', ')}`,
          'VALIDATION_ERROR',
          undefined,
          400,
        ),
      );
    }

    let entries: LogEntry[] = [];

    switch (source) {
      // ----------------------------------------------------------------
      // Caddy access logs
      // ----------------------------------------------------------------
      case 'caddy-access': {
        const args = ['get-logs', 'caddy-access'];
        if (domain) args.push(domain);
        args.push(String(lines));
        const result = await callHelper('alo-log-helper', args, 15000);
        if (result.success && result.stdout) {
          const rawLines = result.stdout.split('\n').filter(Boolean);
          entries = parseCaddyAccessLog(rawLines, domain);
        } else {
          // Fallback: read log files directly
          let logPath = '/var/log/caddy/access.log';
          if (domain) logPath = `/var/log/caddy/alo-sites/${domain}-access.log`;
          const raw = await runCmd('tail', ['-n', String(lines), logPath], 15000);
          if (raw) {
            entries = parseCaddyAccessLog(raw.split('\n').filter(Boolean), domain);
          }
        }
        break;
      }

      // ----------------------------------------------------------------
      // Caddy error logs
      // ----------------------------------------------------------------
      case 'caddy-error': {
        const args = ['get-logs', 'caddy-error'];
        if (domain) args.push(domain);
        args.push(String(lines));
        const result = await callHelper('alo-log-helper', args, 15000);
        if (result.success && result.stdout) {
          entries = parseCaddyErrorLog(result.stdout.split('\n').filter(Boolean), domain);
        } else {
          let logPath = '/var/log/caddy/error.log';
          if (domain) logPath = `/var/log/caddy/alo-sites/${domain}-error.log`;
          const raw = await runCmd('tail', ['-n', String(lines), logPath], 15000);
          if (raw) {
            entries = parseCaddyErrorLog(raw.split('\n').filter(Boolean), domain);
          }
        }
        break;
      }

      // ----------------------------------------------------------------
      // Systemd journal
      // ----------------------------------------------------------------
      case 'systemd': {
        const journalArgs = ['-n', String(lines), '-o', 'short-iso', '--no-pager'];
        if (domain) {
          // Try to get the systemd service for this domain
          const safeName = domain.replace(/[^a-zA-Z0-9.-]/g, '_');
          journalArgs.push('-u', `alo-site-${safeName}`);
        }
        const raw = await runCmd('journalctl', journalArgs, 15000);
        if (raw) {
          entries = parseSystemdLog(raw.split('\n').filter(Boolean));
        }
        break;
      }

      // ----------------------------------------------------------------
      // PHP-FPM logs
      // ----------------------------------------------------------------
      case 'php-fpm': {
        const result = await callHelper('alo-log-helper', ['get-logs', 'php-fpm', String(lines)], 15000);
        if (result.success && result.stdout) {
          entries = parsePhpFpmLog(result.stdout.split('\n').filter(Boolean));
        } else {
          const raw = await runCmd('tail', ['-n', String(lines), '/var/log/php8.2-fpm.log'], 15000);
          if (raw) {
            entries = parsePhpFpmLog(raw.split('\n').filter(Boolean));
          }
        }
        break;
      }

      // ----------------------------------------------------------------
      // Application logs (from our own logger via journalctl)
      // ----------------------------------------------------------------
      case 'application': {
        const journalArgs = [
          '-n', String(lines),
          '-o', 'short-iso',
          '--no-pager',
          '-u', 'alo-server-hosting',
        ];
        const raw = await runCmd('journalctl', journalArgs, 15000);
        if (raw) {
          entries = raw.split('\n').filter(Boolean).map((line) => {
            const match = line.match(/^(\S+)\s+\S+\s+(\S+?):\s+(.*)$/);
            const msg = match?.[3] ?? line;
            let level = 'info';
            if (msg.includes('"level":30') || msg.includes('"level":"info"')) level = 'info';
            else if (msg.includes('"level":40') || msg.includes('"level":"warn"')) level = 'warn';
            else if (msg.includes('"level":50') || msg.includes('"level":"error"')) level = 'error';
            else if (msg.includes('"level":60') || msg.includes('"level":"fatal"')) level = 'fatal';
            else if (msg.includes('"level":10') || msg.includes('"level":"trace"')) level = 'debug';

            return {
              timestamp: match?.[1] ?? '',
              level,
              message: msg,
              source: 'application',
            };
          });
        }
        break;
      }

      // ----------------------------------------------------------------
      // Security logs (from AuditLog table)
      // ----------------------------------------------------------------
      case 'security': {
        const where: Record<string, unknown> = {
          OR: [
            { action: { contains: 'login' } },
            { action: { contains: 'auth' } },
            { action: { contains: 'MFA' } },
            { action: { contains: 'lockout' } },
            { action: { contains: 'FORBIDDEN' } },
            { action: { contains: 'UNAUTHORIZED' } },
            { action: { contains: 'firewall' } },
            { action: { contains: 'ssh' } },
          ],
        };

        if (search) {
          where.OR = [
            ...(where.OR as Array<Record<string, unknown>>),
            { action: { contains: search } },
            { domain: { contains: search } },
            { actorEmail: { contains: search } },
            { ipAddress: { contains: search } },
          ];
        }

        const auditLogs = await db.auditLog.findMany({
          where,
          orderBy: { timestamp: 'desc' },
          take: lines,
          select: {
            id: true,
            action: true,
            actorEmail: true,
            actorRole: true,
            resourceType: true,
            resourceId: true,
            domain: true,
            result: true,
            ipAddress: true,
            errorCode: true,
            timestamp: true,
          },
        });

        entries = auditLogs.map((log) => {
          let level = 'info';
          if (log.result === 'failure' || log.errorCode) level = 'error';
          else if (log.action.includes('fail') || log.action.includes('denied')) level = 'warn';

          return {
            timestamp: log.timestamp.toISOString(),
            level,
            message: `${log.action} — ${log.actorEmail || 'system'} on ${log.resourceType || ''}${log.resourceId ? `/${log.resourceId.slice(0, 8)}` : ''}${log.domain ? ` (${log.domain})` : ''}${log.result ? ` [${log.result}]` : ''}`,
            source: 'security',
            domain: log.domain || undefined,
            metadata: {
              id: log.id,
              actorEmail: log.actorEmail || undefined,
              actorRole: log.actorRole || undefined,
              resourceType: log.resourceType || undefined,
              ipAddress: log.ipAddress || undefined,
              errorCode: log.errorCode || undefined,
            },
          };
        });
        break;
      }

      // ----------------------------------------------------------------
      // Full audit logs
      // ----------------------------------------------------------------
      case 'audit': {
        const where: Record<string, unknown> = {};
        if (search) {
          where.OR = [
            { action: { contains: search } },
            { actorEmail: { contains: search } },
            { resourceType: { contains: search } },
            { domain: { contains: search } },
            { ipAddress: { contains: search } },
          ];
        }
        if (domain) {
          where.domain = domain;
        }

        const auditLogs = await db.auditLog.findMany({
          where,
          orderBy: { timestamp: 'desc' },
          take: lines,
          select: {
            id: true,
            action: true,
            actorEmail: true,
            actorRole: true,
            resourceType: true,
            resourceId: true,
            domain: true,
            result: true,
            requestId: true,
            ipAddress: true,
            userAgent: true,
            errorCode: true,
            durationMs: true,
            timestamp: true,
            metadata: true,
          },
        });

        entries = auditLogs.map((log) => {
          let level = 'info';
          if (log.result === 'failure' || log.errorCode) level = 'error';
          else if (log.action.includes('delete') || log.action.includes('remove')) level = 'warn';

          return {
            timestamp: log.timestamp.toISOString(),
            level,
            message: `${log.action} — ${log.actorEmail || 'system'} on ${log.resourceType || 'unknown'}${log.result ? ` [${log.result}]` : ''}`,
            source: 'audit',
            domain: log.domain || undefined,
            metadata: {
              id: log.id,
              actorEmail: log.actorEmail || undefined,
              actorRole: log.actorRole || undefined,
              resourceType: log.resourceType || undefined,
              resourceId: log.resourceId || undefined,
              requestId: log.requestId || undefined,
              ipAddress: log.ipAddress || undefined,
              userAgent: log.userAgent || undefined,
              errorCode: log.errorCode || undefined,
              durationMs: log.durationMs ? String(log.durationMs) : undefined,
            },
          };
        });
        break;
      }
    }

    // Apply text search filter (for non-DB sources)
    if (search && source !== 'security' && source !== 'audit') {
      const searchLower = search.toLowerCase();
      entries = entries.filter((e) => e.message.toLowerCase().includes(searchLower));
    }

    return NextResponse.json(
      apiSuccess({
        source,
        domain: domain || null,
        total: entries.length,
        requestedLines: lines,
        entries,
      }),
    );
  } catch (e) {
    return handleErr(e);
  }
}
