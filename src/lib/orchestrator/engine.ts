/** One tick of the central Automation Engine (scheduler + durable job queue). */
import { orchestrator } from "./orchestrator";
import { reconcileAutomation, tickSchedules } from "./workflows";
import { expireStaleTasks } from "@/lib/agents/agent";
import { db } from "@/lib/db";
import { ensureDeploymentJob } from "@/lib/deploy/queue";
import { reconcileProfileVerifications } from "./profiles";
import { reconcileStaticHostingRequests } from "@/lib/hosting/static-control";
import type { WorkerKind } from "./contracts";

export async function runAutomationTick(opts: { workerId: string; maxJobs?: number; kinds?: WorkerKind[]; lockKey?: string; workerProcess?: true } = { workerId: "api" }) {
  const recovered = await orchestrator.recoverAbandoned();
  const expiredTasks = await expireStaleTasks().catch(() => 0);
  const scheduled = await tickSchedules();
  const reconciled = await reconcileAutomation(orchestrator);
  const profiles = await reconcileProfileVerifications();
  // The legacy HTTP tick/cron can keep driving their existing jobs, but never
  // access the content volume or publish static assets in the request process.
  const staticRequests = opts.workerProcess && (!opts.kinds || opts.kinds.includes("STATIC_HOSTING")) ? await reconcileStaticHostingRequests(10) : 0;
  const ran: string[] = [];
  for (let i = 0; i < (opts.maxJobs ?? 5); i++) {
    const jobId = await orchestrator.runNext(opts.workerId, { kinds: opts.kinds, lockKey: opts.lockKey, excludeKinds: opts.workerProcess ? undefined : ["STATIC_HOSTING"] });
    if (!jobId) break;
    ran.push(jobId);
  }
  // Attach legacy PENDING deployment records to the same central queue. They
  // are claimed by the same bounded runNext loop above on the next tick; this
  // avoids executing extra jobs outside maxJobs/kinds/lockKey filters.
  const pending = await db.deployment.findMany({ where: { status: "PENDING", projectId: { not: null } }, select: { id: true }, orderBy: { createdAt: "asc" }, take: 25 });
  const deployments: string[] = [];
  for (const row of pending) {
    const jobId = await ensureDeploymentJob(row.id);
    if (jobId) deployments.push(jobId);
  }
  const queue = await orchestrator.queueDepth();
  return { workerId: opts.workerId, recovered, expiredTasks, scheduled, reconciled, profiles, staticRequests, ran, deployments, queue, stats: queue };
}
