/**
 * Start-command resolution.
 *
 * A repository's `scripts.start` is attacker-controlled input *and* it is
 * usually written for a human shell, not for a process supervisor. The value
 * that broke two production sites was:
 *
 *   "start": "NODE_ENV=production bun .next/standalone/server.js 2>&1 | tee server.log"
 *
 * Handing that string to `pm2 start npm -- start` (or `sh -c`) fails for three
 * independent reasons, all of which show up as a silent crash-loop:
 *
 *   1. `bun` may not be installed on the host  -> `sh: 1: bun: not found`.
 *   2. The pipeline's exit status is `tee`'s, so the supervisor is watching the
 *      wrong process and can never observe the server dying.
 *   3. `.next/standalone/server.js` only exists if `next build` emitted it at
 *      the tracing root; otherwise the bundle lands in a nested directory and
 *      node dies with MODULE_NOT_FOUND.
 *
 * This module converts such a script into a plain argv command plus warnings.
 * It never emits shell metacharacters, so everything it returns is safe for
 * `parseCommand()` and for an execFile/spawn-style launcher.
 */

export const NEXT_STANDALONE_SERVER = ".next/standalone/server.js";

/** Runtimes that can execute a JavaScript server entry directly. */
const JS_RUNTIMES = new Set(["node", "nodejs", "bun", "tsx", "ts-node", "bunx"]);

