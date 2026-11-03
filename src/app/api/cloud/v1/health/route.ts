import { NextRequest, NextResponse } from "next/server";
import { apiSuccess } from "@/lib/response";
import { cloudHttpError, verifyMachineProjectHealth } from "@/lib/cloud/cloud-service";

/**
 * Appwrite-style machine/SDK/agent health endpoint (`GET /api/cloud/v1/health`).
 * Authenticated exclusively by `x-alo-project` + `x-alo-key` (or Bearer `alok_live_...`)
 * with `health.read` or `project.read` scope — never by browser cookies.
 */
export async function GET(request: NextRequest) {
  try {
    const verified = await verifyMachineProjectHealth(request.headers, ["health.read", "project.read"]);
    return NextResponse.json(apiSuccess(verified.data), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return cloudHttpError(error);
  }
}
