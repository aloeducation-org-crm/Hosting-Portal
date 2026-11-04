import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { apiSuccess } from "@/lib/response";
import { cloudHttpError, readCloudJson } from "@/lib/cloud/cloud-service";
import { createCloudStorageBucket, listCloudStorageBuckets } from "@/lib/cloud/storage";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: Context) {
  try { const actor = await requireSession(request); const { id } = await context.params; return NextResponse.json(apiSuccess(await listCloudStorageBuckets(actor, id)), { headers: { "Cache-Control": "private, no-store" } }); }
  catch (error) { return cloudHttpError(error); }
}

export async function POST(request: NextRequest, context: Context) {
  try {
    const actor = await requireSession(request); const { id } = await context.params;
    const bucket = await createCloudStorageBucket(actor, id, await readCloudJson(request, 16_384));
    return NextResponse.json(apiSuccess(bucket, "Cloud Storage bucket created", 201), { status: 201, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return cloudHttpError(error); }
}
