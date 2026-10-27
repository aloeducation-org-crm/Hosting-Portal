import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveProviders } from "@/lib/ai/providers";
import {
  AGENT_PLATFORM_DECISION_MATRIX,
  getAgentPresetById,
  listDeployableAgentPresets,
  SELF_HOSTED_AGENT_CATALOG,
  SelfHostedAgentPresetSchema,
  SELF_HOSTED_AGENT_PLATFORMS,
  SizingValidationError,
  USE_CASE_DECISION_MATRIX,
  VRAM_SIZING_PROFILES,
  calculateSelfHostedSizing,
  recommendSelfHostedHardware,
  validateAgentCatalog,
} from "@/lib/ai/self-hosted-agents";
import {
  buildReferenceSizingMatrix,
  calculateInferenceSizing,
  evaluateHardwareFit,
} from "@/lib/ai/hardware-sizing";
import {
  buildAgentDeploymentPlan,
  uninstallAgentDeployment,
  verifyAgentReadiness,
} from "@/lib/ai/deploy-assistant";
import { db } from "@/lib/db";
import * as helpersModule from "@/lib/helpers";
import * as auditModule from "@/lib/audit";

describe("Self-hosted AI agent catalog & 13-use-case decision matrix", () => {
  it("validates every preset against strict Zod schema and forbids :latest/:main/:master tags", () => {
    expect(SELF_HOSTED_AGENT_CATALOG.length).toBeGreaterThanOrEqual(12);
    for (const preset of SELF_HOSTED_AGENT_CATALOG) {
      expect(() => SelfHostedAgentPresetSchema.parse(preset)).not.toThrow();
      if (preset.dockerImage) {
        expect(preset.dockerImage).not.toMatch(/:(latest|main|master)$/i);
        expect(preset.dockerImage).toContain(":");
      }
      if (preset.defaultHostPort !== null) {
        expect(preset.defaultHostPort).toBeGreaterThanOrEqual(1024);
        expect(preset.defaultHostPort).not.toBe(3000); // Must never collide with Next.js portal on 3000
      }
    }

    // Schema must reject :latest if someone tries to add one later
    const badCandidate = {
      ...SELF_HOSTED_AGENT_CATALOG[0],
      dockerImage: "langflowai/langflow:latest",
    };
    expect(SelfHostedAgentPresetSchema.safeParse(badCandidate).success).toBe(false);
  });

  it("classifies licensing & multi-tenant permissions accurately based on upstream LICENSE audit", () => {
    const langflow = getAgentPresetById("langflow")!;
    expect(langflow.licenseTriage).toBe("License verified for intended use");
    expect(langflow.commercialMultiTenantAllowed).toBe("yes");

    const flowise = getAgentPresetById("flowise")!;
    expect(flowise.enterpriseDirectoryPresent).toBe(true);
    expect(flowise.licenseTriage).toBe("Conditional, requires additional review");

    const openWebui = getAgentPresetById("open-webui")!;
    expect(openWebui.licenseTriage).toBe("Internal use recommended");
    expect(openWebui.auditDecision).toBe("INTERNAL ONLY");

    const dify = getAgentPresetById("dify")!;
    expect(dify.commercialMultiTenantAllowed).toBe("no");
    expect(dify.licenseTriage).toBe("Commercial permission required or potentially required");
    expect(dify.auditDecision).toBe("REJECT");

    const n8n = getAgentPresetById("n8n")!;
    expect(n8n.commercialMultiTenantAllowed).toBe("no");
    expect(n8n.auditDecision).toBe("INTERNAL ONLY");

    const deployableIds = listDeployableAgentPresets().map((p) => p.id);
    expect(deployableIds).toEqual(
      expect.arrayContaining(["langflow", "flowise", "ollama", "localai", "qdrant", "open-webui"]),
    );
    expect(deployableIds).not.toContain("dify");
    expect(deployableIds).not.toContain("n8n");
    expect(deployableIds).not.toContain("openhands");
  });

  it("covers all 13 required architectural use cases in AGENT_PLATFORM_DECISION_MATRIX", () => {
    expect(AGENT_PLATFORM_DECISION_MATRIX).toHaveLength(13);
    const ids = new Set(AGENT_PLATFORM_DECISION_MATRIX.map((r) => r.useCaseId));
    expect(ids.size).toBe(13);
    for (const row of AGENT_PLATFORM_DECISION_MATRIX) {
      expect(row.primaryRecommendation.length).toBeGreaterThan(5);
      expect(row.avoidOrCaution.length).toBeGreaterThan(5);
      expect(row.rationale.length).toBeGreaterThan(10);
    }
  });
});

