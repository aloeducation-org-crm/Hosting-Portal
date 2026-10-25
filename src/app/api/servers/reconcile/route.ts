import { NextRequest, NextResponse } from 'next/server';
import { execFile } from 'child_process';
import fs from 'fs';
import { apiSuccess, apiError, type ApiResponse } from '@/lib/response';
import { requireSuperAdmin } from '@/lib/auth';
import { callHelper } from '@/lib/helpers';
import { db } from '@/lib/db';
import { env } from '@/lib/env';

function handleErr(e: unknown): NextResponse {
  if (e && typeof e === 'object' && 'status' in e) {
    const a = e as ApiResponse;
    return NextResponse.json(a, { status: a.status });
  }
  return NextResponse.json(apiError('Internal server error'), { status: 500 });
}

/** Promisified execFile */
function execFileAsync(
  cmd: string,
  args: string[],
  timeoutMs = 30_000,
): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
  return new Promise((resolve) => {
    const child = execFile(cmd, args, { timeout: timeoutMs, maxBuffer: 5 * 1024 * 1024 }, (error, stdout, stderr) => {
      resolve({
        stdout: stdout || '',
        stderr: stderr || '',
        exitCode: error ? (typeof error.code === 'number' ? error.code : 1) : 0,
      });
    });
    child.on('error', (err) => {
      resolve({ stdout: '', stderr: err.message, exitCode: -1 });
    });
  });
}

