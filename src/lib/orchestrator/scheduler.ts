/**
 * Central compute-node scheduler.
 *
 * Selects the enrolled node a project deploys to. Deterministic, explainable
 * and audited: every decision returns the score breakdown that produced it, so
 * "why did this app land on that node" is answerable after the fact.
 *
 * Selection inputs (in order of hardness):
 *   1. Hard requirements — agent online (fresh heartbeat), status active, and
 *      capabilities cover the deployment command set for the project's runtime.
 *   2. Capacity — latest measured metrics (CPU %, memory headroom, disk
 *      headroom) from the node's heartbeats. Unknown metrics are neutral, never
 *      treated as free capacity.
 *   3. Load spreading — fewer already-assigned projects wins ties.
 *   4. Placement preferences — a preferred region (if any) biases, not forces.
 *
 * The scheduler never invents capacity: a node without recent measurements is
 * scored on load alone and flagged `capacity: "unknown"` in its rationale.
 */
import { db } from "@/lib/db";
import { agentOnline } from "@/lib/agents/agent";

/** Commands a project's remote lifecycle needs, by runtime shape. */
export function requiredDeploymentCapabilities(runtime: "node" | "static"): string[] {
  const base = ["deploy.clone", "deploy.build-release", "deploy.marker", "deploy.read-marker", "deploy.switch", "deploy.list", "app.up", "health.probe"];
  return runtime === "node" ? [...base, "app.restart", "app.status"] : [...base, "app.status"];
}

export interface SchedulerCandidate {
  agentId: string;
  name: string;
  serverId: string | null;
  region: string | null;
  online: boolean;
  capabilities: string[];
  /** Latest measured metrics, when the node has reported any. */
  metrics: {
    cpuPercent: number | null;
    memoryTotalMb: number | null;
    memoryUsedMb: number | null;
    diskTotalGb: number | null;
    diskUsedGb: number | null;
  } | null;
  assignedProjects: number;
}

export interface SchedulerDecision {
  agentId: string;
  candidate: SchedulerCandidate;
  score: number;
  rationale: string[];
  considered: number;
  capacityKnown: boolean;
}

function memHeadroomPct(c: SchedulerCandidate): number | null {
  const m = c.metrics;
  if (!m || m.memoryTotalMb === null || m.memoryUsedMb === null || m.memoryTotalMb <= 0) return null;
  return Math.max(0, Math.min(100, ((m.memoryTotalMb - m.memoryUsedMb) / m.memoryTotalMb) * 100));
}

function diskHeadroomPct(c: SchedulerCandidate): number | null {
  const m = c.metrics;
  if (!m || m.diskTotalGb === null || m.diskUsedGb === null || m.diskTotalGb <= 0) return null;
  return Math.max(0, Math.min(100, ((m.diskTotalGb - m.diskUsedGb) / m.diskTotalGb) * 100));
}

/** Load the schedulable fleet with its freshest measurements. */
export async function schedulerCandidates(now = new Date()): Promise<SchedulerCandidate[]> {
  const agents = await db.serverAgent.findMany({ where: { status: "active" }, take: 200 });
  const counts = await db.gitProject.groupBy({ by: ["agentId"], _count: { _all: true }, where: { agentId: { not: null } } });
  const assigned = new Map(counts.map((c) => [c.agentId as string, c._count._all]));
  const out: SchedulerCandidate[] = [];
  for (const agent of agents) {
    let metrics: SchedulerCandidate["metrics"] = null;
    const metric = await db.agentMetric.findFirst({ where: { agentId: agent.id }, orderBy: { recordedAt: "desc" } });
    if (metric) {
      metrics = {
        cpuPercent: metric.cpuPercent,
        memoryTotalMb: metric.memoryTotalMb,
        memoryUsedMb: metric.memoryUsedMb,
        diskTotalGb: metric.diskTotalGb,
        diskUsedGb: metric.diskUsedGb,
      };
    }
    let region: string | null = null;
    if (agent.serverId) {
      const server = await db.server.findUnique({ where: { id: agent.serverId }, select: { region: true } });
      region = server?.region ?? null;
    }
    let capabilities: string[] = [];
    try {
      capabilities = Array.isArray(JSON.parse(agent.capabilities)) ? (JSON.parse(agent.capabilities) as string[]) : [];
    } catch {
      capabilities = [];
    }
    out.push({
      agentId: agent.id,
      name: agent.name,
      serverId: agent.serverId,
      region,
      online: agentOnline(agent, now.getTime()),
      capabilities,
      metrics,
      assignedProjects: assigned.get(agent.id) ?? 0,
    });
  }
  return out;
}

