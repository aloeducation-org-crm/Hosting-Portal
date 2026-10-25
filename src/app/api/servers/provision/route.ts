import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/nextauth";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const execFileAsync = promisify(execFile);
const helperPath = process.env.PROVISION_SITE_HELPER ?? "/usr/local/sbin/provision-site.sh";
const schema = z.object({
  serverId: z.string().uuid(),
  domainName: z.string().trim().toLowerCase().max(253).regex(
    /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?))*$/,
    "Enter a valid DNS hostname",
  ),
  targetPort: z.number().int().min(1024).max(65535),
});

function jsonError(message: string, status: number) {
  return NextResponse.json({ success: false, error: message }, { status });
}

async function runProvisionHelper(domainName: string, targetPort: number): Promise<void> {
  // execFile passes an argv array directly; no shell is involved. A strict
  // allowlist is still enforced by both this route and the root-owned helper.
  const { stdout, stderr } = await execFileAsync(
    "sudo",
    ["-n", helperPath, domainName, String(targetPort)],
    {
      timeout: 90_000,
      maxBuffer: 64 * 1024,
      env: { NODE_ENV: process.env.NODE_ENV ?? "production", PATH: "/usr/sbin:/usr/bin:/sbin:/bin", LANG: "C.UTF-8" },
      encoding: "utf8",
    },
  );
  logger.info({ event: "site.provision.helper.complete", domainName, stdout: stdout.trim(), stderr: stderr.trim() }, "Site provisioning helper completed");
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return jsonError("Authentication required", 401);
  if (session.user.role !== "SUPER_ADMIN") return jsonError("SUPER_ADMIN role required", 403);

  let input: z.infer<typeof schema>;
  try {
    input = schema.parse(await request.json());
  } catch (error) {
    return jsonError(error instanceof z.ZodError ? error.issues.map((issue) => issue.message).join("; ") : "Invalid JSON body", 400);
  }

  try {
    const server = await db.server.findUnique({ where: { id: input.serverId }, select: { id: true, status: true } });
    if (!server) return jsonError("Server not found", 404);
    if (server.status === "ERROR" || server.status === "OFFLINE") return jsonError("Target server is not available for provisioning", 409);
    // This endpoint executes a local helper. Never imply it can mutate a remote
    // server; remote targets need a separately authenticated agent/SSH channel.
    const localServerId = process.env.PROVISION_LOCAL_SERVER_ID;
    if (!localServerId || server.id !== localServerId) {
      return jsonError("This deployment can provision only its explicitly configured local server", 409);
    }

    const existing = await db.site.findUnique({ where: { domainName: input.domainName } });
    if (existing) return jsonError("A site with this domain already exists", 409);

    const site = await db.site.create({
      data: {
        domainName: input.domainName,
        serverId: input.serverId,
        vhostPath: `/etc/nginx/sites-available/${input.domainName}.conf`,
        sslStatus: "PENDING",
        provisioningStatus: "RUNNING",
      },
    });
    logger.info({ event: "site.provision.started", siteId: site.id, serverId: server.id, domainName: site.domainName }, "Site provisioning started");

    try {
      await runProvisionHelper(input.domainName, input.targetPort);
      const updated = await db.site.update({
        where: { id: site.id },
        data: { provisioningStatus: "ACTIVE" },
      });
      await db.auditLog.create({
        data: {
          actorUserId: session.user.id,
          actorEmail: session.user.email,
          actorRole: session.user.role,
          action: "SITE_PROVISION",
          resourceType: "Site",
          resourceId: site.id,
          result: "SUCCESS",
          metadata: { domainName: input.domainName, targetPort: input.targetPort, serverId: server.id },
        },
      }).catch((auditError: unknown) => logger.error({ event: "site.provision.audit_failed", siteId: site.id, error: auditError }, "Failed to write provisioning audit record"));
      return NextResponse.json({ success: true, site: updated }, { status: 201 });
    } catch (error) {
      const message = error instanceof Error ? error.message.slice(0, 1000) : "Unknown helper failure";
      await db.site.update({ where: { id: site.id }, data: { provisioningStatus: "ERROR" } }).catch((dbError: unknown) => {
        logger.error({ event: "site.provision.db_update_failed", siteId: site.id, error: dbError }, "Failed to mark site provisioning state");
      });
      logger.error({ event: "site.provision.failed", siteId: site.id, domainName: input.domainName, error: message }, "Site provisioning helper failed");
      await db.auditLog.create({
        data: {
          actorUserId: session.user.id,
          actorEmail: session.user.email,
          actorRole: session.user.role,
          action: "SITE_PROVISION",
          resourceType: "Site",
          resourceId: site.id,
          result: "FAILURE",
          metadata: { domainName: input.domainName, error: message },
        },
      }).catch((auditError: unknown) => logger.error({ event: "site.provision.audit_failed", siteId: site.id, error: auditError }, "Failed to write provisioning audit record"));
      return jsonError("Site provisioning failed; inspect service logs using the operation ID", 502);
    }
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "P2002") {
      return jsonError("A site with this domain already exists", 409);
    }
    logger.error({ event: "site.provision.request_failed", error }, "Provisioning request failed");
    return jsonError("Unable to provision site", 500);
  }
}
