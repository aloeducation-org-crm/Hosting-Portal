import { NextRequest, NextResponse } from "next/server";
import { verifyInternalSecretValue } from "@/lib/auth";
import { apiError, apiSuccess } from "@/lib/response";
import { cloudHttpError, readCloudJson } from "@/lib/cloud/cloud-service";
import { registerCloudWorker } from "@/lib/cloud/workers";

function internalAuthorized(request: NextRequest): boolean {
  const auth = request.headers.get("authorization");
  const bearer = auth?.startsWith("Bearer ") ? auth.slice(7) : null;
  return verifyInternalSecretValue(bearer ?? request.headers.get("x-internal-secret"));
}

/** Bootstrap endpoint, restricted to a platform-local internal secret. */
export async function POST(request: NextRequest) {
  try {
    if (!internalAuthorized(request)) {
      return NextResponse.json(apiError("Cloud worker registration requires the internal bootstrap secret", "UNAUTHORIZED", undefined, 401), { status: 401 });
    }
    const worker = await registerCloudWorker(await readCloudJson(request, 16_384));
    return NextResponse.json(apiSuccess(worker, "Cloud worker registered — store the returned bearer secret securely", 201), {
      status: 201,
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return cloudHttpError(error);
  }
}
