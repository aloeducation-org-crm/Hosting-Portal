/**
 * Remote release engine — executes a verified deployment through an enrolled
 * node agent instead of on the panel host.
 *
 * Mirrors the local engine's contract (`src/lib/deploy/engine.ts`): atomic
 * PENDING→RUNNING claim, per-stage `Deployment`/`DeploymentLog` records, an
 * exact pinned commit, staged execution where every stage is verified before
 * the next begins, and automatic restore of the previous release on failure.
 *
 * Every host action goes through ONE allowlisted agent command per stage
 * (`deploy.clone`, `deploy.build-release`, `deploy.marker`, `deploy.switch`,
 * `app.up`); nothing is ever a shell string, and the agent re-validates every
 * argument on the host side.
 *
 * Verification is dual-sourced, exactly like the local engine: a real HTTP
 * probe of the app's loopback listener AND the release marker (deployment id +
 * commit SHA) read from the activated release. An HTTP 200 alone is never
 * accepted as a deployment success.
 */
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { redact } from "./redact";
import { validateDeployConfig, parseCommand } from "./config";
import type { DeployConfig } from "./types";
import type { DeployStage } from "./types";
import type { WorkerContext } from "@/lib/orchestrator/contracts";
import { runAgent, type AgentAuthorization } from "@/lib/orchestrator/platform-workers";

const REMOTE_VERIFY_ATTEMPTS = 20;
const REMOTE_VERIFY_DELAY_MS = 750;

export interface RemoteDeploymentResult {
  status: "SUCCESS" | "FAILED" | "ROLLED_BACK";
  stage: string;
  reason?: string;
  verifiedCommitSha?: string;
  httpStatus?: number | null;
  releasePath?: string | null;
}

