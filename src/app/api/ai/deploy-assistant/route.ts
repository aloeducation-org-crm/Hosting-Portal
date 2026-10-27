import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireSession, requirePermission, isAdminRole, ROLES } from "@/lib/auth";
import { apiError, apiSuccess, type ApiResponse } from "@/lib/response";
import { rateLimit } from "@/lib/security";
import { redactContainerRecord } from "@/lib/containers/security";
import { AIProviderError } from "@/lib/ai/client";
import { redactProviderForRole, resolveProviders } from "@/lib/ai/providers";
import { recordAIUsage } from "@/lib/ai/usage";
import {
  AGENT_PLATFORM_DECISION_MATRIX,
  SELF_HOSTED_AGENT_CATALOG,
  SELF_HOSTED_AGENT_PLATFORMS,
  SizingValidationError,
  USE_CASE_DECISION_MATRIX,
  VRAM_SIZING_PROFILES,
  calculateSelfHostedSizing,
} from "@/lib/ai/self-hosted-agents";
import {
  buildReferenceSizingMatrix,
  evaluateHardwareFit,
  type WeightQuantization,
} from "@/lib/ai/hardware-sizing";
import {
  ONE_CLICK_STACK_PRESETS,
  STACK_PRESET_IDS,
  ZERO_TERMINAL_BENCHMARKS,
  buildAgentDeploymentPlan,
  buildBlueprintFromPreset,
  executeAgentDeployment,
  inspectLocalHostCapacity,
  planDeploymentWithAI,
  provisionZeroTerminalProject,
  uninstallAgentDeployment,
  verifyAgentReadiness,
} from "@/lib/ai/deploy-assistant";

const checkDeployRate = rateLimit({ windowMs: 60_000, maxRequests: 30 });

function handleErr(e: unknown, requestId: string): NextResponse {
  if (e && typeof e === "object" && "status" in e && "success" in e) {
    const a = e as ApiResponse;
    return NextResponse.json(a, { status: a.status, headers: { "X-Request-Id": requestId } });
  }
  if (e && typeof e === "object" && "status" in e) {
    const a = e as ApiResponse;
    return NextResponse.json(a, { status: a.status, headers: { "X-Request-Id": requestId } });
  }
  if (e instanceof SizingValidationError) {
    return NextResponse.json(
      apiError(e.message, "VALIDATION_ERROR", undefined, 400),
      { status: 400, headers: { "X-Request-Id": requestId } },
    );
  }
  if (e instanceof z.ZodError) {
    return NextResponse.json(
      apiError("Validation failed", "VALIDATION_ERROR", e.flatten(), 400),
      { status: 400, headers: { "X-Request-Id": requestId } },
    );
  }
  if (e instanceof Error && "status" in e) {
    const status = Number((e as Error & { status?: number }).status) || 400;
    const code = String((e as Error & { code?: string }).code || "REQUEST_ERROR");
    return NextResponse.json(apiError(e.message, code, undefined, status), {
      status,
      headers: { "X-Request-Id": requestId },
    });
  }
  return NextResponse.json(apiError("Internal server error"), {
    status: 500,
    headers: { "X-Request-Id": requestId },
  });
}

function extractHostPort(portMapping: string | null): number | null {
  if (!portMapping) return null;
  const match = portMapping.match(/^(?:127\.0\.0\.1:)?(\d{2,5}):\d{1,5}$/);
  return match ? Number.parseInt(match[1]!, 10) : null;
}

const ContainerPlanSchema = z.object({
  action: z.literal("plan"),
  presetId: z.string().min(1).max(64),
  instanceName: z.string().min(1).max(64),
  websiteId: z.string().max(64).optional().nullable(),
  hostPort: z.number().int().min(1024).max(65535).optional(),
  envOverrides: z.record(z.string(), z.string()).optional(),
  acknowledgeLicenseTerms: z.boolean().optional(),
});

const ContainerDeploySchema = z.object({
  action: z.literal("deploy"),
  presetId: z.string().min(1).max(64),
  instanceName: z.string().min(1).max(64),
  websiteId: z.string().max(64).optional().nullable(),
  hostPort: z.number().int().min(1024).max(65535).optional(),
  envOverrides: z.record(z.string(), z.string()).optional(),
  acknowledgeLicenseTerms: z.boolean().optional(),
});

const ContainerUninstallSchema = z.object({
  action: z.literal("uninstall"),
  containerId: z.string().min(1).max(64),
});

const ContainerSizingSchema = z.object({
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
});

