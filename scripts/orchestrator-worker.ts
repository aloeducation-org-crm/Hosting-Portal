/**
 * Standalone durable Automation Engine worker.
 *
 * One loop drives the central engine: lease recovery, stale agent-task expiry,
 * schedule claims, workflow reconciliation, bounded job claims and legacy
 * deployment attachment. It never creates a second in-memory queue.
 *
 * Development:  npx tsx scripts/orchestrator-worker.ts [--once]
 * Production:   node .next/standalone/automation-worker.cjs [--once]
 *
 * Environment:
 *   ORCHESTRATOR_INTERVAL_MS      poll interval (1000..60000, default 5000)
 *   ORCHESTRATOR_MAX_JOBS         jobs per tick (1..25, default 5)
 *   ORCHESTRATOR_WORKER_ID        lease identity (default hostname-pid)
 *   ORCHESTRATOR_HEARTBEAT_FILE   liveness file (default /tmp/alo-automation-worker.json)
 *   DEPLOY_INLINE_WORKER          defaults to false here; set the panel to false too
 */
import os from "node:os";
import fs from "node:fs/promises";
import { runAutomationTick } from "../src/lib/orchestrator/engine";
import "../src/lib/orchestrator/workers";
import { db } from "../src/lib/db";
import { logger } from "../src/lib/logger";

const once = process.argv.includes("--once");
const intervalMs = Math.min(60_000, Math.max(1000, Number(process.env.ORCHESTRATOR_INTERVAL_MS) || 5000));
const maxJobs = Math.min(25, Math.max(1, Number(process.env.ORCHESTRATOR_MAX_JOBS) || 5));
const workerId = (process.env.ORCHESTRATOR_WORKER_ID || `${os.hostname()}-${process.pid}`).slice(0, 64);
const heartbeatFile = process.env.ORCHESTRATOR_HEARTBEAT_FILE || "/tmp/alo-automation-worker.json";
if (process.env.DEPLOY_INLINE_WORKER === undefined) process.env.DEPLOY_INLINE_WORKER = "false";

let stopping = false;
let inTick = false;
let lastSuccessAt: string | null = null;
let lastError: string | null = null;
// Consecutive failed ticks. A wedged database adapter (a leaked Prisma
// interactive transaction holds the SQLite adapter's mutex) makes every
// following tick fail deterministically; a worker that only logs is then dead
// in the water while looking alive. After this many failures in a row the
// worker exits non-zero so the supervisor restarts it with a fresh adapter.
const MAX_CONSECUTIVE_TICK_FAILURES = Math.max(2, Number(process.env.ORCHESTRATOR_MAX_TICK_FAILURES) || 5);
let consecutiveFailures = 0;

async function heartbeat() {
  const payload = { workerId, pid: process.pid, inTick, lastSuccessAt, lastError, updatedAt: new Date().toISOString() };
  await fs.writeFile(heartbeatFile, JSON.stringify(payload), "utf8").catch((error) => logger.warn({ error }, "worker heartbeat write failed"));
}

async function tick() {
  inTick = true;
  await heartbeat();
  try {
    const result = await runAutomationTick({ workerId, maxJobs });
    lastSuccessAt = new Date().toISOString();
    lastError = null;
    consecutiveFailures = 0;
    if (result.recovered.jobIds.length || result.expiredTasks || result.ran.length || result.scheduled.length) {
      logger.info({ workerId, jobs: result.ran.length, scheduled: result.scheduled.length, recovered: result.recovered.jobIds.length }, "automation tick");
    }
  } catch (error) {
    lastError = error instanceof Error ? error.message.slice(0, 300) : "unknown";
    consecutiveFailures += 1;
    logger.error({ workerId, error, consecutiveFailures }, "automation tick failed");
    if (!once && consecutiveFailures >= MAX_CONSECUTIVE_TICK_FAILURES) {
      // Crash-only design: the supervisor (systemd, PM2, the run loop that
      // started this process) restarts us with a clean adapter. Leases and
      // idempotency keys make the restart safe.
      logger.fatal({ workerId, consecutiveFailures }, "automation worker gave up after repeated tick failures; exiting for a supervised restart");
      process.exitCode = 1;
      stopping = true;
    }
  } finally {
    inTick = false;
    await heartbeat();
  }
}

async function main() {
  logger.info({ workerId, once, intervalMs, maxJobs }, "automation worker started");
  const stop = () => { stopping = true; logger.info({ workerId }, "automation worker draining current tick"); };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
  const pulse = setInterval(() => void heartbeat(), 15_000);
  pulse.unref();
  await heartbeat();
  do {
    await tick();
    if (once || stopping) break;
    await new Promise((r) => setTimeout(r, intervalMs));
  } while (!stopping);
  clearInterval(pulse);
  await db.$disconnect().catch(() => {});
  logger.info({ workerId }, "automation worker stopped");
}

void main().catch((error) => { logger.fatal({ error }, "automation worker crashed"); process.exitCode = 1; });
