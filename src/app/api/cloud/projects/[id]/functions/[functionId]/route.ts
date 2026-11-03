import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { apiSuccess } from "@/lib/response";
import { cloudHttpError, removeCloudFunction } from "@/lib/cloud/cloud-service";

type RouteContext = { params: Promise<{ id: string; functionId: string }> };

export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const actor = await requireSession(request);
    const { id, functionId } = await context.params;
    const removed = await removeCloudFunction(actor, id, functionId);
    return NextResponse.json(apiSuccess(removed, "Function definition removed"), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return cloudHttpError(error);
  }
}
