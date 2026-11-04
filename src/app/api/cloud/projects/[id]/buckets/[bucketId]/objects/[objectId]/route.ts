import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { apiSuccess } from "@/lib/response";
import { cloudHttpError } from "@/lib/cloud/cloud-service";
import { deleteCloudStorageObject, readCloudStorageObject } from "@/lib/cloud/storage";

type Context = { params: Promise<{ id: string; bucketId: string; objectId: string }> };

export async function GET(request: NextRequest, context: Context) {
  try {
    const actor = await requireSession(request); const { id, bucketId, objectId } = await context.params;
    // Project ownership is enforced by a signed, session-bound read request.
    const data = await readCloudStorageObject({ bucketId, objectId, actor, expectedProjectRef: id });
    const body = data.content.buffer.slice(data.content.byteOffset, data.content.byteOffset + data.content.byteLength) as ArrayBuffer;
    return new NextResponse(body, { headers: { "Content-Type": data.object.mimeType, "Content-Length": String(data.content.byteLength), "X-Content-SHA256": data.object.checksumSha256, "Cache-Control": "private, no-store" } });
  } catch (error) { return cloudHttpError(error); }
}

export async function DELETE(request: NextRequest, context: Context) {
  try { const actor = await requireSession(request); const { id, bucketId, objectId } = await context.params; return NextResponse.json(apiSuccess(await deleteCloudStorageObject(actor, id, bucketId, objectId), "Cloud Storage object deleted"), { headers: { "Cache-Control": "private, no-store" } }); }
  catch (error) { return cloudHttpError(error); }
}
