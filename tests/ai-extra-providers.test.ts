import { describe, it, expect } from "vitest";
import { AI_PROVIDER_CATALOG, resolveProviders } from "../src/lib/ai/providers";

describe("OpenRouter / Qwen provider adapters", () => {
  it("registers both as key-required OpenAI-compatible profiles", () => {
    const openrouter = AI_PROVIDER_CATALOG.find((p) => p.id === "openrouter");
    const qwen = AI_PROVIDER_CATALOG.find((p) => p.id === "qwen");
    expect(openrouter?.baseUrl).toBe("https://openrouter.ai/api/v1");
    expect(openrouter?.requiresKey).toBe(true);
    expect(qwen?.apiKeyEnv).toBe("QWEN_API_KEY");
    expect(qwen?.baseUrlVerified).toBe(false); // region must be confirmed by the operator
  });

  it("resolves both into the failover chain when keys are present", () => {
    const resolution = resolveProviders({
      AI_PROVIDER_ORDER: "openrouter,qwen",
      OPENROUTER_API_KEY: "or-key",
      QWEN_API_KEY: "qwen-key",
      QWEN_BASE_URL: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
    });
    expect(resolution.providers.map((p) => p.id)).toEqual(["openrouter", "qwen"]);
    expect(resolution.providers[0]?.apiKey).toBe("or-key");
    expect(resolution.providers[1]?.apiKey).toBe("qwen-key");
    expect(resolution.warnings.join(" ")).not.toContain("unverified default");
  });

  it("skips them with a clear reason when no key is configured", () => {
    const resolution = resolveProviders({ AI_PROVIDER_ORDER: "openrouter,qwen" });
    expect(resolution.providers).toHaveLength(0);
    expect(resolution.skipped.map((s) => s.id)).toEqual(["openrouter", "qwen"]);
    expect(resolution.skipped[0]?.reason).toContain("OPENROUTER_API_KEY");
  });
});

describe("GLM-5 provider adapter (zai-org/GLM-5)", () => {
  it("registers glm in the catalog with Z.ai/BigModel defaults and ZHIPU_API_KEY fallback", () => {
    const glm = AI_PROVIDER_CATALOG.find((p) => p.id === "glm");
    expect(glm).toBeDefined();
    expect(glm?.defaultModel).toBe("glm-5");
    expect(glm?.apiKeyEnv).toBe("GLM_API_KEY");
    expect(glm?.altApiKeyEnv).toBe("ZHIPU_API_KEY");
    expect(glm?.docs).toBe("https://github.com/zai-org/GLM-5");
    expect(glm?.baseUrlVerified).toBe(false);
  });

  it("resolves glm with GLM_API_KEY and explicit region GLM_BASE_URL without warnings", () => {
    const resolution = resolveProviders({
      AI_PROVIDER_ORDER: "glm",
      GLM_API_KEY: "glm-secret",
      GLM_BASE_URL: "https://api.z.ai/api/paas/v4",
      AI_MODEL_GLM: "glm-5.3",
    });
    expect(resolution.providers).toHaveLength(1);
    expect(resolution.providers[0]).toMatchObject({
      id: "glm",
      tier: "paid",
      baseUrl: "https://api.z.ai/api/paas/v4",
      model: "glm-5.3",
      apiKey: "glm-secret",
      baseUrlVerified: true,
    });
    expect(resolution.warnings).toEqual([]);
  });

  it("accepts ZHIPU_API_KEY as fallback and warns when GLM_BASE_URL is not explicitly confirmed", () => {
    const resolution = resolveProviders({
      AI_PROVIDER_ORDER: "glm",
      ZHIPU_API_KEY: "zhipu-secret",
    });
    expect(resolution.providers).toHaveLength(1);
    expect(resolution.providers[0]?.apiKey).toBe("zhipu-secret");
    expect(resolution.providers[0]?.baseUrlVerified).toBe(false);
    expect(resolution.warnings.join(" ")).toContain("unverified default API host");
  });

  it("supports keyless self-hosted vLLM/SGLang when GLM_BASE_URL points to localhost, even with AI_FREE_ONLY=true", () => {
    const resolution = resolveProviders({
      AI_PROVIDER_ORDER: "glm",
      AI_FREE_ONLY: "true",
      GLM_BASE_URL: "http://127.0.0.1:8000/v1",
      AI_MODEL_GLM: "zai-org/GLM-5.3-Flash",
    });
    expect(resolution.providers).toHaveLength(1);
    expect(resolution.providers[0]).toMatchObject({
      id: "glm",
      tier: "self-hosted",
      kind: "local-openai-compatible",
      baseUrl: "http://127.0.0.1:8000/v1",
      model: "zai-org/GLM-5.3-Flash",
      anonymous: true,
      baseUrlVerified: true,
    });
  });

  it("skips glm with a clear message when neither GLM_API_KEY nor ZHIPU_API_KEY is set", () => {
    const resolution = resolveProviders({ AI_PROVIDER_ORDER: "glm" });
    expect(resolution.providers).toHaveLength(0);
    expect(resolution.skipped[0]?.reason).toContain("GLM_API_KEY (or ZHIPU_API_KEY) not set");
  });
});
