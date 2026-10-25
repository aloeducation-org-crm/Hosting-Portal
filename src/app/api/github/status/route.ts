import { NextRequest, NextResponse } from "next/server";
import { apiSuccess } from "@/lib/response";
import { requireSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { errorResponse } from "@/lib/deploy/http";

/** Reports configuration state only — never returns a secret value. */
export async function GET(request: NextRequest) {
  try {
    await requireSession(request);
    const [connections, projects, deliveries] = await Promise.all([
      db.gitConnection.findMany({ select: { id: true, mode: true, accountLogin: true, accountType: true, status: true, installationId: true, createdAt: true } }),
      db.gitProject.count(),
      db.webhookDelivery.count(),
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
