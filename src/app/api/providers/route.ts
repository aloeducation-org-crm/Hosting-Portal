import { NextRequest, NextResponse } from "next/server";
import { apiSuccess, apiError, type ApiResponse } from "@/lib/response";
import { requireSuperAdmin } from "@/lib/auth";
import {
  listProviderStatuses,
  recordHostingerVerification,
  recordCpanelVerification,
} from "@/lib/providers/registry";
import { verifyHostingerAccess } from "@/lib/providers/hostinger";
import { verifyCpanelAccess } from "@/lib/providers/cpanel";

function handleErr(e: unknown): NextResponse {
  if (e && typeof e === "object" && "status" in e) {
    const a = e as ApiResponse;
    return NextResponse.json(a, { status: a.status });
  }
  return NextResponse.json(apiError("Internal server error"), { status: 500 });
}

/**
 * GET /api/providers — honest status of every external provider integration
 * (Server C Hostinger, Server D cPanel, optional Cloudflare).
 * Admin-only: it discloses which credentials are configured.
 */
export async function GET(request: NextRequest) {
  try {
    await requireSuperAdmin(request);
    return NextResponse.json(apiSuccess({ providers: listProviderStatuses() }));
  } catch (e) {
    return handleErr(e);
  }
}

/**
 * POST /api/providers/verify — run a REAL live check against one provider.
 * Body: { provider: "hostinger" | "cpanel" }.
 *
 * The result is whatever actually happened: an unreachable API or missing
 * credential returns `ok: false` with the precise reason, and `connected`
 * only becomes true in the status list after a successful round trip.
 */
export async function POST(request: NextRequest) {
  try {
    await requireSuperAdmin(request);
    const body = (await request.json().catch(() => ({}))) as { provider?: string };
    if (body.provider !== "hostinger" && body.provider !== "cpanel") {
      return NextResponse.json(
        apiError('provider must be "hostinger" or "cpanel"', "VALIDATION_ERROR", undefined, 400),
        { status: 400 }
      );
    }
    const result =
      body.provider === "hostinger" ? await verifyHostingerAccess() : await verifyCpanelAccess();
    if (result.ok && result.checkedAt) {
      if (body.provider === "hostinger") recordHostingerVerification(result.checkedAt);
      else recordCpanelVerification(result.checkedAt);
    }
    return NextResponse.json(apiSuccess({ provider: body.provider, result }));
  } catch (e) {
    return handleErr(e);
  }
}
