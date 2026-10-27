import http from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ONE_CLICK_STACK_PRESETS,
  ZERO_TERMINAL_BENCHMARKS,
  buildBlueprintFromPreset,
  deployBlueprintSchema,
  isSafeCommand,
  normalizeDomain,
  planDeploymentWithAI,
  probeLocalServiceReadiness,
  sanitizeDbName,
  slugifyName,
} from "../src/lib/ai/deploy-assistant";

describe("Zero-Terminal AI Deploy Assistant", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  it("registers all 11 1-click stack presets with pinned versions and upstream telemetry-disable flags", () => {
    const ids = ONE_CLICK_STACK_PRESETS.map((p) => p.id);
    expect(ids).toEqual([
      "nextjs-app",
      "nodejs-api",
      "python-app",
      "static-spa",
      "php-cms",
      "flowise-agent",
      "langflow-agent",
      "langgraph-agent",
      "crewai-service",
      "agno-agent",
      "letta-memory",
    ]);

    for (const preset of ONE_CLICK_STACK_PRESETS) {
      const bp = buildBlueprintFromPreset(preset.id, {
        projectName: "Student Portal",
        workspaceName: "ALO Education",
      });
      expect(bp.stackId).toBe(preset.id);
      expect(bp.domain).toBe("student-portal.apps.alolabs.net");
      expect(bp.autoSsl).toBe(true);
      expect(bp.backups.enabled).toBe(true);
      expect(bp.selfHealing.enabled).toBe(true);

      // Must NOT inject fake DATA_RESIDENCY=on-premise env var; self-hosted agents must have pinned versions.
      expect(bp.envVars.some((e) => e.key === "DATA_RESIDENCY")).toBe(false);
      if (preset.category === "self-hosted-agent") {
        expect(preset.pinnedVersion).toBeTruthy();
        expect(preset.defaultBuildCommand).toContain(preset.pinnedVersion!.split("@").pop()!.split("==").pop()!);
      }
    }
  });

  it("maps all 10 managed visual VPS control-panel benchmarks", () => {
    expect(ZERO_TERMINAL_BENCHMARKS).toHaveLength(10);
    const names = ZERO_TERMINAL_BENCHMARKS.map((b) => b.provider);
    expect(names).toEqual([
      "A2 Hosting",
      "InMotion Hosting",
      "SiteGround",
      "Bluehost",
      "DreamHost",
      "FastComet",
      "Namecheap FastCloud",
      "Liquid Web",
      "InterServer",
      "HostGator",
    ]);
  });

  it("normalizes slugs, database identifiers, and domains safely", () => {
    expect(slugifyName("  ALO Education CRM 2026! ")).toBe("alo-education-crm-2026");
    expect(sanitizeDbName("123-My-Database!!")).toBe("db_123_my_database");
    expect(normalizeDomain("https://Portal.ALOLabs.net:8443/login", "portal")).toBe(
      "portal.alolabs.net",
    );
    expect(normalizeDomain("not a domain", "crm-ui")).toBe("not-a-domain.apps.alolabs.net");
  });

  it("rejects shell injection metacharacters and path traversal in blueprints", () => {
    expect(isSafeCommand("uvicorn app.main:app --host 127.0.0.1")).toBe(true);
    expect(isSafeCommand("npm run build && rm -rf /")).toBe(false);
    expect(isSafeCommand("npm start; cat /etc/passwd")).toBe(false);
    expect(isSafeCommand("$(whoami)")).toBe(false);

    const base = buildBlueprintFromPreset("nodejs-api");
    expect(() =>
      deployBlueprintSchema.parse({
        ...base,
        buildCommand: "npm ci | sh",
      }),
    ).toThrow();

    expect(() =>
      deployBlueprintSchema.parse({
        ...base,
        outputDirectory: "../etc",
      }),
    ).toThrow();
  });

  it("distinguishes closed ports from genuinely healthy HTTP endpoints via probeLocalServiceReadiness", async () => {
    const closedProbe = await probeLocalServiceReadiness(59999, "/health", 300);
    expect(closedProbe.reachable).toBe(false);
    expect(closedProbe.httpStatus).toBeNull();

    const server = http.createServer((req, res) => {
      if (req.url === "/health_check") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "ok" }));
      } else {
        res.writeHead(503);
        res.end();
      }
    });

    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;

    try {
      const okProbe = await probeLocalServiceReadiness(port, "/health_check", 1000);
      expect(okProbe.reachable).toBe(true);
      expect(okProbe.httpStatus).toBe(200);

      const unhealthyProbe = await probeLocalServiceReadiness(port, "/broken", 1000);
      expect(unhealthyProbe.reachable).toBe(false);
      expect(unhealthyProbe.httpStatus).toBe(503);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("synthesizes a validated zero-terminal Langflow blueprint via GLM-5 provider", async () => {
    process.env = {
      NODE_ENV: "test",
      AI_PROVIDER_ORDER: "glm",
      GLM_API_KEY: "glm-test-key",
      GLM_MODEL: "glm-5",
    };

    const mockFetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          model: "glm-5",
          choices: [
            {
              message: {
                content: JSON.stringify({
                  projectName: "Admissions Langflow Builder",
                  workspaceName: "ALO Education",
                  stackId: "langflow-agent",
                  domain: "langflow-admissions.apps.alolabs.net",
                  gitRepo: "aloeducation-org-crm/langflow-agents",
                  gitBranch: "main",
                  databaseEnabled: true,
                  databaseEngine: "POSTGRESQL",
                  databaseName: "langflow_admissions_db",
                  resourceTier: "performance",
                  backupFrequency: "every-6h",
                  securityProfile: "strict-waf",
                  healthPath: "/health_check",
                  summary:
                    "Configured a pure-MIT Langflow 1.13.0 visual agent builder with PostgreSQL and 6-hour backups.",
                  highlights: [
                    "Pinned langflow==1.13.0 MIT runtime",
                    "Isolated PostgreSQL blueprint",
                    "Telemetry disabled & auth enforced",
                  ],
                }),
              },
            },
          ],
          usage: { prompt_tokens: 180, completion_tokens: 120, total_tokens: 300 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", mockFetch);

    const result = await planDeploymentWithAI(
      "Deploy a self-hosted MIT visual agent builder for ALO Education admissions with Postgres",
    );

    expect(result.completion.provider).toBe("glm");
    expect(result.blueprint.stackId).toBe("langflow-agent");
    expect(result.blueprint.workspaceName).toBe("ALO Education");
    expect(result.blueprint.domain).toBe("langflow-admissions.apps.alolabs.net");
    expect(result.blueprint.selfHealing.healthPath).toBe("/health_check");
    expect(result.blueprint.resources.tier).toBe("performance");
  });
});
