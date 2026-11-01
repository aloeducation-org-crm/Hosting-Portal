#!/usr/bin/env node
/**
 * Print a redacted production-configuration report for this host.
 *
 * The logic lives in `src/lib/config/production-config.ts` so the same checks are
 * unit-tested rather than re-implemented in shell. This CLI only reads: it parses
 * an env file (never sourcing it, so a hostile .env cannot execute anything),
 * merges it with the ambient environment and prints JSON.
 *
 * It never prints a value. Findings name a key and describe a property:
 * "must be https", "is a placeholder", "is inside the Git checkout". That is what
 * makes the report safe to paste into a ticket or a CI log — see
 * docs/PRODUCTION-CONFIG-VALIDATION.md.
 *
 * Usage:
 *   node scripts/validate-prod-config.mjs                       # ambient env
 *   node scripts/validate-prod-config.mjs --env-file /etc/alo-hosting/panel.env
 *   node scripts/validate-prod-config.mjs --app-dir ~/Hosting-Portal --check-paths
 *   node scripts/validate-prod-config.mjs --fail-on-warnings
 *
 * Exit codes: 0 = no errors, 1 = at least one error, 2 = bad usage / unreadable file.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { register } from "tsx/esm/api";

const here = path.dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const args = { envFile: null, appDir: null, checkPaths: false, failOnWarnings: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--env-file") {
      args.envFile = argv[i + 1] ?? null;
      i += 1;
    } else if (arg.startsWith("--env-file=")) {
      args.envFile = arg.slice("--env-file=".length);
    } else if (arg === "--app-dir") {
      args.appDir = argv[i + 1] ?? null;
      i += 1;
    } else if (arg.startsWith("--app-dir=")) {
      args.appDir = arg.slice("--app-dir=".length);
    } else if (arg === "--check-paths") {
      args.checkPaths = true;
    } else if (arg === "--fail-on-warnings") {
      args.failOnWarnings = true;
    } else if (arg === "--help" || arg === "-h") {
      process.stdout.write(
        "usage: validate-prod-config.mjs [--env-file <path>] [--app-dir <path>] [--check-paths] [--fail-on-warnings]\n",
      );
      process.exit(0);
    } else {
      process.stderr.write(`validate-prod-config: unknown argument '${arg}'\n`);
      process.exit(2);
    }
  }
  return args;
}

/**
 * Parse KEY=VALUE lines without executing anything. Deliberately mirrors how
 * scripts/deploy-release.sh reads DATABASE_URL: no `source`, no `eval`, no
 * command substitution, and quoted values are unwrapped only.
 */
function readEnvFile(file) {
  const out = {};
  const text = readFileSync(file, "utf8");
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    let value = line.slice(eq + 1).trim();
    if (value.length >= 2 && value[0] === value[value.length - 1] && (value[0] === '"' || value[0] === "'")) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  let fileEnv = {};
  if (args.envFile) {
    try {
      fileEnv = readEnvFile(args.envFile);
    } catch (error) {
      // The path is useful; the contents are never echoed.
      process.stderr.write (
        `validate-prod-config: could not read ${args.envFile} (${error instanceof Error ? error.message : String(error)})\n`,
      );
      process.exit(2);
    }
  }

  const source = { ...process.env, ...fileEnv };
  const options = {
    appDir: args.appDir ? path.resolve(args.appDir) : undefined,
    checkFilesystem: args.checkPaths,
  };

  const unregister = register();
  let report;
  try {
    const mod = await import(path.join(here, "..", "src", "lib", "config", "production-config.ts"));
    report = mod.validateProductionConfig(source, options);
  } finally {
    unregister();
  }

  process.stdout.write(`${JSON.stringify({ ...report, envFile: args.envFile ?? null }, null, 2)}\n`);

  if (!report.ok) process.exit(1);
  if (args.failOnWarnings && report.counts.warnings > 0) process.exit(1);
}

main().catch((error) => {
  process.stderr.write(
    `validate-prod-config: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exit(2);
});
