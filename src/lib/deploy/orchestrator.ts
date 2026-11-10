/**
 * Compatibility entrypoint for the retired nested application's
 * `executeDeployment(options)`. The legacy module used `exec()` with untrusted
 * repository URLs and a hardcoded /home/alamin/storage path. This adapter keeps
 * the same capability — clone, detect, configure, queue and run a deployment —
 * but delegates every privileged step to the canonical, allowlisted engine in
 * ./engine.ts (which also verifies HTTP health and rolls back on failure).
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { db } from "@/lib/db";
import { detectFramework, fsReader } from "./detect";
import { configFromDetection, validateDeployConfig } from "./config";
import { runDeployment } from "./engine";

const execFileAsync = promisify(execFile);

export interface DeployOptions {
  websiteId: string;
  repositoryUrl: string;
  branch: string;
  commitHash: string;
  commitMessage?: string;
  commitAuthor?: string;
  actorId?: string;
}

const SAFE_BRANCH = /^[A-Za-z0-9][A-Za-z0-9/._-]{0,127}$/;
const SAFE_SHA = /^[0-9a-f]{40}$/;

function repositoryFromUrl(raw: string): string {
  const value = raw.trim().replace(/\.git$/, "");
  const github = value.match(/^https:\/\/github\.com\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)$/);
  if (github) return github[1]!;
  // Local/staging absolute paths are supported verbatim by the canonical engine.
  if (value.startsWith("/") || value.startsWith("file:")) return `local/${path.basename(value)}`;
  throw new Error("repositoryUrl must be a GitHub HTTPS URL or an absolute local path");
}

export async function executeDeployment(options: DeployOptions) {
  if (!options.websiteId) throw new Error("websiteId is required");
  if (!SAFE_BRANCH.test(options.branch)) throw new Error("Unsafe branch name");
  if (!SAFE_SHA.test(options.commitHash)) throw new Error("commitHash must be a 40-character SHA");

  const repository = repositoryFromUrl(options.repositoryUrl);
  const workdir = await fs.mkdtemp(path.join(os.tmpdir(), "alo-compat-detect-"));
  try {
    const checkout = path.join(workdir, "src");
    await execFileAsync(
      "git",
      ["clone", "--quiet", "--depth", "1", "--branch", options.branch, "--", options.repositoryUrl, checkout],
      { timeout: 120_000, maxBuffer: 1024 * 1024 },
    );
    const detection = await detectFramework(fsReader(checkout));
    const config = validateDeployConfig(configFromDetection(detection));

    const project = await db.gitProject.upsert({
      where: { websiteId: options.websiteId },
      create: {
        websiteId: options.websiteId,
        repository,
        cloneUrl: options.repositoryUrl,
        productionBranch: options.branch,
        lastCommitSha: options.commitHash,
        lastCommitMessage: options.commitMessage,
        lastCommitAuthor: options.commitAuthor,
        detection: JSON.stringify(detection),
        detectionStatus: detection.ambiguous ? "ambiguous" : "detected",
        config: JSON.stringify(config),
        healthPath: config.healthPath,
        requiresApproval: config.requiresApproval,
        serviceManager: config.serviceManager,
      },
      update: {
        repository,
        cloneUrl: options.repositoryUrl,
        productionBranch: options.branch,
        lastCommitSha: options.commitHash,
        lastCommitMessage: options.commitMessage,
        lastCommitAuthor: options.commitAuthor,
        detection: JSON.stringify(detection),
        config: JSON.stringify(config),
        healthPath: config.healthPath,
      },
    });

    const deployment = await db.deployment.create({
      data: {
        websiteId: options.websiteId,
        projectId: project.id,
        source: options.repositoryUrl,
        commitHash: options.commitHash,
        branch: options.branch,
        commitMessage: options.commitMessage,
        commitAuthor: options.commitAuthor,
        actorId: options.actorId ?? null,
        status: "PENDING",
        trigger: "manual",
        configSnapshot: JSON.stringify(config),
      },
    });

    await runDeployment(deployment.id);
    return deployment;
  } finally {
    await fs.rm(workdir, { recursive: true, force: true }).catch(() => {});
  }
}

export { runDeployment, rollbackProject } from "./engine";
