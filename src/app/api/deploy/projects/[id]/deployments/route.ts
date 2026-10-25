import { NextRequest, NextResponse } from "next/server";
import { apiSuccess } from "@/lib/response";
import { requireSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { canAccessProject, errorResponse, forbidden, notFound } from "@/lib/deploy/http";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireSession(request);
    const { id } = await params;
    const project = await db.gitProject.findUnique({ where: { id } });
    if (!project) return notFound("Project not found");
    const website = await db.website.findUnique({ where: { id: project.websiteId } });
    if (!canAccessProject(user, project, website)) return forbidden();
    const { searchParams } = new URL(request.url);
    const take = Math.min(100, Math.max(1, Number(searchParams.get("limit") ?? 25)));
    const items = await db.deployment.findMany({ where: { projectId: id }, orderBy: { createdAt: "desc" }, take });
    const total = await db.deployment.count({ where: { projectId: id } });
    return NextResponse.json(apiSuccess({ items, total }));
  } catch (error) {
    return errorResponse(error);
  }
}
