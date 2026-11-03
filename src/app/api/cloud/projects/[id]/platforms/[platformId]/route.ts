import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { apiSuccess } from "@/lib/response";
import { cloudHttpError, removeCloudPlatform } from "@/lib/cloud/cloud-service";

type RouteContext = { params: Promise<{ id: string; platformId: string }> };

export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const actor = await requireSession(request);
    const { id, platformId } = await context.params;
    const removed = await removeCloudPlatform(actor, id, platformId);
    return NextResponse.json(apiSuccess(removed, "Client platform removed"), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return cloudHttpError(error);
  }
}
