import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { apiSuccess } from "@/lib/response";
import { cloudHttpError, listCloudProjectMembers, readCloudJson, upsertCloudProjectMember } from "@/lib/cloud/cloud-service";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: Context) {
  try {
    const actor = await requireSession(request);
    const { id } = await context.params;
    return NextResponse.json(apiSuccess(await listCloudProjectMembers(actor, id)), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return cloudHttpError(error);
  }
}

export async function PUT(request: NextRequest, context: Context) {
  try {
    const actor = await requireSession(request);
    const { id } = await context.params;
    const result = await upsertCloudProjectMember(actor, id, await readCloudJson(request, 8_192));
    return NextResponse.json(apiSuccess(result, "Project member saved"), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return cloudHttpError(error);
  }
}
