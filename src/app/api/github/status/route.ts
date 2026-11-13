import { NextRequest, NextResponse } from "next/server";
import { apiSuccess } from "@/lib/response";
import { requireSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { errorResponse } from "@/lib/deploy/http";
import { listUsableConnections, publicConnection } from "@/lib/deploy/connections";
import { isAdminRole } from "@/lib/auth";

/**
 * Reports configuration state only — never returns a secret value.
 *
 * SEC-02: this used to return *every* connection on the platform, including the
 * ids, account logins and installation ids of other tenants. That is what turned
 * the unowned `connectionId` parameter elsewhere into an exploitable defect: an
 * attacker did not have to guess an id. Connections are now scoped to the caller
 * (`listUsableConnections`), administrators still see the platform totals, and a
 * customer sees counts for their own projects only.
 */
export async function GET(request: NextRequest) {
  try {
    const user = await requireSession(request);
    const admin = isAdminRole(user.role);
    const connections = (await listUsableConnections(user)).map(publicConnection);
    const projectWhere = admin ? {} : { OR: [{ createdById: user.id }, { website: { ownerId: user.id } }] };
    const [projects, deliveries] = await Promise.all([
      db.gitProject.count({ where: projectWhere }),
      // Deliveries are keyed by project id, not a relation. Non-administrators
      // see deliveries for the projects they can access, and nothing else.
      db.webhookDelivery.count({
        where: admin
          ? {}
          : {
              projectId: {
                in: (
                  await db.gitProject.findMany({
                    where: projectWhere,
                    select: { id: true },
                  })
                ).map((row) => row.id),
              },
            },
      }).catch(() => 0),
    ]);
    return NextResponse.json(apiSuccess({
      github: {
        appConfigured: Boolean(process.env.GITHUB_APP_ID && process.env.GITHUB_APP_PRIVATE_KEY),
        oauthConfigured: Boolean(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET),
        serverTokenConfigured: Boolean(process.env.GITHUB_TOKEN),
        webhookSecretConfigured: Boolean(process.env.GITHUB_WEBHOOK_SECRET),
        apiUrl: process.env.GITHUB_API_URL || "https://api.github.com",
        webhookPath: "/api/github/webhook",
      },
      connections,
      projects,
      webhookDeliveries: deliveries,
    }));
  } catch (error) {
    return errorResponse(error);
  }
}
