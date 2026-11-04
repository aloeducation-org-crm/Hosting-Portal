import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { apiSuccess } from "@/lib/response";
import { cloudHttpError, readCloudJson } from "@/lib/cloud/cloud-service";
import { createCloudDatabase, listCloudDatabases } from "@/lib/cloud/databases";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: Context) {
  try {
    const actor = await requireSession(request);
    const { id } = await context.params;
    return NextResponse.json(apiSuccess(await listCloudDatabases(actor, id)), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return cloudHttpError(error); }
}

export async function POST(request: NextRequest, context: Context) {
  try {
    const actor = await requireSession(request);
    const { id } = await context.params;
    const result = await createCloudDatabase(actor, id, await readCloudJson(request, 16_384));
    return NextResponse.json(apiSuccess(result, result.setupState === "AVAILABLE" ? "Cloud database provisioned" : "Cloud database is waiting for agent infrastructure", 201), {
      status: 201,
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) { return cloudHttpError(error); }
}
