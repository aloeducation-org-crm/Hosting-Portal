import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { detectFramework, fsReader } from "./detect";
import { validateDeployConfig, parseCommand, filterBuildEnv, resolveConfig } from "./config";
import {
  releasePath,
  writeMarker,
  activateRelease,
  restoreRelease,
  currentReleaseDir,
  startStaticServer,
  restartExternalService,
  verifyDeployment,
  projectRoot,
} from "./service";
import { redact, redactCommand, collectSecrets } from "./redact";
import { cloneUrlFor, resolveToken } from "./github";
import type { DeployStage, DeployConfig, ReleaseMarker } from "./types";

const execFileAsync = promisify(execFile);
const COMMAND_TIMEOUT_MS = Number(process.env.DEPLOY_COMMAND_TIMEOUT_MS || 10 * 60_000);
const MAX_LOG_BYTES = 2 * 1024 * 1024;

interface RunResult {
  code: number;
  output: string;
}

function buildEnvironment(config: DeployConfig, buildEnvFileContent: string | null): Record<string, string> {
  // Deliberately minimal: no NEXTAUTH_SECRET, no DATABASE_URL, no production
  // credentials. Only PATH/HOME/CI plus explicitly named build variables.
  const env: Record<string, string> = {
    PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin",
    HOME: process.env.HOME ?? os.tmpdir(),
    CI: "true",
    GIT_TERMINAL_PROMPT: "0",
  };
  if (buildEnvFileContent) {
    const parsed: Record<string, string> = {};
    for (const line of buildEnvFileContent.split(/\r?\n/)) {
      const match = line.match(/^\s*(?:export\s+)?([A-Z_][A-Z0-9_]*)=(.*)$/);
      if (match) parsed[match[1]!] = (match[2] ?? "").replace(/^["']|["']$/g, "");
    }
    Object.assign(env, filterBuildEnv(parsed, config.envNames));
  }
  return env;
}

/** argv-only execution. No shell, no arbitrary interpreter eval, hard timeout. */
export function runCommand(
  argv: string[],
  options: { cwd: string; env: Record<string, string>; timeoutMs?: number; onChunk?: (text: string) => void; secrets?: string[] },
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    if (!argv.length) return reject(new Error("empty command"));
    let output = "";
    let settled = false;
    const child = spawn(argv[0]!, argv.slice(1), {
      cwd: options.cwd,
      env: options.env as NodeJS.ProcessEnv,
      shell: false,
    });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(new Error(`command timed out after ${options.timeoutMs ?? COMMAND_TIMEOUT_MS}ms`));
    }, options.timeoutMs ?? COMMAND_TIMEOUT_MS);

    const consume = (chunk: Buffer) => {
      const text = redact(chunk.toString("utf8"), options.secrets ?? []);
      if (output.length < MAX_LOG_BYTES) output += text.slice(0, MAX_LOG_BYTES - output.length);
      options.onChunk?.(text);
    };
    child.stdout?.on("data", consume);
    child.stderr?.on("data", consume);

    function finish(error?: Error) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve({ code: child.exitCode ?? -1, output });
    }
    child.on("error", (error) => finish(error));
    child.on("close", () => finish());
  });
}

async function gitCheckout(cloneUrl: string, sha: string, workdir: string, secrets: string[]): Promise<string> {
  if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error("Invalid commit SHA");
  const env: Record<string, string> = {
    PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin",
    HOME: process.env.HOME ?? os.tmpdir(),
    GIT_TERMINAL_PROMPT: "0",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
  };
  await execFileAsync("git", ["clone", "--quiet", "--no-checkout", "--", cloneUrl, workdir], {
    timeout: 5 * 60_000,
    env: env as NodeJS.ProcessEnv,
  });
  await execFileAsync("git", ["-C", workdir, "checkout", "--quiet", "--detach", sha], {
    timeout: 60_000,
    env: env as NodeJS.ProcessEnv,
  });
  const { stdout } = await execFileAsync("git", ["-C", workdir, "rev-parse", "HEAD"], { env: env as NodeJS.ProcessEnv });
  const checkedOut = stdout.trim();
  if (checkedOut !== sha) {
    throw new Error(`checkout mismatch: expected ${sha}, got ${checkedOut}`);
  }
  // Never log the clone URL (it can embed a token).
  return redactCommand(["git", "clone", "<repository>", workdir], secrets);
}

