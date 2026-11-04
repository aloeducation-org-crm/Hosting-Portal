import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { apiError, apiSuccess } from "@/lib/response";
import { cloudHttpError, readCloudJson } from "@/lib/cloud/cloud-service";
import { issueCloudObjectSignedUrl } from "@/lib/cloud/storage";

type Context = { params: Promise<{ id: string; bucketId: string; objectId: string }> };

export async function POST(request: NextRequest, context: Context) {
  try {
    const actor = await requireSession(request); const { id, bucketId, objectId } = await context.params;
    const body = z.object({ expiresInSeconds: z.number().int().min(1).max(3600).optional() }).strict().parse(await readCloudJson(request, 4_096));
    const url = new URL(request.url);
    const result = await issueCloudObjectSignedUrl(actor, id, bucketId, objectId, body.expiresInSeconds ?? 300, url.origin);
    return NextResponse.json(apiSuccess(result), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json(apiError("Validation failed", "VALIDATION_ERROR", error.flatten(), 400), { status: 400 });
    return cloudHttpError(error);
  }
}
