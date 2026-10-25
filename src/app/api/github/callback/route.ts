import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { env } from "@/lib/env";
import { db } from "@/lib/db";
import { exchangeOAuthCode, getCurrentUser, encryptToken } from "@/lib/deploy/github";
import { createAuditLog } from "@/lib/audit";
import { errorResponse } from "@/lib/deploy/http";

export async function GET(request: NextRequest) {
  const base = env.APP_URL.replace(/\/$/, "");
  try {
    const user = await requireSession(request);
    const url = new URL(request.url);
    const code = url.searchParams.get("code") ?? "";
    const state = url.searchParams.get("state") ?? "";
    const expected = request.cookies.get("alo_github_oauth_state")?.value ?? "";
    if (!code || !state || !expected || state !== expected) {
      return NextResponse.redirect(`${base}/deployments?github=error&reason=invalid_state`);
    }
    const redirectUri = `${base}/api/github/callback`;
    const token = await exchangeOAuthCode(code, redirectUri);
    const account = await getCurrentUser(token);
    const encrypted = encryptToken(token);
    await db.gitConnection.upsert({
      where: { provider_accountLogin: { provider: "github", accountLogin: account.login } },
      create: {
        provider: "github",
        mode: "oauth",
        accountLogin: account.login,
        accountType: account.type,
        tokenEncrypted: encrypted,
        connectedById: user.id,
        status: "active",
      },
      update: { tokenEncrypted: encrypted, accountType: account.type, status: "active", connectedById: user.id },
    });
    await createAuditLog({
      actorId: user.id, actorEmail: user.email, actorRole: user.role,
      action: "GITHUB_CONNECT", resourceType: "GitConnection", resourceId: account.login,
      result: "SUCCESS", metadata: { accountLogin: account.login },
    });
    const response = NextResponse.redirect(`${base}/deployments?github=connected`);
    response.cookies.delete("alo_github_oauth_state");
    return response;
  } catch (error) {
    return errorResponse(error);
  }
}
