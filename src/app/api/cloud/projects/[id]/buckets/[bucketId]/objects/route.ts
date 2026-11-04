import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { apiError, apiSuccess } from "@/lib/response";
import { cloudHttpError } from "@/lib/cloud/cloud-service";
import { listCloudStorageObjects, uploadCloudStorageObject } from "@/lib/cloud/storage";

type Context = { params: Promise<{ id: string; bucketId: string }> };

export async function GET(request: NextRequest, context: Context) {
  try { const actor = await requireSession(request); const { id, bucketId } = await context.params; return NextResponse.json(apiSuccess(await listCloudStorageObjects(actor, id, bucketId)), { headers: { "Cache-Control": "private, no-store" } }); }
  catch (error) { return cloudHttpError(error); }
}

export async function POST(request: NextRequest, context: Context) {
  try {
    const actor = await requireSession(request); const { id, bucketId } = await context.params;
    const form = await request.formData();
    const rawFile = form.get("file");
    if (!(rawFile instanceof File)) return NextResponse.json(apiError("Multipart file is required", "VALIDATION_ERROR", undefined, 400), { status: 400 });
    const objectKey = typeof form.get("objectKey") === "string" ? String(form.get("objectKey")) : rawFile.name;
    let metadata: unknown = {};
    const rawMetadata = form.get("metadata");
    if (typeof rawMetadata === "string" && rawMetadata.trim()) {
      try { metadata = JSON.parse(rawMetadata); } catch { return NextResponse.json(apiError("metadata must be JSON", "VALIDATION_ERROR", undefined, 400), { status: 400 }); }
    }
    const expiresAt = typeof form.get("expiresAt") === "string" ? String(form.get("expiresAt")) : null;
    const object = await uploadCloudStorageObject(actor, id, bucketId, { objectKey, file: rawFile, metadata, expiresAt });
    return NextResponse.json(apiSuccess(object, "Cloud Storage object uploaded", 201), { status: 201, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return cloudHttpError(error); }
}
