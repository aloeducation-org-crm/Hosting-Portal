import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireSession, requirePermission, isAdminRole } from "@/lib/auth";
import { apiError, apiSuccess, type ApiResponse } from "@/lib/response";
import { rateLimit } from "@/lib/security";
import { redactContainerRecord } from "@/lib/containers/security";
import {
  AGENT_PLATFORM_DECISION_MATRIX,
  SELF_HOSTED_AGENT_CATALOG,
} from "@/lib/ai/self-hosted-agents";
import {
  buildReferenceSizingMatrix,
  evaluateHardwareFit,
  type WeightQuantization,
} from "@/lib/ai/hardware-sizing";
import {
  buildAgentDeploymentPlan,
  executeAgentDeployment,
  inspectLocalHostCapacity,
  uninstallAgentDeployment,
  verifyAgentReadiness,
} from "@/lib/ai/deploy-assistant";

const checkDeployRate = rateLimit({ windowMs: 60_000, maxRequests: 30 });

function handleErr(e: unknown): NextResponse {
  if (e && typeof e === "object" && "status" in e) {
    const a = e as ApiResponse;
    return NextResponse.json(a, { status: a.status });
  }
  return NextResponse.json(apiError("Internal server error"), { status: 500 });
}

function extractHostPort(portMapping: string | null): number | null {
  if (!portMapping) return null;
  const match = portMapping.match(/^(?:127\.0\.0\.1:)?(\d{2,5}):\d{1,5}$/);
  return match ? Number.parseInt(match[1]!, 10) : null;
}

const DeployRequestSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("plan"),
    presetId: z.string().min(1).max(64),
    instanceName: z.string().min(1).max(64),
    websiteId: z.string().max(64).optional().nullable(),
    hostPort: z.number().int().min(1024).max(65535).optional(),
    envOverrides: z.record(z.string(), z.string()).optional(),
    acknowledgeLicenseTerms: z.boolean().optional(),
  }),
  z.object({
    action: z.literal("deploy"),
    presetId: z.string().min(1).max(64),
    instanceName: z.string().min(1).max(64),
    websiteId: z.string().max(64).optional().nullable(),
    hostPort: z.number().int().min(1024).max(65535).optional(),
    envOverrides: z.record(z.string(), z.string()).optional(),
    acknowledgeLicenseTerms: z.boolean().optional(),
  }),
  z.object({
    action: z.literal("uninstall"),
    containerId: z.string().min(1).max(64),
  }),
  z.object({
    action: z.literal("sizing"),
    paramsBillions: z.number().min(0.5).max(1000),
    quantization: z.enum([
      "fp16",
      "bf16",
      "fp8",
      "int8",
      "q6_k",
      "q5_k_m",
      "q4_k_m",
      "awq_4bit",
    ]),
    contextLengthTokens: z.number().int().min(512).max(1_048_576),
    concurrency: z.number().int().min(1).max(512),
    orchestrationRamGb: z.number().min(0).max(256).optional(),
    host: z.object({
      cpuCores: z.number().int().min(1).max(512),
      systemRamGb: z.number().min(1).max(4096),
      gpuCount: z.number().int().min(0).max(64),
      vramPerGpuGb: z.number().min(0).max(256),
      availableDiskGb: z.number().min(1).max(100_000),
    }),
  }),
]);

