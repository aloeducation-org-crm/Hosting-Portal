#!/usr/bin/env node
/**
 * ALO Hosting Portal — start-command resolver (CLI).
 *
 * Reads a project directory and answers one question: *what argv can a process
 * supervisor safely run for this app?*
 *
 * It exists because `package.json` `scripts.start` is written for a human
 * shell, not for PM2. The value that took two production sites down was:
 *
 *   "start": "NODE_ENV=production bun .next/standalone/server.js 2>&1 | tee server.log"
 *
 * Under PM2 that crash-loops for reasons that look unrelated:
 *   - `bun` is not installed              -> `sh: 1: bun: not found`
 *   - the pipeline exits with tee's status -> PM2 supervises the wrong process
 *   - `.next/standalone/server.js` may live in a nested tracing root
 *     -> `MODULE_NOT_FOUND` even though `next build` exited 0
 *
 * Usage:
 *   node scripts/resolve-start-entry.mjs --dir <project> [options]
 *
 * Options:
 *   --dir <path>              project directory (required)
 *   --port <n>                port to bake into the ecosystem file
 *   --name <name>             PM2 app name (default: package.json name)
 *   --stage-assets            copy .next/static + public into the standalone bundle
 *   --write-ecosystem <path>  write a PM2 ecosystem file with the resolved entry
 *   --json                    machine-readable output
 *   --quiet                   suppress warnings
 *
 * Exit codes: 0 resolved, 2 nothing runnable found, 1 usage/IO error.
 */
import { readFile, readdir, stat, mkdir, cp, writeFile } from "node:fs/promises";
import path from "node:path";

