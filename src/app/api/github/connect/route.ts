import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import { requireSession } from "@/lib/auth";
import { env } from "@/lib/env";
import { oauthAuthorizeUrl } from "@/lib/deploy/github";
import { errorResponse } from "@/lib/deploy/http";

/** Start the GitHub OAuth (state-bound CSRF protection, httpOnly cookie). */
export async function GET(request: NextRequest) {
  try {
    await requireSession(request);
    const state = crypto.randomBytes(24).toString("hex");
    const redirectUri = `${env.APP_URL.replace(/\/$/, "")}/api/github/callback`;
    const url = oauthAuthorizeUrl(state, redirectUri);
    const response = NextResponse.redirect(url);
    response.cookies.set("alo_github_oauth_state", state, {
      httpOnly: true,
      secure: env.APP_URL.startsWith("https://"),
      sameSite: "lax",
      maxAge: 600,
      path: "/",
    });
    return response;
  } catch (error) {
    return errorResponse(error);
  }
}
