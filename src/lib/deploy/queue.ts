import { db } from "@/lib/db";
import { runDeployment } from "./engine";
import { logger } from "@/lib/logger";
import type { EnqueueInput } from "./types";

/**
 * A persisted deployment queue.
 *
 * - One row per deployment in the existing `deployments` table (PENDING is the
 *   queue state), so a process restart does not lose work.
 * - Per-project serialization: two pushes to the same project cannot build or
 *   swap `current` at the same time.
 * - `runDeployment` also performs an atomic PENDING -> RUNNING claim, so two
 *   workers (inline + `scripts/deploy-worker.ts`) cannot double-run a job.
 */

const projectQueues = new Map<string, Promise<void>>();
const active = new Map<string, string>();

export function withProjectLock<T>(projectId: string, fn: () => Promise<T>): Promise<T> {
  const previous = projectQueues.get(projectId) ?? Promise.resolve();
  const result = previous.catch(() => {}).then(fn);
  projectQueues.set(
    projectId,
    result.then(
      () => {},
      () => {},
    ),
  );
  return result;
}

export function inlineWorkerEnabled(): boolean {
  return process.env.DEPLOY_INLINE_WORKER !== "false";
}

export interface EnqueueResult {
  deploymentId: string;
  status: "queued";
  position: number;
}

export async function enqueueDeployment(input: EnqueueInput): Promise<EnqueueResult> {
  const project = await db.gitProject.findUnique({ where: { id: input.projectId } });
  if (!project) throw new Error("Project not found");
  if (!/^[0-9a-f]{40}$/.test(input.commitSha)) throw new Error("Invalid commit SHA");

  const queuedAhead = await db.deployment.count({
    where: { projectId: project.id, status: { in: ["PENDING", "RUNNING"] } },
  });

  const deployment = await db.deployment.create({
    data: {
      websiteId: project.websiteId,
      projectId: project.id,
      status: "PENDING",
      stage: "queued",
      source: "git",
      trigger: input.trigger,
      deliveryId: input.deliveryId,
      commitHash: input.commitSha,
      commitMessage: input.commitMessage?.slice(0, 500) ?? null,
      commitAuthor: input.commitAuthor?.slice(0, 200) ?? null,
      branch: input.branch ?? project.productionBranch,
      configSnapshot: project.config,
    },
  });
  await db.deploymentLog.create({
    data: {
      deploymentId: deployment.id,
      level: "INFO",
      message: `queued ${input.trigger} deployment of ${project.repository}@${input.commitSha.slice(0, 12)} on ${input.branch ?? project.productionBranch}`,
    },
  });

  await db.gitProject.update({
    where: { id: project.id },
    data: {
      lastCommitSha: input.commitSha,
      ...(input.commitMessage ? { lastCommitMessage: input.commitMessage.slice(0, 500) } : {}),
      ...(input.commitAuthor ? { lastCommitAuthor: input.commitAuthor.slice(0, 200) } : {}),
      lastDeployStatus: "QUEUED",
    },
  });

  if (inlineWorkerEnabled()) {
    void withProjectLock(project.id, async () => {
      active.set(project.id, deployment.id);
      try {
        await runDeployment(deployment.id);
      } catch (error) {
        logger.error({ deploymentId: deployment.id, error }, "deployment worker crashed");
        await db.deployment
          .update({
            where: { id: deployment.id },
            data: { status: "FAILED", failureStage: "queued", finishedAt: new Date(), buildOutput: "worker crashed" },
          })
          .catch(() => {});
      } finally {
        active.delete(project.id);
      }
    });
  }

  return { deploymentId: deployment.id, status: "queued", position: queuedAhead + 1 };
}

/** Used by `scripts/deploy-worker.ts` and by tests with an inline worker off. */
export async function processPendingDeployments(limit = 5): Promise<string[]> {
  const pending = await db.deployment.findMany({
    where: { status: "PENDING", projectId: { not: null } },
    orderBy: { createdAt: "asc" },
    take: limit,
  });
  const byProject = new Map<string, string[]>();
  for (const item of pending) {
    const list = byProject.get(item.projectId!) ?? [];
    list.push(item.id);
    byProject.set(item.projectId!, list);
  }
  const processed: string[] = [];
  await Promise.all(
    [...byProject.entries()].map(([projectId, ids]) =>
      withProjectLock(projectId, async () => {
        for (const id of ids) {
          await runDeployment(id);
          processed.push(id);
        }
      }),
    ),
  );
  return processed;
}

export function queueStatus(): { running: Array<{ projectId: string; deploymentId: string }>; knownProjects: number } {
  return {
    running: [...active.entries()].map(([projectId, deploymentId]) => ({ projectId, deploymentId })),
    knownProjects: projectQueues.size,
  };
}

/** Test/ops helper: wait for a deployment to leave PENDING/RUNNING. */
export async function waitForDeployment(id: string, timeoutMs = 60_000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const d = await db.deployment.findUnique({ where: { id }, select: { status: true } });
    if (d && d.status !== "PENDING" && d.status !== "RUNNING") return d.status;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`Timed out waiting for deployment ${id}`);
}