const JS_RUNTIMES = new Set(["node", "nodejs", "bun", "tsx", "ts-node", "bunx"]);
const SHELL_OPERATORS = /(\|\||&&|[|&;<>`]|\$\(|\$\{)/g;
const ENV_ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;
const SCRIPT_ENTRY = /\.(?:js|mjs|cjs|ts)$/;
const DEFAULT_STANDALONE = ".next/standalone/server.js";

function parseArgs(argv) {
  const args = { stageAssets: false, json: false, quiet: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case "--dir": args.dir = argv[++i]; break;
      case "--port": args.port = Number(argv[++i]); break;
      case "--name": args.name = argv[++i]; break;
      case "--write-ecosystem": args.ecosystem = argv[++i]; break;
      case "--stage-assets": args.stageAssets = true; break;
      case "--json": args.json = true; break;
      case "--quiet": args.quiet = true; break;
      case "--help":
      case "-h":
        console.log("Usage: node scripts/resolve-start-entry.mjs --dir <project> [--port N] [--name NAME] [--stage-assets] [--write-ecosystem FILE] [--json]");
        process.exit(0);
        break;
      default:
        if (arg.startsWith("--")) {
          console.error(`Unknown option: ${arg}`);
          process.exit(1);
        }
    }
  }
  return args;
}

function tokenize(command) {
  const tokens = [];
  let current = "";
  let quote = null;
  for (const char of command) {
    if (quote) {
      if (char === quote) quote = null;
      else current += char;
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (/\s/.test(char)) {
      if (current) tokens.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  if (current) tokens.push(current);
  return tokens;
}

function executableName(token) {
  return (token.split("/").pop() ?? token).replace(/\.exe$/i, "").toLowerCase();
}

function isSafeEntry(entry) {
  if (!entry) return false;
  if (entry.startsWith("/") || /^[A-Za-z]:[\\/]/.test(entry)) return false;
  if (entry.split("/").includes("..")) return false;
  if (/[\s|&;<>`$'"\\]/.test(entry)) return false;
  return SCRIPT_ENTRY.test(entry);
}

function normalizeEntry(entry) {
  if (!entry) return null;
  const cleaned = entry.replace(/^\.\//, "");
  return isSafeEntry(cleaned) ? cleaned : null;
}

function analyseStartScript(script) {
  const raw = (script ?? "").trim();
  const warnings = [];
  if (!raw) return { raw, env: {}, argv: [], executable: null, entry: null, shellOperators: [], warnings };

  const shellOperators = [...new Set([...raw.matchAll(SHELL_OPERATORS)].map((m) => m[0]))];
  const tokens = tokenize(raw);
  const env = {};
  let index = 0;
  while (index < tokens.length && ENV_ASSIGNMENT.test(tokens[index])) {
    const [name, ...rest] = tokens[index].split("=");
    env[name] = rest.join("=");
    index += 1;
  }
  const argv = [];
  for (; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (/[|&;<>`]|\$\(/.test(token)) break;
    argv.push(token);
  }
  const executable = argv.length ? executableName(argv[0]) : null;
  const entry = argv.slice(1).map(normalizeEntry).find((candidate) => candidate) ?? null;
  return { raw, env, argv, executable, entry, shellOperators, warnings };
}

async function isFile(file) {
  const info = await stat(file).catch(() => null);
  return !!info?.isFile();
}

/** `next build` nests the bundle when it infers a workspace root. */
async function findStandalone(checkoutDir) {
  const direct = path.join(checkoutDir, ".next", "standalone");
  if (await isFile(path.join(direct, "server.js"))) return ".next/standalone";

  async function search(dir, rel, depth) {
    if (depth > 3) return null;
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => null);
    if (!entries) return null;
    if (entries.some((entry) => entry.isFile() && entry.name === "server.js")) return rel;
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name === "node_modules" || entry.name === ".next") continue;
      const found = await search(path.join(dir, entry.name), `${rel}/${entry.name}`, depth + 1);
      if (found) return found;
    }
    return null;
  }
  return search(direct, ".next/standalone", 0);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.dir) {
    console.error("--dir is required");
    process.exit(1);
  }
  const projectDir = path.resolve(args.dir);
  const projectStat = await stat(projectDir).catch(() => null);
  if (!projectStat?.isDirectory()) {
    console.error(`Not a directory: ${projectDir}`);
    process.exit(1);
  }

  const pkgRaw = await readFile(path.join(projectDir, "package.json"), "utf8").catch(() => null);
  if (!pkgRaw) {
    console.error(`No package.json in ${projectDir}`);
    process.exit(2);
  }
  let pkg;
  try {
    pkg = JSON.parse(pkgRaw);
  } catch (error) {
    console.error(`package.json is not valid JSON: ${error.message}`);
    process.exit(2);
  }

  const warnings = [];
  const scripts = pkg.scripts ?? {};
  let nextConfigFound = null;
  for (const config of ["next.config.ts", "next.config.js", "next.config.mjs"]) {
    if (await isFile(path.join(projectDir, config))) {
      nextConfigFound = config;
      break;
    }
  }
  const nextConfigText = nextConfigFound
    ? await readFile(path.join(projectDir, nextConfigFound), "utf8").catch(() => "")
    : "";
  const standaloneConfigured = /standalone/.test(nextConfigText);

  const analysis = analyseStartScript(scripts.start);
  if (analysis.shellOperators.length) {
    warnings.push(
      `scripts.start contains shell plumbing (${analysis.shellOperators.join(" ")}) and was not used verbatim; ` +
        "a supervisor runs argv and captures logs itself",
    );
  }
  const envKeys = Object.keys(analysis.env);
  if (envKeys.length) {
    warnings.push(`scripts.start sets ${envKeys.join(", ")} inline; the PM2 env block provides those instead`);
  }

  // Which bundle is actually on disk decides the mode, not what the manifest
  // claims: a build can be absent, stale, or nested.
  const bundle = await findStandalone(projectDir);
  const mode = bundle && (standaloneConfigured || analysis.entry?.includes(".next/standalone")) ? "standalone" : "server";

  let entry = null;
  if (mode === "standalone") {
    entry = `${bundle}/server.js`;
    if (entry !== DEFAULT_STANDALONE) {
      warnings.push(
        `standalone bundle is at ${entry}, not ${DEFAULT_STANDALONE}; deploying the resolved path ` +
          "(pin outputFileTracingRoot in next.config to make this deterministic)",
      );
    }
    if (analysis.executable === "bun" || analysis.executable === "bunx") {
      warnings.push("scripts.start launches the server with bun; running it with node instead (it is a Node script)");
    }
  } else if (analysis.executable && JS_RUNTIMES.has(analysis.executable) && analysis.entry) {
    entry = analysis.entry;
    if (!(await isFile(path.join(projectDir, entry)))) {
      warnings.push(`scripts.start points at ${entry}, which does not exist in the build output`);
      entry = null;
    }
  }

  if (!entry) {
    if (standaloneConfigured || bundle) {
      warnings.push("no runnable standalone server.js found; run the build before activating this release");
    } else {
      warnings.push("no runnable entry point found in scripts.start");
    }
    const result = { ok: false, mode, runtime: null, entry: null, startCmd: null, warnings };
    if (args.json) console.log(JSON.stringify(result, null, 2));
    else warnings.forEach((warning) => console.error(`warning: ${warning}`));
    process.exit(2);
  }

  const startCmd = `node ${entry}`;

  // `next build` never copies these, so a standalone bundle boots and then
  // 404s every hashed asset. Staging is part of activation, not a nicety.
  const staged = [];
  if (mode === "standalone" && args.stageAssets) {
    const bundleDir = path.join(projectDir, bundle);
    for (const asset of [".next/static", "public"]) {
      const from = path.join(projectDir, asset);
      const to = path.join(bundleDir, asset);
      if (await stat(to).catch(() => null)) continue;
      if (!(await stat(from).catch(() => null))) {
        warnings.push(`${asset} is missing from the project; the site will serve without it`);
        continue;
      }
      await mkdir(path.dirname(to), { recursive: true });
      await cp(from, to, { recursive: true });
      staged.push(asset);
    }
  }

  const name = args.name || pkg.name || path.basename(projectDir);
  if (args.ecosystem) {
    const ecosystemPath = path.resolve(args.ecosystem);
    const port = Number.isFinite(args.port) && args.port > 0 ? args.port : 3000;
    const contents = `// Generated by scripts/resolve-start-entry.mjs — do not edit by hand.
// argv-only start: PM2 owns the process, so logs and restarts behave.
module.exports = {
  apps: [{
    name: ${JSON.stringify(name)},
    script: ${JSON.stringify(entry)},
    cwd: ${JSON.stringify(projectDir)},
    interpreter: "node",
    exec_mode: "fork",
    instances: 1,
    autorestart: true,
    max_restarts: 10,
    restart_delay: 5000,
    max_memory_restart: "768M",
    env: {
      NODE_ENV: "production",
      PORT: ${JSON.stringify(String(port))},
      HOSTNAME: "127.0.0.1",
    },
    time: true,
  }],
};
`;
    await writeFile(ecosystemPath, contents, "utf8");
  }

  const result = {
    ok: true,
    mode,
    runtime: "node",
    entry,
    startCmd,
    name,
    port: Number.isFinite(args.port) ? args.port : null,
    stagedAssets: staged,
    warnings,
  };

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    if (!args.quiet) warnings.forEach((warning) => console.error(`warning: ${warning}`));
    console.log(`mode=${mode}`);
    console.log(`runtime=node`);
    console.log(`entry=${entry}`);
    console.log(`start=${startCmd}`);
    if (staged.length) console.log(`staged=${staged.join(",")}`);
  }
}

main().catch((error) => {
  console.error(error?.stack || String(error));
  process.exit(1);
});
