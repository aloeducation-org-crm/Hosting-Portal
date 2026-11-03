import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { apiSuccess } from "@/lib/response";
import { cloudHttpError, createCloudProject, listCloudWorkspace, readCloudJson } from "@/lib/cloud/cloud-service";

export async function GET(request: NextRequest) {
  try {
    const actor = await requireSession(request);
    const workspace = await listCloudWorkspace(actor);
    return NextResponse.json(apiSuccess(workspace), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return cloudHttpError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const actor = await requireSession(request);
    const body = await readCloudJson(request, 16_384);
    const created = await createCloudProject(actor, body);
    return NextResponse.json(apiSuccess(created, "Cloud Project created", 201), {
      status: 201,
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return cloudHttpError(error);
  }
}
