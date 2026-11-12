#!/usr/bin/env node
/** Bundle the durable worker next to the Next.js standalone server. */
import { build } from "esbuild";
import { mkdirSync } from "node:fs";

mkdirSync(".next/standalone", { recursive: true });
await build({
  entryPoints: ["scripts/orchestrator-worker.ts"],
  outfile: ".next/standalone/automation-worker.cjs",
  bundle: true,
  platform: "node",
  target: "node22",
  format: "cjs",
  packages: "external",
  sourcemap: false,
  legalComments: "none",
  logLevel: "info",
});
