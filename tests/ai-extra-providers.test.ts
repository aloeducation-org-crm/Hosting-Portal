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
