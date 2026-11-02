import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { apiSuccess } from "@/lib/response";
import { reviewCapabilityRequest } from "@/lib/ai/capability-requests";
import { capabilityError, readCapabilityJson } from "@/lib/ai/capability-http";

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireAdmin(request);
    const { id } = await params;
    const record = await reviewCapabilityRequest(actor, id, await readCapabilityJson(request, 5000));
    return NextResponse.json(apiSuccess(record, "Review recorded; execution remains disabled"));
  } catch (error) { return capabilityError(error); }
}
