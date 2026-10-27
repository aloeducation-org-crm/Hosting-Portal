/**
 * Standalone durable-job worker for self-hosted installs.
 *
 * One process, one loop, two existing persistent queues — deliberately *not* a
 * second queue implementation:
 *
 *   1. `operation_jobs` — the durable orchestrator (build/test, security
 *      analysis, release identity, backups, monitoring, recovery, database and
 *      domain audits). Claimed with leases, per-lock-key serialization, retries
 *      and dead-lettering.
 *   2. `deployments` — the Git-connected deployment pipeline, which keeps its
 *      own PENDING rows and its own atomic PENDING → RUNNING claim.
 *
 * Usage:
 *   DATABASE_URL=file:/var/lib/alo-hosting/alo.db npx tsx scripts/orchestrator-worker.ts
 *   npx tsx scripts/orchestrator-worker.ts --once
 *
 * Environment:
 *   ORCHESTRATOR_INTERVAL_MS   poll interval (default 2000)
 *   ORCHESTRATOR_WORKER_ID     worker identity written into leases (default: hostname+pid)
 *   DEPLOY_INLINE_WORKER       set to "false" in the panel env when this worker
 *                              is the one running deployments (default here: false)
 *
 * Safe to run next to the panel's inline worker: every claim is a conditional
 * write, so two processes cannot run the same job twice.
 */
import os from "node:os";
import { Orchestrator } from "../src/lib/orchestrator/orchestrator";
import "../src/lib/orchestrator/workers"; // registers the worker catalogue
import { processPendingDeployments } from "../src/lib/deploy/queue";
import { expireStaleTasks } from "../src/lib/agents/agent";
import { db } from "../src/lib/db";

const once = process.argv.includes("--once");
const intervalMs = Number(process.env.ORCHESTRATOR_INTERVAL_MS || 2000);
const workerId = process.env.ORCHESTRATOR_WORKER_ID || `${os.hostname()}-${process.pid}`;

// When a dedicated worker is running, the panel process should not also start
// deployments inline — that is what DEPLOY_INLINE_WORKER=false is for.
if (process.env.DEPLOY_INLINE_WORKER === undefined) process.env.DEPLOY_INLINE_WORKER = "false";

const orchestrator = new Orchestrator();

async function tick() {
  const recovered = await orchestrator.recoverAbandoned();
  const expiredTasks = await expireStaleTasks().catch(() => 0);

  let jobs = 0;
  for (let i = 0; i < 5; i++) {
    const jobId = await orchestrator.runNext(workerId);
    if (!jobId) break;
    jobs++;
    console.log(`[orchestrator] job ${jobId} completed by ${workerId}`);
  }

  const deployments = await processPendingDeployments(3).catch((error) => {
    console.error("[orchestrator] deployment sweep failed:", error instanceof Error ? error.message : String(error));
    return [] as string[];
  });

  if (recovered.jobIds.length || expiredTasks || jobs || deployments.length) {
    console.log(
      `[orchestrator] jobs=${jobs} deployments=${deployments.length} recovered=${recovered.jobIds.length} expiredTasks=${expiredTasks}`,
    );
  }
  return jobs + deployments.length;
}

async function main() {
  console.log(`[orchestrator-worker] started (id=${workerId}, once=${once}, interval=${intervalMs}ms)`);
  const stop = async () => {
    console.log("[orchestrator-worker] shutting down gracefully");
    await db.$disconnect().catch(() => {});
    process.exit(0);
  };
  process.on("SIGTERM", () => void stop());
  process.on("SIGINT", () => void stop());

  do {
    try {
      await tick();
    } catch (error) {
      console.error("[orchestrator-worker] tick failed:", error instanceof Error ? error.message : String(error));
    }
    if (!once) await new Promise((r) => setTimeout(r, intervalMs));
  } while (!once);

  await db.$disconnect();
}

void main();
