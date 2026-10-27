import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { apiSuccess, apiError, type ApiResponse } from "@/lib/response";
import { requireAdmin, requireSession } from "@/lib/auth";
import { orchestrator, type EnqueueJobInput } from "@/lib/orchestrator/orchestrator";
import { WORKER_KINDS, type RiskLevel } from "@/lib/orchestrator/contracts";
import { listWorkers } from "@/lib/orchestrator/workers";

const enqueueSchema = z.object({
  kind: z.enum(WORKER_KINDS),
  type: z.string().max(120).optional(),
  input: z.unknown(),
  lockKey: z.string().max(200).optional(),
  websiteId: z.string().max(64).optional(),
  resourceId: z.string().max(64).optional(),
  resourceType: z.string().max(64).optional(),
  priority: z.number().int().min(0).max(1000).optional(),
  idempotencyKey: z.string().min(8).max(120).optional(),
  correlationId: z.string().max(64).optional(),
  maxAttempts: z.number().int().min(1).max(10).optional(),
  timeoutMs: z.number().int().min(1000).max(3_600_000).optional(),
  riskLevel: z.enum(["READ_ONLY", "REVERSIBLE", "PRIVILEGED", "DESTRUCTIVE"]).optional(),
});

function handleErr(e: unknown): NextResponse {
  if (e && typeof e === "object" && "status" in e) {
    const a = e as ApiResponse;
    return NextResponse.json(a, { status: a.status });
  }
  const message = e instanceof Error ? e.message : "Internal server error";
  const code = (e as { code?: string })?.code;
  if (code === "VALIDATION_FAILED") {
    return NextResponse.json(apiError(message, code, (e as { details?: unknown }).details, 400), { status: 400 });
  }
  if (code === "UNKNOWN_WORKER") {
    return NextResponse.json(apiError(message, code, undefined, 400), { status: 400 });
  }
  return NextResponse.json(apiError(message, code ?? "INTERNAL_ERROR"), { status: 500 });
}

/**
 * GET  — list jobs (`?status=`, `?lockKey=`, `?kind=`) plus the worker catalogue.
 * POST — enqueue a job. Admin only: every worker can read or change
 *        infrastructure state, and the orchestrator itself re-applies the
 *        approval gate for PRIVILEGED / DESTRUCTIVE risk.
 */
export async function GET(request: NextRequest) {
  try {
    await requireSession(request);
    const sp = request.nextUrl.searchParams;
    const status = sp.getAll("status").filter(Boolean);
    const lockKey = sp.get("lockKey") ?? undefined;
    const kind = sp.get("kind") ?? undefined;
    const limit = Math.min(Number(sp.get("limit") ?? 50) || 50, 200);

    const jobs = await orchestrator.list(limit, {
      status: status.length ? (status as never) : undefined,
      lockKey,
      kind: kind && (WORKER_KINDS as readonly string[]).includes(kind) ? (kind as never) : undefined,
    });
    const depth = await orchestrator.queueDepth();
    return NextResponse.json(apiSuccess({ jobs, queue: depth, workers: listWorkers() }));
  } catch (e) {
    return handleErr(e);
  }
}

export async function POST(request: NextRequest) {
  try {
    const admin = await requireAdmin(request);
    const parsed = enqueueSchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json(apiError("Validation failed", "VALIDATION_ERROR", parsed.error.flatten(), 400), { status: 400 });
    }
    const payload: EnqueueJobInput = {
      ...parsed.data,
      riskLevel: parsed.data.riskLevel as RiskLevel | undefined,
      actor: { id: admin.id, email: admin.email, role: admin.role },
    };
    const result = await orchestrator.enqueue(payload);
    return NextResponse.json(
      apiSuccess(result, result.duplicate ? "Duplicate request — the existing job was returned" : result.requiresApproval ? "Job queued, waiting for approval" : "Job queued", result.duplicate ? 200 : 201),
      { status: result.duplicate ? 200 : 201 },
    );
  } catch (e) {
    return handleErr(e);
  }
}
