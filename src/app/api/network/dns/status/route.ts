import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { apiSuccess, apiError, type ApiResponse } from "@/lib/response";
import {
  currentDnsMode,
  dnsPublicationState,
  lastDnsLivePublishAt,
  DNS_MODES,
} from "@/lib/dns-provider";

/**
 * GET /api/network/dns/status — honest publication state of the DNS layer.
 * Tells the dashboard exactly what the configured mode does: panel-only
 * (never published anywhere), blocked (credentials/engine missing), unverified
 * (credentials set, no successful publish yet), or active (a publish has
 * actually succeeded from this control plane).
 */
export async function GET(request: NextRequest) {
  try {
    await requireSession(request);
    const state = dnsPublicationState();
    return NextResponse.json(
      apiSuccess({
        ...state,
        supportedModes: DNS_MODES,
        currentMode: currentDnsMode(),
        lastLivePublishAt: lastDnsLivePublishAt(),
      })
    );
  } catch (e) {
    const err = e as ApiResponse;
    if (err && typeof err === "object" && "status" in err) {
      return NextResponse.json(err as ApiResponse, { status: err.status });
    }
    return NextResponse.json(apiError("Internal server error"), { status: 500 });
  }
}
