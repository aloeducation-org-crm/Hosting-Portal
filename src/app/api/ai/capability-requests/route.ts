import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { apiSuccess } from "@/lib/response";
import { capabilityError, readCapabilityJson } from "@/lib/ai/capability-http";
import { capabilityRequestPresentation, createCapabilityRequest } from "@/lib/ai/capability-requests";

export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request);
    const records = await db.aiCapabilityRequest.findMany({ orderBy: { createdAt: "desc" }, take: 50 });
    const projects = await db.project.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" }, take: 200 });
    return NextResponse.json(apiSuccess({ requests: records.map(capabilityRequestPresentation), projects, executionEnabled: false }), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return capabilityError(error); }
}
export async function POST(request: NextRequest) {
  try {
    const actor = await requireAdmin(request);
    const record = await createCapabilityRequest(actor, await readCapabilityJson(request, 12000));
    return NextResponse.json(apiSuccess(record, "Saved for independent review; no execution dispatched", 201), { status: 201 });
  } catch (error) { return capabilityError(error); }
}
