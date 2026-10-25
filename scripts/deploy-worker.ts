/**
 * Standalone deployment worker for self-hosted installs.
 *
 * Usage (with DEPLOY_INLINE_WORKER=false in the panel environment):
 *   DATABASE_URL=file:/var/lib/alo-hosting/alo.db npx tsx scripts/deploy-worker.ts
 *   DATABASE_URL=... npx tsx scripts/deploy-worker.ts --once
 *
 * It polls the existing `deployments` table for PENDING rows and runs them one
 * at a time per project. Safe to run alongside the inline worker: runDeployment
 * performs an atomic PENDING -> RUNNING claim.
 */
import { processPendingDeployments } from "../src/lib/deploy/queue";
import { db } from "../src/lib/db";

const once = process.argv.includes("--once");
const intervalMs = Number(process.env.DEPLOY_WORKER_INTERVAL_MS || 2000);

async function tick() {
  const ids = await processPendingDeployments(5);
  if (ids.length) console.log(`[deploy-worker] processed ${ids.length}: ${ids.join(", ")}`);
  return ids.length;
}

async function main() {
  console.log(`[deploy-worker] started (once=${once}, interval=${intervalMs}ms)`);
  do {
    try {
      await tick();
    } catch (error) {
      console.error("[deploy-worker] tick failed:", error instanceof Error ? error.message : String(error));
    }
    if (!once) await new Promise((r) => setTimeout(r, intervalMs));
  } while (!once);
  await db.$disconnect();
}

void main();
