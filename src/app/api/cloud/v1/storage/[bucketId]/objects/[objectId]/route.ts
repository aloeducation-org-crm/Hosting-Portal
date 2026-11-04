import { NextRequest, NextResponse } from "next/server";
import { cloudHttpError } from "@/lib/cloud/cloud-service";
import { readCloudStorageObject } from "@/lib/cloud/storage";

type Context = { params: Promise<{ bucketId: string; objectId: string }> };

/** HMAC-signed object delivery endpoint. It deliberately accepts no session cookie. */
export async function GET(request: NextRequest, context: Context) {
  try {
    const { bucketId, objectId } = await context.params;
    const { searchParams } = new URL(request.url);
    const data = await readCloudStorageObject({ bucketId, objectId, signedExpires: searchParams.get("expires"), signedSignature: searchParams.get("sig") });
    const body = data.content.buffer.slice(data.content.byteOffset, data.content.byteOffset + data.content.byteLength) as ArrayBuffer;
    return new NextResponse(body, {
      headers: {
        "Content-Type": data.object.mimeType,
        "Content-Length": String(data.content.byteLength),
        "X-Content-SHA256": data.object.checksumSha256,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) { return cloudHttpError(error); }
}
