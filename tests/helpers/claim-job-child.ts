/** Child process for a disposable-database crash drill. Claims, then exits
 * before touching the execution plane, leaving the real persisted lease. */
import { db } from "@/lib/db";
import { orchestrator } from "@/lib/orchestrator/orchestrator";

async function main() {
  const [jobId, workerId] = process.argv.slice(2);
  if (!jobId || !workerId || !/[/]alo-test-db-[^/]+\/custom\.db$/.test(process.env.DATABASE_URL ?? "")) throw new Error("Disposable test DB required");
  try { console.log(JSON.stringify({ claimed: await orchestrator.claimSpecific(workerId, jobId) })); }
  finally { await db.$disconnect(); }
}
void main().catch(() => { console.error("Test worker failed to claim"); process.exitCode = 1; });
