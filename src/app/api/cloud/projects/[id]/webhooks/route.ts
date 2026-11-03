import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { apiSuccess } from "@/lib/response";
import { cloudHttpError, createCloudWebhook, readCloudJson } from "@/lib/cloud/cloud-service";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const actor = await requireSession(request);
    const { id } = await context.params;
    const body = await readCloudJson(request, 8_192);
    const created = await createCloudWebhook(actor, id, body);
    return NextResponse.json(
      apiSuccess(created, "Event webhook created — copy the signing secret now; only its hash is stored", 201),
      { status: 201, headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return cloudHttpError(error);
  }
}