function parse<T>(raw: string | null | undefined, fallback: T): T {
  try {
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

/** The runtime shape a project takes on a node. */
function runtimeOf(config: DeployConfig): "node" | "static" {
  return config.startCmd ? "node" : "static";
}

export class RemoteDeploymentFailure extends Error {
  constructor(
    public stage: DeployStage | "service" | "verify",
    message: string,
    public rolledBack: boolean,
  ) {
    super(message);
    this.name = "RemoteDeploymentFailure";
  }
}

/**
 * Drive one deployment to completion on its assigned node.
 *
 * @param deploymentId the deployment row (already created by prepare-deployment)
 * @param ctx worker context (progress, abort signal, approval, actor)
 * @param authorization how privileged agent commands are authorized for this run
 */
export async function runRemoteDeployment(
  deploymentId: string,
  ctx: WorkerContext,
  authorization: AgentAuthorization,
): Promise<RemoteDeploymentResult> {
  const deployment = await db.deployment.findUnique({ where: { id: deploymentId } });
  if (!deployment) throw new Error(`Deployment ${deploymentId} not found`);

  // Atomic claim — same contract as the local engine.
  const claim = await db.deployment.updateMany({
    where: { id: deploymentId, status: "PENDING" },
    data: { status: "RUNNING", startedAt: new Date(), stage: "checkout" },
  });
  if (claim.count !== 1) {
    // Already running or finished; the worker reports the stored state.
    const current = await db.deployment.findUnique({ where: { id: deploymentId } });
    return {
      status: (current?.status as RemoteDeploymentResult["status"]) ?? "FAILED",
      stage: current?.stage ?? "unknown",
      reason: "deployment was not PENDING (already claimed)",
    };
  }

  const started = Date.now();
  const agentId = await resolveAgentId(deployment.projectId as string);
  if (!agentId) throw new Error("Deployment has no assigned node agent");

  const log = async (level: "INFO" | "WARN" | "ERROR", text: string) => {
    const safe = redact(text).slice(0, 4000);
    await db.deploymentLog.create({ data: { deploymentId, level, message: safe } }).catch(() => {});
    logger.info({ deploymentId, level }, safe.slice(0, 500));
  };
  const setStage = async (next: DeployStage | "service") => {
    await db.deployment.update({ where: { id: deploymentId }, data: { stage: next } });
    await log("INFO", `stage: ${next}`);
  };

  const project = await db.gitProject.findUnique({ where: { id: deployment.projectId! } });
  if (!project) throw new RemoteDeploymentFailure("checkout", "Project not found", false);
  const website = await db.website.findUnique({ where: { id: project.websiteId } });
  if (!website) throw new RemoteDeploymentFailure("checkout", "Website not found", false);
  const domain = website.domain;

  const config = validateDeployConfig(parse(project.config, {}));
  if (config.requiresApproval && !config.confirmedBy) {
    throw new RemoteDeploymentFailure(
      "detect",
      "Detection is ambiguous; an operator must confirm the deployment config before any command runs",
      false,
    );
  }

  const sha = deployment.commitHash || project.lastCommitSha;
  if (!sha || !/^[0-9a-f]{40}$/.test(sha)) {
    throw new RemoteDeploymentFailure("checkout", "No valid commit SHA pinned for this deployment", false);
  }

  const runtime = runtimeOf(config);
  let releasePath: string | null = null;
  let switched = false;
  let previousRelease: string | null = null;

  const fail = async (stage: DeployStage | "service" | "verify", message: string) => {
    let rolledBack = false;
    // Service-affecting stages require the previous release to be restored,
    // exactly like the local engine's restore-on-failure guarantee.
    if (switched) {
      try {
        if (previousRelease) {
          const rollback = await runAgent(ctx, agentId, "deploy.switch", { domain, releasePath: previousRelease }, authorization, 60_000);
          await log("WARN", `restored previous release ${previousRelease} (agent task ${rollback.taskId})`);
        } else {
          const rollback = await runAgent(ctx, agentId, "deploy.rollback", { domain }, authorization, 60_000);
          await log("WARN", `deploy.rollback executed (agent task ${rollback.taskId})`);
        }
        await runAgent(ctx, agentId, "app.up", appUpArgs(domain, config, runtime), authorization, 120_000).catch(async (error) => {
          await log("WARN", `app re-start after rollback failed: ${error instanceof Error ? error.message : String(error)}`);
        });
        rolledBack = true;
      } catch (error) {
        await log("ERROR", `rollback after failure could not be verified: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    await db.deployment.update({
      where: { id: deploymentId },
      data: {
        status: rolledBack ? "ROLLED_BACK" : "FAILED",
        stage,
        failureStage: stage,
        finishedAt: new Date(),
        durationMs: Date.now() - started,
        buildOutput: redact(message).slice(0, 2000),
      },
    });
    await db.gitProject.update({ where: { id: project.id }, data: { lastDeployStatus: "FAILED" } });
    return new RemoteDeploymentFailure(stage, message, rolledBack);
  };

  try {
    await ctx.progress(10, `remote deployment ${deployment.id} on node agent ${agentId.slice(0, 8)} (commit ${sha.slice(0, 12)})`);
    await log("INFO", `remote deployment of ${project.repository}@${sha.slice(0, 12)} to node ${agentId.slice(0, 8)} (domain ${domain}, runtime ${runtime})`);

    // ── checkout: clone the production branch on the node ────────────────────
    await setStage("checkout");
    // The agent only accepts credential-free URLs; private repos require deploy
    // keys on the node (reported honestly rather than bypassed).
    const cloneUrl = project.cloneUrl;
    if (!/^https:\/\/[A-Za-z0-9.-]+\//.test(cloneUrl) && !/^(git@|ssh:\/\/)/.test(cloneUrl)) {
      throw await fail("checkout", `Refusing to clone non-git URL ${redact(cloneUrl)}`);
    }

    // Resume support: a previous attempt of THIS deployment may already have
    // built a release (e.g. it paused for approval). Reuse it instead of
    // re-cloning, so an approval round-trip is cheap.
    const existing = await runAgent(ctx, agentId, "deploy.list", { domain }, authorization, 30_000);
    const releases = (existing.data as { releases?: Array<{ path?: string; deploymentId?: string; commitSha?: string }> }).releases ?? [];
    const reusable = releases.find((r) => r.deploymentId === deploymentId && r.commitSha === sha && r.path);
    if (reusable?.path) {
      releasePath = reusable.path;
      await log("INFO", `reusing already-built release ${releasePath} for this deployment (resume)`);
    } else {
      const clone = await runAgent(ctx, agentId, "deploy.clone", { domain, repo: cloneUrl, branch: deployment.branch ?? project.productionBranch }, authorization, 5 * 60_000);
      const data = clone.data as { releasePath?: string };
      if (!data.releasePath) throw await fail("checkout", "Clone did not return a release path");
      releasePath = data.releasePath;
      await log("INFO", `cloned branch ${deployment.branch ?? project.productionBranch} to ${releasePath} (agent task ${clone.taskId})`);
    }

    // ── install / lint / typecheck / test / build: each in the new release ──
    const stages: Array<[DeployStage, string | null]> = [
      ["install", config.installCmd],
      ["lint", config.lintCmd],
      ["typecheck", config.typecheckCmd],
      ["test", config.testCmd],
      ["build", config.buildCmd],
    ];
    for (const [stage, command] of stages) {
      if (!command) {
        await log("INFO", `${stage}: not configured, skipped`);
        continue;
      }
      // Guard the exact command with the platform's own parser before it is
      // sent anywhere, so an unsafe stored config fails here, not on the host.
      parseCommand(command);
      await setStage(stage);
      await log("INFO", `$ ${command} (in ${releasePath})`);
      const built = await runAgent(ctx, agentId, "deploy.build-release", { domain, releasePath, buildCmd: command }, authorization, 15 * 60_000);
      const output = String((built.data as { output?: string }).output ?? "").slice(0, 600);
      if (output) await log("INFO", output);
      await log("INFO", `${stage} completed on node (agent task ${built.taskId})`);
    }

    // ── package: verify commit identity and write the release marker ────────
    await setStage("package");
    const marker = await runAgent(ctx, agentId, "deploy.marker", { domain, releasePath, deploymentId, commitSha: sha }, authorization, 60_000);
    await log("INFO", `release marker written and commit identity verified (agent task ${marker.taskId})`);

    // ── activate: record previous, switch current ───────────────────────────
    await setStage("activate");
    previousRelease = ((existing.data as { currentRelease?: string | null }).currentRelease ?? null) || null;
    const switchResult = await runAgent(ctx, agentId, "deploy.switch", { domain, releasePath }, authorization, 60_000);
    switched = true;
    await log("INFO", `activated ${releasePath}; previous=${previousRelease ?? "none"} (agent task ${switchResult.taskId})`);

    // ── service: start/replace the supervised process ───────────────────────
    await setStage("service");
    const up = await runAgent(ctx, agentId, "app.up", appUpArgs(domain, config, runtime), authorization, 180_000);
    await log("INFO", `supervised process started: ${JSON.stringify(up.data).slice(0, 300)} (agent task ${up.taskId})`);

    // ── verify: HTTP probe + release marker, both through the node agent ────
    await setStage("verify");
    const verify = await verifyRemoteRelease(ctx, agentId, domain, config, sha, deploymentId, authorization);
    if (!verify.ok) throw await fail("verify", `health/release verification failed: ${verify.reason}`);
    await log("INFO", `verified live commit ${verify.marker?.commitSha} (HTTP ${verify.httpStatus}, attempt ${verify.attempts}) through the node agent`);

    // ── persist success ──────────────────────────────────────────────────────
    const lastRelease = await db.release.findFirst({ where: { websiteId: website.id }, orderBy: { version: "desc" } });
    const release = await db.release.create({
      data: { websiteId: website.id, version: (lastRelease?.version ?? 0) + 1, path: releasePath, commitHash: sha },
    });
    await db.deployment.update({
      where: { id: deploymentId },
      data: {
        status: "SUCCESS",
        stage: "done",
        releaseId: release.id,
        verifiedCommitSha: sha,
        healthResult: { ok: true, httpStatus: verify.httpStatus, marker: verify.marker, source: "node-agent" } as unknown as object,
        finishedAt: new Date(),
        durationMs: Date.now() - started,
        buildOutput: `remote release v${release.version} on node ${agentId.slice(0, 8)} verified at HTTP ${verify.httpStatus} (${verify.attempts} attempt(s))`,
      },
    });
    await db.website.update({
      where: { id: website.id },
      data: { currentReleasePath: releasePath, status: "ACTIVE", healthStatus: "HEALTHY" },
    });
    await db.gitProject.update({
      where: { id: project.id },
      data: {
        lastCommitSha: sha,
        lastCommitMessage: deployment.commitMessage,
        lastCommitAuthor: deployment.commitAuthor,
        lastDeployStatus: "SUCCESS",
        releaseRoot: releasePath,
      },
    });
    await db.healthCheck.upsert({
      where: { websiteId: website.id },
      create: { websiteId: website.id, publicHttp: true, localHttp: true, overallStatus: "HEALTHY", checkedAt: new Date() },
      update: { publicHttp: true, localHttp: true, overallStatus: "HEALTHY", checkedAt: new Date() },
    });
    await ctx.progress(95, "remote deployment verified");
    return { status: "SUCCESS", stage: "done", verifiedCommitSha: sha, httpStatus: verify.httpStatus, releasePath };
  } catch (error) {
    if (error instanceof RemoteDeploymentFailure) throw error;
    const failure = await fail("verify", error instanceof Error ? error.message : String(error));
    throw failure;
  }
}

function appUpArgs(domain: string, config: DeployConfig, runtime: "node" | "static") {
  return {
    domain,
    port: config.port,
    type: runtime,
    commandOrRoot: runtime === "node" ? (config.startCmd as string) : config.outputDir,
    healthPath: config.healthPath,
  };
}

async function resolveAgentId(projectId: string): Promise<string | null> {
  const project = await db.gitProject.findUnique({ where: { id: projectId }, select: { agentId: true } });
  return project?.agentId ?? null;
}

export interface RemoteVerifyResult {
  ok: boolean;
  httpStatus: number | null;
  marker: { deploymentId?: string; commitSha?: string } | null;
  reason: string;
  attempts: number;
}

/**
 * Verify a live release on a node: HTTP probe of the app's loopback listener
 * plus the release marker served by the release tree. Both through the agent.
 */
export async function verifyRemoteRelease(
  ctx: WorkerContext,
  agentId: string,
  domain: string,
  config: Pick<DeployConfig, "port" | "healthPath">,
  /**
   * Commit identity (or accepted set of identities) the serving release
   * marker must carry. A set is used on the rollback path, where the restored
   * release may be any release this platform has historically verified.
   */
  expectedSha: string | string[],
  /**
   * Deployment identity the marker must carry. Null on the rollback path: a
   * restored release directory keeps the marker written by the deployment
   * that BUILT it, which is by definition not the newest deployment row —
   * pinning there would fail every legitimate rollback.
   */
  expectedDeploymentId: string | null,
  authorization: AgentAuthorization,
): Promise<RemoteVerifyResult> {
  const acceptedShas = Array.isArray(expectedSha) ? expectedSha : [expectedSha];
  let lastStatus: number | null = null;
  let lastReason = "health endpoint never returned 2xx";
  for (let i = 1; i <= REMOTE_VERIFY_ATTEMPTS; i++) {
    ctx.signal.throwIfAborted();
    try {
      const probe = await runAgent(
        ctx,
        agentId,
        "health.probe",
        { url: `http://127.0.0.1:${config.port}${config.healthPath || "/"}` },
        authorization,
        30_000,
      );
      const httpStatus = Number((probe.data as { httpStatus?: number }).httpStatus ?? 0);
      lastStatus = httpStatus;
      if (httpStatus >= 200 && httpStatus < 400) {
        const markerTask = await runAgent(ctx, agentId, "deploy.read-marker", { domain }, authorization, 30_000);
        const marker = markerTask.data as { deploymentId?: string; commitSha?: string };
        if (
          marker?.commitSha &&
          acceptedShas.includes(marker.commitSha) &&
          (expectedDeploymentId === null || marker?.deploymentId === expectedDeploymentId)
        ) {
          return { ok: true, httpStatus, marker, reason: "verified", attempts: i };
        }
        lastReason = `release marker mismatch (live=${marker?.commitSha ?? "none"} expected=${acceptedShas.join("|")})`;
      } else {
        lastReason = `health endpoint returned HTTP ${httpStatus}`;
      }
    } catch (error) {
      lastReason = redact(error instanceof Error ? error.message : String(error));
    }
    if (i < REMOTE_VERIFY_ATTEMPTS) await new Promise((r) => setTimeout(r, REMOTE_VERIFY_DELAY_MS));
  }
  return { ok: false, httpStatus: lastStatus, marker: null, reason: lastReason, attempts: REMOTE_VERIFY_ATTEMPTS };
}
