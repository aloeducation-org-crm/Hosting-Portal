import { NextRequest, NextResponse } from "next/server";
import { apiSuccess, apiError, type ApiResponse } from "@/lib/response";
import { verifyInternalSecretValue } from "@/lib/auth";
import { runAutomationTick } from "@/lib/orchestrator/engine";
import { WORKER_KINDS, type WorkerKind } from "@/lib/orchestrator/contracts";
import { logger } from "@/lib/logger";

function isAuthorized(request: NextRequest): boolean {
  const authHeader = request.headers.get("authorization");
  const headerSecret = request.headers.get("x-internal-secret");
  const bearer = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  return verifyInternalSecretValue(bearer ?? headerSecret);
}

function handleErr(e: unknown): NextResponse {
  if (e && typeof e === "object" && "status" in e) {
    const a = e as ApiResponse;
    return NextResponse.json(a, { status: a.status });
  }
  return NextResponse.json(apiError("Internal server error"), { status: 500 });
}

/**
 * Worker tick: claim and run queued jobs.
 *
 * Protected by the same INTERNAL_SECRET mechanism the existing operations
 * worker uses, so an external caller cannot make the panel execute work. Called
 * by `scripts/orchestrator-worker.ts` on an interval, and safe to call from a
 * cron/health endpoint because claiming is atomic and per-lock-key serialized.
 */
export async function POST(request: NextRequest) {
  try {
    if (!isAuthorized(request)) {
      return NextResponse.json(apiError("Invalid or missing internal secret", "UNAUTHORIZED", undefined, 401), { status: 401 });
    }

    const url = new URL(request.url);
    const workerId = (url.searchParams.get("worker") || `api-${process.pid}`).slice(0, 64);
    const maxJobs = Math.min(Number(url.searchParams.get("max") ?? 5) || 5, 25);
    const kindsParam = url.searchParams.getAll("kind");
    const kinds = kindsParam.filter((k): k is WorkerKind => (WORKER_KINDS as readonly string[]).includes(k));
    const lockKey = url.searchParams.get("lockKey") ?? undefined;

    const result = await runAutomationTick({ workerId, maxJobs, kinds: kinds.length ? kinds : undefined, lockKey });
    if (result.recovered.jobIds.length || result.ran.length) logger.info({ workerId, ran: result.ran, recovered: result.recovered }, "orchestrator tick");
    return NextResponse.json(apiSuccess(result));
  } catch (e) {
    return handleErr(e);
  }
}
