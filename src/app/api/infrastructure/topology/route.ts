import { NextRequest, NextResponse } from "next/server";
import { apiSuccess, apiError, type ApiResponse } from "@/lib/response";
import { requireSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { orchestrator } from "@/lib/orchestrator/orchestrator";
import { agentOnline, parseArray } from "@/lib/agents/agent";
import { allowlistCatalogue } from "@/lib/agents/allowlist";

function handleErr(e: unknown): NextResponse {
  if (e && typeof e === "object" && "status" in e) {
    const a = e as ApiResponse;
    return NextResponse.json(a, { status: a.status });
  }
  return NextResponse.json(apiError("Internal server error"), { status: 500 });
}

/**
 * The hybrid infrastructure topology, assembled from *observed* data only.
 *
 * Each node carries a `dataState`:
 *   - `live`         an agent has reported a heartbeat inside the online window
 *   - `stale`        an agent is enrolled but its heartbeat is too old
 *   - `unavailable`  no agent has ever reported — every metric is unknown, and
 *                    the UI must show "not measured", never a zero.
 *
 * The planned role (production / replica / CI / backup target) is configuration.
 * Whether that role is actually fulfilled is a separate, evidence-backed field.
 */
export async function GET(request: NextRequest) {
  try {
    await requireSession(request);
    const now = Date.now();

    const [servers, agents, replication, backups, websites, deployments] = await Promise.all([
      db.server.findMany({ orderBy: { createdAt: "asc" }, take: 50 }),
      db.serverAgent.findMany({ orderBy: { createdAt: "asc" }, take: 50 }),
      db.replicationStatus.findMany({ orderBy: { updatedAt: "desc" }, take: 20 }),
      db.backup.findMany({ orderBy: { createdAt: "desc" }, take: 10 }),
      db.website.count(),
      db.deployment.findMany({ orderBy: { createdAt: "desc" }, take: 10, select: { id: true, status: true, stage: true, createdAt: true, commitHash: true, verifiedCommitSha: true, projectId: true } }),
    ]);

    const queue = await orchestrator.queueDepth();
    const taskCounts = await db.agentTask.groupBy({ by: ["status"], _count: { _all: true } });
    // PRIVILEGED / DESTRUCTIVE agent tasks that a named human must approve
    // before `claimTask` will hand them to a host.
    const gatedTasks = await db.agentTask.findMany({
      where: { status: "PENDING", requiresApproval: true, approvedBy: null },
      orderBy: { createdAt: "asc" },
      take: 20,
      include: { agent: { select: { name: true } } },
    });

    const agentViews = agents.map((agent) => {
      const online = agentOnline(agent, now);
      return {
        id: agent.id,
        name: agent.name,
        agentKey: agent.agentKey,
        serverId: agent.serverId,
        status: agent.status,
        version: agent.version,
        capabilities: parseArray(agent.capabilities),
        scopes: parseArray(agent.scopes),
        online,
        dataState: agent.status === "revoked" ? "revoked" : online ? "live" : agent.lastHeartbeat ? "stale" : "unavailable",
        lastHeartbeat: agent.lastHeartbeat,
        heartbeatAgeMs: agent.lastHeartbeat ? now - agent.lastHeartbeat.getTime() : null,
        lastSeenIp: agent.lastSeenIp,
        enrolledAt: agent.enrolledAt,
      };
    });

    const serverViews = servers.map((server) => {
      const agent = agentViews.find((a) => a.serverId === server.id) ?? null;
      return {
        id: server.id,
        name: server.name,
        hostname: server.hostname,
        ip: server.ip,
        region: server.region,
        role: server.role,
        status: server.status,
        cpuCores: server.cpuCores,
        ramGb: server.ramGb,
        diskGb: server.diskGb,
        // These come from the agent heartbeat mirror. They are null when no
        // agent has reported — the UI renders that as "not measured".
        cpuUsage: server.cpuUsage,
        memoryUsage: server.memoryUsage,
        diskUsage: server.diskUsage,
        uptime: server.uptime,
        agent,
        dataState: agent?.dataState ?? "unavailable",
        replication: replication.find((r) => r.host === server.hostname) ?? null,
      };
    });

    // Hosts that reported an audit but are not registered as servers yet.
    const orphanAudits = replication
      .filter((r) => !servers.some((s) => s.hostname === r.host))
      .map((r) => ({ host: r.host, engine: r.engine, version: r.version, role: r.role, binlogEnabled: r.binlogEnabled, gtidMode: r.gtidMode, lagSeconds: r.lagSeconds, lastCheckedAt: r.lastCheckedAt, healthy: r.healthy }));

    const verifiedBackups = backups.filter((b) => b.status === "COMPLETED" && b.checksum);
    const restoreJobs = await db.restoreJob.findMany({ orderBy: { createdAt: "desc" }, take: 5 }).catch(() => []);

    return NextResponse.json(
      apiSuccess({
        generatedAt: new Date(now).toISOString(),
        nodes: serverViews,
        agents: agentViews,
        unregisteredAudits: orphanAudits,
        replication: replication.map((r) => ({
          host: r.host,
          engine: r.engine,
          version: r.version,
          role: r.role,
          binlogEnabled: r.binlogEnabled,
          gtidMode: r.gtidMode,
          binlogPosition: r.binlogPosition,
          replicaOf: r.replicaOf,
          lagSeconds: r.lagSeconds,
          healthy: r.healthy,
          lastCheckedAt: r.lastCheckedAt,
          notes: r.notes,
        })),
        queue: {
          ...queue,
          tasks: Object.fromEntries(taskCounts.map((t) => [t.status, t._count._all])),
        },
        pendingApprovals: gatedTasks.map((t) => ({
          id: t.id,
          command: t.command,
          agentName: t.agent?.name ?? "unknown agent",
          args: t.args.slice(0, 400),
          timeoutMs: t.timeoutMs,
          createdAt: t.createdAt,
        })),
        allowlist: allowlistCatalogue(),
        workloads: {
          websites,
          recentDeployments: deployments,
          deploymentsSucceeded: deployments.filter((d) => d.status === "SUCCESS").length,
          deploymentsFailed: deployments.filter((d) => d.status === "FAILED").length,
        },
        backups: {
          recent: backups.map((b) => ({
            id: b.id,
            filename: b.filename,
            filepath: b.filepath,
            status: b.status,
            backupType: b.backupType,
            checksum: b.checksum,
            fileSize: b.fileSize === null ? null : Number(b.fileSize),
            createdAt: b.createdAt,
          })),
          verifiedCount: verifiedBackups.length,
          // A backup counts as verified only when an integrity check passed.
          verified: verifiedBackups.length > 0,
          restoreDrills: restoreJobs.map((r) => ({ id: r.id, status: r.status, createdAt: r.createdAt })),
          restoreDrillEverRun: restoreJobs.length > 0,
        },
        dataState:
          agentViews.length === 0
            ? "unavailable"
            : agentViews.some((a) => a.dataState === "live")
              ? "live"
              : "stale",
      }),
    );
  } catch (e) {
    return handleErr(e);
  }
}
