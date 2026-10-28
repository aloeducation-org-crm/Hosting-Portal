import { completeWithAI } from "@/lib/ai/client";
import { validateDeployConfig } from "@/lib/deploy/config";
import { detectFramework, memoryReader } from "@/lib/deploy/detect";
import {
  ALO_SERVER_SPEC,
  allocateNextAvailablePort,
  generateCloudflareAndCliChecklist,
  generateNginxSiteConfig,
  generateShareableProjectBriefYaml,
} from "@/lib/deploy/server-spec";
import type { DeployConfig, ServiceManager, WorkloadCategory } from "@/lib/deploy/types";

export type HostWebsiteRuntime = "STATIC" | "PHP82" | "NODE" | "NEXTJS";

export interface AutoDeployBlueprint {
  id: string;
  name: string;
  workloadCategory: WorkloadCategory;
  framework: string;
  runtime: string;
  websiteRuntime: HostWebsiteRuntime;
  summary: string;
  serviceManager: ServiceManager;
  defaultPort: number;
  healthPath: string;
  installCmd: string | null;
  buildCmd: string | null;
  startCmd: string | null;
  outputDir: string;
  defaultEnvKeys: Array<{ key: string; secret: boolean; autoGenerate: boolean; description: string }>;
  highlights: string[];
}

export interface AutoDeployArchitectureInput {
  prompt?: string;
  blueprintId?: string;
  appName?: string;
  domain?: string;
  repository?: string;
  branch?: string;
  manifestFiles?: Record<string, string>;
  usedPorts?: Iterable<number>;
}

export interface AutoDeployArchitecturePlan {
  appName: string;
  domain: string;
  repository: string | null;
  branch: string;
  workloadCategory: WorkloadCategory;
  framework: string;
  runtime: string;
  websiteRuntime: HostWebsiteRuntime;
  allocatedPort: number;
  deployConfig: DeployConfig;
  requiredEnvKeys: Array<{ key: string; secret: boolean; autoGenerate: boolean; description: string }>;
  sslAutoIssue: boolean;
  autoDeployOnPush: boolean;
  aiEnhanced: boolean;
  aiProviderUsed: string | null;
  aiSummary: string;
  shareableBriefYaml: string;
  nginxConfig: string;
  cloudflareDnsRecord: {
    type: "A";
    name: string;
    content: string;
    proxied: boolean;
  };
  cliDeployCommand: string;
  verificationCommands: string[];
  steps: string[];
  warnings: string[];
}

