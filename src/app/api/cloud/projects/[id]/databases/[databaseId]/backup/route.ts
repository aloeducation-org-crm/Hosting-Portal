import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { apiSuccess } from "@/lib/response";
import { cloudHttpError } from "@/lib/cloud/cloud-service";
import { createCloudDatabaseBackup } from "@/lib/cloud/databases";

type Context = { params: Promise<{ id: string; databaseId: string }> };

export async function POST(request: NextRequest, context: Context) {
  try {
    const actor = await requireSession(request);
    const { id, databaseId } = await context.params;
    const backup = await createCloudDatabaseBackup(actor, id, databaseId);
    return NextResponse.json(apiSuccess(backup, "Checksummed database backup created", 201), {
      status: 201, headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) { return cloudHttpError(error); }
}