async function packageRelease(
  checkoutDir: string,
  outputDir: string,
  releaseDir: string,
  marker: ReleaseMarker,
): Promise<number> {
  const source = path.resolve(checkoutDir, outputDir);
  if (source !== checkoutDir && !source.startsWith(checkoutDir + path.sep)) {
    throw new Error("outputDir escapes checkout");
  }
  await fs.mkdir(releaseDir, { recursive: true });
  await fs.cp(source, releaseDir, {
    recursive: true,
    errorOnExist: false,
    filter: (src) => {
      const name = path.basename(src);
      if (name === ".git" || name === "node_modules" || name === ".next" || name === "vendor") return false;
      // .env files can contain real values; they must not be published as static assets.
      if (/^\.env(\.[A-Za-z0-9_-]+)?$/.test(name) && name !== ".env.example") return false;
      return true;
    },
  });
  await writeMarker(releaseDir, marker);
  const entries = await fs.readdir(releaseDir);
  return entries.length;
}

async function readBuildEnvFile(config: DeployConfig): Promise<string | null> {
  if (!config.buildEnvFile) return null;
  const allowedBase = process.env.DEPLOY_ENV_FILE_BASE;
  const resolved = path.resolve(config.buildEnvFile);
  if (allowedBase && !resolved.startsWith(path.resolve(allowedBase) + path.sep)) {
    throw new Error("buildEnvFile is outside DEPLOY_ENV_FILE_BASE");
  }
  return fs.readFile(resolved, "utf8").catch(() => null);
}

export class DeploymentFailure extends Error {
  constructor(public stage: DeployStage, message: string) {
    super(message);
    this.name = "DeploymentFailure";
  }
}

