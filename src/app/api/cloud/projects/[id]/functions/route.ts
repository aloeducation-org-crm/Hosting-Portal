import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { apiSuccess } from "@/lib/response";
import { cloudHttpError, createCloudFunction, readCloudJson } from "@/lib/cloud/cloud-service";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const actor = await requireSession(request);
    const { id } = await context.params;
    const body = await readCloudJson(request, 8_192);
    const created = await createCloudFunction(actor, id, body);
    return NextResponse.json(
      apiSuccess(created, "Function definition saved (executionState: REQUIRES_SETUP)", 201),
      { status: 201, headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return cloudHttpError(error);
  }
}
