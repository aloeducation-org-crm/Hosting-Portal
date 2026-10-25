import { z } from "zod";
import path from "node:path";
import type { DeployConfig, DetectionResult, ServiceManager } from "./types";

/**
 * Commands are NEVER shell strings. They are parsed into argv and the executable
 * is checked against a small allowlist. This is the boundary that stops a
 * webhook payload (or a tampered project config) from running arbitrary code on
 * the deploy host.
 */
export const ALLOWED_EXECUTABLES = new Set([
  "npm",
  "npx",
  "pnpm",
  "yarn",
  "bun",
  "node",
  "python3",
  "python",
  "pip3",
  "composer",
  "php",
  "docker",
  "git",
  "pm2",
  "systemctl",
]);

const FORBIDDEN_META = /[;&|`$<>(){}\[\]!*?~#\\\n\r]/;
const FORBIDDEN_EVAL_FLAGS = new Set(["-e", "--eval", "-c", "--command", "-p", "--print"]);
const SAFE_SCRIPT_NAME = /^[A-Za-z0-9][A-Za-z0-9:_.-]{0,63}$/;

export class UnsafeCommandError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafeCommandError";
  }
}

/** Minimal tokenizer: whitespace + single/double quotes, no shell expansion. */
export function tokenize(command: string): string[] {
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
  if (quote) throw new UnsafeCommandError("Unterminated quote in command");
  if (current) tokens.push(current);
  return tokens;
}

/** Validate and parse an allowlisted command string into argv. */
export function parseCommand(command: string | null | undefined): string[] | null {
  if (command === null || command === undefined || command.trim() === "") return null;
  if (command.length > 512) throw new UnsafeCommandError("Command is too long");
  const tokens = tokenize(command.trim());
  const [exe, ...args] = tokens;
  if (!exe || !ALLOWED_EXECUTABLES.has(exe)) {
    throw new UnsafeCommandError(`Executable not allowed: ${exe || "(empty)"}`);
  }
  for (const arg of [exe, ...args]) {
    if (FORBIDDEN_META.test(arg)) throw new UnsafeCommandError("Shell metacharacter in command");
    if (FORBIDDEN_EVAL_FLAGS.has(arg.toLowerCase())) throw new UnsafeCommandError("Inline evaluation flags are not allowed");
    if (arg.startsWith("/") || /^[A-Za-z]:\\/.test(arg) || arg.includes("..")) {
      throw new UnsafeCommandError("Absolute or traversing paths are not allowed in commands");
    }
  }
  // `npm run <script>` / `bun run <script>`: script names are constrained so a
  // manifest cannot smuggle a second command through the argument list.
  if ((exe === "npm" || exe === "bun" || exe === "yarn" || exe === "pnpm") && args[0] === "run" && args[1]) {
    if (!SAFE_SCRIPT_NAME.test(args[1])) throw new UnsafeCommandError("Unsafe package script name");
  }
  return tokens;
}

export const deployConfigSchema = z.object({
  version: z.literal(1).default(1),
  installCmd: z.string().max(512).nullable().default(null),
  lintCmd: z.string().max(512).nullable().default(null),
  typecheckCmd: z.string().max(512).nullable().default(null),
  testCmd: z.string().max(512).nullable().default(null),
  buildCmd: z.string().max(512).nullable().default(null),
  startCmd: z.string().max(512).nullable().default(null),
  outputDir: z.string().min(1).max(256).default("."),
  envNames: z.array(z.string().regex(/^[A-Z_][A-Z0-9_]*$/)).max(100).default([]),
  port: z.number().int().min(1).max(65535).default(3100),
  healthPath: z.string().regex(/^\/[A-Za-z0-9/._-]*$/).max(200).default("/"),
  serviceManager: z.enum(["static", "pm2", "systemd", "none"]).default("static"),
  serviceName: z.string().max(128).optional(),
  buildEnvFile: z.string().max(512).optional(),
  requiresApproval: z.boolean().default(false),
  source: z.enum(["detected", "operator"]).default("operator"),
  confirmedBy: z.string().max(128).optional(),
});

export type DeployConfigInput = z.infer<typeof deployConfigSchema>;

export function validateDeployConfig(raw: unknown): DeployConfig {
  const parsed = deployConfigSchema.parse(raw ?? {});
  const commands: Array<keyof DeployConfig> = [
    "installCmd",
    "lintCmd",
    "typecheckCmd",
    "testCmd",
    "buildCmd",
    "startCmd",
  ];
  for (const key of commands) {
    parseCommand(parsed[key] as string | null);
  }
  if (parsed.outputDir.startsWith("/") || parsed.outputDir.split("/").includes("..")) {
    throw new UnsafeCommandError("outputDir must be a relative path without '..'");
  }
  if (parsed.buildEnvFile) {
    const envBase = process.env.DEPLOY_ENV_FILE_BASE;
    const resolved = path.resolve(parsed.buildEnvFile);
    if (!parsed.buildEnvFile.startsWith("/") || !envBase || !resolved.startsWith(path.resolve(envBase) + path.sep)) {
      throw new UnsafeCommandError("buildEnvFile must be an absolute path inside DEPLOY_ENV_FILE_BASE");
    }
  }
  if (parsed.serviceManager !== "static" && parsed.serviceManager !== "none" && !parsed.serviceName) {
    throw new UnsafeCommandError("serviceName is required for pm2/systemd service managers");
  }
  if (parsed.serviceName && !SAFE_SCRIPT_NAME.test(parsed.serviceName)) {
    throw new UnsafeCommandError("Unsafe serviceName");
  }
  return parsed as DeployConfig;
}

/** Turn a detection result into an editable, validated starting configuration. */
export function configFromDetection(d: DetectionResult): DeployConfig {
  return validateDeployConfig({
    version: 1,
    installCmd: d.installCmd,
    lintCmd: d.lintCmd,
    typecheckCmd: d.typecheckCmd,
    testCmd: d.testCmd,
    buildCmd: d.buildCmd,
    startCmd: d.startCmd,
    outputDir: d.outputDir,
    envNames: d.envNames,
    port: d.port,
    healthPath: d.healthPath,
    serviceManager: "static" as ServiceManager,
    requiresApproval: d.ambiguous,
    source: "detected",
  });
}

/** Only explicitly named build variables may enter the isolated build env. */
export function filterBuildEnv(source: Record<string, string | undefined>, names: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of names) {
    const value = source[name];
    if (typeof value === "string") out[name] = value;
  }
  return out;
}

const COMMAND_KEYS = ["installCmd", "lintCmd", "typecheckCmd", "testCmd", "buildCmd", "startCmd"] as const;

/**
 * Re-resolve the config against the manifests in THIS commit. Fields the
 * operator has not changed follow the repository's own scripts; fields they did
 * change are kept. This is what makes a newly added build script take effect on
 * the next push without letting a webhook inject a command.
 */
export function resolveConfig(
  storedConfig: unknown,
  importDetection: DetectionResult | null,
  currentDetection: DetectionResult,
): DeployConfig {
  const stored = validateDeployConfig(storedConfig);
  const proposedNow = configFromDetection(currentDetection);
  if (!importDetection) return stored;
  const proposedAtImport = configFromDetection(importDetection);
  const resolved: Record<string, unknown> = { ...stored };
  for (const key of COMMAND_KEYS) {
    if (stored[key] === proposedAtImport[key]) resolved[key] = proposedNow[key];
  }
  if (stored.outputDir === proposedAtImport.outputDir) resolved.outputDir = proposedNow.outputDir;
  return validateDeployConfig(resolved);
}
