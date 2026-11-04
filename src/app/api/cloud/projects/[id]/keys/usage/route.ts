import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { apiSuccess } from "@/lib/response";
import { cloudHttpError, cloudKeyUsageSummary } from "@/lib/cloud/cloud-service";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: Context) {
  try {
    const actor = await requireSession(request);
    const { id } = await context.params;
    const keyId = new URL(request.url).searchParams.get("keyId")?.trim() || undefined;
    const result = await cloudKeyUsageSummary(actor, id, keyId);
    return NextResponse.json(apiSuccess(result), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return cloudHttpError(error);
  }
}
