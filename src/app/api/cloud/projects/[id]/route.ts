import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { apiSuccess } from "@/lib/response";
import {
  cloudHttpError,
  deleteCloudProject,
  getCloudProjectWorkspace,
  readCloudJson,
  updateCloudProject,
} from "@/lib/cloud/cloud-service";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const actor = await requireSession(request);
    const { id } = await context.params;
    const origin = request.nextUrl?.origin || new URL(request.url).origin;
    const detail = await getCloudProjectWorkspace(actor, id, origin);
    return NextResponse.json(apiSuccess(detail), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return cloudHttpError(error);
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const actor = await requireSession(request);
    const { id } = await context.params;
    const body = await readCloudJson(request, 16_384);
    const updated = await updateCloudProject(actor, id, body);
    return NextResponse.json(apiSuccess(updated, "Cloud Project updated"), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return cloudHttpError(error);
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const actor = await requireSession(request);
    const { id } = await context.params;
    const deleted = await deleteCloudProject(actor, id);
    return NextResponse.json(apiSuccess(deleted, "Cloud Project deleted"), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return cloudHttpError(error);
  }
}
