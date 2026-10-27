import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import {
  isBlockedMetadataOrWildcardHost,
  isPrivateOrInternalUrl,
  normalizeBaseUrl,
  redactProvider,
  redactSecretsInText,
  resolveProviders,
} from "@/lib/ai/providers";
import {
  AIProviderError,
  completeWithAI,
  getProviderCircuitStates,
  resetProviderHealth,
} from "@/lib/ai/client";
import { findUnsafeProductionSecrets, isUnsafeDefaultSecret } from "@/lib/env";
import { resolveMiddlewareJwtSecret } from "@/middleware";
import {
  normalizeSafePortMapping,
  redactContainerRecord,
  validateContainerImage,
  validateContainerName,
  validateEnvVarMap,
} from "@/lib/containers/security";
import { createScopedHostingTools } from "@/lib/ai/automation/tools";
import { db } from "@/lib/db";

describe("AI provider registry additions, SSRF metadata guards & topology redaction", () => {
  it("keeps localai and glm opt-in by default and activates them cleanly when configured", () => {
    const fresh = resolveProviders({});
    expect(fresh.providers.map((p) => p.id)).toEqual(["llm7"]);

    const withLocalAi = resolveProviders({
      LOCALAI_BASE_URL: "http://127.0.0.1:18080/v1",
      LOCALAI_API_KEY: "sk-localai-test",
      AI_ALLOW_ANONYMOUS: "false",
    });
    expect(withLocalAi.providers.map((p) => p.id)).toEqual(["localai"]);
    expect(withLocalAi.providers[0]!.tier).toBe("self-hosted");

    const withGlm = resolveProviders({
      AI_PROVIDER_ORDER: "glm,llm7",
      GLM_API_KEY: "glm-secret-key",
      GLM_BASE_URL: "https://open.bigmodel.cn/api/paas/v4",
    });
    expect(withGlm.providers[0]!.id).toBe("glm");
    expect(withGlm.warnings).toHaveLength(0);
  });

  it("blocks cloud metadata, link-local, and wildcard addresses in normalizeBaseUrl()", () => {
    expect(normalizeBaseUrl("http://169.254.169.254/latest/meta-data")).toBeNull();
    expect(normalizeBaseUrl("http://100.100.100.200/latest/meta-data")).toBeNull();
    expect(normalizeBaseUrl("http://metadata.google.internal/computeMetadata/v1")).toBeNull();
    expect(normalizeBaseUrl("http://0.0.0.0:8080/v1")).toBeNull();
    expect(normalizeBaseUrl("http://[::]:8080/v1")).toBeNull();
    expect(normalizeBaseUrl("http://[fd00:ec2::254]/latest")).toBeNull();
    expect(isBlockedMetadataOrWildcardHost("169.254.170.2")).toBe(true);

    // Operator loopback endpoints remain valid for server-side env config
    expect(normalizeBaseUrl("http://127.0.0.1:11434/v1")).toBe("http://127.0.0.1:11434/v1");
  });

  it("identifies RFC1918, loopback, CGNAT, and internal URLs accurately and masks topology for non-admins", () => {
    expect(isPrivateOrInternalUrl("http://127.0.0.1:4000/v1")).toBe(true);
    expect(isPrivateOrInternalUrl("http://10.0.1.5:8000/v1")).toBe(true);
    expect(isPrivateOrInternalUrl("http://172.18.0.4:8080/v1")).toBe(true);
    expect(isPrivateOrInternalUrl("http://192.168.1.50:11434/v1")).toBe(true);
    expect(isPrivateOrInternalUrl("http://100.80.1.2:4000/v1")).toBe(true);
    expect(isPrivateOrInternalUrl("https://api.openai.com/v1")).toBe(false);

    const resolved = resolveProviders({ AI_GATEWAY_URL: "http://127.0.0.1:4000/v1" });
    const gw = resolved.providers.find((p) => p.id === "gateway")!;
    expect(redactProvider(gw).baseUrl).toBe("http://127.0.0.1:4000/v1");
    expect(redactProvider(gw, { includeTopology: false }).baseUrl).toBe("internal-endpoint (redacted)");
  });

  it("scrubs bearer tokens, sk-/gsk- API keys, and URL credentials from log strings", () => {
    const dirty =
      "Upstream failed with Authorization: Bearer sk-live-1234567890abcdef and key gsk-abcdef1234567890 at https://user:pass123@example.com/v1";
    const clean = redactSecretsInText(dirty);
    expect(clean).not.toContain("sk-live-1234567890abcdef");
    expect(clean).not.toContain("gsk-abcdef1234567890");
    expect(clean).not.toContain("pass123");
    expect(clean).toContain("[REDACTED]");
  });
});