const StackPresetSchema = z.object({
  action: z.literal("preset"),
  stackId: z.enum(STACK_PRESET_IDS),
  projectName: z.string().max(80).optional(),
  workspaceName: z.string().max(80).optional(),
  domain: z.string().max(253).optional(),
  gitRepo: z.string().max(240).optional(),
  tier: z.enum(["starter", "growth", "performance"]).optional(),
});

const BlueprintPlanSchema = z.object({
  action: z.literal("plan"),
  prompt: z.string().trim().min(5, "Describe the project you want to deploy").max(4000),
});

const BlueprintSizeSchema = z.object({
  action: z.literal("size"),
  parameterBillions: z.number(),
  quantization: z.enum(["fp16", "q8", "q6", "q4_k_m", "int4"]).optional(),
  contextTokens: z.number().optional(),
  concurrentRequests: z.number().int().optional(),
  includeEmbeddings: z.boolean().optional(),
  includeReranker: z.boolean().optional(),
  includeBrowserSandbox: z.boolean().optional(),
  safetyMarginPct: z.number().optional(),
});

const BlueprintDeploySchema = z.object({
  action: z.literal("deploy"),
  blueprint: z.unknown(),
  idempotencyKey: z.string().max(128).optional(),
});

export async function GET(request: NextRequest) {
  const requestId = request.headers.get("x-request-id") || randomUUID();
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
        return NextResponse.json(apiError("Container not found", undefined, undefined, 404), {
          status: 404,
          headers: { "X-Request-Id": requestId },
        });
      }
      if (!isAdmin && container.website?.ownerId !== user.id) {
        return NextResponse.json(apiError("Forbidden", undefined, undefined, 403), {
          status: 403,
          headers: { "X-Request-Id": requestId },
        });
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
          { headers: { "X-Request-Id": requestId } },
        );
      }
      const readiness = await verifyAgentReadiness(hostPort, healthPath);
      return NextResponse.json(apiSuccess({ containerId: container.id, readiness }), {
        headers: { "X-Request-Id": requestId },
      });
    }

    const resolution = resolveProviders(process.env);
    const catalogImages = new Set(
      SELF_HOSTED_AGENT_CATALOG.map((p) => p.dockerImage?.split(":")[0]).filter(Boolean),
    );

    const [allContainers, websites, workspaces, recentSites] = await Promise.all([
      db.dockerContainer.findMany({
        where: isAdmin ? {} : { website: { ownerId: user.id } },
        include: { website: { select: { id: true, name: true, domain: true } } },
        orderBy: { createdAt: "desc" },
      }),
      db.website.findMany({
        where: isAdmin ? {} : { ownerId: user.id },
        select: { id: true, name: true, domain: true },
        orderBy: { createdAt: "asc" },
      }),
      db.organization.findMany({
        where: isAdmin ? {} : { ownerId: user.id },
        orderBy: { createdAt: "desc" },
        take: 20,
        select: { id: true, name: true, slug: true },
      }),
      db.website.findMany({
        where: {
          deletedAt: null,
          ...(isAdmin ? {} : { ownerId: user.id }),
        },
        orderBy: { createdAt: "desc" },
        take: 6,
        select: {
          id: true,
          name: true,
          domain: true,
          runtime: true,
          status: true,
          applicationPort: true,
          documentRoot: true,
          healthStatus: true,
          createdAt: true,
          organization: { select: { name: true, slug: true } },
          domains: { select: { domain: true, sslEnabled: true, sslStatus: true } },
          applications: { select: { id: true, name: true, type: true, runtime: true } },
          cronJobs: { select: { id: true, name: true, schedule: true, isActive: true } },
        },
      }),
    ]);

    const deployments = allContainers
      .filter((c) => catalogImages.has(c.image.split(":")[0]))
      .map((c) => redactContainerRecord(c));

    return NextResponse.json(
      apiSuccess({
        requestId,
        aiReady: resolution.providers.length > 0,
        activeProvider: resolution.providers[0]
          ? redactProviderForRole(resolution.providers[0], isAdmin)
          : null,
        catalog: SELF_HOSTED_AGENT_CATALOG,
        decisionMatrix: AGENT_PLATFORM_DECISION_MATRIX,
        sizingMatrix: buildReferenceSizingMatrix(),
        hostCapacity: inspectLocalHostCapacity(),
        deployments,
        websites,
        presets: ONE_CLICK_STACK_PRESETS,
        benchmarks: ZERO_TERMINAL_BENCHMARKS,
        selfHostedAgents: SELF_HOSTED_AGENT_PLATFORMS,
        useCaseMatrix: USE_CASE_DECISION_MATRIX,
        hardwareProfiles: VRAM_SIZING_PROFILES,
        workspaces,
        recentSites,
      }),
      { headers: { "X-Request-Id": requestId } },
    );
  } catch (e) {
    return handleErr(e, requestId);
  }
}

