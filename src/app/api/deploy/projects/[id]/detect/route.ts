import { NextRequest, NextResponse } from "next/server";
import { apiSuccess } from "@/lib/response";
import { requireSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { accessToken } from "@/lib/deploy/projects";
import { fetchRepoManifests } from "@/lib/deploy/github";
import { detectFramework, memoryReader } from "@/lib/deploy/detect";
import { configFromDetection } from "@/lib/deploy/config";
import { canAccessProject, errorResponse, forbidden, notFound } from "@/lib/deploy/http";

/** Re-run detection from the repository's current default/production branch. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireSession(request);
    const { id } = await params;
    const project = await db.gitProject.findUnique({ where: { id } });
    if (!project) return notFound("Project not found");
    const website = await db.website.findUnique({ where: { id: project.websiteId } });
    if (!canAccessProject(user, project, website)) return forbidden();
    const source = await accessToken(project.connectionId);
    const { files, truncated } = await fetchRepoManifests(source.token!, project.repository, project.productionBranch);
    const detection = await detectFramework(memoryReader(files));
    const config = configFromDetection(detection);
    config.port = project.port ?? config.port;
    await db.gitProject.update({
      where: { id },
      data: { detection: JSON.stringify(detection), config: JSON.stringify(config), detectionStatus: detection.ambiguous ? "ambiguous" : "detected", requiresApproval: detection.ambiguous },
    });
    return NextResponse.json(apiSuccess({ detection, config, truncated }));
  } catch (error) {
    return errorResponse(error);
  }
}
