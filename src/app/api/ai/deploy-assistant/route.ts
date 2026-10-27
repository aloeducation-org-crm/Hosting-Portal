import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { apiError, apiSuccess, type ApiResponse } from "@/lib/response";
import { isAdminRole, requireSession, ROLES } from "@/lib/auth";
import { db } from "@/lib/db";
import { AIProviderError } from "@/lib/ai/client";
import { redactProviderForRole, resolveProviders } from "@/lib/ai/providers";
import { recordAIUsage } from "@/lib/ai/usage";
import {
  ONE_CLICK_STACK_PRESETS,
  STACK_PRESET_IDS,
  ZERO_TERMINAL_BENCHMARKS,
  buildBlueprintFromPreset,
  planDeploymentWithAI,
  provisionZeroTerminalProject,
} from "@/lib/ai/deploy-assistant";
import {
  SELF_HOSTED_AGENT_PLATFORMS,
  SizingValidationError,
  USE_CASE_DECISION_MATRIX,
  VRAM_SIZING_PROFILES,
  calculateSelfHostedSizing,
} from "@/lib/ai/self-hosted-agents";

function handleErr(e: unknown, requestId: string): NextResponse {
  if (e && typeof e === "object" && "status" in e && "success" in e) {
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

const presetBodySchema = z.object({
  action: z.literal("preset"),
  stackId: z.enum(STACK_PRESET_IDS),
  projectName: z.string().max(80).optional(),
  workspaceName: z.string().max(80).optional(),
  domain: z.string().max(253).optional(),
  gitRepo: z.string().max(240).optional(),
  tier: z.enum(["starter", "growth", "performance"]).optional(),
});

const planBodySchema = z.object({
  action: z.literal("plan"),
  prompt: z.string().trim().min(5, "Describe the project you want to deploy").max(4000),
});

const sizeBodySchema = z.object({
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

const deployBodySchema = z.object({
  action: z.literal("deploy"),
  blueprint: z.unknown(),
  idempotencyKey: z.string().max(128).optional(),
});

export async function GET(request: NextRequest) {
  const requestId = request.headers.get("x-request-id") || randomUUID();
  try {
    const user = await requireSession(request);
    const resolution = resolveProviders(process.env);
    const isAdmin = isAdminRole(user.role);

    const [workspaces, recentSites] = await Promise.all([
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

    return NextResponse.json(
      apiSuccess({
        requestId,
        aiReady: resolution.providers.length > 0,
        activeProvider: resolution.providers[0]
          ? redactProviderForRole(resolution.providers[0], isAdmin)
          : null,
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
    const rawBody = await request.json().catch(() => ({}));
    const action = typeof rawBody?.action === "string" ? rawBody.action : "";

    if (action === "preset") {
      const input = presetBodySchema.parse(rawBody);
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
      const input = sizeBodySchema.parse(rawBody);
      const estimate = calculateSelfHostedSizing(input);
      return NextResponse.json(apiSuccess({ requestId, estimate }), {
        headers: { "X-Request-Id": requestId },
      });
    }

    if (action === "plan") {
      const input = planBodySchema.parse(rawBody);
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

    if (action === "deploy") {
      if (user.role === ROLES.VIEWER) {
        return NextResponse.json(
          apiError("Viewers cannot provision sites", "FORBIDDEN", undefined, 403),
          { status: 403, headers: { "X-Request-Id": requestId } },
        );
      }
      const input = deployBodySchema.parse(rawBody);
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

    return NextResponse.json(
      apiError(
        'Unsupported action; expected "preset", "plan", "size", or "deploy"',
        "VALIDATION_ERROR",
        undefined,
        400,
      ),
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
