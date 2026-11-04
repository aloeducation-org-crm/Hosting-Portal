import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { apiSuccess } from "@/lib/response";
import { cloudHttpError, removeCloudProjectMember } from "@/lib/cloud/cloud-service";

type Context = { params: Promise<{ id: string; userId: string }> };

export async function DELETE(request: NextRequest, context: Context) {
  try {
    const actor = await requireSession(request);
    const { id, userId } = await context.params;
    return NextResponse.json(apiSuccess(await removeCloudProjectMember(actor, id, userId), "Project member removed"), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return cloudHttpError(error);
  }
}
