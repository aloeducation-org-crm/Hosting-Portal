import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { apiSuccess } from "@/lib/response";
import { cloudHttpError, listCloudProjectEnvironments } from "@/lib/cloud/cloud-service";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: Context) {
  try {
    const actor = await requireSession(request);
    const { id } = await context.params;
    return NextResponse.json(apiSuccess(await listCloudProjectEnvironments(actor, id)), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return cloudHttpError(error);
  }
}
