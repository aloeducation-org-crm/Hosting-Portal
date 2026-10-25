import path from "node:path";
import { readFile, stat, readdir } from "node:fs/promises";
import type { DetectionResult } from "./types";

/**
 * Framework/build detection from repository manifests.
 *
 * It reads files only. It never executes anything, never reads .env values, and
 * always returns a proposal — an ambiguous proposal is flagged so the API can
 * require operator confirmation instead of running guessed commands.
 */

export interface FsReader {
  read(rel: string): Promise<string | null>;
  exists(rel: string): Promise<boolean>;
  files(max?: number): Promise<string[]>;
}

export function fsReader(root: string): FsReader {
  const safe = (rel: string) => {
    const resolved = path.resolve(root, rel);
    if (resolved !== root && !resolved.startsWith(root + path.sep)) {
      throw new Error("Path escapes checkout root");
    }
    return resolved;
  };
  return {
    async read(rel) {
      try {
        return await readFile(safe(rel), "utf8");
      } catch {
        return null;
      }
    },
    async exists(rel) {
      try {
        await stat(safe(rel));
        return true;
      } catch {
        return false;
      }
    },
    async files(max = 400) {
      const out: string[] = [];
      async function walk(dir: string, depth: number) {
        if (out.length >= max || depth > 6) return;
        let entries;
        try {
          entries = await readdir(dir, { withFileTypes: true });
        } catch {
          return;
        }
        for (const entry of entries) {
          if (out.length >= max) return;
          if (entry.name === ".git" || entry.name === "node_modules" || entry.name === "vendor" || entry.name === "dist" || entry.name === "build") continue;
          const rel = path.relative(root, path.join(dir, entry.name));
          if (entry.isDirectory()) await walk(path.join(dir, entry.name), depth + 1);
          else out.push(rel);
        }
      }
      await walk(root, 0);
      return out;
    },
  };
}

export function memoryReader(files: Record<string, string>): FsReader {
  return {
    async read(rel) {
      return Object.prototype.hasOwnProperty.call(files, rel) ? (files[rel] ?? null) : null;
    },
    async exists(rel) {
      return Object.prototype.hasOwnProperty.call(files, rel);
    },
    async files() {
      return Object.keys(files);
    },
  };
}

