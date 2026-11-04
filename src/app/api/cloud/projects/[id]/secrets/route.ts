import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { apiSuccess } from "@/lib/response";
import { cloudHttpError, listCloudProjectSecrets, readCloudJson, upsertCloudProjectSecret } from "@/lib/cloud/cloud-service";

type Context = { params: Promise<{ id: string }> };

/** Lists secret metadata only. Plaintext and ciphertext are never serialized. */
export async function GET(request: NextRequest, context: Context) {
  try {
    const actor = await requireSession(request);
    const { id } = await context.params;
    return NextResponse.json(apiSuccess(await listCloudProjectSecrets(actor, id)), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return cloudHttpError(error);
  }
}

export async function PUT(request: NextRequest, context: Context) {
  try {
    const actor = await requireSession(request);
    const { id } = await context.params;
    const result = await upsertCloudProjectSecret(actor, id, await readCloudJson(request, 70_000));
    return NextResponse.json(apiSuccess(result, "Cloud secret sealed and versioned"), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return cloudHttpError(error);
  }
}
