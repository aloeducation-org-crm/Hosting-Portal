import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { apiSuccess } from "@/lib/response";
import { cloudHttpError, readCloudJson, rotateCloudProjectKey } from "@/lib/cloud/cloud-service";

type Context = { params: Promise<{ id: string; keyId: string }> };

/** Rotate a bearer key atomically; the previous key is immediately revoked. */
export async function POST(request: NextRequest, context: Context) {
  try {
    const actor = await requireSession(request);
    const { id, keyId } = await context.params;
    const body = request.body ? await readCloudJson(request, 8_192) : {};
    const result = await rotateCloudProjectKey(actor, id, keyId, body);
    return NextResponse.json(apiSuccess(result, "API key rotated — copy the new secret now", 201), {
      status: 201,
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return cloudHttpError(error);
  }
}