function json(text: string | null): Record<string, any> | null {
  if (!text) return null;
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

const LOCKFILES: Array<[string, string, string]> = [
  ["bun.lockb", "bun", "bun install --frozen-lockfile"],
  ["bun.lock", "bun", "bun install --frozen-lockfile"],
  ["pnpm-lock.yaml", "pnpm", "pnpm install --frozen-lockfile"],
  ["yarn.lock", "yarn", "yarn install --frozen-lockfile"],
  ["package-lock.json", "npm", "npm ci"],
];

function envNamesFrom(text: string | null, acc: Set<string>) {
  if (!text) return;
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?([A-Z_][A-Z0-9_]*)\s*=/);
    if (m) acc.add(m[1]!);
  }
  for (const m of text.matchAll(/\bprocess\.env\.([A-Z_][A-Z0-9_]*)/g)) acc.add(m[1]!);
  for (const m of text.matchAll(/\bimport\.meta\.env\.([A-Z_][A-Z0-9_]*)/g)) acc.add(m[1]!);
  for (const m of text.matchAll(/os\.environ(?:\.get)?\(?\s*["']([A-Z_][A-Z0-9_]*)["']/g)) acc.add(m[1]!);
  for (const m of text.matchAll(/\benv\(\s*["']([A-Z_][A-Z0-9_]*)["']/g)) acc.add(m[1]!);
  for (const m of text.matchAll(/\$_ENV\[\s*["']([A-Z_][A-Z0-9_]*)["']/g)) acc.add(m[1]!);
}

export async function detectFramework(fs: FsReader): Promise<DetectionResult> {
  const reasons: string[] = [];
  const warnings: string[] = [];
  const envNames = new Set<string>();
  const result: DetectionResult = {
    language: "unknown",
    framework: "static",
    runtime: "static",
    packageManager: null,
    lockfile: null,
    runtimeVersion: null,
    installCmd: null,
    lintCmd: null,
    typecheckCmd: null,
    testCmd: null,
    buildCmd: null,
    startCmd: null,
    outputDir: ".",
    envNames: [],
    port: 8080,
    healthPath: "/",
    confidence: "low",
    ambiguous: true,
    reasons,
    warnings,
  };

  const pkg = json(await fs.read("package.json"));
  const composer = json(await fs.read("composer.json"));
  const pyproject = await fs.read("pyproject.toml");
  const requirements = await fs.read("requirements.txt");
  const hasDockerfile = await fs.exists("Dockerfile");
  const hasCompose = (await fs.exists("docker-compose.yml")) || (await fs.exists("compose.yaml")) || (await fs.exists("docker-compose.yaml"));
  const hasIndexHtml = await fs.exists("index.html");
  const hasArtisan = await fs.exists("artisan");
  const hasManagePy = await fs.exists("manage.py");
  const hasNestCli = await fs.exists("nest-cli.json");
  const hasVite = (await fs.exists("vite.config.ts")) || (await fs.exists("vite.config.js")) || (await fs.exists("vite.config.mjs"));
  const hasNextConfig = !!(await fs.read("next.config.js")) || !!(await fs.read("next.config.mjs")) || !!(await fs.read("next.config.ts"));

  // Runtime version hints.
  for (const file of [".nvmrc", ".node-version", ".python-version", "runtime.txt"]) {
    const text = await fs.read(file);
    if (text?.trim()) {
      result.runtimeVersion = text.trim().split(/\s/)[0] ?? null;
      reasons.push(`runtime version from ${file}: ${result.runtimeVersion}`);
      break;
    }
  }
  if (!result.runtimeVersion && pkg?.engines?.node) {
    result.runtimeVersion = String(pkg.engines.node);
    reasons.push(`runtime version from package.json engines.node: ${result.runtimeVersion}`);
  }

  // Health path from conventional route files (never guessed from a URL).
  if ((await fs.exists("src/app/api/health/route.ts")) || (await fs.exists("app/api/health/route.ts"))) {
    result.healthPath = "/api/health";
    reasons.push("health path /api/health (Next route handler present)");
  } else if (await fs.exists("public/health.json")) {
    result.healthPath = "/health.json";
  }

  // Environment variable NAMES only.
  for (const name of [".env.example", ".env.sample", ".env.template"]) envNamesFrom(await fs.read(name), envNames);
  const scanFiles = (await fs.files(400)).filter((f) => /\.(ts|tsx|js|jsx|mjs|cjs|py|php|json|toml|ya?ml)$/.test(f));
  for (const file of scanFiles.slice(0, 200)) {
    const text = await fs.read(file);
    if (text && text.length < 200_000) envNamesFrom(text, envNames);
  }
  // Never return an env var that could be a secret VALUE by accident.
  result.envNames = [...envNames].filter((n) => n.length <= 64).sort();

  // ── Node / JS / TS ─────────────────────────────────────────────────────────
  if (pkg) {
    result.language = "javascript";
    result.runtime = "node";
    result.port = 3000;
    const scripts: Record<string, string> = pkg.scripts ?? {};
    const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
    for (const [file, manager, install] of LOCKFILES) {
      if (await fs.exists(file)) {
        result.packageManager = manager;
        result.lockfile = file;
        result.installCmd = install;
        reasons.push(`${file} -> ${manager} (${install})`);
        break;
      }
    }
    if (!result.installCmd) {
      result.installCmd = "npm install";
      warnings.push("No lockfile found; install command is not reproducible");
      result.ambiguous = true;
    }
    const script = (name: string, cmd: string) => {
      if (typeof scripts[name] === "string") {
        reasons.push(`package.json script "${name}" used`);
        return `${result.packageManager === "bun" ? "bun" : result.packageManager === "pnpm" ? "pnpm" : result.packageManager === "yarn" ? "yarn" : "npm"} run ${name}`;
      }
      return cmd;
    };
    if (scripts.lint) result.lintCmd = script("lint", "");
    if (scripts.typecheck) result.typecheckCmd = script("typecheck", "");
    if (scripts.test) result.testCmd = script("test", "");

    if (deps.next || hasNextConfig) {
      result.framework = "nextjs";
      result.buildCmd = script("build", "npm run build");
      result.startCmd = scripts.start ? script("start", "") : "node .next/standalone/server.js";
      const nextConfig = (await fs.read("next.config.ts")) || (await fs.read("next.config.js")) || (await fs.read("next.config.mjs")) || "";
      if (/standalone/.test(nextConfig)) result.outputDir = ".next/standalone";
      else result.outputDir = ".next";
      result.confidence = scripts.build ? "high" : "medium";
      result.ambiguous = true; // a server process, not a static bundle -> operator must confirm service manager
      warnings.push("Next.js needs a long-running service; confirm serviceManager (pm2/systemd) and static asset copy before deploying");
      reasons.push("next dependency / next.config detected");
    } else if (deps.vite || hasVite) {
      result.framework = "vite";
      result.buildCmd = script("build", "npm run build");
      result.outputDir = "dist";
      result.startCmd = null;
      result.confidence = scripts.build ? "high" : "medium";
      result.ambiguous = !scripts.build;
      reasons.push("vite dependency / vite.config detected");
    } else if (deps["react-scripts"]) {
      result.framework = "create-react-app";
      result.buildCmd = script("build", "npm run build");
      result.outputDir = "build";
      result.ambiguous = !scripts.build;
      result.confidence = scripts.build ? "high" : "medium";
    } else if (deps["@nestjs/core"] || hasNestCli) {
      result.framework = "nestjs";
      result.buildCmd = script("build", "npm run build");
      result.startCmd = scripts.start ? script("start", "") : "node dist/main.js";
      result.outputDir = "dist";
      result.ambiguous = true;
      warnings.push("NestJS needs a long-running service; confirm serviceManager and start command");
    } else if (deps.express || deps.fastify || deps.koa) {
      result.framework = deps.express ? "express" : deps.fastify ? "fastify" : "koa";
      result.buildCmd = scripts.build ? script("build", "") : null;
      result.startCmd = scripts.start ? script("start", "") : null;
      result.outputDir = ".";
      result.ambiguous = !scripts.start;
      if (!scripts.start) warnings.push("No start script; an operator must supply a start command");
      result.confidence = scripts.start ? "high" : "low";
    } else if (hasIndexHtml) {
      result.framework = "static-html";
      result.buildCmd = scripts.build ? script("build", "") : null;
      result.outputDir = scripts.build ? "dist" : ".";
      result.ambiguous = false;
      result.confidence = "high";
    } else {
      result.framework = "node";
      result.buildCmd = scripts.build ? script("build", "") : null;
      result.startCmd = scripts.start ? script("start", "") : null;
      result.ambiguous = true;
      warnings.push("Generic Node project; confirm build and start commands");
    }
  } else if (composer || hasArtisan) {
    // ── PHP / Laravel ───────────────────────────────────────────────────────
    result.language = "php";
    result.runtime = "php";
    result.framework = hasArtisan ? "laravel" : "php-composer";
    result.packageManager = "composer";
    result.lockfile = (await fs.exists("composer.lock")) ? "composer.lock" : null;
    result.installCmd = "composer install --no-dev --optimize-autoloader";
    result.buildCmd = null;
    result.startCmd = null;
    result.outputDir = ".";
    result.port = 8000;
    result.ambiguous = true;
    result.confidence = "medium";
    warnings.push("PHP/Laravel requires a verified PHP-FPM/Caddy vhost; no migrations or artisan commands are run automatically");
  } else if (requirements || pyproject || hasManagePy) {
    // ── Python ──────────────────────────────────────────────────────────────
    result.language = "python";
    result.runtime = "python3";
    result.packageManager = "pip3";
    result.lockfile = (await fs.exists("poetry.lock")) ? "poetry.lock" : (await fs.exists("Pipfile.lock")) ? "Pipfile.lock" : requirements ? "requirements.txt" : "pyproject.toml";
    result.installCmd = requirements ? "python3 -m pip install -r requirements.txt" : "python3 -m pip install .";
    const all = `${requirements ?? ""}\n${pyproject ?? ""}`;
    if (/django/i.test(all) || hasManagePy) result.framework = "django";
    else if (/fastapi/i.test(all)) result.framework = "fastapi";
    else if (/flask/i.test(all)) result.framework = "flask";
    else result.framework = "python";
    result.outputDir = ".";
    result.port = 8000;
    result.ambiguous = true;
    result.confidence = "medium";
    warnings.push("Python needs an operator-confirmed ASGI/WSGI module and service manager; no framework command is guessed");
  } else if (hasDockerfile || hasCompose) {
    result.language = "docker";
    result.runtime = "docker";
    result.framework = hasCompose ? "docker-compose" : "docker";
    result.installCmd = null;
    result.buildCmd = null;
    result.startCmd = null;
    result.outputDir = ".";
    result.port = 8080;
    result.ambiguous = true;
    result.confidence = "medium";
    warnings.push("Docker builds are not run from the web panel without an approval gate");
  } else if (hasIndexHtml) {
    result.framework = "static-html";
    result.language = "html";
    result.runtime = "static";
    result.outputDir = ".";
    result.ambiguous = false;
    result.confidence = "high";
    reasons.push("index.html with no manifest -> static site");
  } else {
    warnings.push("No recognized manifest; nothing will be built until an operator supplies a config");
    result.framework = "unknown";
  }

  result.ambiguous = result.ambiguous || result.confidence === "low";
  return result;
}