export const AUTO_DEPLOY_BLUEPRINTS: readonly AutoDeployBlueprint[] = [
  // ── Web Applications ───────────────────────────────────────────────────────
  {
    id: "nextjs-fullstack",
    name: "Next.js 16 Full-Stack Web App",
    workloadCategory: "web",
    framework: "nextjs",
    runtime: "node",
    websiteRuntime: "NEXTJS",
    summary: "Standalone App Router web platform with PM2 zero-downtime reload, /api/health probe, and automatic HTTPS.",
    serviceManager: "pm2",
    defaultPort: 3100,
    healthPath: "/api/health",
    installCmd: "npm ci",
    buildCmd: "npm run build",
    startCmd: "node .next/standalone/server.js",
    outputDir: ".next/standalone",
    defaultEnvKeys: [
      { key: "NODE_ENV", secret: false, autoGenerate: false, description: "Production runtime mode" },
      { key: "NEXTAUTH_SECRET", secret: true, autoGenerate: true, description: "CSPRNG session signing secret" },
      { key: "DATABASE_URL", secret: true, autoGenerate: false, description: "SQLite or managed database URL" },
    ],
    highlights: ["Zero-terminal Git push deploy", "Atomic symlink rollback", "Auto Let's Encrypt TLS"],
  },
  {
    id: "vite-react-spa",
    name: "React / Vite / Astro Static & Edge Web App",
    workloadCategory: "web",
    framework: "vite",
    runtime: "static",
    websiteRuntime: "STATIC",
    summary: "High-speed static/SPA bundle built automatically on push and served directly by Caddy/Nginx with Brotli/Gzip.",
    serviceManager: "static",
    defaultPort: 8080,
    healthPath: "/",
    installCmd: "npm ci",
    buildCmd: "npm run build",
    startCmd: null,
    outputDir: "dist",
    defaultEnvKeys: [
      { key: "VITE_API_BASE_URL", secret: false, autoGenerate: false, description: "Public API endpoint" },
    ],
    highlights: ["Instant CDN-grade static serving", "SPA fallback routing", "Zero server memory overhead"],
  },
  {
    id: "laravel-web",
    name: "Laravel / PHP 8.2 Web Application",
    workloadCategory: "web",
    framework: "laravel",
    runtime: "php",
    websiteRuntime: "PHP82",
    summary: "Composer-managed Laravel/PHP web portal behind PHP-FPM 8.2 and Caddy with isolated site user.",
    serviceManager: "systemd",
    defaultPort: 8000,
    healthPath: "/",
    installCmd: "composer install --no-dev --optimize-autoloader",
    buildCmd: null,
    startCmd: null,
    outputDir: ".",
    defaultEnvKeys: [
      { key: "APP_ENV", secret: false, autoGenerate: false, description: "Laravel environment (production)" },
      { key: "APP_KEY", secret: true, autoGenerate: true, description: "Encrypted application key" },
    ],
    highlights: ["PHP 8.2 FPM pool isolation", "Zero-shell Composer install", "Automated vhost + SSL"],
  },

  // ── Server-Side Applications ───────────────────────────────────────────────
  {
    id: "nodejs-api-server",
    name: "Node.js / NestJS / Express API Server",
    workloadCategory: "server",
    framework: "nestjs",
    runtime: "node",
    websiteRuntime: "NODE",
    summary: "Managed backend REST/GraphQL/WebSocket service with PM2 process supervision, health checks, and secret vault.",
    serviceManager: "pm2",
    defaultPort: 4100,
    healthPath: "/api/health",
    installCmd: "npm ci",
    buildCmd: "npm run build",
    startCmd: "node dist/main.js",
    outputDir: "dist",
    defaultEnvKeys: [
      { key: "NODE_ENV", secret: false, autoGenerate: false, description: "Production runtime mode" },
      { key: "JWT_SECRET", secret: true, autoGenerate: true, description: "API token signing secret" },
      { key: "INTERNAL_WEBHOOK_SECRET", secret: true, autoGenerate: true, description: "Internal service webhook secret" },
    ],
    highlights: ["PM2 cluster/reload supervision", "Loopback reverse proxy", "Automatic crash recovery"],
  },
  {
    id: "python-fastapi-ai",
    name: "Python FastAPI / AI Automation Server",
    workloadCategory: "server",
    framework: "fastapi",
    runtime: "python3",
    websiteRuntime: "NODE",
    summary: "ASGI Python microservice or AI agent backend connected to LiteLLM/UnoRouter/Ollama with health monitoring.",
    serviceManager: "pm2",
    defaultPort: 8010,
    healthPath: "/health",
    installCmd: "python3 -m pip install -r requirements.txt",
    buildCmd: null,
    startCmd: "python3 -m uvicorn app.main:app --host 127.0.0.1 --port 8010",
    outputDir: ".",
    defaultEnvKeys: [
      { key: "AI_GATEWAY_URL", secret: false, autoGenerate: false, description: "OpenAI-compatible AI router URL" },
      { key: "API_SECRET_KEY", secret: true, autoGenerate: true, description: "Service authentication secret" },
    ],
    highlights: ["ASGI Uvicorn loopback worker", "Native AI provider gateway wiring", "Zero-terminal log streaming"],
  },
  {
    id: "go-microservice",
    name: "Go High-Throughput Backend Service",
    workloadCategory: "server",
    framework: "go-http",
    runtime: "go",
    websiteRuntime: "NODE",
    summary: "Compiled Go server binary managed via systemd with sub-millisecond reverse-proxy routing and health probes.",
    serviceManager: "systemd",
    defaultPort: 8090,
    healthPath: "/healthz",
    installCmd: "go mod download",
    buildCmd: "go build -o bin/server .",
    startCmd: null,
    outputDir: ".",
    defaultEnvKeys: [
      { key: "PORT", secret: false, autoGenerate: false, description: "Loopback HTTP port" },
      { key: "SERVICE_HMAC_SECRET", secret: true, autoGenerate: true, description: "HMAC verification secret" },
    ],
    highlights: ["Single static Go binary", "Systemd sandboxing", "Atomic release cutover"],
  },

  // ── Mobile Applications ────────────────────────────────────────────────────
  {
    id: "expo-mobile-ota",
    name: "Expo / React Native Mobile App (Web + OTA Hub)",
    workloadCategory: "mobile",
    framework: "expo",
    runtime: "node",
    websiteRuntime: "STATIC",
    summary: "Exports universal React Native Web + Expo OTA update bundles (`dist/`) with HTTPS manifest hosting.",
    serviceManager: "static",
    defaultPort: 8080,
    healthPath: "/",
    installCmd: "npm ci",
    buildCmd: "npx expo export --platform all",
    startCmd: null,
    outputDir: "dist",
    defaultEnvKeys: [
      { key: "EXPO_PUBLIC_API_URL", secret: false, autoGenerate: false, description: "Backend API URL consumed by mobile app" },
    ],
    highlights: ["iOS/Android OTA bundle hosting", "Universal Expo Web PWA", "Instant rollback on bad mobile bundle"],
  },
  {
    id: "flutter-cross-platform",
    name: "Flutter Mobile & Web Release Portal",
    workloadCategory: "mobile",
    framework: "flutter",
    runtime: "flutter",
    websiteRuntime: "STATIC",
    summary: "Compiles Flutter Web (`build/web`) & hosts mobile release artifacts with PWA service-worker caching.",
    serviceManager: "static",
    defaultPort: 8080,
    healthPath: "/",
    installCmd: "flutter pub get",
    buildCmd: "flutter build web --release",
    startCmd: null,
    outputDir: "build/web",
    defaultEnvKeys: [
      { key: "API_BASE_URL", secret: false, autoGenerate: false, description: "Mobile backend endpoint" },
    ],
    highlights: ["CanvasKit/Wasm release bundle", "PWA + APK distribution ready", "Automatic SSL & domain binding"],
  },
  {
    id: "ionic-capacitor-hybrid",
    name: "Ionic / Capacitor Hybrid Mobile App",
    workloadCategory: "mobile",
    framework: "ionic-capacitor",
    runtime: "node",
    websiteRuntime: "STATIC",
    summary: "Builds Capacitor/Ionic hybrid mobile bundle for live web deployment and native iOS/Android WebView sync.",
    serviceManager: "static",
    defaultPort: 8080,
    healthPath: "/",
    installCmd: "npm ci",
    buildCmd: "npm run build",
    startCmd: null,
    outputDir: "dist",
    defaultEnvKeys: [
      { key: "CAPACITOR_LIVE_URL", secret: false, autoGenerate: false, description: "Live update web bundle URL" },
    ],
    highlights: ["Capacitor live-reload compatible", "Shared mobile + web codebase", "Zero-terminal CI build"],
  },
] as const;