export async function GET(request: NextRequest) {
  try {
    await requireSuperAdmin(request);

    // ── 1. Get real server state via health helper ──
    const healthResult = await callHelper('alo-health-helper', ['discover']);
    let realServerState: Record<string, unknown> = {};
    if (healthResult.success && healthResult.stdout.trim()) {
      try {
        realServerState = JSON.parse(healthResult.stdout.trim());
      } catch {
        realServerState = { raw: healthResult.stdout.trim() };
      }
    }

    // ── 2. Get all active, non-deleted websites from DB ──
    const dbWebsites = await db.website.findMany({
      where: {
        status: 'ACTIVE',
        deletedAt: null,
      },
    });

    const siteBase = env.SITE_BASE;
    const caddyDir = env.CADDY_CONFIG_DIR;

    const websiteDetails: Array<{
      id: string;
      domain: string;
      runtime: string;
      hasDirectory: boolean;
      hasCaddyConfig: boolean;
      hasSystemdService: boolean;
      systemdOutput: string;
      consistent: boolean;
    }> = [];

    let websiteConsistent = 0;
    let websiteOrphanedDb = 0;
    let websiteMissingInfra = 0;

    // ── 3. Check each website's infrastructure ──
    for (const site of dbWebsites) {
      const publicDir = `${siteBase}/${site.domain}/public`;
      const caddyConf = `${caddyDir}/${site.domain}.conf`;
      const serviceUnit = `alo-${site.domain}.service`;

      const hasDirectory = fs.existsSync(publicDir);
      const hasCaddyConfig = fs.existsSync(caddyConf);

      // Check systemd service status
      const svcResult = await execFileAsync('systemctl', ['status', serviceUnit], 10_000);
      const hasSystemdService = svcResult.exitCode === 0;

      // For static sites, directory is the main check; for node/nextjs, systemd is critical
      const needsSystemd = site.runtime === 'NODE' || site.runtime === 'NEXTJS';
      const needsCaddy = true; // All sites need Caddy config
      const needsDirectory = true; // All sites need their directory

      const consistent =
        hasDirectory === needsDirectory &&
        hasCaddyConfig === needsCaddy &&
        (needsSystemd ? hasSystemdService : true);

      if (consistent) {
        websiteConsistent++;
      } else if (!hasDirectory && !hasCaddyConfig && (!needsSystemd || !hasSystemdService)) {
        websiteOrphanedDb++;
      } else {
        websiteMissingInfra++;
      }

      websiteDetails.push({
        id: site.id,
        domain: site.domain,
        runtime: site.runtime,
        hasDirectory,
        hasCaddyConfig,
        hasSystemdService,
        systemdOutput: svcResult.stdout.slice(0, 200),
        consistent,
      });
    }

    // ── 4. Docker containers reconciliation ──
    const dbContainers = await db.dockerContainer.findMany();

    const dockerResult = await execFileAsync('docker', ['ps', '--format', '{{.Names}}'], 15_000);
    const realContainerNames = new Set(
      dockerResult.stdout
        .split('\n')
        .map((n) => n.trim())
        .filter(Boolean),
    );

    const containerDetails: Array<{
      id: string;
      name: string;
      image: string;
      dbStatus: string;
      existsInDocker: boolean;
      consistent: boolean;
    }> = [];

    let containerConsistent = 0;
    let containerOrphanedDb = 0;
    let containerMissingReal = 0;

    for (const ctr of dbContainers) {
      const existsInDocker = realContainerNames.has(ctr.name);
      // A container is consistent if the DB says running and docker confirms, or DB says stopped and docker doesn't have it
      const consistent =
        (ctr.status === 'running' && existsInDocker) ||
        (ctr.status !== 'running' && !existsInDocker);

      if (consistent) {
        containerConsistent++;
      } else if (ctr.status === 'running' && !existsInDocker) {
        containerOrphanedDb++;
      } else if (ctr.status !== 'running' && existsInDocker) {
        containerMissingReal++;
      } else {
        containerOrphanedDb++;
      }

      containerDetails.push({
        id: ctr.id,
        name: ctr.name,
        image: ctr.image,
        dbStatus: ctr.status,
        existsInDocker,
        consistent,
      });
    }

    // ── 5. Firewall rules reconciliation ──
    const dbFirewallRules = await db.firewallRule.findMany({
      where: { isActive: true },
    });

    const fwResult = await callHelper('alo-firewall-helper', ['status']);
    let liveFirewallRules: unknown[] = [];
    if (fwResult.success && fwResult.stdout.trim()) {
      try {
        const fwParsed = JSON.parse(fwResult.stdout.trim());
        liveFirewallRules = Array.isArray(fwParsed.rules) ? fwParsed.rules : [];
      } catch {
        // leave as empty
      }
    }

    const firewallDetails: Array<{
      dbRuleId: string;
      dbRuleName: string;
      dbRuleAction: string;
      dbRulePort: number | null;
      dbRuleProtocol: string;
      foundInLive: boolean;
    }> = [];

    for (const rule of dbFirewallRules) {
      // Try to match by port + protocol + action
      const foundInLive = liveFirewallRules.some((r: unknown) => {
        const rec = r as Record<string, unknown>;
        const rPort = rec.port ?? rec.to_port ?? rec.from_port;
        const rProto = String(rec.protocol ?? '').toLowerCase();
        const rAction = String(rec.action ?? '').toLowerCase();
        return (
          rAction === rule.action.toLowerCase() &&
          rProto === rule.protocol.toLowerCase() &&
          (rule.port === null || Number(rPort) === rule.port)
        );
      });

      firewallDetails.push({
        dbRuleId: rule.id,
        dbRuleName: rule.name,
        dbRuleAction: rule.action,
        dbRulePort: rule.port,
        dbRuleProtocol: rule.protocol,
        foundInLive,
      });
    }

    // ── 6. Databases from DB ──
    const dbDatabases = await db.databaseInstance.findMany({
      include: { website: { select: { domain: true } } },
    });

    // ── 7. Build and return reconciliation report ──
    const report = {
      websites: {
        total: dbWebsites.length,
        consistent: websiteConsistent,
        orphaned_db: websiteOrphanedDb,
        missing_infrastructure: websiteMissingInfra,
        details: websiteDetails,
      },
      containers: {
        total: dbContainers.length,
        consistent: containerConsistent,
        orphaned_db: containerOrphanedDb,
        missing_real: containerMissingReal,
        details: containerDetails,
      },
      firewall: {
        db_rules: dbFirewallRules.length,
        live_rules: liveFirewallRules.length,
        details: firewallDetails,
      },
      databases: {
        total: dbDatabases.length,
        details: dbDatabases.map((d) => ({
          id: d.id,
          name: d.name,
          engine: d.engine,
          domain: d.website?.domain ?? null,
          host: d.host,
          port: d.port,
        })),
      },
      server: realServerState,
    };

    return NextResponse.json(apiSuccess(report, 'Reconciliation complete'));
  } catch (e) {
    return handleErr(e);
  }
}