/** Anything that makes a command a *shell program* rather than an argv list. */
const SHELL_OPERATORS = /(\|\||&&|[|&;<>`]|\$\(|\$\{)/g;

/** `NAME=value` in front of the command. */
const ENV_ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;

/** A JavaScript entry point we are willing to execute. */
const SCRIPT_ENTRY = /\.(?:js|mjs|cjs|ts)$/;

export interface StartScriptAnalysis {
  raw: string;
  /** Inline `NAME=value` prefixes found before the command. */
  env: Record<string, string>;
  /** Command tokens with env prefixes and shell plumbing removed. */
  argv: string[];
  /** Basename of the executable, lowercased (no `.exe`). */
  executable: string | null;
  /** First token that looks like a JavaScript entry point. */
  entry: string | null;
  /** Shell operators that were stripped (deduplicated). */
  shellOperators: string[];
  notes: string[];
}

function tokenize(command: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;
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

function executableName(token: string): string {
  const base = token.split("/").pop() ?? token;
  return base.replace(/\.exe$/i, "").toLowerCase();
}

/** A relative, non-traversing path that we are willing to execute. */
export function isSafeEntryPath(entry: string | null | undefined): entry is string {
  if (!entry) return false;
  if (entry.startsWith("/") || /^[A-Za-z]:[\\/]/.test(entry)) return false;
  if (entry.split("/").includes("..")) return false;
  if (/[\s|&;<>`$'"\\]/.test(entry)) return false;
  return SCRIPT_ENTRY.test(entry);
}

function normalizeEntry(entry: string | null | undefined): string | null {
  if (!entry) return null;
  const cleaned = entry.replace(/^\.\//, "");
  return isSafeEntryPath(cleaned) ? cleaned : null;
}

/**
 * Split a start script into runtime, entry point and shell noise.
 * Pure, synchronous and total: it never throws on malformed input.
 */
export function analyseStartScript(script: string | null | undefined): StartScriptAnalysis {
  const raw = (script ?? "").trim();
  const notes: string[] = [];
  if (!raw) {
    return { raw, env: {}, argv: [], executable: null, entry: null, shellOperators: [], notes };
  }

  const shellOperators = [...new Set([...raw.matchAll(SHELL_OPERATORS)].map((m) => m[0]))];

  const env: Record<string, string> = {};
  const tokens = tokenize(raw);
  let index = 0;
  while (index < tokens.length && ENV_ASSIGNMENT.test(tokens[index]!)) {
    const [name, ...rest] = tokens[index]!.split("=");
    env[name!] = rest.join("=");
    index += 1;
  }

  // Cut the command at the first token that belongs to the shell, so the
  // pipeline/redirect tail (`2>&1 | tee server.log`) cannot leak through.
  const argv: string[] = [];
  for (; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    if (/[|&;<>`]|\$\(/.test(token)) {
      notes.push(`stopped at shell token "${token}"`);
      break;
    }
    argv.push(token);
  }

  const executable = argv.length ? executableName(argv[0]!) : null;
  const entry = argv.slice(1).map(normalizeEntry).find((candidate) => candidate !== null) ?? null;

  return { raw, env, argv, executable, entry, shellOperators, notes };
}

export interface ResolvedStartCommand {
  /** argv-only command, always parseable by `parseCommand()`. */
  startCmd: string;
  /** Runtime the resolved command needs. Always `node` here. */
  runtime: "node";
  entry: string;
  warnings: string[];
}

export interface ResolveStartOptions {
  startScript?: string | null;
  /** True when `next.config.*` sets `output: "standalone"`. */
  standalone: boolean;
  /**
   * Standalone entry discovered on disk after `next build`, relative to the
   * checkout root. This is what makes a nested tracing root survivable.
   */
  standaloneEntry?: string | null;
}

/**
 * Turn `scripts.start` into an argv command the deploy pipeline can run.
 *
 * The returned command always starts with `node`: the Next.js standalone
 * server is a Node script, so a `bun`-flavoured start script is a needless
 * dependency on a runtime the host may not have installed.
 */
export function resolveNodeStartCommand(options: ResolveStartOptions): ResolvedStartCommand {
  const warnings: string[] = [];
  const analysis = analyseStartScript(options.startScript);
  const fallbackEntry = normalizeEntry(options.standaloneEntry) ?? NEXT_STANDALONE_SERVER;

  if (analysis.shellOperators.length) {
    warnings.push(
      `scripts.start contains shell plumbing (${analysis.shellOperators.join(" ")}) and was not used verbatim: ` +
        `a service manager runs argv and captures logs itself, and a pipeline makes it supervise tee instead of the server`,
    );
  }
  const envKeys = Object.keys(analysis.env);
  if (envKeys.length) {
    warnings.push(
      `scripts.start sets ${envKeys.join(", ")} inline; the service environment provides those instead`,
    );
  }

  if (!options.standalone) {
    // Not a standalone build: `next start` is the supported entry point, and
    // an explicit Node script in the manifest is even better.
    const entry = normalizeEntry(analysis.entry);
    if (entry && analysis.executable && JS_RUNTIMES.has(analysis.executable)) {
      return { startCmd: `node ${entry}`, runtime: "node", entry, warnings };
    }
    warnings.push("standalone output not configured; falling back to `npx next start`");
    return { startCmd: "npx next start", runtime: "node", entry: "next", warnings };
  }

  if (analysis.executable && JS_RUNTIMES.has(analysis.executable)) {
    // What is on disk beats what the manifest claims: `next build` nests the
    // bundle when it infers a workspace root, and the manifest still says
    // `.next/standalone/server.js`. Trusting the manifest here is the exact
    // MODULE_NOT_FOUND that crash-looped the incident.
    const declared = normalizeEntry(analysis.entry);
    const discovered = normalizeEntry(options.standaloneEntry);
    const entry = discovered ?? declared ?? fallbackEntry;
    if (discovered && declared && declared !== discovered) {
      warnings.push(
        `scripts.start points at ${declared} but the built bundle is at ${discovered}; using the bundle that exists`,
      );
    }
    if (analysis.executable === "bun" || analysis.executable === "bunx") {
      warnings.push(
        "scripts.start launches the server with bun; resolved to `node` so supervision does not depend on a bun install",
      );
    }
    return { startCmd: `node ${entry}`, runtime: "node", entry, warnings };
  }

  if (analysis.executable) {
    warnings.push(
      `scripts.start runs "${analysis.executable}", which is not a JavaScript runtime; using node ${fallbackEntry}`,
    );
  }
  return { startCmd: `node ${fallbackEntry}`, runtime: "node", entry: fallbackEntry, warnings };
}

/**
 * Why a standalone bundle needs these two directories bundled *inside* it.
 * `next build` does not copy them, and without them the server boots fine but
 * every hashed asset (`/_next/static/**`) and public file 404s.
 */
export const NEXT_STANDALONE_ASSETS = [".next/static", "public"] as const;