export async function runDeployment(deploymentId: string): Promise<void> {
  const deployment = await db.deployment.findUnique({ where: { id: deploymentId } });
  if (!deployment) throw new Error(`Deployment ${deploymentId} not found`);

  // Atomic claim: a second worker/process cannot run the same deployment twice.
  const claim = await db.deployment.updateMany({
    where: { id: deploymentId, status: "PENDING" },
    data: { status: "RUNNING", startedAt: new Date(), stage: "checkout" },
  });
  if (claim.count !== 1) return;

  const started = Date.now();
  const secrets = collectSecrets();
  let stage: DeployStage = "checkout";
  let workdir: string | null = null;
  let activated = false;
  let previousDir: string | null = null;
  let releaseDir: string | null = null;
  let config: DeployConfig | null = null;
  let projectId: string | null = deployment.projectId;

  const log = async (level: "INFO" | "WARN" | "ERROR", text: string) => {
    const safe = redact(text, secrets).slice(0, 4000);
    await db.deploymentLog.create({ data: { deploymentId, level, message: safe } }).catch(() => {});
    logger.info({ deploymentId, stage, level }, safe.slice(0, 500));
  };
  const setStage = async (next: DeployStage) => {
    stage = next;
    await db.deployment.update({ where: { id: deploymentId }, data: { stage: next } });
    await log("INFO", `stage: ${next}`);
  };

  try {
    if (!deployment.projectId) throw new DeploymentFailure("checkout", "Deployment has no project");
    const project = await db.gitProject.findUnique({ where: { id: deployment.projectId } });
    if (!project) throw new DeploymentFailure("checkout", "Project not found");
    projectId = project.id;
    const website = await db.website.findUnique({ where: { id: project.websiteId } });
    if (!website) throw new DeploymentFailure("checkout", "Website not found");

    const storedConfig = validateDeployConfig(JSON.parse(project.config || "{}"));
    config = storedConfig;
    if (config.requiresApproval && !config.confirmedBy) {
      throw new DeploymentFailure(
        "detect",
        "Detection is ambiguous; an operator must review and confirm the deployment config before any command runs",
      );
    }

    const sha = deployment.commitHash || project.lastCommitSha;
    if (!sha || !/^[0-9a-f]{40}$/.test(sha)) {
      throw new DeploymentFailure("checkout", "No valid commit SHA pinned for this deployment");
    }

    workdir = await fs.mkdtemp(path.join(os.tmpdir(), `alo-build-${deploymentId.slice(0, 8)}-`));
    const checkoutDir = path.join(workdir, "src");
    await log("INFO", `checkout ${sha} from ${project.repository} (branch ${deployment.branch ?? project.productionBranch})`);
    // Local/staging paths are used verbatim. For GitHub URLs a short-lived token
    // is resolved from the stored connection at checkout time and never logged.
    let cloneUrl = project.cloneUrl;
    if (!/^(\/|file:)/.test(cloneUrl) && /^https:\/\/(www\.)?github\.com\//.test(cloneUrl)) {
      const connection = project.connectionId
        ? await db.gitConnection.findUnique({ where: { id: project.connectionId } })
        : null;
      const tokenSource = await resolveToken(connection).catch(() => ({ token: null as string | null }));
      cloneUrl = cloneUrlFor(project.repository, tokenSource.token);
    }
    const cloneLog = await gitCheckout(cloneUrl, sha, checkoutDir, secrets);
    await log("INFO", cloneLog);

    await setStage("detect");
    const detection = await detectFramework(fsReader(checkoutDir));
    await log("INFO", `detected ${detection.framework}/${detection.language}, confidence=${detection.confidence}, ambiguous=${detection.ambiguous}`);
    if (detection.ambiguous && !config.confirmedBy) {
      throw new DeploymentFailure("detect", "Checked-out manifests are ambiguous; operator confirmation required");
    }
    const importDetection = project.detection ? (JSON.parse(project.detection) as Parameters<typeof resolveConfig>[1]) : null;
    config = resolveConfig(storedConfig, importDetection, detection);
    await log("INFO", `effective commands: install=${config.installCmd ?? "none"} build=${config.buildCmd ?? "none"} test=${config.testCmd ?? "none"}`);

    const envFile = await readBuildEnvFile(config);
    const env = buildEnvironment(config, envFile);
    const run = async (label: DeployStage, command: string | null, required: boolean) => {
      const argv = parseCommand(command);
      if (!argv) {
        await log("INFO", `${label}: not configured, skipped`);
        return;
      }
      await setStage(label);
      await log("INFO", `$ ${redactCommand(argv, secrets)}`);
      const result = await runCommand(argv, { cwd: checkoutDir, env, secrets, onChunk: (chunk) => void log("INFO", chunk.trim()) });
      if (result.code !== 0) {
        if (required) throw new DeploymentFailure(label, `${label} failed with exit code ${result.code}`);
        await log("WARN", `${label} exited ${result.code} (non-blocking)`);
      }
    };

    await run("install", config.installCmd, true);
    await run("lint", config.lintCmd, true);
    await run("typecheck", config.typecheckCmd, true);
    await run("test", config.testCmd, true);
    await run("build", config.buildCmd, true);

    await setStage("package");
    releaseDir = releasePath(project.id, sha, deploymentId);
    const marker: ReleaseMarker = {
      deploymentId,
      projectId: project.id,
      repository: project.repository,
      commitSha: sha,
      branch: deployment.branch ?? project.productionBranch,
      createdAt: new Date().toISOString(),
    };
    const fileCount = await packageRelease(checkoutDir, config.outputDir, releaseDir, marker);
    await log("INFO", `release packaged at ${releaseDir} (${fileCount} top-level entries)`);

    await setStage("activate");
    if (config.serviceManager === "static") {
      await startStaticServer(config.port, projectRoot(project.id));
    }
    previousDir = await currentReleaseDir(project.id);
    await activateRelease(project.id, releaseDir);
    activated = true;
    if (config.serviceManager === "pm2" || config.serviceManager === "systemd") {
      await restartExternalService(config.serviceManager, config.serviceName!);
    }
    await log("INFO", `activated ${releaseDir}; previous=${previousDir ?? "none"}`);

    await setStage("verify");
    const baseUrl = project.healthUrl || `http://127.0.0.1:${config.port}`;
    const verification = await verifyDeployment({
      baseUrl,
      healthPath: config.healthPath,
      expectedSha: sha,
      expectedDeploymentId: deploymentId,
    });
    if (!verification.ok) {
      throw new DeploymentFailure("verify", `health/release verification failed: ${verification.reason}`);
    }
    await log("INFO", `verified live commit ${verification.marker?.commitSha} (HTTP ${verification.httpStatus}, attempt ${verification.attempts})`);

    const lastRelease = await db.release.findFirst({ where: { websiteId: website.id }, orderBy: { version: "desc" } });
    const release = await db.release.create({
      data: { websiteId: website.id, version: (lastRelease?.version ?? 0) + 1, path: releaseDir, commitHash: sha },
    });
    await db.deployment.update({
      where: { id: deploymentId },
      data: {
        status: "SUCCESS",
        stage: "done",
        releaseId: release.id,
        verifiedCommitSha: sha,
        healthResult: verification as unknown as object,
        finishedAt: new Date(),
        durationMs: Date.now() - started,
        buildOutput: `release v${release.version} verified at ${verification.httpStatus} (${verification.attempts} attempt(s))`,
      },
    });
    await db.website.update({
      where: { id: website.id },
      data: { currentReleasePath: releaseDir, status: "ACTIVE", healthStatus: "HEALTHY" },
    });
    await db.gitProject.update({
      where: { id: project.id },
      data: {
        lastCommitSha: sha,
        lastCommitMessage: deployment.commitMessage,
        lastCommitAuthor: deployment.commitAuthor,
        lastDeployStatus: "SUCCESS",
      },
    });
    await setStage("done");
    await log("INFO", `deployment ${deploymentId} SUCCESS (${Date.now() - started}ms)`);
  } catch (error) {
    const message = redact(error instanceof Error ? error.message : String(error), secrets).slice(0, 2000);
    const failedStage = error instanceof DeploymentFailure ? error.stage : stage;
    if (activated && projectId) {
      await restoreRelease(projectId, previousDir).catch(() => {});
      await log("WARN", `restored previous release ${previousDir ?? "none"} after failure`);
    }
    await db.deployment.update({
      where: { id: deploymentId },
      data: {
        status: activated ? "ROLLED_BACK" : "FAILED",
        stage: "done",
        failureStage: failedStage,
        finishedAt: new Date(),
        durationMs: Date.now() - started,
        buildOutput: message,
      },
    });
    await db.gitProject.update({ where: { id: projectId! }, data: { lastDeployStatus: activated ? "ROLLED_BACK" : "FAILED" } }).catch(() => {});
    await log("ERROR", `deployment FAILED at ${failedStage}: ${message}`);
  } finally {
    if (workdir) await fs.rm(workdir, { recursive: true, force: true }).catch(() => {});
  }
}

