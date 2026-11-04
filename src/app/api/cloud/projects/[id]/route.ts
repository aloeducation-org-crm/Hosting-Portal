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
    // First DELETE creates a reversible pending-deletion request. Send
    // {slug, token} from that response within 15 minutes for final removal.
    let confirmation: { slug?: string; token?: string } | undefined;
    const raw = await request.text();
    if (raw.trim()) {
      try {
        const body = JSON.parse(raw) as Record<string, unknown>;
        confirmation = {
          slug: typeof body.slug === "string" ? body.slug : undefined,
          token: typeof body.token === "string" ? body.token : undefined,
        };
      } catch {
        throw new SyntaxError("Invalid JSON request body");
      }
    }
    const deleted = await deleteCloudProject(actor, id, confirmation);
    return NextResponse.json(apiSuccess(deleted, deleted.deleted ? "Cloud Project deleted" : "Deletion requested; confirm to permanently remove"), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return cloudHttpError(error);
  }
}
