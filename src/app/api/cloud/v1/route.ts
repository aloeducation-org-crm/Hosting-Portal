import { NextRequest, NextResponse } from "next/server";
import { apiSuccess } from "@/lib/response";
import { cloudHttpError, verifyMachineProjectHealth } from "@/lib/cloud/cloud-service";

/**
 * Cloud v1 root discovery endpoint (`GET /api/cloud/v1`).
 * Authenticated exclusively by `x-alo-project` + `x-alo-key` (or Bearer `alok_live_...`)
 * with `health.read` or `project.read` scope — never by browser cookies.
 */
export async function GET(request: NextRequest) {
  try {
    const verified = await verifyMachineProjectHealth(request.headers, ["health.read", "project.read"]);
    return NextResponse.json(
      apiSuccess({
        version: "v1",
        endpoints: {
          health: "/api/cloud/v1/health",
          storage: "/api/cloud/v1/storage/:bucketId/objects/:objectId",
        },
        project: verified.data.project,
      }),
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return cloudHttpError(error);
  }
}