describe("Hardware & VRAM sizing estimator", () => {
  it("scales KV cache linearly with context length and concurrent users and includes fragmentation reserve", () => {
    const lowCtx = calculateInferenceSizing({
      paramsBillions: 8,
      quantization: "q4_k_m",
      contextLengthTokens: 4_096,
      concurrency: 1,
    });
    const highCtx = calculateInferenceSizing({
      paramsBillions: 8,
      quantization: "q4_k_m",
      contextLengthTokens: 32_768,
      concurrency: 8,
    });

    expect(highCtx.weightsMemoryGb).toBe(lowCtx.weightsMemoryGb);
    expect(highCtx.kvCacheMemoryGb).toBeGreaterThan(lowCtx.kvCacheMemoryGb * 30);
    expect(highCtx.fragmentationReserveGb).toBeGreaterThan(0);
    expect(highCtx.totalInferenceVramGb).toBeGreaterThan(highCtx.subtotalInferenceGb);
  });

  it("rejects 32B/70B models on small VPS or insufficient single-GPU hardware and passes on enterprise GPUs", () => {
    const smallVps = {
      cpuCores: 4,
      systemRamGb: 8,
      gpuCount: 0,
      vramPerGpuGb: 0,
      availableDiskGb: 80,
    };
    const eval70bVps = evaluateHardwareFit(
      {
        paramsBillions: 70,
        quantization: "q4_k_m",
        contextLengthTokens: 16_384,
        concurrency: 4,
      },
      smallVps,
    );
    expect(eval70bVps.verdict).toBe("INSUFFICIENT");
    expect(eval70bVps.executionMode).toBe("blocked");

    const dualA100 = {
      cpuCores: 32,
      systemRamGb: 256,
      gpuCount: 2,
      vramPerGpuGb: 80,
      availableDiskGb: 500,
    };
    const eval70bEnterprise = evaluateHardwareFit(
      {
        paramsBillions: 70,
        quantization: "fp8",
        kvCachePrecision: "fp8_q8",
        contextLengthTokens: 32_768,
        concurrency: 8,
      },
      dualA100,
    );
    expect(eval70bEnterprise.verdict).toBe("FIT");
    expect(eval70bEnterprise.executionMode).toBe("gpu");
  });

  it("marks <=8B quantized GGUF on CPU-only with adequate RAM as TIGHT (cpu-fallback), never FIT", () => {
    const cpuServer = {
      cpuCores: 8,
      systemRamGb: 32,
      gpuCount: 0,
      vramPerGpuGb: 0,
      availableDiskGb: 120,
    };
    const fit = evaluateHardwareFit(
      {
        paramsBillions: 7,
        quantization: "q4_k_m",
        contextLengthTokens: 8_192,
        concurrency: 2,
      },
      cpuServer,
    );
    expect(fit.verdict).toBe("TIGHT");
    expect(fit.executionMode).toBe("cpu-fallback");

    // AWQ 4-bit on CPU-only must be blocked
    const awqOnCpu = evaluateHardwareFit(
      {
        paramsBillions: 7,
        quantization: "awq_4bit",
        contextLengthTokens: 8_192,
        concurrency: 1,
      },
      cpuServer,
    );
    expect(awqOnCpu.verdict).toBe("INSUFFICIENT");
  });

  it("produces monotonically increasing VRAM across the 5 reference sizing profiles", () => {
    const matrix = buildReferenceSizingMatrix();
    expect(matrix).toHaveLength(5);
    for (let i = 1; i < matrix.length; i += 1) {
      expect(matrix[i]!.totalVramGb).toBeGreaterThan(matrix[i - 1]!.totalVramGb);
    }
  });
});