export async function GET(request: NextRequest) {
  try {
    const user = await requireSession(request);
    const isAdmin = isAdminRole(user.role) || user.role === "DEVOPS";
    const { searchParams } = new URL(request.url);
    const readinessId = searchParams.get("readiness");

    if (readinessId) {
      const container = await db.dockerContainer.findUnique({
        where: { id: readinessId },
        include: { website: { select: { id: true, ownerId: true } } },
      });
      if (!container) {
        return NextResponse.json(apiError("Container not found", undefined, undefined, 404), { status: 404 });
      }
      if (!isAdmin && container.website?.ownerId !== user.id) {
        return NextResponse.json(apiError("Forbidden", undefined, undefined, 403), { status: 403 });
      }
      const hostPort = extractHostPort(container.portMapping);
      const matchedPreset = SELF_HOSTED_AGENT_CATALOG.find(
        (preset) => preset.dockerImage && container.image.startsWith(preset.dockerImage.split(":")[0]!),
      );
      const healthPath = matchedPreset?.healthcheckPath ?? "/";
      if (!hostPort) {
        return NextResponse.json(
          apiSuccess({
            containerId: container.id,
            readiness: {
              state: "UNREACHABLE",
              httpStatus: null,
              latencyMs: 0,
              detail: "No loopback port mapping configured",
            },
          }),
        );
      }
      const readiness = await verifyAgentReadiness(hostPort, healthPath);
      return NextResponse.json(apiSuccess({ containerId: container.id, readiness }));
    }

    const catalogImages = new Set(
      SELF_HOSTED_AGENT_CATALOG.map((p) => p.dockerImage?.split(":")[0]).filter(Boolean),
    );
    const allContainers = await db.dockerContainer.findMany({
      where: isAdmin ? {} : { website: { ownerId: user.id } },
      include: { website: { select: { id: true, name: true, domain: true } } },
      orderBy: { createdAt: "desc" },
    });
    const deployments = allContainers
      .filter((c) => catalogImages.has(c.image.split(":")[0]))
      .map((c) => redactContainerRecord(c));

    const websites = await db.website.findMany({
      where: isAdmin ? {} : { ownerId: user.id },
      select: { id: true, name: true, domain: true },
      orderBy: { createdAt: "asc" },
    });

    return NextResponse.json(
      apiSuccess({
        catalog: SELF_HOSTED_AGENT_CATALOG,
        decisionMatrix: AGENT_PLATFORM_DECISION_MATRIX,
        sizingMatrix: buildReferenceSizingMatrix(),
        hostCapacity: inspectLocalHostCapacity(),
        deployments,
        websites,
      }),
    );
  } catch (e) {
    return handleErr(e);
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireSession(request);
    const isAdmin = isAdminRole(user.role) || user.role === "DEVOPS";

    const rl = checkDeployRate(`ai-deploy:${user.id}`);
    if (!rl.allowed) {
      return NextResponse.json(apiError("Rate limit exceeded", "RATE_LIMIT", undefined, 429), { status: 429 });
    }

    let rawBody: unknown;
    try {
      rawBody = await request.json();
    } catch {
      return NextResponse.json(apiError("Malformed JSON request body", "VALIDATION_ERROR", undefined, 400), {
        status: 400,
      });
    }

    const parsed = DeployRequestSchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json(
        apiError("Validation failed", "VALIDATION_ERROR", parsed.error.issues[0]?.message, 400),
        { status: 400 },
      );
    }

    const payload = parsed.data;

    if (payload.action === "sizing") {
      const evaluation = evaluateHardwareFit(
        {
          paramsBillions: payload.paramsBillions,
          quantization: payload.quantization as WeightQuantization,
          contextLengthTokens: payload.contextLengthTokens,
          concurrency: payload.concurrency,
          orchestrationRamGb: payload.orchestrationRamGb ?? 2,
        },
        payload.host,
      );
      return NextResponse.json(apiSuccess({ evaluation }));
    }

    if (payload.action === "plan") {
      try {
        const { plan } = await buildAgentDeploymentPlan({
          presetId: payload.presetId,
          instanceName: payload.instanceName,
          websiteId: payload.websiteId,
          hostPort: payload.hostPort,
          envOverrides: payload.envOverrides,
          acknowledgeLicenseTerms: payload.acknowledgeLicenseTerms,
        });
        return NextResponse.json(apiSuccess({ plan }));
      } catch (err) {
        return NextResponse.json(
          apiError(err instanceof Error ? err.message : "Invalid preset", "VALIDATION_ERROR", undefined, 400),
          { status: 400 },
        );
      }
    }

    if (payload.action === "deploy") {
      await requirePermission(request, "SERVER_MANAGE");
      const outcome = await executeAgentDeployment(
        {
          presetId: payload.presetId,
          instanceName: payload.instanceName,
          websiteId: payload.websiteId,
          hostPort: payload.hostPort,
          envOverrides: payload.envOverrides,
          acknowledgeLicenseTerms: payload.acknowledgeLicenseTerms,
        },
        {
          userId: user.id,
          userEmail: user.email,
          userRole: user.role,
          isAdmin,
        },
      );
      if (!outcome.ok) {
        return NextResponse.json(
          apiError(outcome.error, "DEPLOY_ERROR", undefined, outcome.status),
          { status: outcome.status },
        );
      }
      return NextResponse.json(apiSuccess(outcome), { status: outcome.idempotent ? 200 : 201 });
    }

    if (payload.action === "uninstall") {
      await requirePermission(request, "SERVER_MANAGE");
      const outcome = await uninstallAgentDeployment(payload.containerId, {
        userId: user.id,
        userEmail: user.email,
        userRole: user.role,
        isAdmin,
      });
      if (!outcome.ok) {
        return NextResponse.json(
          apiError(outcome.error, "UNINSTALL_ERROR", undefined, outcome.status),
          { status: outcome.status },
        );
      }
      return NextResponse.json(apiSuccess(outcome));
    }

    return NextResponse.json(apiError("Unsupported action", "VALIDATION_ERROR", undefined, 400), { status: 400 });
  } catch (e) {
    return handleErr(e);
  }
}