export interface RollbackResult {
  deploymentId: string;
  commitSha: string;
  releaseDir: string;
  verified: boolean;
  reason?: string;
}

/** Manual rollback to the last verified release that still exists on disk. */
export async function rollbackProject(projectId: string, actorId?: string): Promise<RollbackResult> {
  const project = await db.gitProject.findUnique({ where: { id: projectId } });
  if (!project) throw new Error("Project not found");
  const config = validateDeployConfig(JSON.parse(project.config || "{}"));
  const current = await currentReleaseDir(project.id);

  const successful = await db.deployment.findMany({
    where: { projectId: project.id, status: "SUCCESS", releaseId: { not: null }, verifiedCommitSha: { not: null } },
    include: { release: true },
    orderBy: { createdAt: "desc" },
    take: 20,
  });
  const target = successful.find((d) => d.release?.path && d.release.path !== current);
  if (!target?.release?.path || !target.verifiedCommitSha) {
    throw new Error("No previous verified release available for rollback");
  }
  await fs.stat(target.release.path).catch(() => {
    throw new Error("Previous release directory is missing on disk");
  });

  const deployment = await db.deployment.create({
    data: {
      websiteId: project.websiteId,
      projectId: project.id,
      trigger: "rollback",
      status: "RUNNING",
      startedAt: new Date(),
      stage: "activate",
      source: "rollback",
      commitHash: target.verifiedCommitSha,
      branch: project.productionBranch,
      actorId,
      configSnapshot: project.config,
      previousReleaseId: undefined,
    },
  });
  const log = async (level: string, message: string) =>
    db.deploymentLog.create({ data: { deploymentId: deployment.id, level, message: redact(message).slice(0, 4000) } });

  await log("INFO", `rollback requested to ${target.release.path} (${target.verifiedCommitSha})`);
  const previous = await currentReleaseDir(project.id);
  if (config.serviceManager === "static") await startStaticServer(config.port, projectRoot(project.id));
  await activateRelease(project.id, target.release.path);
  if (config.serviceManager === "pm2" || config.serviceManager === "systemd") {
    await restartExternalService(config.serviceManager, config.serviceName!);
  }

  const baseUrl = project.healthUrl || `http://127.0.0.1:${config.port}`;
  const verification = await verifyDeployment({
    baseUrl,
    healthPath: config.healthPath,
    expectedSha: target.verifiedCommitSha,
    expectedDeploymentId: target.id,
  });
  const verified = verification.ok;
  if (!verified && previous) {
    await activateRelease(project.id, previous);
    await log("ERROR", `rollback verification failed (${verification.reason}); restored ${previous}`);
  } else {
    await log("INFO", `rollback verified live commit ${target.verifiedCommitSha}`);
  }

  await db.deployment.update({
    where: { id: deployment.id },
    data: {
      status: verified ? "SUCCESS" : "FAILED",
      stage: "done",
      failureStage: verified ? null : "verify",
      verifiedCommitSha: verified ? target.verifiedCommitSha : null,
      healthResult: verification as unknown as object,
      finishedAt: new Date(),
      buildOutput: verified ? `rolled back to ${target.release.path}` : verification.reason,
    },
  });
  if (verified) {
    await db.website.update({
      where: { id: project.websiteId },
      data: { currentReleasePath: target.release.path, status: "ACTIVE" },
    });
    await db.gitProject.update({ where: { id: project.id }, data: { lastDeployStatus: "ROLLED_BACK", lastCommitSha: target.verifiedCommitSha } });
  }
  return {
    deploymentId: deployment.id,
    commitSha: target.verifiedCommitSha,
    releaseDir: target.release.path,
    verified,
    reason: verification.reason,
  };
}
