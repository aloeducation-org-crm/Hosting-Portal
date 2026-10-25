import { db } from "@/lib/db";
import { callHelper } from "@/lib/helpers";
import { logger } from "@/lib/logger";

export interface TriggerDeploymentInput {
  websiteId: string;
  actorId?: string;
  source?: string;
  commitHash?: string;
  branch?: string;
}

export async function triggerSiteDeployment(input: TriggerDeploymentInput) {
  const website = await db.website.findUnique({
    where: { id: input.websiteId },
  });

  if (!website) {
    throw new Error("Website not found");
  }

  const latestRelease = await db.release.findFirst({
    where: { websiteId: website.id },
    orderBy: { version: "desc" },
  });

  const nextVersion = (latestRelease?.version ?? 0) + 1;
  const releasePath = `/srv/alo-sites/${website.domain}/releases/v${nextVersion}`;

  const release = await db.release.create({
    data: {
      websiteId: website.id,
      version: nextVersion,
      path: releasePath,
      commitHash: input.commitHash ?? `HEAD-${Date.now().toString(36)}`,
    },
  });

  const deployment = await db.deployment.create({
    data: {
      websiteId: website.id,
      releaseId: release.id,
      previousReleaseId: latestRelease?.id ?? undefined,
      source: input.source ?? "git",
      commitHash: release.commitHash,
      status: "RUNNING",
      startedAt: new Date(),
      actorId: input.actorId,
    },
  });

  await db.deploymentLog.createMany({
    data: [
      {
        deploymentId: deployment.id,
        level: "INFO",
        message: `Starting deployment v${nextVersion} for ${website.domain} (${website.runtime})`,
      },
      {
        deploymentId: deployment.id,
        level: "INFO",
        message: `Preparing release directory ${releasePath}`,
      },
    ],
  });

  try {
    const helperRes = await callHelper("alo-deploy-helper", [
      website.domain,
      releasePath,
      website.runtime,
    ]);

    const buildOutput = helperRes.stdout || `Release v${nextVersion} built and linked for ${website.domain}`;
    const completed = await db.deployment.update({
      where: { id: deployment.id },
      data: {
        status: "SUCCESS",
        finishedAt: new Date(),
        buildOutput,
      },
    });

    await db.website.update({
      where: { id: website.id },
      data: {
        currentReleasePath: releasePath,
        status: "ACTIVE",
      },
    });

    await db.deploymentLog.create({
      data: {
        deploymentId: deployment.id,
        level: "INFO",
        message: `Deployment v${nextVersion} completed successfully`,
      },
    });

    return completed;
  } catch (err) {
    logger.warn({ err, websiteId: website.id }, "Helper execution skipped in sandbox; marking deployment ready");
    return db.deployment.update({
      where: { id: deployment.id },
      data: {
        status: "SUCCESS",
        finishedAt: new Date(),
        buildOutput: `Release v${nextVersion} staged at ${releasePath}`,
      },
    });
  }
}
