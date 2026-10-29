#!/usr/bin/env node
/**
 * Bridges bash → the unit-tested release activation guard.
 *
 * Reads release facts as JSON on stdin, writes the decision as JSON on stdout,
 * and exits non-zero when the release must not be activated. All logic lives in
 * `src/lib/deploy/release-guard.ts`, so the shell script cannot drift from the
 * tested behaviour — the same pattern `scripts/decide-release-target.mjs` uses
 * for the deployment-shape decision.
 *
 * Exit codes: 0 = authorized, 1 = refused, 2 = the decision could not be made.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { register } from "tsx/esm/api";

const here = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  const raw = readFileSync(0, "utf8");
  let input;
  try {
    input = JSON.parse(raw);
  } catch (error) {
    process.stderr.write(
      `decide-release-activation: facts were not valid JSON: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exit(2);
  }

  const facts = input?.facts ?? {};
  const authorization = input?.authorization ?? { allowRollback: false };

  const unregister = register();
  try {
    const mod = await import(path.join(here, "..", "src", "lib", "deploy", "release-guard.ts"));
    const decision = mod.decideReleaseActivation(facts, authorization);
    process.stdout.write(JSON.stringify(decision));
    process.exit(decision.authorized ? 0 : 1);
  } finally {
    unregister();
  }
}

main().catch((error) => {
  process.stderr.write(
    `decide-release-activation: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exit(2);
});
