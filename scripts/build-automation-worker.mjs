#!/usr/bin/env node
/**
 * Bundle the durable workers next to the Next.js standalone server.
 *
 * Entrypoints, each consumed by a shipped systemd unit:
 *   automation-worker.cjs  <- scripts/orchestrator-worker.ts  (pre-existing)
 *   deploy-worker.cjs      <- scripts/deploy-worker.ts        (REL-03)
 *   static-edge.cjs        <- scripts/static-edge.ts (opt-in; no panel DB)
 *
 * CI asserts all files exist after this runs (see .github/workflows/ci-cd.yml,
 * "Check standalone entrypoints"), so a unit cannot point at a bundle that the
 * build quietly stopped producing.
 */
import { build } from "esbuild";
import { mkdirSync } from "node:fs";

mkdirSync(".next/standalone", { recursive: true });

const entries = [
  { entryPoints: ["scripts/orchestrator-worker.ts"], outfile: ".next/standalone/automation-worker.cjs" },
  { entryPoints: ["scripts/deploy-worker.ts"], outfile: ".next/standalone/deploy-worker.cjs" },
  { entryPoints: ["scripts/static-edge.ts"], outfile: ".next/standalone/static-edge.cjs", packages: "bundle" },
];

for (const { entryPoints, outfile, packages = "external" } of entries) {
  await build({
    entryPoints,
    outfile,
    bundle: true,
    platform: "node",
    target: "node22",
    format: "cjs",
    packages,
    sourcemap: false,
    legalComments: "none",
    logLevel: "info",
  });
}