describe("Zero-Terminal Deployment Assistant plan & readiness checks", () => {
  const ampleHost = { cpuCores: 8, totalRamGb: 32, freeRamGb: 20 };

  it("builds a valid loopback-bound plan for Langflow, auto-generates secrets, and masks them in preview", async () => {
    const { plan, resolvedEnv } = await buildAgentDeploymentPlan(
      {
        presetId: "langflow",
        instanceName: "alo-langflow-prod",
        hostPort: 7860,
      },
      { hostOverride: ampleHost, skipDbCollisionCheck: true },
    );

    expect(plan.valid).toBe(true);
    expect(plan.loopbackPortMapping).toBe("127.0.0.1:7860:7860");
    expect(plan.namedVolumeSpec).toBe("alo-agent-alo-langflow-prod:/app/langflow");
    expect(resolvedEnv.LANGFLOW_SUPERUSER_PASSWORD.length).toBeGreaterThanOrEqual(24);
    expect(resolvedEnv.LANGFLOW_SECRET_KEY.length).toBeGreaterThanOrEqual(24);
    // Preview must NEVER contain the raw auto-generated secrets
    expect(plan.redactedEnvPreview.LANGFLOW_SUPERUSER_PASSWORD).toBe("[AUTO-GENERATED-SECRET]");
    expect(plan.redactedEnvPreview.LANGFLOW_SECRET_KEY).toBe("[AUTO-GENERATED-SECRET]");
    expect(JSON.stringify(plan)).not.toContain(resolvedEnv.LANGFLOW_SECRET_KEY);
  });

  it("enforces license acknowledgement for conditional/internal presets and blocks restricted presets", async () => {
    const unackedFlowise = await buildAgentDeploymentPlan(
      {
        presetId: "flowise",
        instanceName: "alo-flowise",
        acknowledgeLicenseTerms: false,
      },
      { hostOverride: ampleHost, skipDbCollisionCheck: true },
    );
    expect(unackedFlowise.plan.valid).toBe(false);
    expect(unackedFlowise.plan.errors.join(" ")).toContain("acknowledgement required");

    const ackedFlowise = await buildAgentDeploymentPlan(
      {
        presetId: "flowise",
        instanceName: "alo-flowise",
        acknowledgeLicenseTerms: true,
      },
      { hostOverride: ampleHost, skipDbCollisionCheck: true },
    );
    expect(ackedFlowise.plan.valid).toBe(true);

    // Dify must remain blocked even if acknowledgeLicenseTerms is true
    const difyAttempt = await buildAgentDeploymentPlan(
      {
        presetId: "dify",
        instanceName: "alo-dify",
        acknowledgeLicenseTerms: true,
      },
      { hostOverride: ampleHost, skipDbCollisionCheck: true },
    );
    expect(difyAttempt.plan.valid).toBe(false);
    expect(difyAttempt.plan.canDirectDeploy).toBe(false);
  });

  it("rewrites 127.0.0.1 / localhost upstream URLs to host.docker.internal for container isolation", async () => {
    const { plan, resolvedEnv } = await buildAgentDeploymentPlan(
      {
        presetId: "open-webui",
        instanceName: "alo-webui",
        acknowledgeLicenseTerms: true,
        envOverrides: {
          OPENAI_API_BASE_URL: "http://127.0.0.1:4000/v1",
        },
      },
      { hostOverride: ampleHost, skipDbCollisionCheck: true },
    );

    expect(plan.valid).toBe(true);
    expect(resolvedEnv.OPENAI_API_BASE_URL).toBe("http://host.docker.internal:4000/v1");
    expect(plan.warnings.some((w) => w.includes("host.docker.internal"))).toBe(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("probes loopback readiness honestly and never reports READY when service is down or 503", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("ECONNREFUSED"));
    const down = await verifyAgentReadiness(7860, "/health_check", 500);
    expect(down.state).toBe("UNREACHABLE");

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("starting", { status: 503 }));
    const booting = await verifyAgentReadiness(7860, "/health_check", 500);
    expect(booting.state).toBe("STARTING");

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response('{"status":"ok"}', { status: 200 }));
    const ready = await verifyAgentReadiness(7860, "/health_check", 500);
    expect(ready.state).toBe("READY");
  });

  it("includes backup, helper-version fallback, volume-integrity check, and non-prod validation in rollbackSteps", async () => {
    const { plan } = await buildAgentDeploymentPlan(
      {
        presetId: "langflow",
        instanceName: "alo-langflow-rb",
      },
      { hostOverride: ampleHost, skipDbCollisionCheck: true },
    );

    const joined = plan.rollbackSteps.join(" ");
    expect(joined).toContain("Back up named volume (alo-agent-alo-langflow-rb)");
    expect(joined).toContain("if supported by the installed helper");
    expect(joined).toContain("docker volume inspect alo-agent-alo-langflow-rb");
    expect(joined).toContain("non-production environment");
  });

  it("falls back to stop + remove when an older helper lacks remove-force and retains DB row on helper failure", async () => {
    vi.spyOn(db.dockerContainer, "findUnique").mockResolvedValue({
      id: "ctr-rb-1",
      name: "alo-langflow-rb",
      image: "langflowai/langflow:1.13.0",
      website: { id: "site-1", ownerId: "user-1" },
    } as never);
    const deleteSpy = vi.spyOn(db.dockerContainer, "delete").mockResolvedValue({} as never);
    vi.spyOn(auditModule, "createAuditLog").mockResolvedValue(undefined as never);

    // 1. Older helper returns Unknown command on remove-force, then succeeds on stop + remove
    const helperSpy = vi
      .spyOn(helpersModule, "callHelper")
      .mockResolvedValueOnce({
        success: false,
        stdout: '{"success":false,"error":"Unknown command"}',
        stderr: "",
        exitCode: 1,
      })
      .mockResolvedValueOnce({ success: true, stdout: '{"success":true}', stderr: "", exitCode: 0 })
      .mockResolvedValueOnce({ success: true, stdout: '{"success":true}', stderr: "", exitCode: 0 });

    const okResult = await uninstallAgentDeployment("ctr-rb-1", {
      userId: "user-1",
      userEmail: "u@example.com",
      userRole: "ADMIN",
      isAdmin: true,
    });

    expect(okResult.ok).toBe(true);
    if (okResult.ok) {
      expect(okResult.removalMethod).toBe("stop-and-remove");
      expect(okResult.expectedVolumeName).toBe("alo-agent-alo-langflow-rb");
    }
    expect(helperSpy).toHaveBeenCalledTimes(3);
    expect(deleteSpy).toHaveBeenCalledTimes(1);

    // 2. Helper fails completely -> must NOT delete DB row or orphan running container
    helperSpy.mockReset();
    deleteSpy.mockClear();
    helperSpy.mockResolvedValueOnce({
      success: false,
      stdout: "",
      stderr: "permission denied",
      exitCode: 1,
    });

    const failResult = await uninstallAgentDeployment("ctr-rb-1", {
      userId: "user-1",
      userEmail: "u@example.com",
      userRole: "ADMIN",
      isAdmin: true,
    });

    expect(failResult.ok).toBe(false);
    if (!failResult.ok) {
      expect(failResult.status).toBe(502);
    }
    expect(deleteSpy).not.toHaveBeenCalled();
  });
});