function sanitizeSlug(raw: string): string {
  const cleaned = raw
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return cleaned || "alo-app";
}

function inferBlueprintFromPrompt(prompt: string): AutoDeployBlueprint {
  const text = prompt.toLowerCase();

  // Mobile keywords (English + Bengali)
  if (/flutter|ফ্লাটার|dart|apk/.test(text)) {
    return AUTO_DEPLOY_BLUEPRINTS.find((b) => b.id === "flutter-cross-platform")!;
  }
  if (/ionic|capacitor|ক্যাপাসিটর|hybrid mobile/.test(text)) {
    return AUTO_DEPLOY_BLUEPRINTS.find((b) => b.id === "ionic-capacitor-hybrid")!;
  }
  if (/expo|react\s*native|মোবাইল|mobile|ios|android|ota/.test(text)) {
    return AUTO_DEPLOY_BLUEPRINTS.find((b) => b.id === "expo-mobile-ota")!;
  }

  // Server keywords (English + Bengali)
  if (/fastapi|uvicorn|django|flask|python|পাইথন|ai server|mcp/.test(text)) {
    return AUTO_DEPLOY_BLUEPRINTS.find((b) => b.id === "python-fastapi-ai")!;
  }
  if (/\bgolang\b|\bgo\s+api\b|\bgo\s+server\b|microservice/.test(text)) {
    return AUTO_DEPLOY_BLUEPRINTS.find((b) => b.id === "go-microservice")!;
  }
  if (/nestjs|express|fastify|hono|backend|api\s*server|সার্ভার|ব্যাকএন্ড|এপিআই/.test(text)) {
    return AUTO_DEPLOY_BLUEPRINTS.find((b) => b.id === "nodejs-api-server")!;
  }

  // Web keywords (English + Bengali)
  if (/laravel|php|লারাভেল|পিএইচপি/.test(text)) {
    return AUTO_DEPLOY_BLUEPRINTS.find((b) => b.id === "laravel-web")!;
  }
  if (/vite|astro|spa|static|landing/.test(text)) {
    return AUTO_DEPLOY_BLUEPRINTS.find((b) => b.id === "vite-react-spa")!;
  }

  return AUTO_DEPLOY_BLUEPRINTS.find((b) => b.id === "nextjs-fullstack")!;
}

