import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { apiError, apiSuccess } from "@/lib/response";
import { cloudHttpError, readCloudJson } from "@/lib/cloud/cloud-service";
import { requestCloudDatabaseRestore } from "@/lib/cloud/databases";

type Context = { params: Promise<{ id: string; databaseId: string }> };

export async function POST(request: NextRequest, context: Context) {
  try {
    const actor = await requireSession(request);
    const { id, databaseId } = await context.params;
    const body = z.object({ backupId: z.string().min(1).max(128) }).strict().parse(await readCloudJson(request, 8_192));
    const result = await requestCloudDatabaseRestore(actor, id, databaseId, body.backupId);
    return NextResponse.json(apiSuccess(result, "Restore is queued and requires explicit human approval", 202), {
      status: 202, headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json(apiError("Validation failed", "VALIDATION_ERROR", error.flatten(), 400), { status: 400 });
    return cloudHttpError(error);
  }
}
