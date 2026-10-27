import { NextRequest, NextResponse } from "next/server";
import { apiSuccess, apiError, type ApiResponse } from "@/lib/response";
import { requireSession } from "@/lib/auth";
import { orchestrator } from "@/lib/orchestrator/orchestrator";
import { listWorkers } from "@/lib/orchestrator/workers";
import { expireStaleTasks } from "@/lib/agents/agent";
import { db } from "@/lib/db";

function handleErr(e: unknown): NextResponse {
  if (e && typeof e === "object" && "status" in e) {
    const a = e as ApiResponse;
    return NextResponse.json(a, { status: a.status });
  }
  return NextResponse.json(apiError("Internal server error"), { status: 500 });
}

/**
 * Orchestrator health: queue depth per state, dead letters, worker catalogue,
 * agent connectivity and the age of the oldest queued job.
 *
 * Everything here is measured from the database. If no agent has ever reported,
 * `agents.online` is 0 and `agents.dataState` says "unavailable" — the UI must
 * not turn that into a healthy-looking zero.
 */
export async function GET(request: NextRequest) {
  try {
    await requireSession(request);

    const [depth, recovered] = await Promise.all([
      orchestrator.queueDepth(),
      orchestrator.recoverAbandoned().catch(() => ({ requeued: 0, deadLettered: 0, jobIds: [] })),
    ]);
    await expireStaleTasks().catch(() => 0);

    const now = Date.now();
    const agents = await db.serverAgent.findMany({ orderBy: { createdAt: "desc" }, take: 50 });
    const onlineWindow = 3 * 60_000;
    const online = agents.filter((a) => a.status === "active" && a.lastHeartbeat && now - a.lastHeartbeat.getTime() <= onlineWindow);

    const taskCounts = await db.agentTask.groupBy({ by: ["status"], _count: { _all: true } });

    return NextResponse.json(
      apiSuccess({
        queue: { ...depth, recoveredNow: recovered },
        workers: listWorkers(),
        agents: {
          total: agents.length,
          online: online.length,
          revoked: agents.filter((a) => a.status === "revoked").length,
          pending: agents.filter((a) => a.status === "pending").length,
          stale: agents.filter((a) => a.status === "active" && (!a.lastHeartbeat || now - a.lastHeartbeat.getTime() > onlineWindow)).length,
          // Honest data-state label for the dashboard.
          dataState: agents.length === 0 ? "unavailable" : online.length === 0 ? "stale" : "live",
          onlineWindowMs: onlineWindow,
        },
        tasks: Object.fromEntries(taskCounts.map((t) => [t.status, t._count._all])),
      }),
    );
  } catch (e) {
    return handleErr(e);
  }
}