function mapFrameworkToWebsiteRuntime(framework: string, runtime: string): HostWebsiteRuntime {
  if (framework === "nextjs") return "NEXTJS";
  if (runtime === "php" || framework === "laravel" || framework === "php-composer") return "PHP82";
  if (
    runtime === "static" ||
    framework === "vite" ||
    framework === "astro" ||
    framework === "create-react-app" ||
    framework === "static-html" ||
    framework === "expo" ||
    framework === "flutter" ||
    framework === "capacitor" ||
    framework === "ionic-capacitor"
  ) {
    return "STATIC";
  }
  return "NODE";
}

export async function architectAutoDeployPlan(
  input: AutoDeployArchitectureInput,
): Promise<AutoDeployArchitecturePlan> {
  const explicitBlueprint = input.blueprintId
    ? AUTO_DEPLOY_BLUEPRINTS.find((b) => b.id === input.blueprintId)
    : undefined;
  const fallbackBlueprint = explicitBlueprint ?? inferBlueprintFromPrompt(input.prompt ?? "");

  const derivedSlug = sanitizeSlug(
    input.appName ||
      input.repository?.split("/")[1] ||
      fallbackBlueprint.id,
  );
  const safeServiceName = `alo-${derivedSlug}`;
  const rawDomain = input.domain?.trim().toLowerCase();
  const normalizedDomain =
    rawDomain && rawDomain !== ALO_SERVER_SPEC.controlPlane.domain
      ? rawDomain
      : `${derivedSlug}.${ALO_SERVER_SPEC.baseDomain}`;
  const normalizedBranch = input.branch?.trim() || "main";
  const normalizedRepo =
    input.repository && /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(input.repository.trim())
      ? input.repository.trim()
      : null;

  let workloadCategory: WorkloadCategory = fallbackBlueprint.workloadCategory;
  let framework = fallbackBlueprint.framework;
  let runtime = fallbackBlueprint.runtime;
  let websiteRuntime: HostWebsiteRuntime = fallbackBlueprint.websiteRuntime;
  let serviceManager: ServiceManager = fallbackBlueprint.serviceManager;
  let installCmd = fallbackBlueprint.installCmd;
  let lintCmd: string | null = null;
  let typecheckCmd: string | null = null;
  let testCmd: string | null = null;
  let buildCmd = fallbackBlueprint.buildCmd;
  let startCmd = fallbackBlueprint.startCmd;
  let outputDir = fallbackBlueprint.outputDir;
  let port = allocateNextAvailablePort(input.usedPorts ?? []);
  let healthPath = fallbackBlueprint.healthPath;
  const warnings: string[] = [];
  const envKeySet = new Map<string, { key: string; secret: boolean; autoGenerate: boolean; description: string }>(
    fallbackBlueprint.defaultEnvKeys.map((item) => [item.key, item]),
  );

  // If operator pasted real manifest files (package.json, pubspec.yaml, etc.), run deterministic detector first!
  if (input.manifestFiles && Object.keys(input.manifestFiles).length > 0) {
    const detected = await detectFramework(memoryReader(input.manifestFiles));
    if (detected.framework !== "unknown") {
      workloadCategory = detected.workloadCategory ?? workloadCategory;
      framework = detected.framework;
      runtime = detected.runtime;
      websiteRuntime = mapFrameworkToWebsiteRuntime(detected.framework, detected.runtime);
      serviceManager = websiteRuntime === "STATIC" ? "static" : "pm2";
      installCmd = detected.installCmd;
      lintCmd = detected.lintCmd;
      typecheckCmd = detected.typecheckCmd;
      testCmd = detected.testCmd;
      buildCmd = detected.buildCmd;
      startCmd = detected.startCmd;
      outputDir = detected.outputDir;
      port = allocateNextAvailablePort(input.usedPorts ?? []);
      healthPath = detected.healthPath;
      warnings.push(...detected.warnings);
      for (const envName of detected.envNames) {
        if (!envKeySet.has(envName)) {
          const isSecret = /(SECRET|KEY|TOKEN|PASSWORD|DATABASE_URL)/i.test(envName);
          envKeySet.set(envName, {
            key: envName,
            secret: isSecret,
            autoGenerate: /(SECRET|WEBHOOK)/i.test(envName),
            description: `Detected from repository manifest (${envName})`,
          });
        }
      }
    }
  }

  if (startCmd && startCmd.includes("--port 8010")) {
    startCmd = startCmd.replace("--port 8010", `--port ${port}`);
  }

  const deployConfig = validateDeployConfig({
    version: 1,
    installCmd,
    lintCmd,
    typecheckCmd,
    testCmd,
    buildCmd,
    startCmd,
    outputDir,
    envNames: [...envKeySet.keys()],
    port,
    healthPath,
    serviceManager,
    ...(serviceManager === "pm2" || serviceManager === "systemd" ? { serviceName: safeServiceName } : {}),
    requiresApproval: false,
    source: "operator",
  });

  // Optional non-blocking AI architectural summary via configured AI provider chain
  let aiEnhanced = false;
  let aiProviderUsed: string | null = null;
  let aiSummary =
    `Configured zero-terminal ${workloadCategory.toUpperCase()} pipeline for ${derivedSlug} (${framework} on ${runtime}): ` +
    `${installCmd ? `install via "${installCmd}", ` : ""}${buildCmd ? `build via "${buildCmd}" -> "${outputDir}", ` : ""}` +
    `managed by ${serviceManager} with automatic HTTPS on ${normalizedDomain} and health verification at ${healthPath}.`;

  if (input.prompt && input.prompt.trim().length > 8 && process.env.NODE_ENV !== "test") {
    try {
      const completion = await Promise.race([
        completeWithAI(
          [
            {
              role: "system",
              content:
                "You are the ALO Hosting Panel AI Deployment Architect. Write a concise 2-sentence operational summary (matching the user's language, Bengali or English) explaining how this app will be built, secured with SSL, health-checked, and auto-deployed from the dashboard without manual SSH. Never invent secrets or credentials.",
            },
            {
              role: "user",
              content: `User goal: ${input.prompt.trim()}\nSelected stack: category=${workloadCategory}, framework=${framework}, runtime=${runtime}, domain=${normalizedDomain}, build=${buildCmd ?? "none"}, output=${outputDir}, serviceManager=${serviceManager}, healthPath=${healthPath}`,
            },
          ],
          {
            maxTokens: 220,
            temperature: 0.3,
          },
        ),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error("AI summary timeout")), 4500)),
      ]);
      if (completion?.text?.trim()) {
        aiSummary = completion.text.trim();
        aiEnhanced = true;
        aiProviderUsed = completion.provider;
      }
    } catch {
      // Deterministic blueprint remains 100% functional when external AI providers are unreachable or unconfigured.
    }
  }

  const steps = [
    `1. Provision isolated tenant workspace on ${ALO_SERVER_SPEC.hostName} (${ALO_SERVER_SPEC.publicIp}) & allocate port ${port}`,
    `2. Encrypt & inject ${envKeySet.size} environment variable(s) (CSPRNG auto-generation for secret keys)`,
    normalizedRepo
      ? `3. Bind GitHub repository (${normalizedRepo}@${normalizedBranch}) with HMAC-SHA256 push webhook auto-deploy`
      : `3. Register zero-terminal release target (${workloadCategory.toUpperCase()} / ${framework}) ready for Git or one-click deploy`,
    `4. Execute allowlisted argv build pipeline (${[installCmd, buildCmd].filter(Boolean).join(" -> ") || "direct release staging"})`,
  ];

  if (framework === "nextjs") {
    // A standalone bundle boots without these and then 404s every asset, so the
    // staging step is part of the contract rather than an optimization.
    steps.push(
      `5. Stage .next/static and public into the standalone bundle, then supervise \`${startCmd}\` as argv ` +
        `(never \`| tee\` or another shell pipeline - the supervisor must own the process it restarts)`,
    );
  }

  steps.push(
    `${steps.length + 1}. Configure Nginx reverse proxy (${normalizedDomain} -> 127.0.0.1:${port}) + PM2 supervision & verify HTTP 200 on ${healthPath}`,
  );

  const shareableBriefYaml = generateShareableProjectBriefYaml({
    projectName: input.appName?.trim() || derivedSlug,
    appSlug: derivedSlug,
    domain: normalizedDomain,
    port,
    workloadCategory,
    framework,
    runtime,
  });

  const nginxConfig = generateNginxSiteConfig({
    domain: normalizedDomain,
    port,
    sslMode: "cloudflare-http80",
  });

  const checklist = generateCloudflareAndCliChecklist({
    appSlug: derivedSlug,
    domain: normalizedDomain,
    port,
  });

  return {
    appName: derivedSlug,
    domain: normalizedDomain,
    repository: normalizedRepo,
    branch: normalizedBranch,
    workloadCategory,
    framework,
    runtime,
    websiteRuntime,
    allocatedPort: port,
    deployConfig,
    requiredEnvKeys: [...envKeySet.values()],
    sslAutoIssue: true,
    autoDeployOnPush: true,
    aiEnhanced,
    aiProviderUsed,
    aiSummary,
    shareableBriefYaml,
    nginxConfig,
    cloudflareDnsRecord: checklist.dnsRecord,
    cliDeployCommand: checklist.cliCommand,
    verificationCommands: checklist.verificationCommands,
    steps,
    warnings,
  };
}
