import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { apiSuccess } from "@/lib/response";
import { cloudHttpError } from "@/lib/cloud/cloud-service";
import { rotateCloudDatabaseCredential } from "@/lib/cloud/databases";

type Context = { params: Promise<{ id: string; databaseId: string }> };

export async function POST(request: NextRequest, context: Context) {
  try {
    const actor = await requireSession(request);
    const { id, databaseId } = await context.params;
    const result = await rotateCloudDatabaseCredential(actor, id, databaseId);
    return NextResponse.json(apiSuccess(result, "Database credential rotated — copy the new password now", 201), {
      status: 201, headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) { return cloudHttpError(error); }
}
