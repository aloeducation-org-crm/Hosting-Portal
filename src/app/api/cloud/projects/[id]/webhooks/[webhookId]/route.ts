import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { apiSuccess } from "@/lib/response";
import { cloudHttpError, removeCloudWebhook } from "@/lib/cloud/cloud-service";

type RouteContext = { params: Promise<{ id: string; webhookId: string }> };

export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const actor = await requireSession(request);
    const { id, webhookId } = await context.params;
    const removed = await removeCloudWebhook(actor, id, webhookId);
    return NextResponse.json(apiSuccess(removed, "Webhook removed"), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return cloudHttpError(error);
  }
}
