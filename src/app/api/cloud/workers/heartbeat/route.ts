import { NextRequest, NextResponse } from "next/server";
import { apiSuccess } from "@/lib/response";
import { cloudHttpError, readCloudJson } from "@/lib/cloud/cloud-service";
import { heartbeatCloudWorker } from "@/lib/cloud/workers";

/** Signed by the per-worker bearer returned once from registration. */
export async function POST(request: NextRequest) {
  try {
    const auth = request.headers.get("authorization");
    const bearer = auth?.startsWith("Bearer ") ? auth.slice(7).trim() : null;
    const worker = await heartbeatCloudWorker(
      await readCloudJson(request, 16_384),
      bearer ?? request.headers.get("x-alo-worker-secret"),
    );
    return NextResponse.json(apiSuccess({ worker, nextHeartbeatMs: 30_000 }, "Cloud worker heartbeat recorded"), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return cloudHttpError(error);
  }
}