describe("AI client hardening: redirect blocking, capability bounds, requestId & circuit snapshots", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    resetProviderHealth();
    vi.restoreAllMocks();
  });

  it("passes redirect:'error', clamps max_tokens to provider capability, and propagates requestId", async () => {
    process.env = {
      ...originalEnv,
      AI_PROVIDER_ORDER: "llm7",
    };

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          model: "gpt-oss:20b",
          choices: [{ message: { content: "verified" } }],
          usage: { prompt_tokens: 10, completion_tokens: 4, total_tokens: 14 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    const completion = await completeWithAI(
      [{ role: "user", content: "ping" }],
      { maxTokens: 99_999, requestId: "req-test-42" },
    );

    expect(completion.requestId).toBe("req-test-42");
    expect(completion.usageReportedByProvider).toBe(true);

    const [, init] = fetchSpy.mock.calls[0]!;
    expect(init?.redirect).toBe("error");
    const sentBody = JSON.parse(String(init?.body)) as { max_tokens: number };
    // llm7 maxOutputTokens is 4096 — must be clamped!
    expect(sentBody.max_tokens).toBe(4096);
  });

  it("rejects prompts that grossly exceed the provider context window before sending network traffic", async () => {
    process.env = {
      ...originalEnv,
      LOCALAI_BASE_URL: "http://127.0.0.1:18080/v1",
      AI_PROVIDER_ORDER: "localai",
    };
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const hugePrompt = "x".repeat(16_384 * 4 * 2); // ~32K tokens against 16K context window

    await expect(
      completeWithAI([{ role: "user", content: hugePrompt }]),
    ).rejects.toMatchObject({
      code: "AI_CONTEXT_EXCEEDED",
      status: 413,
    } satisfies Partial<AIProviderError>);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("reports circuit breaker state accurately without network I/O", () => {
    const resolved = resolveProviders({});
    const states = getProviderCircuitStates(resolved.providers);
    expect(states).toHaveLength(1);
    expect(states[0]).toEqual({
      provider: "llm7",
      circuitOpen: false,
      consecutiveFailures: 0,
      cooldownRemainingMs: 0,
    });
  });
});

describe("Secret hardening, container security validators & workflow tenant isolation", () => {
  it("detects unsafe fallback secrets and fails middleware JWT secret closed in production", () => {
    expect(isUnsafeDefaultSecret("")).toBe(true);
    expect(isUnsafeDefaultSecret("dev-secret-change-in-production")).toBe(true);
    expect(isUnsafeDefaultSecret("generate-with-openssl-rand-hex-32")).toBe(true);
    expect(isUnsafeDefaultSecret("a9f4c8e21b7d0365f1a8c4e9b2d7053184ef92a1c6b3d8047e5f1a2b3c4d5e6f")).toBe(false);

    expect(
      findUnsafeProductionSecrets({
        NEXTAUTH_SECRET: "dev-secret-change-in-production",
        JWT_SECRET: "dev-jwt-secret-change-in-production",
        APP_ENCRYPTION_KEY: "",
        INTERNAL_SECRET: "alo-internal-secret-change-me",
      }),
    ).toEqual(["NEXTAUTH_SECRET", "JWT_SECRET", "APP_ENCRYPTION_KEY", "INTERNAL_SECRET"]);

    expect(
      resolveMiddlewareJwtSecret({
        NODE_ENV: "production",
        NEXTAUTH_SECRET: "dev-secret-change-in-production",
      }),
    ).toBeNull();

    expect(
      resolveMiddlewareJwtSecret({
        NODE_ENV: "development",
        NEXTAUTH_SECRET: undefined,
      }),
    ).not.toBeNull();
  });

  it("enforces pinned images, loopback ports >=1024, safe env keys, and envVars redaction on containers", () => {
    expect(validateContainerName("alo-agent-1")).toBe("alo-agent-1");
    expect(() => validateContainerName("-flag-inject")).toThrow();
    expect(() => validateContainerName("bad;rm -rf")).toThrow();

    expect(validateContainerImage("langflowai/langflow:1.13.0", { requireExplicitTag: true })).toBe(
      "langflowai/langflow:1.13.0",
    );
    expect(() => validateContainerImage("langflowai/langflow:latest", { requireExplicitTag: true })).toThrow(
      /pinned version tag/,
    );
    expect(() => validateContainerImage("ubuntu", { requireExplicitTag: true })).toThrow(/pinned version tag/);
    expect(() => validateContainerImage("--privileged")).toThrow();

    expect(normalizeSafePortMapping("7860:7860")).toBe("127.0.0.1:7860:7860");
    expect(() => normalizeSafePortMapping("0.0.0.0:7860:7860")).toThrow(/loopback/);
    expect(() => normalizeSafePortMapping("80:8080")).toThrow(/1024/);

    expect(() => validateEnvVarMap({ LD_PRELOAD: "/tmp/evil.so" })).toThrow(/restricted/);
    expect(validateEnvVarMap({ LANGFLOW_AUTO_LOGIN: "false" })).toEqual({ LANGFLOW_AUTO_LOGIN: "false" });

    const redacted = redactContainerRecord({
      id: "ctr-1",
      name: "alo-langflow",
      envVars: JSON.stringify({ LANGFLOW_SECRET_KEY: "super-secret-value", PORT: "7860" }),
    });
    expect(redacted.envVars).toEqual({
      LANGFLOW_SECRET_KEY: "[REDACTED]",
      PORT: "[REDACTED]",
    });
    expect(redacted.envVarKeys).toEqual(["LANGFLOW_SECRET_KEY", "PORT"]);
    expect(JSON.stringify(redacted)).not.toContain("super-secret-value");
  });

  it("scopes AI workflow tools strictly to the acting tenant and fails closed when userId is missing", async () => {
    const unauthenticatedTools = createScopedHostingTools({ userId: undefined, isAdmin: false });
    await expect(unauthenticatedTools.listSites({})).rejects.toThrow(/Tenant context/);

    const findManySpy = vi.spyOn(db.website, "findMany").mockResolvedValueOnce([] as never);
    const tenantTools = createScopedHostingTools({ userId: "tenant-user-99", isAdmin: false });
    await tenantTools.listSites({});
    expect(findManySpy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ ownerId: "tenant-user-99" }),
      }),
    );
    findManySpy.mockRestore();
  });

  it("rejects unauthenticated access on hardened agent & container API routes", async () => {
    const runsRoute = await import("@/app/api/agents/runs/route");
    const runsRes = await runsRoute.GET(new NextRequest("http://localhost:3000/api/agents/runs"));
    expect(runsRes.status).toBe(401);

    const seedRoute = await import("@/app/api/agents/seed/route");
    const seedRes = await seedRoute.POST(
      new NextRequest("http://localhost:3000/api/agents/seed", { method: "POST" }),
    );
    expect(seedRes.status).toBe(401);

    const tokenRoute = await import("@/app/api/ai/token/route");
    const tokenRes = await tokenRoute.GET(new NextRequest("http://localhost:3000/api/ai/token"));
    expect(tokenRes.status).toBe(401);

    const deployRoute = await import("@/app/api/ai/deploy-assistant/route");
    const deployRes = await deployRoute.GET(new NextRequest("http://localhost:3000/api/ai/deploy-assistant"));
    expect(deployRes.status).toBe(401);
  });
});
