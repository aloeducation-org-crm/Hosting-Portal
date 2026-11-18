/** Standalone, opt-in worker. The panel process never needs a provider key. */
import { db } from "../src/lib/db";
import { readMessagingConfig } from "../src/lib/messaging/config";
import { runPilotMessagingTick } from "../src/lib/messaging/worker";

async function main() {
  const config = readMessagingConfig();
  if (!config) {
    console.info("Pilot messaging worker disabled");
    return;
  }
  if (!process.env.DATABASE_URL?.trim()) throw new Error("Explicit database required");
  const once = process.argv.includes("--once");
  let stop = false;
  const drain = () => { stop = true; };
  process.on("SIGTERM", drain);
  process.on("SIGINT", drain);
  console.info("Pilot messaging worker started");
  do {
    const result = await runPilotMessagingTick(config, { stopping: () => stop });
    if (result.processed || result.recovered) console.info(JSON.stringify(result));
    if (!stop && !once) await new Promise((resolve) => setTimeout(resolve, 2_000));
  } while (!stop && !once);
}

void main().catch(() => {
  // No provider body, URL, credential, recipient or message in service logs.
  console.error("Pilot messaging worker stopped after a configuration or database error");
  process.exitCode = 1;
}).finally(() => db.$disconnect());
