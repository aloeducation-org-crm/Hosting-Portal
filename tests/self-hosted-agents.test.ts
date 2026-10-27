import { describe, expect, it } from "vitest";
import { resolveProviders } from "../src/lib/ai/providers";
import {
  SELF_HOSTED_AGENT_PLATFORMS,
  SizingValidationError,
  USE_CASE_DECISION_MATRIX,
  VRAM_SIZING_PROFILES,
  calculateSelfHostedSizing,
  recommendSelfHostedHardware,
  validateAgentCatalog,
} from "../src/lib/ai/self-hosted-agents";

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
