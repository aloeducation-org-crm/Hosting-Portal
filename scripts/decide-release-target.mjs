#!/usr/bin/env node
/**
 * Turns preflight facts (JSON on stdin) into a deployment decision (JSON on
 * stdout). All logic lives in `src/lib/deploy/preflight.ts`, which is unit-tested;
 * this file only bridges bash → TypeScript so the shell script cannot drift from
 * the tested behaviour.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { register } from "tsx/esm/api";

const here = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  const raw = readFileSync(0, "utf8");
  const facts = JSON.parse(raw);
  const unregister = register();
  try {
    const mod = await import(path.join(here, "..", "src", "lib", "deploy", "preflight.ts"));
    process.stdout.write(JSON.stringify(mod.decideReleaseTarget(facts)));
  } finally {
    unregister();
  }
}

main().catch((error) => {
  process.stderr.write(`decide-release-target: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(2);
});
