/**
 * Standalone deployment worker for self-hosted installs.
 *
 * Development:
 *   npx tsx scripts/deploy-worker.ts [--once]
 * Production:
 *   install deploy/systemd/alo-deploy-worker.service (REL-03)
 *
 * It polls the existing `deployments` table for PENDING rows and runs them one
 * at a time per project. Safe to run alongside the inline worker: runDeployment
 * performs an atomic PENDING -> RUNNING claim, so a row is never built twice.
 *
 * Supervision contract (mirrors scripts/orchestrator-worker.ts, which has been
 * running in production):
 *   - SIGTERM/SIGINT finish the in-flight deployment, then exit. Killing a build
 *     halfway leaves a release directory in an unknown state, so the drain
 *     matters.
 *   - A heartbeat file is rewritten every tick and every 15 s. systemd and any
 *     external monitor can distinguish "alive but idle" from "alive but wedged".
 *   - A failed tick is logged and retried; it never exits the process, because
 *     one poisoned deployment must not take the worker down for every tenant.
 *   - The interval is clamped: a typo in the environment cannot turn this into a
 *     busy loop against the database.
 *
 * Environment:
 *   DEPLOY_WORKER_INTERVAL_MS     poll interval (500..60000, default 2000)
 *   DEPLOY_WORKER_BATCH           rows claimed per tick (1..25, default 5)
 *   DEPLOY_WORKER_HEARTBEAT_FILE  liveness file (default /tmp/alo-deploy-worker.json)
 *   DEPLOY_INLINE_WORKER          defaults to false here; set the panel to false too
 */
import os from "node:os";
import fs from "node:fs/promises";
import { processPendingDeployments } from "../src/lib/deploy/queue";
import { db } from "../src/lib/db";

const once = process.argv.includes("--once");
const intervalMs = Math.min(
  60_000,
  Math.max(500, Number(process.env.DEPLOY_WORKER_INTERVAL_MS) || 2000),
);
const batch = Math.min(25, Math.max(1, Number(process.env.DEPLOY_WORKER_BATCH) || 5));
const workerId = (process.env.DEPLOY_WORKER_ID || `${os.hostname()}-${process.pid}`).slice(0, 64);
const heartbeatFile =
  process.env.DEPLOY_WORKER_HEARTBEAT_FILE || "/tmp/alo-deploy-worker.json";

// The panel defaults this to true; a standalone worker that leaves it unset
// would have both processes claiming rows. Explicit is better than implicit.
if (process.env.DEPLOY_INLINE_WORKER === undefined) process.env.DEPLOY_INLINE_WORKER = "false";

let stopping = false;
let inTick = false;
let lastSuccessAt: string | null = null;
let lastError: string | null = null;
let lastProcessed = 0;

async function heartbeat(): Promise<void> {
  const payload = {
    workerId,
    pid: process.pid,
    inTick,
    lastProcessed,
    lastSuccessAt,
    lastError,
    updatedAt: new Date().toISOString(),
  };
  // A heartbeat failure must never crash the worker: a full disk is a reason to
  // log, not to stop deploying.
  await fs.writeFile(heartbeatFile, JSON.stringify(payload), "utf8").catch((error) => {
    console.error(
      "[deploy-worker] heartbeat write failed:",
      error instanceof Error ? error.message : String(error),
    );
  });
}

async function tick(): Promise<number> {
  inTick = true;
  await heartbeat();
  try {
    const ids = await processPendingDeployments(batch);
    lastProcessed = ids.length;
    lastSuccessAt = new Date().toISOString();
    lastError = null;
    if (ids.length) console.log(`[deploy-worker] processed ${ids.length}: ${ids.join(", ")}`);
    return ids.length;
  } catch (error) {
    lastError = error instanceof Error ? error.message.slice(0, 300) : "unknown";
    console.error("[deploy-worker] tick failed:", lastError);
    return 0;
  } finally {
    inTick = false;
    await heartbeat();
  }
}

async function main(): Promise<void> {
  console.log(
    `[deploy-worker] started (workerId=${workerId}, once=${once}, interval=${intervalMs}ms, batch=${batch})`,
  );

  const stop = (signal: string) => {
    if (stopping) return;
    stopping = true;
    console.log(
      `[deploy-worker] ${signal} received; ${inTick ? "finishing the in-flight deployment" : "idle"} then exiting`,
    );
  };
  process.on("SIGTERM", () => stop("SIGTERM"));
  process.on("SIGINT", () => stop("SIGINT"));

  const pulse = setInterval(() => void heartbeat(), 15_000);
  pulse.unref();
  await heartbeat();

  do {
    await tick();
    if (once || stopping) break;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  } while (!stopping);

  clearInterval(pulse);
  await db.$disconnect().catch(() => {});
  console.log(`[deploy-worker] stopped (lastProcessed=${lastProcessed})`);
}

void main().catch((error) => {
  console.error("[deploy-worker] crashed:", error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
