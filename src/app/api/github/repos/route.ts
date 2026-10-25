import { NextRequest, NextResponse } from "next/server";
import { apiSuccess } from "@/lib/response";
import { requireSession } from "@/lib/auth";
import { listRepositories, listBranches, fetchRepoManifests, validateRepositoryName } from "@/lib/deploy/github";
import { detectFramework, memoryReader } from "@/lib/deploy/detect";
import { accessToken } from "@/lib/deploy/projects";
import { badRequest, errorResponse } from "@/lib/deploy/http";

/** List authorized repositories, or branches/detection for one repository. */
export async function GET(request: NextRequest) {
  try {
    await requireSession(request);
    const { searchParams } = new URL(request.url);
    const connectionId = searchParams.get("connectionId");
    let source;
    try {
      source = await accessToken(connectionId);
    } catch (error) {
      return NextResponse.json(apiSuccess({ configured: false, reason: error instanceof Error ? error.message : "no credentials", repositories: [] }));
    }
    const repository = searchParams.get("repository");
    if (!repository) {
      const repositories = await listRepositories(source.token!);
      return NextResponse.json(apiSuccess({ configured: true, mode: source.mode, label: source.label, repositories }));
    }
    let repo: string;
    try { repo = validateRepositoryName(repository); } catch { return badRequest("Invalid repository name"); }
    const branches = await listBranches(source.token!, repo);
    const branch = searchParams.get("branch") || branches[0]?.name || "main";
    let detection = null;
    if (searchParams.get("detect") !== "0") {
      try {
        const manifests = await fetchRepoManifests(source.token!, repo, branch);
        detection = await detectFramework(memoryReader(manifests.files));
      } catch { /* detection is best-effort at listing time */ }
    }
    return NextResponse.json(apiSuccess({ configured: true, mode: source.mode, repository: repo, branch, branches, detection }));
  } catch (error) {
    return errorResponse(error);
  }
}