// ─── Extended 26-Platform Catalog & Parameterized VRAM Sizer Suite ───────────

describe("Revalidated Self-Hosted AI Agent Catalog, Decision Matrix & VRAM Sizer", () => {
  it("resolves LocalAI when LOCALAI_BASE_URL is configured and skips it by default when unset", () => {
    const defaultRes = resolveProviders({ AI_ALLOW_ANONYMOUS: "true" });
    expect(defaultRes.providers.some((p) => p.id === "localai")).toBe(false);
    expect(defaultRes.skipped.some((s) => s.id === "localai")).toBe(true);

    const enabledRes = resolveProviders({
      LOCALAI_BASE_URL: "http://127.0.0.1:8080/v1",
      AI_MODEL_LOCALAI: "qwen2.5-7b-instruct:q4_k_m",
      AI_PROVIDER_ORDER: "localai",
    });
    expect(enabledRes.providers).toHaveLength(1);
    expect(enabledRes.providers[0]).toMatchObject({
      id: "localai",
      tier: "self-hosted",
      kind: "local-openai-compatible",
      baseUrl: "http://127.0.0.1:8080/v1",
      model: "qwen2.5-7b-instruct:q4_k_m",
      anonymous: true,
    });
  });

  it("validates every catalog entry against agentPlatformMetadataSchema and enforces primary-source license triage", () => {
    const validation = validateAgentCatalog();
    expect(validation.valid).toBe(true);
    expect(validation.count).toBeGreaterThanOrEqual(22);

    const byId = new Map(SELF_HOSTED_AGENT_PLATFORMS.map((p) => [p.id, p]));

    // Corrected license & maintenance findings from primary-source GitHub audit
    expect(byId.get("flowise")?.commercialMultiTenantSafe).toBe(false);
    expect(byId.get("flowise")?.licenseTriage).toBe("Conditional, requires additional review");
    expect(byId.get("flowise")?.licenseGuardrail).toContain("enterprise");

    expect(byId.get("langflow")?.spdxId).toBe("MIT");
    expect(byId.get("langflow")?.commercialMultiTenantSafe).toBe(true);
    expect(byId.get("langflow")?.decision).toBe("ADD");

    expect(byId.get("agno")?.spdxId).toBe("Apache-2.0");
    expect(byId.get("agno")?.commercialMultiTenantSafe).toBe(true);
    expect(byId.get("agno")?.decision).toBe("ADD");

    expect(byId.get("librechat")?.spdxId).toBe("MIT");
    expect(byId.get("librechat")?.commercialMultiTenantSafe).toBe(true);

    expect(byId.get("rivet")?.spdxId).toBe("MIT");
    expect(byId.get("superagi")?.maintenanceStatus).toBe("unmaintained");
    expect(byId.get("superagi")?.decision).toBe("REJECT");
    expect(byId.get("drevon")?.decision).toBe("REJECT");

    expect(byId.get("open-webui")?.decision).toBe("INTERNAL_ONLY");
    expect(byId.get("open-webui")?.licenseGuardrail).toContain("50");

    expect(byId.get("dify")?.decision).toBe("INTERNAL_ONLY");
    expect(byId.get("n8n")?.decision).toBe("INTERNAL_ONLY");
    expect(byId.get("openhands")?.decision).toBe("INTERNAL_ONLY");
    expect(byId.get("skyvern")?.decision).toBe("REJECT");
    expect(byId.get("skyvern")?.spdxId).toBe("AGPL-3.0");
  });

  it("covers all 13 strategic use cases in USE_CASE_DECISION_MATRIX", () => {
    expect(USE_CASE_DECISION_MATRIX).toHaveLength(13);
    for (const row of USE_CASE_DECISION_MATRIX) {
      expect(row.primaryRecommendation.length).toBeGreaterThan(5);
      expect(row.backupOption.length).toBeGreaterThan(3);
      expect(row.licenseNotes.length).toBeGreaterThan(5);
    }
  });

  it("calculates realistic hardware & VRAM ranges across context, concurrency, embeddings, and rejects invalid inputs", () => {
    const apiOnly = calculateSelfHostedSizing({ parameterBillions: 0, concurrentRequests: 4 });
    expect(apiOnly.mode).toBe("orchestration-only");
    expect(apiOnly.inferenceNode.estimatedMaxVramGb).toBe(0);
    expect(apiOnly.orchestrationNode.recommendedRamGb).toBeGreaterThanOrEqual(8);

    const small7b = calculateSelfHostedSizing({
      parameterBillions: 7,
      quantization: "q4_k_m",
      contextTokens: 8192,
      concurrentRequests: 2,
    });
    expect(small7b.isEstimate).toBe(true);
    expect(small7b.inferenceNode.estimatedMinVramGb).toBeGreaterThanOrEqual(6);
    expect(small7b.inferenceNode.estimatedMaxVramGb).toBeLessThanOrEqual(14);

    const long70b = calculateSelfHostedSizing({
      parameterBillions: 70,
      quantization: "q4_k_m",
      contextTokens: 65536,
      concurrentRequests: 8,
      includeEmbeddings: true,
      includeReranker: true,
      includeBrowserSandbox: true,
    });
    expect(long70b.inferenceNode.kvCacheVramGb).toBeGreaterThan(small7b.inferenceNode.kvCacheVramGb);
    expect(long70b.inferenceNode.auxiliaryModelsVramGb).toBeGreaterThan(2);
    expect(long70b.warnings.some((w) => w.includes("vLLM"))).toBe(true);
    expect(long70b.warnings.some((w) => w.includes("Squid SSRF"))).toBe(true);

    // Boundary rejections
    expect(() => calculateSelfHostedSizing({ parameterBillions: -1 })).toThrow(SizingValidationError);
    expect(() => calculateSelfHostedSizing({ parameterBillions: 7, contextTokens: 128 })).toThrow(
      SizingValidationError,
    );
    expect(() => calculateSelfHostedSizing({ parameterBillions: 7, concurrentRequests: 0 })).toThrow(
      SizingValidationError,
    );

    expect(VRAM_SIZING_PROFILES).toHaveLength(8);
    expect(recommendSelfHostedHardware("api-gateway-only").minVramGb).toBe(0);
    expect(recommendSelfHostedHardware("70b-q4-16k").minVramGb).toBeGreaterThanOrEqual(48);
  });
});
