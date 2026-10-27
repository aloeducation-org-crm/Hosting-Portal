import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireSession, isAdminRole } from "@/lib/auth";
import { apiError, apiSuccess, type ApiResponse } from "@/lib/response";
import { createAuditLog } from "@/lib/audit";
import { encryptSecret } from "@/lib/encryption";
import { redactProvider, resolveProviders } from "@/lib/ai/providers";
import { SELF_HOSTED_AGENT_CATALOG } from "@/lib/ai/self-hosted-agents";
import { HOSTING_TOOLS } from "@/lib/ai/automation/tools";
import { ensureDefaultAgentsSeeded } from "@/lib/seed-agents";
import { validateDeployConfig } from "@/lib/deploy/config";
import {
  ALO_SERVER_SPEC,
  allocateNextAvailablePort,
  assertTenantPortAllowed,
  generateCloudflareAndCliChecklist,
  generateNginxSiteConfig,
  generateShareableProjectBriefYaml,
  type PortRegistryEntry,
} from "@/lib/deploy/server-spec";
import { evaluateUbuntuCisBaseline } from "@/lib/security/ubuntu-cis-baseline";
import {
  AUTO_DEPLOY_BLUEPRINTS,
  architectAutoDeployPlan,
} from "@/lib/ai/auto-deploy-blueprint";

const SAFE_DOMAIN_REGEX =
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?))+$/i;

const AutoDeployActionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("architect"),
    prompt: z.string().max(4000).optional(),
    blueprintId: z.string().max(64).optional(),
    appName: z.string().max(64).optional(),
    domain: z.string().max(253).optional(),
    repository: z.string().max(200).optional(),
    branch: z.string().max(120).optional(),
    manifestFiles: z.record(z.string(), z.string().max(100_000)).optional(),
  }),
  z.object({
    action: z.literal("provision"),
    appName: z.string().min(2).max(64),
    domain: z.string().min(4).max(253),
    repository: z.string().max(200).optional().nullable(),
    branch: z.string().min(1).max(120).default("main"),
    workloadCategory: z.enum(["web", "server", "mobile"]),
    framework: z.string().min(1).max(64),
    runtime: z.string().min(1).max(64),
    websiteRuntime: z.enum(["STATIC", "PHP82", "NODE", "NEXTJS"]),
    deployConfig: z.unknown(),
    envVars: z.record(z.string(), z.string().max(4096)).optional(),
    autoGenerateSecretsFor: z.array(z.string().regex(/^[A-Z_][A-Z0-9_]*$/)).max(50).optional(),
    autoDeployOnPush: z.boolean().default(true),
    sslAutoIssue: z.boolean().default(true),
  }),
]);

function handleErr(e: unknown): NextResponse {
  if (e instanceof z.ZodError) {
    return NextResponse.json(
      apiError("Validation failed", "VALIDATION_ERROR", e.flatten(), 400),
      { status: 400 },
    );
  }
  if (e && typeof e === "object" && "status" in e) {
    const a = e as ApiResponse;
    return NextResponse.json(a, { status: a.status });
  }
  if (e instanceof Error && e.name === "UnsafeCommandError") {
    return NextResponse.json(
      apiError(e.message, "UNSAFE_DEPLOY_CONFIG", undefined, 400),
      { status: 400 },
    );
  }
  return NextResponse.json(apiError("Internal server error"), { status: 500 });
}

async function collectUsedPortsSafe(): Promise<number[]> {
  try {
    const [sitePorts, gitPorts, serverPorts] = await Promise.all([
      db.website.findMany({
        where: { deletedAt: null, applicationPort: { not: null } },
        select: { applicationPort: true },
      }),
      db.gitProject.findMany({
        select: { port: true },
      }),
      db.serverPort.findMany({
        select: { port: true },
      }),
    ]);
    const ports: number[] = [];
    for (const s of sitePorts) {
      if (typeof s.applicationPort === "number") ports.push(s.applicationPort);
    }
    for (const g of gitPorts) {
      if (typeof g.port === "number") ports.push(g.port);
    }
    for (const sp of serverPorts) {
      if (typeof sp.port === "number") ports.push(sp.port);
    }
    return ports;
  } catch {
    return [];
  }
}