/**
 * Pick the best node for a project. Returns null when no online node satisfies
 * the hard capability requirements — the caller must report that honestly
 * instead of deploying somewhere unverified.
 */
export async function selectNode(
  opts: { runtime: "node" | "static"; preferredAgentId?: string | null; preferredRegion?: string | null },
  now = new Date(),
): Promise<SchedulerDecision | null> {
  const required = requiredDeploymentCapabilities(opts.runtime);
  const candidates = await schedulerCandidates(now);
  const eligible = candidates.filter((c) => {
    if (!c.online) return false;
    return required.every((command) => c.capabilities.includes(command));
  });
  if (!eligible.length) return null;

  let best: { candidate: SchedulerCandidate; score: number; rationale: string[]; capacityKnown: boolean } | null = null;

  for (const candidate of eligible) {
    const rationale: string[] = [];
    let score = 0;
    let capacityKnown = false;

    // An explicitly pinned node wins ties but is still safety-checked above.
    if (opts.preferredAgentId && candidate.agentId === opts.preferredAgentId) {
      score += 25;
      rationale.push(`pinned preference ${candidate.name} (+25)`);
    }

    const cpu = candidate.metrics?.cpuPercent ?? null;
    const mem = memHeadroomPct(candidate);
    const disk = diskHeadroomPct(candidate);
    if (cpu !== null) {
      const cpuScore = Math.max(0, 100 - cpu) / 10; // 0..10
      score += cpuScore;
      rationale.push(`cpu ${cpu.toFixed(0)}% used (+${cpuScore.toFixed(1)})`);
      capacityKnown = true;
    }
    if (mem !== null) {
      const memScore = mem / 10; // 0..10
      score += memScore;
      rationale.push(`memory headroom ${mem.toFixed(0)}% (+${memScore.toFixed(1)})`);
      capacityKnown = true;
    }
    if (disk !== null) {
      const diskScore = Math.min(disk, 50) / 5; // 0..10, capped: 50%+ free is plenty
      score += diskScore;
      rationale.push(`disk headroom ${disk.toFixed(0)}% (+${diskScore.toFixed(1)})`);
      capacityKnown = true;
    }
    if (!capacityKnown) rationale.push("no capacity measurements reported (scored on placement only)");

    // Load spreading: each already-assigned project costs 2 points.
    if (candidate.assignedProjects > 0) {
      score -= candidate.assignedProjects * 2;
      rationale.push(`${candidate.assignedProjects} project(s) already assigned (-${candidate.assignedProjects * 2})`);
    }

    if (opts.preferredRegion && candidate.region && candidate.region === opts.preferredRegion) {
      score += 5;
      rationale.push(`region ${candidate.region} matches preference (+5)`);
    }

    rationale.push(`total ${score.toFixed(1)}`);
    if (!best || score > best.score) best = { candidate, score, rationale, capacityKnown };
  }

  if (!best) return null;
  return {
    agentId: best.candidate.agentId,
    candidate: best.candidate,
    score: best.score,
    rationale: best.rationale,
    considered: eligible.length,
    capacityKnown: best.capacityKnown,
  };
}
