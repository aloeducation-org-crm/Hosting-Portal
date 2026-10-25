import { logger } from "@/lib/logger";

/**
 * Re-attach the built-in static service manager to every verified release when
 * the panel process starts. Without this, releases would stay on disk but the
 * HTTP listener would disappear after a restart. Production installs should use
 * pm2/systemd (see docs/GIT-AUTODEPLOY.md); this keeps the zero-dependency
 * static manager consistent for staging and small installs.
 */
export async function restoreStaticServices(): Promise<{ started: number; skipped: number }> {
  const { db } = await import("@/lib/db");
  const { startStaticServer, projectRoot, currentReleaseDir } = await import("./service");
  const projects = await db.gitProject.findMany({
    where: { serviceManager: "static", port: { not: null } },
    select: { id: true, port: true },
  });
  let started = 0;
  let skipped = 0;
  const seenPorts = new Set<number>();
  for (const project of projects) {
    const port = project.port;
    if (!port || seenPorts.has(port)) {
      skipped++;
      continue;
    }
    seenPorts.add(port);
    const active = await currentReleaseDir(project.id);
    if (!active) {
      skipped++;
      continue;
    }
    try {
      await startStaticServer(port, projectRoot(project.id));
      started++;
    } catch (error) {
      // A port already owned by an external nginx/PM2 service is not fatal.
      skipped++;
      logger.warn({ projectId: project.id, port, error: error instanceof Error ? error.message : "unknown" }, "static service restore skipped");
    }
  }
  return { started, skipped };
}