export async function GET(request: NextRequest) {
  try {
    const user = await requireSession(request);
    const isAdmin = isAdminRole(user.role);

    const providerResolution = resolveProviders();
    const redactedChain = providerResolution.providers.map((p) =>
      redactProvider(p, { includeTopology: isAdmin }),
    );
    const cisBaseline = evaluateUbuntuCisBaseline();

    const ownerFilter = isAdmin ? {} : { ownerId: user.id };

    const initialAgentCount = await db.aiAgent.count();
    if (initialAgentCount === 0) {
      await ensureDefaultAgentsSeeded();
    }

    const [
      websites,
      gitProjects,
      agentCount,
      workflowCount,
      pendingOpsCount,
    ] = await Promise.all([
      db.website.findMany({
        where: { deletedAt: null, ...ownerFilter },
        orderBy: { createdAt: "desc" },
        take: 50,
        include: {
          domains: {
            select: { id: true, domain: true, primary: true, sslEnabled: true, sslStatus: true },
          },
          applications: {
            select: { id: true, name: true, type: true, status: true, runtime: true, config: true },
          },
          deployments: {
            take: 1,
            orderBy: { createdAt: "desc" },
            select: {
              id: true,
              status: true,
              stage: true,
              branch: true,
              commitHash: true,
              trigger: true,
              createdAt: true,
            },
          },
        },
      }),
      db.gitProject.findMany({
        where: isAdmin ? {} : { createdById: user.id },
        orderBy: { createdAt: "desc" },
        take: 50,
        select: {
          id: true,
          websiteId: true,
          repository: true,
          productionBranch: true,
          autoDeploy: true,
          serviceManager: true,
          detectionStatus: true,
          lastDeployStatus: true,
          port: true,
          healthPath: true,
        },
      }),
      db.aiAgent.count(),
      db.aiWorkflow.count({ where: isAdmin ? {} : { userId: user.id } }),
      db.operationJob.count({
        where: {
          status: "PENDING",
          ...(isAdmin ? {} : { website: { ownerId: user.id } }),
        },
      }),
    ]);

    const gitByWebsiteId = new Map(gitProjects.map((gp) => [gp.websiteId, gp]));

    const managedProjects = websites.map((site) => {
      const app = site.applications[0] ?? null;
      const appCfg =
        app?.config && typeof app.config === "object" && !Array.isArray(app.config)
          ? (app.config as Record<string, unknown>)
          : {};
      const gitProject = gitByWebsiteId.get(site.id) ?? null;
      return {
        websiteId: site.id,
        name: site.name || site.domain,
        domain: site.domain,
        status: site.status,
        websiteRuntime: site.runtime,
        workloadCategory:
          (typeof appCfg.workloadCategory === "string" ? appCfg.workloadCategory : null) ??
          (app?.type === "mobile" ? "mobile" : app?.type === "api" ? "server" : "web"),
        framework: typeof appCfg.framework === "string" ? appCfg.framework : site.runtime.toLowerCase(),
        port: site.applicationPort,
        healthPath: site.healthPath || "/",
        sslEnabled: site.domains.some((d) => d.sslEnabled),
        gitProject,
        latestDeployment: site.deployments[0] ?? null,
        createdAt: site.createdAt,
      };
    });

    const usedPorts = await collectUsedPortsSafe();
    const nextAvailablePort = allocateNextAvailablePort(usedPorts);
    const portRegistry: PortRegistryEntry[] = [
      {
        domain: ALO_SERVER_SPEC.controlPlane.domain,
        pm2App: ALO_SERVER_SPEC.controlPlane.pm2App,
        port: ALO_SERVER_SPEC.controlPlane.port,
        role: "control-plane",
        status: "ONLINE",
      },
      ...managedProjects
        .filter((proj) => typeof proj.port === "number")
        .map((proj) => ({
          domain: proj.domain,
          pm2App: proj.name.toLowerCase().replace(/[^a-z0-9_-]+/g, "-"),
          port: proj.port as number,
          role: "tenant-app" as const,
          status: proj.status,
        })),
    ];

    return NextResponse.json(
      apiSuccess({
        serverEnvironment: {
          spec: ALO_SERVER_SPEC,
          nextAvailablePort,
          portRegistry,
        },
        automationServer: {
          status: "operational",
          aiProviderChainReady: redactedChain.length > 0,
          activeProviders: redactedChain,
          scopedHostingTools: Object.keys(HOSTING_TOOLS),
          seededAiAgents: agentCount,
          configuredWorkflows: workflowCount,
          selfHostedAgentCatalogCount: SELF_HOSTED_AGENT_CATALOG.length,
          pendingOperations: pendingOpsCount,
          cisBaseline: isAdmin
            ? cisBaseline
            : {
                reference: cisBaseline.reference,
                license: cisBaseline.license,
                checkedAt: cisBaseline.checkedAt,
                summary: cisBaseline.summary,
              },
        },
        blueprints: AUTO_DEPLOY_BLUEPRINTS,
        managedProjects,
      }),
    );
  } catch (e) {
    return handleErr(e);
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireSession(request);
    const parsed = AutoDeployActionSchema.parse(await request.json());

    if (parsed.action === "architect") {
      const usedPorts = await collectUsedPortsSafe();
      const plan = await architectAutoDeployPlan({
        prompt: parsed.prompt,
        blueprintId: parsed.blueprintId,
        appName: parsed.appName,
        domain: parsed.domain,
        repository: parsed.repository,
        branch: parsed.branch,
        manifestFiles: parsed.manifestFiles,
        usedPorts,
      });
      return NextResponse.json(apiSuccess({ plan }));
    }

    // action === "provision"
    const normalizedDomain = parsed.domain.trim().toLowerCase();
    if (!SAFE_DOMAIN_REGEX.test(normalizedDomain)) {
      return NextResponse.json(
        apiError("Invalid domain name format", "INVALID_DOMAIN", undefined, 400),
        { status: 400 },
      );
    }

    if (normalizedDomain === ALO_SERVER_SPEC.controlPlane.domain) {
      return NextResponse.json(
        apiError(
          `Domain "${normalizedDomain}" is reserved for the ALO Hosting Portal control plane`,
          "RESERVED_DOMAIN",
          undefined,
          409,
        ),
        { status: 409 },
      );
    }

    const validatedConfig = validateDeployConfig(parsed.deployConfig);
    try {
      assertTenantPortAllowed(validatedConfig.port);
    } catch (portErr) {
      return NextResponse.json(
        apiError(
          portErr instanceof Error ? portErr.message : "Reserved or invalid port",
          "RESERVED_PORT",
          undefined,
          400,
        ),
        { status: 400 },
      );
    }

    const existingWebsite = await db.website.findUnique({
      where: { domain: normalizedDomain },
    });
    if (existingWebsite) {
      return NextResponse.json(
        apiError(
          `Domain "${normalizedDomain}" is already registered on this panel`,
          "DOMAIN_CONFLICT",
          undefined,
          409,
        ),
        { status: 409 },
      );
    }

    const cleanRepo =
      parsed.repository && /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(parsed.repository.trim())
        ? parsed.repository.trim()
        : null;

    if (cleanRepo) {
      const duplicateGit = await db.gitProject.findFirst({
        where: { repository: cleanRepo, productionBranch: parsed.branch },
      });
      if (duplicateGit) {
        return NextResponse.json(
          apiError(
            `Repository ${cleanRepo}@${parsed.branch} is already linked to an active auto-deploy project`,
            "REPO_CONFLICT",
            undefined,
            409,
          ),
          { status: 409 },
        );
      }
    }

    // Prepare encrypted environment variables (including CSPRNG auto-generated secrets)
    const envEntries: Array<{ key: string; value: string; isSecret: boolean }> = [];
    const suppliedEnv = parsed.envVars ?? {};
    const autoSecretKeys = new Set(parsed.autoGenerateSecretsFor ?? []);

    for (const key of autoSecretKeys) {
      if (!suppliedEnv[key]) {
        const generated = randomBytes(32).toString("hex");
        envEntries.push({
          key,
          value: encryptSecret(generated),
          isSecret: true,
        });
      }
    }

    for (const [rawKey, rawVal] of Object.entries(suppliedEnv)) {
      const key = rawKey.trim();
      if (!/^[A-Z_][A-Z0-9_]*$/.test(key) || !rawVal) continue;
      const isSecret =
        autoSecretKeys.has(key) || /(SECRET|KEY|TOKEN|PASSWORD|DATABASE_URL)/i.test(key);
      envEntries.push({
        key,
        value: isSecret ? encryptSecret(rawVal) : rawVal,
        isSecret,
      });
    }

    const appType =
      parsed.workloadCategory === "mobile"
        ? "mobile"
        : parsed.workloadCategory === "server"
          ? "api"
          : "web";

    const webhookPlainSecret = randomBytes(24).toString("hex");
    const webhookSecretEnc = encryptSecret(webhookPlainSecret);

    const created = await db.$transaction(async (tx) => {
      const website = await tx.website.create({
        data: {
          name: parsed.appName.trim(),
          domain: normalizedDomain,
          runtime: parsed.websiteRuntime,
          documentRoot: `/srv/alo-sites/${normalizedDomain}/current`,
          status: "ACTIVE",
          applicationPort: validatedConfig.port,
          buildCommand: validatedConfig.buildCmd,
          startupCommand: validatedConfig.startCmd,
          outputDirectory: validatedConfig.outputDir,
          gitRepo: cleanRepo ? `https://github.com/${cleanRepo}.git` : null,
          gitBranch: parsed.branch,
          healthPath: validatedConfig.healthPath,
          healthStatus: "HEALTHY",
          ownerId: user.id,
        },
      });

      const domainRecord = await tx.domain.create({
        data: {
          domain: normalizedDomain,
          websiteId: website.id,
          primary: true,
          sslEnabled: parsed.sslAutoIssue,
          sslStatus: parsed.sslAutoIssue ? "PENDING" : "NONE",
          nameservers: JSON.stringify(["ns1.alolabs.net", "ns2.alolabs.net"]),
        },
      });

      for (const entry of envEntries) {
        await tx.websiteEnvironment.create({
          data: {
            websiteId: website.id,
            key: entry.key,
            value: entry.value,
            isSecret: entry.isSecret,
          },
        });
      }

      const application = await tx.application.create({
        data: {
          name: parsed.appName.trim(),
          websiteId: website.id,
          type: appType,
          status: "active",
          runtime: parsed.runtime,
          version: "1.0.0",
          userId: user.id,
          config: {
            workloadCategory: parsed.workloadCategory,
            framework: parsed.framework,
            serviceManager: validatedConfig.serviceManager,
            outputDir: validatedConfig.outputDir,
            healthPath: validatedConfig.healthPath,
            autoDeployOnPush: parsed.autoDeployOnPush,
          },
        },
      });

      const gitProject = cleanRepo
        ? await tx.gitProject.create({
            data: {
              websiteId: website.id,
              repository: cleanRepo,
              cloneUrl: `https://github.com/${cleanRepo}.git`,
              productionBranch: parsed.branch,
              autoDeploy: parsed.autoDeployOnPush,
              requiresApproval: false,
              config: JSON.stringify(validatedConfig),
              detectionStatus: "confirmed",
              healthPath: validatedConfig.healthPath,
              serviceManager: validatedConfig.serviceManager,
              serviceName: validatedConfig.serviceName ?? null,
              releaseRoot: `/srv/alo-sites/${normalizedDomain}`,
              port: validatedConfig.port,
              webhookSecretEnc,
              lastDeployStatus: "QUEUED",
              createdById: user.id,
            },
          })
        : null;

      const operationJob = await tx.operationJob.create({
        data: {
          websiteId: website.id,
          type: "WEBSITE_CREATE",
          status: "PENDING",
          priority: 100,
          input: JSON.stringify({
            domain: normalizedDomain,
            workloadCategory: parsed.workloadCategory,
            framework: parsed.framework,
            websiteRuntime: parsed.websiteRuntime,
            sslAutoIssue: parsed.sslAutoIssue,
          }),
          resourceId: website.id,
          resourceType: "Website",
          actorId: user.id,
          actorEmail: user.email,
          actorRole: user.role,
        },
      });

      const deployment = await tx.deployment.create({
        data: {
          websiteId: website.id,
          projectId: gitProject?.id ?? null,
          source: cleanRepo ? "github-auto-deploy" : "ai-blueprint",
          branch: parsed.branch,
          trigger: "manual",
          stage: "queued",
          status: "PENDING",
          configSnapshot: JSON.stringify(validatedConfig),
          actorId: user.id,
        },
      });

      const targetServer = await tx.server.findFirst({
        where: {
          OR: [
            { hostname: ALO_SERVER_SPEC.hostName },
            { hostname: ALO_SERVER_SPEC.controlPlane.domain },
          ],
        },
        select: { id: true },
      });

      if (targetServer) {
        const portTaken = await tx.serverPort.findUnique({
          where: {
            serverId_port: {
              serverId: targetServer.id,
              port: validatedConfig.port,
            },
          },
        });
        if (!portTaken) {
          await tx.serverPort.create({
            data: {
              serverId: targetServer.id,
              port: validatedConfig.port,
              websiteId: website.id,
              service: parsed.appName.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-"),
            },
          });
        }
      }

      return { website, domainRecord, application, gitProject, operationJob, deployment };
    });

    const appSlug = parsed.appName.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-") || "alo-app";
    const shareableBriefYaml = generateShareableProjectBriefYaml({
      projectName: parsed.appName.trim(),
      appSlug,
      domain: normalizedDomain,
      port: validatedConfig.port,
      workloadCategory: parsed.workloadCategory,
      framework: parsed.framework,
      runtime: parsed.runtime,
    });
    const nginxConfig = generateNginxSiteConfig({
      domain: normalizedDomain,
      port: validatedConfig.port,
      sslMode: "cloudflare-http80",
    });
    const checklist = generateCloudflareAndCliChecklist({
      appSlug,
      domain: normalizedDomain,
      port: validatedConfig.port,
    });

    await createAuditLog({
      actorId: user.id,
      actorEmail: user.email,
      actorRole: user.role,
      action: "AI_AUTO_DEPLOY_PROVISION",
      resourceType: "Website",
      resourceId: created.website.id,
      domain: normalizedDomain,
      result: "SUCCESS",
      metadata: {
        workloadCategory: parsed.workloadCategory,
        framework: parsed.framework,
        runtime: parsed.runtime,
        repository: cleanRepo,
        envKeyCount: envEntries.length,
        autoDeployOnPush: parsed.autoDeployOnPush,
      },
    });

    return NextResponse.json(
      apiSuccess(
        {
          websiteId: created.website.id,
          applicationId: created.application.id,
          gitProjectId: created.gitProject?.id ?? null,
          deploymentId: created.deployment.id,
          operationJobId: created.operationJob.id,
          domain: normalizedDomain,
          allocatedPort: validatedConfig.port,
          workloadCategory: parsed.workloadCategory,
          framework: parsed.framework,
          storedEnvKeys: envEntries.map((e) => e.key),
          webhookEndpoint: cleanRepo ? "/api/github/webhook" : null,
          shareableBriefYaml,
          nginxConfig,
          cloudflareDnsRecord: checklist.dnsRecord,
          cliDeployCommand: checklist.cliCommand,
        },
        `Provisioned ${parsed.workloadCategory.toUpperCase()} project "${parsed.appName}" on ${normalizedDomain} (port ${validatedConfig.port})`,
      ),
      { status: 201 },
    );
  } catch (e) {
    return handleErr(e);
  }
}
