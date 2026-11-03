import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { apiSuccess } from "@/lib/response";
import { cloudHttpError, revokeCloudProjectKey } from "@/lib/cloud/cloud-service";

type RouteContext = { params: Promise<{ id: string; keyId: string }> };

export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const actor = await requireSession(request);
    const { id, keyId } = await context.params;
    const revoked = await revokeCloudProjectKey(actor, id, keyId);
    return NextResponse.json(apiSuccess(revoked, "API key revoked"), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return cloudHttpError(error);
  }
}