export async function POST(request: NextRequest) {
  const requestId = request.headers.get("x-request-id") || randomUUID();
  try {
    const user = await requireSession(request);
    const isAdmin = isAdminRole(user.role) || user.role === "DEVOPS";

    const rl = checkDeployRate(`ai-deploy:${user.id}`);
    if (!rl.allowed) {
      return NextResponse.json(apiError("Rate limit exceeded", "RATE_LIMIT", undefined, 429), {
        status: 429,
        headers: { "X-Request-Id": requestId },
      });
    }

    let rawBody: Record<string, unknown>;
    try {
      const parsedJson = await request.json();
      if (!parsedJson || typeof parsedJson !== "object" || Array.isArray(parsedJson)) {
        return NextResponse.json(apiError("Validation failed", "VALIDATION_ERROR", undefined, 400), {
          status: 400,
          headers: { "X-Request-Id": requestId },
        });
      }
      rawBody = parsedJson as Record<string, unknown>;
    } catch {
      return NextResponse.json(apiError("Malformed JSON request body", "VALIDATION_ERROR", undefined, 400), {
        status: 400,
        headers: { "X-Request-Id": requestId },
      });
    }

    const action = typeof rawBody.action === "string" ? rawBody.action : "";

    // ── Zero-Terminal Stack Preset Blueprint Actions ──────────────────────────
    if (action === "preset") {
      const input = StackPresetSchema.parse(rawBody);
      const blueprint = buildBlueprintFromPreset(input.stackId, {
        projectName: input.projectName,
        workspaceName: input.workspaceName,
        domain: input.domain,
        gitRepo: input.gitRepo,
        tier: input.tier,
      });
      return NextResponse.json(
        apiSuccess({
          requestId,
          source: "preset",
          summary: `Loaded 1-click visual configuration for ${blueprint.projectName} (${blueprint.stackId}).`,
          highlights: [
            `Isolated workspace path: /srv/alo-sites/${blueprint.workspaceName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}/${blueprint.domain}`,
            blueprint.autoSsl ? "Automatic Edge / Let's Encrypt SSL blueprint enabled" : "SSL disabled",
            blueprint.database.enabled
              ? `Zero-code ${blueprint.database.engine} database blueprint (${blueprint.database.name})`
              : "Stateless / static edge stack (no database needed)",
            `Automated ${blueprint.backups.frequency} backups & real HTTP readiness probe`,
          ],
          blueprint,
        }),
        { headers: { "X-Request-Id": requestId } },
      );
    }

    if (action === "size") {
      const input = BlueprintSizeSchema.parse(rawBody);
      const estimate = calculateSelfHostedSizing(input);
      return NextResponse.json(apiSuccess({ requestId, estimate }), {
        headers: { "X-Request-Id": requestId },
      });
    }

    // ── Hardware Sizing Evaluation (Self-Hosted Agent Catalog) ────────────────
    if (action === "sizing") {
      const payload = ContainerSizingSchema.parse(rawBody);
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
      return NextResponse.json(apiSuccess({ evaluation }), {
        headers: { "X-Request-Id": requestId },
      });
    }

    // ── Plan: Container Preset vs Natural-Language Blueprint ──────────────────
    if (action === "plan") {
      if ("prompt" in rawBody && typeof rawBody.prompt === "string") {
        const input = BlueprintPlanSchema.parse(rawBody);
        const planned = await planDeploymentWithAI(input.prompt, request.signal);
        await recordAIUsage({
          userId: user.id,
          model: planned.completion.model,
          promptTokens: planned.completion.usage.promptTokens,
          completionTokens: planned.completion.usage.completionTokens,
          totalTokens: planned.completion.tokensUsed,
          requestId,
        });
        return NextResponse.json(
          apiSuccess({
            requestId,
            source: "ai",
            provider: planned.completion.provider,
            providerLabel: planned.completion.providerLabel,
            model: planned.completion.model,
            tokensUsed: planned.completion.tokensUsed,
            latencyMs: planned.completion.latencyMs,
            summary: planned.summary,
            highlights: planned.highlights,
            blueprint: planned.blueprint,
          }),
          { headers: { "X-Request-Id": requestId } },
        );
      }

      const parsed = ContainerPlanSchema.safeParse(rawBody);
      if (!parsed.success) {
        return NextResponse.json(
          apiError("Validation failed", "VALIDATION_ERROR", parsed.error.issues[0]?.message, 400),
          { status: 400, headers: { "X-Request-Id": requestId } },
        );
      }
      try {
        const { plan } = await buildAgentDeploymentPlan({
          presetId: parsed.data.presetId,
          instanceName: parsed.data.instanceName,
          websiteId: parsed.data.websiteId,
          hostPort: parsed.data.hostPort,
          envOverrides: parsed.data.envOverrides,
          acknowledgeLicenseTerms: parsed.data.acknowledgeLicenseTerms,
        });
        return NextResponse.json(apiSuccess({ plan }), {
          headers: { "X-Request-Id": requestId },
        });
      } catch (err) {
        return NextResponse.json(
          apiError(err instanceof Error ? err.message : "Invalid preset", "VALIDATION_ERROR", undefined, 400),
          { status: 400, headers: { "X-Request-Id": requestId } },
        );
      }
    }

    // ── Deploy: Container Preset vs Zero-Terminal Website Blueprint ───────────
    if (action === "deploy") {
      if ("blueprint" in rawBody) {
        if (user.role === ROLES.VIEWER) {
          return NextResponse.json(
            apiError("Viewers cannot provision sites", "FORBIDDEN", undefined, 403),
            { status: 403, headers: { "X-Request-Id": requestId } },
          );
        }
        const input = BlueprintDeploySchema.parse(rawBody);
        const ip = request.headers.get("x-forwarded-for") ?? request.headers.get("x-real-ip");
        const headerIdem = request.headers.get("idempotency-key");
        const provisioned = await provisionZeroTerminalProject(input.blueprint, user, {
          ipAddress: ip,
          idempotencyKey: input.idempotencyKey ?? headerIdem ?? null,
        });
        return NextResponse.json(
          apiSuccess(
            { requestId, ...provisioned },
            `Persisted zero-terminal blueprint for ${provisioned.website.domain}`,
            provisioned.idempotentReplay ? 200 : 201,
          ),
          {
            status: provisioned.idempotentReplay ? 200 : 201,
            headers: { "X-Request-Id": requestId },
          },
        );
      }

      const parsed = ContainerDeploySchema.safeParse(rawBody);
      if (!parsed.success) {
        return NextResponse.json(
          apiError("Validation failed", "VALIDATION_ERROR", parsed.error.issues[0]?.message, 400),
          { status: 400, headers: { "X-Request-Id": requestId } },
        );
      }
      await requirePermission(request, "SERVER_MANAGE");
      const outcome = await executeAgentDeployment(
        {
          presetId: parsed.data.presetId,
          instanceName: parsed.data.instanceName,
          websiteId: parsed.data.websiteId,
          hostPort: parsed.data.hostPort,
          envOverrides: parsed.data.envOverrides,
          acknowledgeLicenseTerms: parsed.data.acknowledgeLicenseTerms,
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
          { status: outcome.status, headers: { "X-Request-Id": requestId } },
        );
      }
      return NextResponse.json(apiSuccess(outcome), {
        status: outcome.idempotent ? 200 : 201,
        headers: { "X-Request-Id": requestId },
      });
    }

    // ── Uninstall Container Deployment ────────────────────────────────────────
    if (action === "uninstall") {
      const parsed = ContainerUninstallSchema.safeParse(rawBody);
      if (!parsed.success) {
        return NextResponse.json(
          apiError("Validation failed", "VALIDATION_ERROR", parsed.error.issues[0]?.message, 400),
          { status: 400, headers: { "X-Request-Id": requestId } },
        );
      }
      await requirePermission(request, "SERVER_MANAGE");
      const outcome = await uninstallAgentDeployment(parsed.data.containerId, {
        userId: user.id,
        userEmail: user.email,
        userRole: user.role,
        isAdmin,
      });
      if (!outcome.ok) {
        return NextResponse.json(
          apiError(outcome.error, "UNINSTALL_ERROR", undefined, outcome.status),
          { status: outcome.status, headers: { "X-Request-Id": requestId } },
        );
      }
      return NextResponse.json(apiSuccess(outcome), {
        headers: { "X-Request-Id": requestId },
      });
    }

    return NextResponse.json(
      apiError("Unsupported action", "VALIDATION_ERROR", undefined, 400),
      { status: 400, headers: { "X-Request-Id": requestId } },
    );
  } catch (e) {
    if (e instanceof AIProviderError) {
      return NextResponse.json(
        {
          success: false,
          requestId,
          message: e.message,
          error: { code: e.code, message: e.message, attempts: e.attempts },
        },
        { status: e.status, headers: { "X-Request-Id": requestId } },
      );
    }
    return handleErr(e, requestId);
  }
}
