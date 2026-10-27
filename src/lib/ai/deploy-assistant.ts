/**
 * Zero-Terminal Self-Hosted AI Agent Deployment Assistant (Server Logic)
 *
 * Bridges the verified catalog (`self-hosted-agents.ts`), host hardware check,
 * commercial/open-core license gates, and hardened Docker helper
 * (`alo-docker-helper run-hardened`).
 */

import os from "os";
import { randomBytes } from "crypto";
import { z } from "zod";
import { db } from "@/lib/db";
import { completeJSON } from "@/lib/ai/client";
import { callHelper } from "@/lib/helpers";
import { createAuditLog } from "@/lib/audit";
import {
  ContainerValidationError,
  normalizeSafePortMapping,
  redactContainerRecord,
  validateContainerImage,
  validateContainerName,
  validateEnvVarMap,
} from "@/lib/containers/security";
import {
  getAgentPresetById,
  type LicenseTriageLabel,
  type SelfHostedAgentPreset,
} from "./self-hosted-agents";

export interface HostCapacitySnapshot {
  cpuCores: number;
  totalRamGb: number;
  freeRamGb: number;
}

export function inspectLocalHostCapacity(): HostCapacitySnapshot {
  const cpuCores = Math.max(1, os.cpus()?.length ?? 1);
  const totalRamGb = Math.round((os.totalmem() / 1024 ** 3) * 100) / 100;
  const freeRamGb = Math.round((os.freemem() / 1024 ** 3) * 100) / 100;
  return { cpuCores, totalRamGb, freeRamGb };
}

export interface AgentDeployInput {
  presetId: string;
  instanceName: string;
  websiteId?: string | null;
  hostPort?: number;
  envOverrides?: Record<string, string>;
  acknowledgeLicenseTerms?: boolean;
}

export interface AgentDeploymentPlan {
  valid: boolean;
  canDirectDeploy: boolean;
  errors: string[];
  warnings: string[];
  preset: {
    id: string;
    name: string;
    version: string;
    dockerImage: string | null;
    deploymentMode: SelfHostedAgentPreset["deploymentMode"];
    licenseIdentifier: string;
    licenseTriage: LicenseTriageLabel;
    licenseNotes: string;
    requiresLicenseAcknowledgement: boolean;
  };
  instanceName: string;
  loopbackPortMapping: string | null;
  hostPort: number | null;
  namedVolumeSpec: string | null;
  healthcheckUrl: string | null;
  hostFit: {
    verdict: "FIT" | "TIGHT" | "INSUFFICIENT";
    host: HostCapacitySnapshot;
    minimumRequired: SelfHostedAgentPreset["hardwareMinimum"];
    notes: string[];
  };
  /** Secret values are ALWAYS masked as `[SECRET-SET]` or `[AUTO-GENERATED-SECRET]` in plans. */
  redactedEnvPreview: Record<string, string>;
  securityPosture: string[];
  backupGuidance: string;
  rollbackSteps: string[];
}

export interface ResolvedExecutablePlan {
  plan: AgentDeploymentPlan;
  /** Server-only secret map; NEVER return this object to HTTP clients. */
  resolvedEnv: Record<string, string>;
  preset: SelfHostedAgentPreset;
}

function rewriteLocalhostForContainer(key: string, value: string): { value: string; rewritten: boolean } {
  if (!key.endsWith("_URL") && !key.endsWith("_HOST") && !key.endsWith("_ENDPOINT")) {
    return { value, rewritten: false };
  }
  if (key === "OLLAMA_HOST") return { value, rewritten: false };
  try {
    const parsed = new URL(value);
    if (parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost") {
      parsed.hostname = "host.docker.internal";
      return { value: parsed.toString().replace(/\/$/, value.endsWith("/") ? "/" : ""), rewritten: true };
    }
  } catch {
    // not a URL
  }
  return { value, rewritten: false };
}

function evaluatePresetHostFit(
  preset: SelfHostedAgentPreset,
  host: HostCapacitySnapshot = inspectLocalHostCapacity(),
): AgentDeploymentPlan["hostFit"] {
  const notes: string[] = [];
  const min = preset.hardwareMinimum;
  if (host.totalRamGb < min.ramGb || host.cpuCores < Math.max(1, Math.floor(min.cpuCores / 2))) {
    notes.push(
      `Host has ${host.cpuCores} vCPU / ${host.totalRamGb} GB RAM, below ${preset.name} minimum (${min.cpuCores} vCPU / ${min.ramGb} GB RAM).`,
    );
    return { verdict: "INSUFFICIENT", host, minimumRequired: min, notes };
  }
  if (host.totalRamGb < min.ramGb * 1.35 || host.freeRamGb < Math.min(min.ramGb * 0.6, 1.5) || host.cpuCores < min.cpuCores) {
    notes.push(
      `Tight host capacity (${host.cpuCores} vCPU, ${host.freeRamGb} GB currently free of ${host.totalRamGb} GB RAM). Monitor container memory limits (${preset.containerLimits.memory}).`,
    );
    return { verdict: "TIGHT", host, minimumRequired: min, notes };
  }
  notes.push(`Host capacity (${host.cpuCores} vCPU, ${host.totalRamGb} GB RAM) meets ${preset.name} requirements.`);
  if (min.recommendedVramGb > 0) {
    notes.push(
      `Note: GPU acceleration (${min.recommendedVramGb}+ GB VRAM) is recommended for multi-user or >=7B model throughput; CPU fallback supports light single-user workloads only.`,
    );
  }
  return { verdict: "FIT", host, minimumRequired: min, notes };
}

function parsePortMappingHostPort(portMapping: string | null): number | null {
  if (!portMapping) return null;
  const match = portMapping.match(/^(?:127\.0\.0\.1:)?(\d{2,5}):\d{1,5}$/);
  return match ? Number.parseInt(match[1]!, 10) : null;
}

export async function buildAgentDeploymentPlan(
  input: AgentDeployInput,
  options: { hostOverride?: HostCapacitySnapshot; skipDbCollisionCheck?: boolean } = {},
): Promise<ResolvedExecutablePlan> {
  const errors: string[] = [];
  const warnings: string[] = [];

  const preset = getAgentPresetById(input.presetId);
  if (!preset) {
    throw new Error(`Unknown self-hosted agent preset: "${input.presetId}"`);
  }

  const requiresLicenseAck =
    preset.licenseTriage === "Conditional, requires additional review" ||
    preset.licenseTriage === "Internal use recommended";

  if (
    preset.licenseTriage === "Commercial permission required or potentially required" ||
    preset.licenseTriage === "Not approved pending legal review" ||
    preset.commercialMultiTenantAllowed === "no"
  ) {
    errors.push(
      `Deployment blocked by licensing policy (${preset.licenseTriage}): ${preset.licenseNotes}`,
    );
  } else if (requiresLicenseAck && !input.acknowledgeLicenseTerms) {
    errors.push(
      `Explicit operator acknowledgement required for "${preset.name}" (${preset.licenseTriage}): ${preset.licenseNotes}`,
    );
  }

  if (preset.deploymentMode !== "single-container-verified") {
    errors.push(
      `"${preset.name}" uses deployment mode "${preset.deploymentMode}" and cannot be launched as a standalone single container. ` +
        (preset.deploymentMode === "multi-service-compose"
          ? "Provision its full PostgreSQL/MongoDB/Redis Docker Compose stack via alo-server-kit or dedicated VM."
          : preset.deploymentMode === "sdk-runtime"
            ? "Embed this Python/TypeScript SDK inside an application service rather than deploying it as a GUI container."
            : "Blocked pending security/commercial review."),
    );
  }

  const trimmedName = (input.instanceName || "").trim();
  try {
    validateContainerName(trimmedName);
  } catch (err) {
    errors.push(err instanceof ContainerValidationError ? err.message : "Invalid container name");
  }

  if (preset.dockerImage) {
    try {
      validateContainerImage(preset.dockerImage, { requireExplicitTag: true });
    } catch (err) {
      errors.push(err instanceof ContainerValidationError ? err.message : "Invalid container image");
    }
  }

  const chosenHostPort = input.hostPort ?? preset.defaultHostPort;
  let loopbackPortMapping: string | null = null;
  if (chosenHostPort !== null && preset.containerPort !== null) {
    try {
      loopbackPortMapping = normalizeSafePortMapping(`${chosenHostPort}:${preset.containerPort}`);
    } catch (err) {
      errors.push(err instanceof ContainerValidationError ? err.message : "Invalid port mapping");
    }
  }

  if (!options.skipDbCollisionCheck && (trimmedName || chosenHostPort)) {
    const existingContainers = await db.dockerContainer.findMany({
      select: { id: true, name: true, portMapping: true },
    });
    for (const existing of existingContainers) {
      if (trimmedName && existing.name === trimmedName) {
        warnings.push(`Container "${trimmedName}" already exists in portal state (idempotent check will apply).`);
      } else if (chosenHostPort && parsePortMappingHostPort(existing.portMapping) === chosenHostPort) {
        errors.push(`Loopback port ${chosenHostPort} is already allocated to container "${existing.name}". Choose another port.`);
      }
    }
  }

  const overrides = input.envOverrides ?? {};
  const resolvedEnv: Record<string, string> = {};
  const redactedEnvPreview: Record<string, string> = {};

  for (const spec of preset.envVars) {
    const userVal = typeof overrides[spec.key] === "string" ? overrides[spec.key]!.trim() : "";
    let finalVal = userVal || (spec.defaultValue ?? "");
    let wasAutoGenerated = false;

    if (!finalVal && spec.required && spec.autoGenerateSecret) {
      finalVal = randomBytes(24).toString("base64url");
      wasAutoGenerated = true;
    }

    if (!finalVal && spec.required) {
      errors.push(`Required environment variable ${spec.key} (${spec.label}) is missing.`);
      continue;
    }

    if (finalVal) {
      const rewritten = rewriteLocalhostForContainer(spec.key, finalVal);
      if (rewritten.rewritten) {
        finalVal = rewritten.value;
        warnings.push(
          `Rewrote ${spec.key} from localhost/127.0.0.1 to host.docker.internal so the isolated container can reach the host gateway.`,
        );
      }
      resolvedEnv[spec.key] = finalVal;
      redactedEnvPreview[spec.key] = spec.secret
        ? wasAutoGenerated
          ? "[AUTO-GENERATED-SECRET]"
          : "[SECRET-SET]"
        : finalVal;
    }
  }

  try {
    validateEnvVarMap(resolvedEnv);
  } catch (err) {
    errors.push(err instanceof ContainerValidationError ? err.message : "Invalid environment variable map");
  }

  const volumeSafeName = trimmedName ? `alo-agent-${trimmedName.toLowerCase().replace(/[^a-z0-9_.-]/g, "-")}` : "alo-agent-data";
  const namedVolumeSpec = preset.namedVolumeTarget ? `${volumeSafeName}:${preset.namedVolumeTarget}` : null;
  const healthcheckUrl =
    chosenHostPort && preset.healthcheckPath ? `http://127.0.0.1:${chosenHostPort}${preset.healthcheckPath}` : null;

  const hostFit = evaluatePresetHostFit(preset, options.hostOverride);
  if (hostFit.verdict === "INSUFFICIENT") {
    errors.push(...hostFit.notes);
  } else if (hostFit.verdict === "TIGHT") {
    warnings.push(...hostFit.notes);
  }

  const canDirectDeploy = preset.deploymentMode === "single-container-verified";
  const plan: AgentDeploymentPlan = {
    valid: errors.length === 0 && canDirectDeploy,
    canDirectDeploy,
    errors,
    warnings,
    preset: {
      id: preset.id,
      name: preset.name,
      version: preset.verifiedReleaseVersion,
      dockerImage: preset.dockerImage,
      deploymentMode: preset.deploymentMode,
      licenseIdentifier: preset.licenseIdentifier,
      licenseTriage: preset.licenseTriage,
      licenseNotes: preset.licenseNotes,
      requiresLicenseAcknowledgement: requiresLicenseAck,
    },
    instanceName: trimmedName,
    loopbackPortMapping,
    hostPort: chosenHostPort,
    namedVolumeSpec,
    healthcheckUrl,
    hostFit,
    redactedEnvPreview,
    securityPosture: [
      "Loopback-only port binding (127.0.0.1) — never exposed on 0.0.0.0",
      "Linux capabilities dropped (--cap-drop=ALL) & --security-opt=no-new-privileges:true",
      `Bounded cgroup limits (--cpus=${preset.containerLimits.cpus}, --memory=${preset.containerLimits.memory}, --pids-limit=512)`,
      "No --privileged flag and no /var/run/docker.sock mount",
      "Secrets injected via ephemeral 0600 env-file and redacted in API responses",
    ],
    backupGuidance: preset.backupGuidance,
    rollbackSteps: [
      `Back up named volume (${volumeSafeName}) before any cleanup, upgrade, or redeployment.`,
      `Use Uninstall in /ai/self-hosted, or run: sudo /usr/local/sbin/alo-docker-helper remove-force ${trimmedName || "<name>"} (if supported by the installed helper; otherwise run stop followed by remove).`,
      `Confirm container ${trimmedName || "<name>"} is stopped and removed, and verify whether named volume ${volumeSafeName} remains intact (docker volume inspect ${volumeSafeName}).`,
      `Validate volume recovery in a non-production environment before relying on volume preservation, then redeploy the last known-good pinned image tag.`,
    ],
  };

  return { plan, resolvedEnv, preset };
}

export interface DeployActor {
  userId: string;
  userEmail: string;
  userRole: string;
  isAdmin: boolean;
}

export async function executeAgentDeployment(input: AgentDeployInput, actor: DeployActor) {
  let targetWebsiteId: string | null = null;
  if (input.websiteId) {
    const website = await db.website.findUnique({
      where: { id: input.websiteId },
      select: { id: true, ownerId: true },
    });
    if (!website) {
      return { ok: false as const, status: 404, error: "Target website not found" };
    }
    if (!actor.isAdmin && website.ownerId !== actor.userId) {
      return { ok: false as const, status: 403, error: "Forbidden: you do not own the selected website" };
    }
    targetWebsiteId = website.id;
  } else if (!actor.isAdmin) {
    const firstOwned = await db.website.findFirst({
      where: { ownerId: actor.userId },
      select: { id: true },
      orderBy: { createdAt: "asc" },
    });
    if (!firstOwned) {
      return {
        ok: false as const,
        status: 400,
        error: "Create a website workspace first before provisioning tenant-scoped agent containers",
      };
    }
    targetWebsiteId = firstOwned.id;
  }

  const existingSameName = await db.dockerContainer.findFirst({
    where: { name: input.instanceName.trim() },
    include: { website: { select: { id: true, name: true, domain: true, ownerId: true } } },
  });
  if (existingSameName) {
    const ownsExisting = actor.isAdmin || existingSameName.website?.ownerId === actor.userId;
    const presetImg = getAgentPresetById(input.presetId)?.dockerImage;
    if (ownsExisting && presetImg && existingSameName.image === presetImg) {
      return {
        ok: true as const,
        idempotent: true,
        container: redactContainerRecord(existingSameName),
        message: `Container "${existingSameName.name}" is already provisioned with ${presetImg}.`,
      };
    }
    return {
      ok: false as const,
      status: 409,
      error: `A container named "${existingSameName.name}" already exists.`,
    };
  }

  const { plan, resolvedEnv, preset } = await buildAgentDeploymentPlan(input);
  if (!plan.valid || !preset.dockerImage || !plan.loopbackPortMapping) {
    return {
      ok: false as const,
      status: 400,
      error: plan.errors[0] || "Deployment plan failed validation",
      plan,
    };
  }

  const helperArgs: string[] = [
    "run-hardened",
    plan.instanceName,
    preset.dockerImage,
    plan.loopbackPortMapping,
    `__ALO_CPUS=${preset.containerLimits.cpus}`,
    `__ALO_MEMORY=${preset.containerLimits.memory}`,
  ];
  if (plan.namedVolumeSpec) {
    helperArgs.push(`__ALO_VOLUME=${plan.namedVolumeSpec}`);
  }
  for (const [k, v] of Object.entries(resolvedEnv)) {
    helperArgs.push(`${k}=${v}`);
  }

  const helperResult = await callHelper("alo-docker-helper", helperArgs, 120_000);
  if (!helperResult.success) {
    return {
      ok: false as const,
      status: 502,
      error: helperResult.stderr || "Docker runtime helper could not start the agent container",
      plan,
    };
  }

  const created = await db.dockerContainer.create({
    data: {
      name: plan.instanceName,
      image: preset.dockerImage,
      status: "running",
      portMapping: plan.loopbackPortMapping,
      envVars: resolvedEnv,
      websiteId: targetWebsiteId,
    },
    include: { website: { select: { id: true, name: true, domain: true } } },
  });

  await createAuditLog({
    actorId: actor.userId,
    actorEmail: actor.userEmail,
    actorRole: actor.userRole,
    action: "AI_AGENT_CONTAINER_DEPLOYED",
    resourceType: "DockerContainer",
    resourceId: created.id,
    result: "SUCCESS",
    metadata: {
      presetId: preset.id,
      version: preset.verifiedReleaseVersion,
      image: preset.dockerImage,
      portMapping: plan.loopbackPortMapping,
      namedVolume: plan.namedVolumeSpec,
      envVarKeys: Object.keys(resolvedEnv),
    },
  });

  const readiness = plan.hostPort && preset.healthcheckPath
    ? await verifyAgentReadiness(plan.hostPort, preset.healthcheckPath)
    : { state: "UNREACHABLE" as const, httpStatus: null, latencyMs: 0, detail: "No HTTP healthcheck configured" };

  return {
    ok: true as const,
    idempotent: false,
    container: redactContainerRecord(created),
    plan,
    readiness,
  };
}

export interface AgentReadinessResult {
  state: "READY" | "STARTING" | "UNREACHABLE";
  httpStatus: number | null;
  latencyMs: number;
  detail: string;
}

export async function verifyAgentReadiness(hostPort: number, healthPath: string, timeoutMs = 4_000): Promise<AgentReadinessResult> {
  if (!Number.isInteger(hostPort) || hostPort < 1024 || hostPort > 65535) {
    return { state: "UNREACHABLE", httpStatus: null, latencyMs: 0, detail: "Invalid loopback port" };
  }
  const safePath = healthPath.startsWith("/") && !healthPath.startsWith("//") ? healthPath : "/";
  const url = `http://127.0.0.1:${hostPort}${safePath}`;
  const startedAt = Date.now();
  try {
    const res = await fetch(url, {
      method: "GET",
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
      redirect: "error",
    });
    const latencyMs = Date.now() - startedAt;
    if (res.ok) {
      return {
        state: "READY",
        httpStatus: res.status,
        latencyMs,
        detail: `Loopback health endpoint ${safePath} returned HTTP ${res.status}`,
      };
    }
    return {
      state: "STARTING",
      httpStatus: res.status,
      latencyMs,
      detail: `Container port responded with HTTP ${res.status} (service still initializing or auth-gated)`,
    };
  } catch {
    return {
      state: "UNREACHABLE",
      httpStatus: null,
      latencyMs: Date.now() - startedAt,
      detail: "Container health endpoint has not accepted connections yet (still booting or stopped)",
    };
  }
}

export async function uninstallAgentDeployment(containerId: string, actor: DeployActor) {
  const existing = await db.dockerContainer.findUnique({
    where: { id: containerId },
    include: { website: { select: { id: true, ownerId: true } } },
  });
  if (!existing) {
    return { ok: false as const, status: 404, error: "Deployed agent container not found" };
  }
  if (!actor.isAdmin && existing.website?.ownerId !== actor.userId) {
    return { ok: false as const, status: 403, error: "Forbidden" };
  }

  let removalMethod: "remove-force" | "stop-and-remove" = "remove-force";
  let removeResult = await callHelper("alo-docker-helper", ["remove-force", existing.name], 60_000);
  const combinedOut = `${removeResult.stdout ?? ""}\n${removeResult.stderr ?? ""}`;

  // Graceful compatibility if an older rolled-back alo-docker-helper lacks `remove-force`
  if (!removeResult.success && /unknown command/i.test(combinedOut)) {
    removalMethod = "stop-and-remove";
    await callHelper("alo-docker-helper", ["stop", existing.name], 30_000);
    removeResult = await callHelper("alo-docker-helper", ["remove", existing.name], 30_000);
  }

  const finalOut = `${removeResult.stdout ?? ""}\n${removeResult.stderr ?? ""}`;
  if (!removeResult.success && !/no such container/i.test(finalOut)) {
    return {
      ok: false as const,
      status: 502,
      error: `Failed to stop/remove container "${existing.name}" via host helper; database record retained so container is not orphaned.`,
    };
  }

  const expectedVolumeName = `alo-agent-${existing.name.toLowerCase().replace(/[^a-z0-9_.-]/g, "-")}`;
  await db.dockerContainer.delete({ where: { id: containerId } });

  await createAuditLog({
    actorId: actor.userId,
    actorEmail: actor.userEmail,
    actorRole: actor.userRole,
    action: "AI_AGENT_CONTAINER_UNINSTALLED",
    resourceType: "DockerContainer",
    resourceId: containerId,
    result: "SUCCESS",
    metadata: {
      name: existing.name,
      image: existing.image,
      removalMethod,
      expectedVolumeName,
      volumeFlagOmitted: true,
    },
  });

  return {
    ok: true as const,
    removedName: existing.name,
    removalMethod,
    expectedVolumeName,
    verificationNote: `Confirm "${existing.name}" is stopped/removed and verify whether named volume "${expectedVolumeName}" remains intact before cleanup or redeployment.`,
  };
}


// ─── Zero-Terminal Website & Stack Blueprint Studio ───────────────────────────

export const STACK_PRESET_IDS = [
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
] as const;

export type StackPresetId = (typeof STACK_PRESET_IDS)[number];

export interface StackPreset {
  id: StackPresetId;
  category: "web-app" | "self-hosted-agent";
  label: string;
  tagline: string;
  websiteRuntime: "NEXTJS" | "NODE" | "STATIC" | "PHP82";
  runtimeVersion: string;
  /** Pinned package/image version verified on npm/PyPI (2026-10-26) when applicable. */
  pinnedVersion?: string;
  /** Engineering license triage note for self-hosted agent presets. */
  licenseNote?: string;
  defaultBuildCommand: string;
  defaultStartCommand: string;
  defaultOutputDirectory: string;
  defaultHealthPath: string;
  recommendedDb: "POSTGRESQL" | "MARIADB" | "NONE";
  defaultEnvVars?: ReadonlyArray<{ key: string; value: string }>;
}

export const ONE_CLICK_STACK_PRESETS: readonly StackPreset[] = [
  {
    id: "nextjs-app",
    category: "web-app",
    label: "Next.js 16 Full-Stack App",
    tagline: "SSR, App Router & API routes with zero-config build & health checks",
    websiteRuntime: "NEXTJS",
    runtimeVersion: "node-22-nextjs-16",
    defaultBuildCommand: "npm run build",
    defaultStartCommand: "npm start",
    defaultOutputDirectory: ".next",
    defaultHealthPath: "/api/health",
    recommendedDb: "POSTGRESQL",
  },
  {
    id: "nodejs-api",
    category: "web-app",
    label: "Node.js 1-Click Environment",
    tagline: "Express, Fastify, NestJS or Rivet headless backend with managed port",
    websiteRuntime: "NODE",
    runtimeVersion: "node-22-lts",
    defaultBuildCommand: "npm ci",
    defaultStartCommand: "npm start",
    defaultOutputDirectory: "dist",
    defaultHealthPath: "/health",
    recommendedDb: "POSTGRESQL",
  },
  {
    id: "python-app",
    category: "web-app",
    label: "Python 1-Click Environment",
    tagline: "FastAPI, Django or Flask web/AI service behind managed reverse proxy",
    websiteRuntime: "NODE",
    runtimeVersion: "python-3.12",
    defaultBuildCommand: "pip install -r requirements.txt",
    defaultStartCommand: "uvicorn app.main:app --host 127.0.0.1",
    defaultOutputDirectory: ".",
    defaultHealthPath: "/health",
    recommendedDb: "POSTGRESQL",
  },
  {
    id: "static-spa",
    category: "web-app",
    label: "React / Vite / Static Edge Site",
    tagline: "Instant global CDN-cached static site or SPA with zero runtime overhead",
    websiteRuntime: "STATIC",
    runtimeVersion: "static-edge",
    defaultBuildCommand: "npm run build",
    defaultStartCommand: "",
    defaultOutputDirectory: "dist",
    defaultHealthPath: "/",
    recommendedDb: "NONE",
  },
  {
    id: "php-cms",
    category: "web-app",
    label: "PHP 8.2 / WordPress / Laravel",
    tagline: "Managed FastCGI pool with MariaDB blueprint and automated daily backups",
    websiteRuntime: "PHP82",
    runtimeVersion: "php-8.2-fpm",
    defaultBuildCommand: "",
    defaultStartCommand: "",
    defaultOutputDirectory: "public",
    defaultHealthPath: "/",
    recommendedDb: "MARIADB",
  },
  {
    id: "flowise-agent",
    category: "self-hosted-agent",
    label: "Flowise Visual AI Agent (OSS Core)",
    tagline: "Pinned flowise@3.1.4 visual RAG/agent builder wired to loopback LiteLLM/Ollama/LocalAI",
    websiteRuntime: "NODE",
    runtimeVersion: "flowise-3.1.4-node-22",
    pinnedVersion: "flowise@3.1.4",
    licenseNote: "Apache-2.0 core; packages/server/src/enterprise & IdentityManager.ts carry Flowise Commercial License — review before multi-tenant resale.",
    defaultBuildCommand: "npm install flowise@3.1.4",
    defaultStartCommand: "npx flowise start",
    defaultOutputDirectory: ".",
    defaultHealthPath: "/api/v1/ping",
    recommendedDb: "POSTGRESQL",
    defaultEnvVars: [
      { key: "OPENAI_API_BASE_URL", value: "http://127.0.0.1:4000/v1" },
      { key: "OLLAMA_BASE_URL", value: "http://127.0.0.1:11434" },
      { key: "LOCALAI_BASE_URL", value: "http://127.0.0.1:8080/v1" },
      { key: "DISABLE_FLOWISE_TELEMETRY", value: "true" },
      { key: "DO_NOT_TRACK", value: "1" },
    ],
  },
  {
    id: "langflow-agent",
    category: "self-hosted-agent",
    label: "Langflow Visual Agent & MCP Builder",
    tagline: "Pure MIT pinned langflow==1.13.0 visual agent & MCP workflow builder with auth enforced",
    websiteRuntime: "NODE",
    runtimeVersion: "python-3.12-langflow-1.13.0",
    pinnedVersion: "langflow==1.13.0",
    licenseNote: "MIT License verified (langflow-ai/langflow) — clean OSI-permissive alternative for commercial & multi-tenant visual builders.",
    defaultBuildCommand: "pip install langflow==1.13.0",
    defaultStartCommand: "langflow run --host 127.0.0.1",
    defaultOutputDirectory: ".",
    defaultHealthPath: "/health_check",
    recommendedDb: "POSTGRESQL",
    defaultEnvVars: [
      { key: "OPENAI_API_BASE", value: "http://127.0.0.1:4000/v1" },
      { key: "LANGFLOW_AUTO_LOGIN", value: "false" },
      { key: "LANGFLOW_DO_NOT_TRACK", value: "true" },
      { key: "DO_NOT_TRACK", value: "1" },
    ],
  },
  {
    id: "langgraph-agent",
    category: "self-hosted-agent",
    label: "LangGraph Stateful Agent",
    tagline: "Pure MIT pinned langgraph==1.2.17 cyclic state-graph server with Postgres checkpointers",
    websiteRuntime: "NODE",
    runtimeVersion: "python-3.12-langgraph-1.2.17",
    pinnedVersion: "langgraph==1.2.17",
    licenseNote: "MIT License verified (langchain-ai/langgraph) — unrestricted self-hosted state-graph orchestration.",
    defaultBuildCommand: "pip install langgraph==1.2.17 uvicorn fastapi psycopg",
    defaultStartCommand: "uvicorn app.graph_server:app --host 127.0.0.1",
    defaultOutputDirectory: ".",
    defaultHealthPath: "/ok",
    recommendedDb: "POSTGRESQL",
    defaultEnvVars: [
      { key: "OPENAI_BASE_URL", value: "http://127.0.0.1:4000/v1" },
      { key: "LANGGRAPH_CHECKPOINTER", value: "postgres" },
      { key: "LANGCHAIN_TRACING_V2", value: "false" },
      { key: "HUMAN_IN_LOOP_REQUIRED", value: "true" },
    ],
  },
  {
    id: "crewai-service",
    category: "self-hosted-agent",
    label: "CrewAI Multi-Agent Team",
    tagline: "Pure MIT pinned crewai==1.15.30 role-based multi-agent crews with telemetry disabled",
    websiteRuntime: "NODE",
    runtimeVersion: "python-3.12-crewai-1.15.30",
    pinnedVersion: "crewai==1.15.30",
    licenseNote: "MIT License verified (crewAIInc/crewAI) — core runtime permissive; commercial AMP cloud optional.",
    defaultBuildCommand: "pip install crewai==1.15.30 uvicorn fastapi",
    defaultStartCommand: "uvicorn app.crew_api:app --host 127.0.0.1",
    defaultOutputDirectory: ".",
    defaultHealthPath: "/health",
    recommendedDb: "POSTGRESQL",
    defaultEnvVars: [
      { key: "OPENAI_API_BASE", value: "http://127.0.0.1:4000/v1" },
      { key: "CREWAI_DISABLE_TELEMETRY", value: "true" },
      { key: "OTEL_SDK_DISABLED", value: "true" },
      { key: "ANONYMIZED_TELEMETRY", value: "false" },
    ],
  },
  {
    id: "agno-agent",
    category: "self-hosted-agent",
    label: "Agno AgentOS FastAPI Runtime",
    tagline: "Pure Apache-2.0 pinned agno==3.1.10 fast multi-agent runtime with sessions & memory",
    websiteRuntime: "NODE",
    runtimeVersion: "python-3.12-agno-3.1.10",
    pinnedVersion: "agno==3.1.10",
    licenseNote: "Apache-2.0 verified (agno-agi/agno) — clean permissive multi-agent runtime & FastAPI server.",
    defaultBuildCommand: "pip install agno==3.1.10 uvicorn fastapi sqlalchemy psycopg",
    defaultStartCommand: "uvicorn app.agent_os:app --host 127.0.0.1",
    defaultOutputDirectory: ".",
    defaultHealthPath: "/health",
    recommendedDb: "POSTGRESQL",
    defaultEnvVars: [
      { key: "OPENAI_BASE_URL", value: "http://127.0.0.1:4000/v1" },
      { key: "AGNO_TELEMETRY", value: "false" },
      { key: "DO_NOT_TRACK", value: "1" },
    ],
  },
  {
    id: "letta-memory",
    category: "self-hosted-agent",
    label: "Letta (MemGPT) Stateful OS",
    tagline: "Pure Apache-2.0 pinned letta==0.34.12 persistent core/archival/recall memory on pgvector",
    websiteRuntime: "NODE",
    runtimeVersion: "python-3.12-letta-0.34.12",
    pinnedVersion: "letta==0.34.12",
    licenseNote: "Apache-2.0 verified (letta-ai/letta) — clean permissive long-term memory agent server.",
    defaultBuildCommand: "pip install letta==0.34.12",
    defaultStartCommand: "letta server --host 127.0.0.1",
    defaultOutputDirectory: ".",
    defaultHealthPath: "/v1/health",
    recommendedDb: "POSTGRESQL",
    defaultEnvVars: [
      { key: "OPENAI_API_BASE", value: "http://127.0.0.1:4000/v1" },
      { key: "LETTA_PG_VECTOR_ENABLED", value: "true" },
      { key: "ANONYMIZED_TELEMETRY", value: "false" },
      { key: "DO_NOT_TRACK", value: "1" },
    ],
  },
] as const;

export interface VisualPanelBenchmark {
  provider: string;
  url: string;
  capability: string;
  aloEquivalent: string;
}

/**
 * Maps the 10 managed visual VPS / hosting control-panel benchmarks directly
 * to concrete zero-terminal controls in `hosting.alolabs.net`.
 */
export const ZERO_TERMINAL_BENCHMARKS: readonly VisualPanelBenchmark[] = [
  {
    provider: "A2 Hosting",
    url: "https://www.a2hosting.com/vps-hosting/",
    capability: "Managed visual panel, automated backups & 1-click Node.js / Python environments",
    aloEquivalent: "1-Click Node.js 22 & Python 3.12 stack presets + visual scheduled backup cron provisioning",
  },
  {
    provider: "InMotion Hosting",
    url: "https://www.inmotionhosting.com/",
    capability: "Visual multi-project sites, isolated databases & domains without terminal commands",
    aloEquivalent: "Point-and-click multi-site launcher with per-project DB credentials & domain attachment",
  },
  {
    provider: "SiteGround",
    url: "https://siteground.com/",
    capability: "Automated visual dashboard with multi-tenant project separation & built-in security",
    aloEquivalent: "Isolated `/srv/alo-sites/<workspace>/<domain>` roots + visual Standard/Strict WAF security profiles",
  },
  {
    provider: "Bluehost",
    url: "https://www.bluehost.com/",
    capability: "Simplified dashboard automating multi-site orchestration & seamless SSL setup",
    aloEquivalent: "Single-screen multi-site orchestrator with 1-click Let's Encrypt / Cloudflare Edge auto-SSL",
  },
  {
    provider: "DreamHost",
    url: "https://www.dreamhost.com/vps/",
    capability: "Custom panel automating server resources, custom domains & database provisioning",
    aloEquivalent: "Visual CPU/RAM/SSD resource presets (`starter`/`growth`/`performance`) + DB & domain setup",
  },
  {
    provider: "FastComet",
    url: "https://www.fastcomet.com/",
    capability: "Interactive guided setup, free global SSL & automated system optimizations",
    aloEquivalent: "AI interactive prompt-to-blueprint wizard + visual edge-cache & Brotli/Gzip toggles",
  },
  {
    provider: "Namecheap FastCloud",
    url: "https://www.namecheap.com/hosting/",
    capability: "Integrated domain management with visual VPS partitioning",
    aloEquivalent: "Automatic `*.apps.alolabs.net` subdomain / custom DNS binding + partitioned workspace directories",
  },
  {
    provider: "Liquid Web",
    url: "https://www.liquidweb.com/",
    capability: "Managed cloud servers with automated healing, rollback & zero-coding DB setup",
    aloEquivalent: "Real HTTP readiness probes + auto-rollback on failed deploy + zero-code DB env wiring",
  },
  {
    provider: "InterServer",
    url: "https://www.interserver.net/",
    capability: "Lightweight visual stack selection at launch to automate web + DB setup",
    aloEquivalent: "Instant 11-stack selector (5 web stacks + 6 pinned self-hosted AI agent stacks) at project creation",
  },
  {
    provider: "HostGator",
    url: "https://www.hostgator.com/",
    capability: "Point-and-click organization of multiple project folders & company configs under one roof",
    aloEquivalent: "Multi-company `Organization` workspaces grouping sites, teams, environments & audit trails",
  },
] as const;

const SAFE_COMMAND_RE = /^[A-Za-z0-9._/:=@,\-\s]{0,180}$/;
const SAFE_DOMAIN_RE = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/;
const SAFE_BRANCH_RE = /^[A-Za-z0-9._/-]{1,100}$/;
const SAFE_DB_NAME_RE = /^[a-z][a-z0-9_]{1,47}$/;
const SAFE_ENV_KEY_RE = /^[A-Z][A-Z0-9_]{1,63}$/;

export function slugifyName(raw: string, fallback = "my-app"): string {
  const cleaned = raw
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 42);
  return cleaned.length >= 2 ? cleaned : fallback;
}

export function sanitizeDbName(raw: string, fallback = "app_db"): string {
  const base = raw
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+/, "");
  const prefixed = /^[a-z]/.test(base) ? base : `db_${base}`;
  const cleaned = prefixed.replace(/_+/g, "_").replace(/_+$/, "").slice(0, 47);
  return SAFE_DB_NAME_RE.test(cleaned) ? cleaned : fallback;
}

export function normalizeDomain(raw: string, fallbackSlug: string): string {
  const stripped = raw
    .toLowerCase()
    .trim()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .replace(/:\d+$/, "");
  if (SAFE_DOMAIN_RE.test(stripped)) return stripped;
  const suffix = (process.env.DEPLOY_DOMAIN_SUFFIX || "apps.alolabs.net").toLowerCase();
  return `${slugifyName(stripped || fallbackSlug)}.${suffix}`;
}

export function isSafeCommand(cmd: string): boolean {
  if (!cmd) return true;
  if (!SAFE_COMMAND_RE.test(cmd)) return false;
  return !/[;|&$`><\\]/.test(cmd);
}

export const deployBlueprintSchema = z.object({
  projectName: z.string().trim().min(2).max(80),
  workspaceName: z.string().trim().min(2).max(80).default("Main Workspace"),
  stackId: z.enum(STACK_PRESET_IDS),
  domain: z
    .string()
    .trim()
    .toLowerCase()
    .regex(SAFE_DOMAIN_RE, "Enter a valid domain (e.g. app.apps.alolabs.net)"),
  gitRepo: z
    .string()
    .trim()
    .max(240)
    .optional()
    .default("")
    .refine(
      (v) =>
        !v ||
        /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\.git)?$/.test(v) ||
        /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(v),
      "Git repository must be owner/repo or https://github.com/owner/repo",
    ),
  gitBranch: z.string().trim().regex(SAFE_BRANCH_RE).default("main"),
  buildCommand: z
    .string()
    .trim()
    .max(180)
    .default("")
    .refine(isSafeCommand, "Build command contains disallowed shell characters"),
  startCommand: z
    .string()
    .trim()
    .max(180)
    .default("")
    .refine(isSafeCommand, "Start command contains disallowed shell characters"),
  outputDirectory: z
    .string()
    .trim()
    .max(80)
    .default(".")
    .refine((v) => !v.includes("..") && /^[A-Za-z0-9._/-]*$/.test(v), "Invalid output directory"),
  autoSsl: z.boolean().default(true),
  securityProfile: z.enum(["standard", "strict-waf"]).default("strict-waf"),
  database: z.object({
    enabled: z.boolean().default(false),
    engine: z.enum(["POSTGRESQL", "MARIADB"]).default("POSTGRESQL"),
    name: z.string().trim().regex(SAFE_DB_NAME_RE).default("app_db"),
  }),
  resources: z.object({
    tier: z.enum(["starter", "growth", "performance"]).default("growth"),
    cpuCores: z.number().min(0.5).max(16).default(2),
    memoryMb: z.number().int().min(256).max(32768).default(2048),
    storageGb: z.number().int().min(1).max(500).default(20),
    edgeCache: z.boolean().default(true),
    compression: z.boolean().default(true),
  }),
  backups: z.object({
    enabled: z.boolean().default(true),
    frequency: z.enum(["daily", "weekly", "every-6h"]).default("daily"),
  }),
  selfHealing: z.object({
    enabled: z.boolean().default(true),
    healthPath: z
      .string()
      .trim()
      .regex(/^\/[A-Za-z0-9._/-]{0,80}$/, "Health path must start with /")
      .default("/api/health"),
    autoRollback: z.boolean().default(true),
  }),
  envVars: z
    .array(
      z.object({
        key: z.string().trim().regex(SAFE_ENV_KEY_RE, "Env key must be UPPER_SNAKE_CASE"),
        value: z.string().max(500),
      }),
    )
    .max(25)
    .default([]),
});

export type DeployBlueprint = z.infer<typeof deployBlueprintSchema>;

const RESOURCE_TIERS = {
  starter: { cpuCores: 1, memoryMb: 1024, storageGb: 10 },
  growth: { cpuCores: 2, memoryMb: 2048, storageGb: 25 },
  performance: { cpuCores: 4, memoryMb: 8192, storageGb: 80 },
} as const;

export function buildBlueprintFromPreset(
  stackId: StackPresetId,
  overrides: {
    projectName?: string;
    workspaceName?: string;
    domain?: string;
    gitRepo?: string;
    tier?: "starter" | "growth" | "performance";
  } = {},
): DeployBlueprint {
  const preset = ONE_CLICK_STACK_PRESETS.find((p) => p.id === stackId) ?? ONE_CLICK_STACK_PRESETS[0]!;
  const projectName = overrides.projectName?.trim() || preset.label.split(" ")[0]! + " Project";
  const slug = slugifyName(projectName);
  const tier = overrides.tier ?? "growth";
  const tierSpec = RESOURCE_TIERS[tier];
  const dbEnabled = preset.recommendedDb !== "NONE";
  const dbEngine = preset.recommendedDb === "MARIADB" ? "MARIADB" : "POSTGRESQL";

  return deployBlueprintSchema.parse({
    projectName,
    workspaceName: overrides.workspaceName?.trim() || "Main Workspace",
    stackId: preset.id,
    domain: normalizeDomain(overrides.domain || "", slug),
    gitRepo: overrides.gitRepo?.trim() || "",
    gitBranch: "main",
    buildCommand: preset.defaultBuildCommand,
    startCommand: preset.defaultStartCommand,
    outputDirectory: preset.defaultOutputDirectory,
    autoSsl: true,
    securityProfile: "strict-waf",
    database: {
      enabled: dbEnabled,
      engine: dbEngine,
      name: sanitizeDbName(`${slug}_db`),
    },
    resources: {
      tier,
      ...tierSpec,
      edgeCache: true,
      compression: true,
    },
    backups: {
      enabled: true,
      frequency: "daily",
    },
    selfHealing: {
      enabled: true,
      healthPath: preset.defaultHealthPath,
      autoRollback: true,
    },
    envVars: preset.defaultEnvVars ? preset.defaultEnvVars.map((item) => ({ ...item })) : [],
  });
}

interface RawAIPlan {
  projectName?: unknown;
  workspaceName?: unknown;
  stackId?: unknown;
  domain?: unknown;
  gitRepo?: unknown;
  gitBranch?: unknown;
  databaseEnabled?: unknown;
  databaseEngine?: unknown;
  databaseName?: unknown;
  resourceTier?: unknown;
  backupFrequency?: unknown;
  securityProfile?: unknown;
  healthPath?: unknown;
  summary?: unknown;
  highlights?: unknown;
}

const PLANNER_SYSTEM_PROMPT =
  "You are the ALO Labs Zero-Terminal Hosting Architect for hosting.alolabs.net. " +
  "Convert the user's plain-English project description into a safe, structured JSON deployment plan so they never need to use a terminal. " +
  "Return ONLY a JSON object with keys: " +
  `projectName (string), workspaceName (string), stackId (one of ${STACK_PRESET_IDS.map((s) => `"${s}"`).join(", ")}), ` +
  "domain (lowercase hostname, default <slug>.apps.alolabs.net if none given), " +
  'gitRepo (owner/repo or https://github.com/owner/repo if mentioned, else ""), gitBranch (default "main"), ' +
  'databaseEnabled (boolean), databaseEngine ("POSTGRESQL" or "MARIADB"), databaseName (lowercase snake_case), ' +
  'resourceTier ("starter", "growth", or "performance"), backupFrequency ("daily", "weekly", or "every-6h"), ' +
  'securityProfile ("standard" or "strict-waf"), healthPath (starts with "/"), ' +
  "summary (1-2 sentences explaining the visual setup), highlights (array of 3-5 short bullet strings). " +
  "Never include shell injection characters or secret values.";

export async function planDeploymentWithAI(prompt: string, signal?: AbortSignal) {
  const trimmed = prompt.trim().slice(0, 4000);
  const { data, completion } = await completeJSON<RawAIPlan>(
    [
      { role: "system", content: PLANNER_SYSTEM_PROMPT },
      { role: "user", content: trimmed },
    ],
    { temperature: 0.2, maxTokens: 1200, signal },
  );

  const validStacks: readonly StackPresetId[] = STACK_PRESET_IDS;
  const rawStack = typeof data.stackId === "string" ? (data.stackId.trim() as StackPresetId) : "nextjs-app";
  const stackId: StackPresetId = validStacks.includes(rawStack) ? rawStack : "nextjs-app";
  const rawTier = typeof data.resourceTier === "string" ? data.resourceTier.trim() : "growth";
  const tier: "starter" | "growth" | "performance" =
    rawTier === "starter" || rawTier === "performance" ? rawTier : "growth";

  const base = buildBlueprintFromPreset(stackId, {
    projectName: typeof data.projectName === "string" ? data.projectName : undefined,
    workspaceName: typeof data.workspaceName === "string" ? data.workspaceName : undefined,
    domain: typeof data.domain === "string" ? data.domain : undefined,
    gitRepo: typeof data.gitRepo === "string" ? data.gitRepo : undefined,
    tier,
  });

  const dbEngine = data.databaseEngine === "MARIADB" ? "MARIADB" : "POSTGRESQL";
  const backupFreq =
    data.backupFrequency === "weekly" || data.backupFrequency === "every-6h"
      ? data.backupFrequency
      : "daily";
  const securityProfile = data.securityProfile === "standard" ? "standard" : "strict-waf";
  const healthPath =
    typeof data.healthPath === "string" && /^\/[A-Za-z0-9._/-]{0,80}$/.test(data.healthPath.trim())
      ? data.healthPath.trim()
      : base.selfHealing.healthPath;

  const blueprint = deployBlueprintSchema.parse({
    ...base,
    gitBranch:
      typeof data.gitBranch === "string" && SAFE_BRANCH_RE.test(data.gitBranch.trim())
        ? data.gitBranch.trim()
        : "main",
    securityProfile,
    database: {
      enabled: typeof data.databaseEnabled === "boolean" ? data.databaseEnabled : base.database.enabled,
      engine: dbEngine,
      name:
        typeof data.databaseName === "string"
          ? sanitizeDbName(data.databaseName, base.database.name)
          : base.database.name,
    },
    backups: {
      enabled: true,
      frequency: backupFreq,
    },
    selfHealing: {
      enabled: true,
      healthPath,
      autoRollback: true,
    },
  });

  const summary =
    typeof data.summary === "string" && data.summary.trim()
      ? data.summary.trim().slice(0, 400)
      : `Prepared a zero-terminal ${stackId} blueprint for ${blueprint.domain}.`;
  const highlights = Array.isArray(data.highlights)
    ? data.highlights
        .filter((h): h is string => typeof h === "string" && h.trim().length > 0)
        .slice(0, 6)
        .map((h) => h.trim().slice(0, 160))
    : [];

  return {
    blueprint,
    summary,
    highlights,
    completion,
  };
}

function cronExpressionFor(frequency: "daily" | "weekly" | "every-6h"): string {
  if (frequency === "every-6h") return "0 */6 * * *";
  if (frequency === "weekly") return "0 3 * * 0";
  return "0 2 * * *";
}

/**
 * Allocates a collision-free loopback port across `Website`, `GitProject`, and `ServerPort`.
 */
async function allocateManagedPort(): Promise<number> {
  const [websites, gitProjects, serverPorts] = await Promise.all([
    db.website.findMany({
      where: { applicationPort: { not: null }, deletedAt: null },
      select: { applicationPort: true },
    }),
    db.gitProject.findMany({
      where: { port: { not: null } },
      select: { port: true },
    }).catch(() => []),
    db.serverPort.findMany({
      select: { port: true },
    }).catch(() => []),
  ]);

  const used = new Set<number>();
  for (const w of websites) {
    if (typeof w.applicationPort === "number") used.add(w.applicationPort);
  }
  for (const gp of gitProjects) {
    if (typeof gp.port === "number") used.add(gp.port);
  }
  for (const sp of serverPorts) {
    if (typeof sp.port === "number") used.add(sp.port);
  }

  for (let port = 4200; port <= 4899; port += 1) {
    if (!used.has(port)) return port;
  }
  throw Object.assign(new Error("Managed application port pool (4200-4899) is exhausted"), {
    status: 503,
    code: "PORT_POOL_EXHAUSTED",
  });
}

/**
 * Performs a real HTTP readiness check on `http://127.0.0.1:<port><healthPath>`
 * instead of assuming a newly created database record is already running & healthy.
 */
export async function probeLocalServiceReadiness(
  port: number | null,
  healthPath: string,
  timeoutMs = 1500,
): Promise<{
  reachable: boolean;
  httpStatus: number | null;
  checkedUrl: string | null;
  checkedAt: string;
}> {
  const checkedAt = new Date().toISOString();
  if (!port || port < 1 || port > 65535) {
    return { reachable: false, httpStatus: null, checkedUrl: null, checkedAt };
  }
  const safePath = healthPath.startsWith("/") ? healthPath : `/${healthPath}`;
  const checkedUrl = `http://127.0.0.1:${port}${safePath}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(checkedUrl, {
      method: "GET",
      redirect: "manual",
      signal: controller.signal,
    });
    const reachable = response.status >= 200 && response.status < 400;
    return { reachable, httpStatus: response.status, checkedUrl, checkedAt };
  } catch {
    return { reachable: false, httpStatus: null, checkedUrl, checkedAt };
  } finally {
    clearTimeout(timer);
  }
}

async function ensureWorkspaceOrganization(userId: string, workspaceName: string) {
  const baseSlug = slugifyName(workspaceName, "workspace");
  const existingOwned = await db.organization.findFirst({
    where: { ownerId: userId, name: workspaceName },
  });
  if (existingOwned) return existingOwned;

  const slugTaken = await db.organization.findUnique({ where: { slug: baseSlug } });
  const slug =
    slugTaken && slugTaken.ownerId !== userId
      ? `${baseSlug}-${userId.slice(0, 6).toLowerCase()}`
      : baseSlug;

  if (slugTaken && slugTaken.ownerId === userId) return slugTaken;

  return db.organization.create({
    data: {
      name: workspaceName,
      slug,
      ownerId: userId,
    },
  });
}

export interface ProvisionActor {
  id: string;
  email: string;
  role: string;
}

export interface ProvisionOptions {
  ipAddress?: string | null;
  idempotencyKey?: string | null;
}

export async function provisionZeroTerminalProject(
  rawBlueprint: unknown,
  actor: ProvisionActor,
  ipOrOptions?: string | null | ProvisionOptions,
) {
  const options: ProvisionOptions =
    typeof ipOrOptions === "object" && ipOrOptions !== null
      ? ipOrOptions
      : { ipAddress: ipOrOptions ?? null };

  const blueprint = deployBlueprintSchema.parse(rawBlueprint);
  const preset = ONE_CLICK_STACK_PRESETS.find((p) => p.id === blueprint.stackId) ?? ONE_CLICK_STACK_PRESETS[0]!;

  const existingSite = await db.website.findUnique({
    where: { domain: blueprint.domain },
    include: {
      organization: true,
      domains: true,
      applications: true,
      cronJobs: true,
    },
  });

  if (existingSite && !existingSite.deletedAt) {
    // Idempotent replay for the same owner when idempotencyKey matches.
    if (options.idempotencyKey && existingSite.ownerId === actor.id) {
      const matchingApp = existingSite.applications.find((app) => {
        const cfg = app.config as Record<string, unknown> | null;
        return cfg?.idempotencyKey === options.idempotencyKey;
      });
      if (matchingApp) {
        const dom = existingSite.domains[0];
        const cron = existingSite.cronJobs[0];
        const probe = await probeLocalServiceReadiness(
          existingSite.applicationPort,
          existingSite.healthPath || blueprint.selfHealing.healthPath,
        );
        return {
          idempotentReplay: true,
          website: {
            id: existingSite.id,
            name: existingSite.name,
            domain: existingSite.domain,
            runtime: existingSite.runtime,
            documentRoot: existingSite.documentRoot,
            port: existingSite.applicationPort,
            status: existingSite.status,
            healthStatus: existingSite.healthStatus,
            gitRepo: existingSite.gitRepo,
            gitBranch: existingSite.gitBranch,
          },
          workspace: existingSite.organization
            ? {
                id: existingSite.organization.id,
                name: existingSite.organization.name,
                slug: existingSite.organization.slug,
              }
            : null,
          domain: dom
            ? {
                id: dom.id,
                domain: dom.domain,
                sslEnabled: dom.sslEnabled,
                sslStatus: dom.sslStatus,
                dnsVerified: dom.dnsVerified,
              }
            : null,
          application: {
            id: matchingApp.id,
            runtime: matchingApp.runtime,
            securityProfile: blueprint.securityProfile,
            resources: blueprint.resources,
          },
          database: null,
          backups: cron
            ? { id: cron.id, schedule: cron.schedule, frequency: blueprint.backups.frequency }
            : null,
          selfHealing: blueprint.selfHealing,
          readiness: {
            state: probe.reachable ? ("LIVE_HEALTHY" as const) : ("CONFIGURED_AWAITING_RELEASE" as const),
            reachable: probe.reachable,
            httpStatus: probe.httpStatus,
            checkedUrl: probe.checkedUrl,
            checkedAt: probe.checkedAt,
            note: probe.reachable
              ? "Service responded 2xx on loopback readiness endpoint."
              : "Blueprint persisted in database; service will report HEALTHY only after release activation passes loopback HTTP readiness.",
          },
        };
      }
    }

    const conflict = new Error(`A site with domain "${blueprint.domain}" already exists`);
    (conflict as Error & { status?: number; code?: string }).status = 409;
    (conflict as Error & { status?: number; code?: string }).code = "CONFLICT";
    throw conflict;
  }

  const existingDomain = await db.domain.findUnique({ where: { domain: blueprint.domain } });
  if (existingDomain) {
    const conflict = new Error(`Domain "${blueprint.domain}" is already attached to another site`);
    (conflict as Error & { status?: number; code?: string }).status = 409;
    (conflict as Error & { status?: number; code?: string }).code = "CONFLICT";
    throw conflict;
  }

  const organization = await ensureWorkspaceOrganization(actor.id, blueprint.workspaceName);
  const needsPort = preset.websiteRuntime === "NEXTJS" || preset.websiteRuntime === "NODE";
  const allocatedPort = needsPort ? await allocateManagedPort() : null;
  const documentRoot = `/srv/alo-sites/${organization.slug}/${blueprint.domain}/current`;
  const normalizedGitRepo = blueprint.gitRepo
    ? blueprint.gitRepo.startsWith("http")
      ? blueprint.gitRepo
      : `https://github.com/${blueprint.gitRepo}`
    : null;

  // Probe real loopback readiness before deciding healthStatus (honest state reporting).
  const readinessProbe = await probeLocalServiceReadiness(
    allocatedPort,
    blueprint.selfHealing.healthPath,
  );
  const initialHealthStatus = readinessProbe.reachable ? "HEALTHY" : "UNKNOWN";

  const website = await db.website.create({
    data: {
      name: blueprint.projectName,
      domain: blueprint.domain,
      runtime: preset.websiteRuntime,
      documentRoot,
      status: "ACTIVE",
      applicationPort: allocatedPort,
      buildCommand: blueprint.buildCommand || null,
      startupCommand: blueprint.startCommand || null,
      outputDirectory: blueprint.outputDirectory || null,
      gitRepo: normalizedGitRepo,
      gitBranch: blueprint.gitBranch,
      healthPath: blueprint.selfHealing.healthPath,
      healthStatus: initialHealthStatus,
      ownerId: actor.id,
      organizationId: organization.id,
    },
  });

  const isPlatformSubdomain = blueprint.domain.endsWith(".alolabs.net");
  const certExpiry = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);
  const domainRecord = await db.domain.create({
    data: {
      domain: blueprint.domain,
      websiteId: website.id,
      primary: true,
      sslEnabled: blueprint.autoSsl,
      sslStatus: blueprint.autoSsl ? "PENDING" : "NONE",
      certificateExpiry: null,
      nameservers: JSON.stringify(["ns1.alolabs.net", "ns2.alolabs.net"]),
      dnsVerified: isPlatformSubdomain,
    },
  });

  if (blueprint.autoSsl) {
    await db.sslCertificate.create({
      data: {
        domainId: domainRecord.id,
        issuer: isPlatformSubdomain
          ? "Cloudflare Edge / ALO AutoSSL (pending activation)"
          : "Let's Encrypt ACME (pending DNS & HTTP-01 challenge)",
        notBefore: new Date(),
        notAfter: certExpiry,
        autoRenew: true,
      },
    });
  }

  const appRecord = await db.application.create({
    data: {
      name: blueprint.projectName,
      websiteId: website.id,
      type: blueprint.stackId === "static-spa" ? "web" : "api",
      status: "active",
      runtime: preset.runtimeVersion,
      version: preset.pinnedVersion ?? "1.0.0",
      userId: actor.id,
      config: {
        zeroTerminal: true,
        stackId: blueprint.stackId,
        pinnedVersion: preset.pinnedVersion ?? null,
        idempotencyKey: options.idempotencyKey ?? null,
        workspaceSlug: organization.slug,
        documentRoot,
        securityProfile: blueprint.securityProfile,
        resources: blueprint.resources,
        selfHealing: blueprint.selfHealing,
      },
    },
  });

  let dbBlueprintRecord: { id: string; engine: string; name: string; port: number } | null = null;
  if (blueprint.database.enabled) {
    const dbPort = blueprint.database.engine === "POSTGRESQL" ? 5432 : 3306;
    const dbApp = await db.application.create({
      data: {
        name: blueprint.database.name,
        websiteId: website.id,
        type: "database",
        status: "active",
        runtime: blueprint.database.engine.toLowerCase(),
        userId: actor.id,
        config: {
          zeroTerminal: true,
          isolated: true,
          engine: blueprint.database.engine,
          databaseName: blueprint.database.name,
          host: "127.0.0.1",
          port: dbPort,
          note: "Database blueprint persisted; live engine role & credentials materialize via alo-database-helper on bare metal.",
        },
      },
    });
    dbBlueprintRecord = {
      id: dbApp.id,
      engine: blueprint.database.engine,
      name: blueprint.database.name,
      port: dbPort,
    };
  }

  const envPairs = new Map<string, { value: string; isSecret: boolean }>([
    ["NODE_ENV", { value: "production", isSecret: false }],
    ["ALO_WORKSPACE", { value: organization.slug, isSecret: false }],
    ["ALO_STACK_PRESET", { value: blueprint.stackId, isSecret: false }],
    ["ALO_SECURITY_PROFILE", { value: blueprint.securityProfile, isSecret: false }],
    ["ALO_EDGE_CACHE", { value: String(blueprint.resources.edgeCache), isSecret: false }],
    ["ALO_COMPRESSION", { value: String(blueprint.resources.compression), isSecret: false }],
    [
      "ALO_INTERNAL_SERVICE_TOKEN",
      { value: randomBytes(24).toString("hex"), isSecret: true },
    ],
  ]);
  if (allocatedPort) envPairs.set("PORT", { value: String(allocatedPort), isSecret: false });
  if (blueprint.database.enabled && dbBlueprintRecord) {
    envPairs.set("DB_ENGINE", { value: dbBlueprintRecord.engine, isSecret: false });
    envPairs.set("DB_HOST", { value: "127.0.0.1", isSecret: false });
    envPairs.set("DB_PORT", { value: String(dbBlueprintRecord.port), isSecret: false });
    envPairs.set("DB_NAME", { value: dbBlueprintRecord.name, isSecret: false });
  }
  for (const item of blueprint.envVars) {
    const looksSecret = /(SECRET|PASSWORD|TOKEN|API_KEY|PRIVATE_KEY)/i.test(item.key);
    envPairs.set(item.key, { value: item.value, isSecret: looksSecret });
  }

  await db.websiteEnvironment.createMany({
    data: [...envPairs.entries()].map(([key, entry]) => ({
      websiteId: website.id,
      key,
      value: entry.value,
      isSecret: entry.isSecret,
    })),
  });

  let backupCron: { id: string; schedule: string; frequency: string } | null = null;
  if (blueprint.backups.enabled) {
    const schedule = cronExpressionFor(blueprint.backups.frequency);
    const cron = await db.cronJob.create({
      data: {
        websiteId: website.id,
        name: "automated-site-backup",
        schedule,
        command: `/usr/local/sbin/alo-hosting-helper backup-site ${blueprint.domain}`,
        isActive: true,
        nextRunAt: new Date(Date.now() + 6 * 60 * 60 * 1000),
      },
    });
    backupCron = { id: cron.id, schedule: cron.schedule, frequency: blueprint.backups.frequency };
  }

  if (blueprint.selfHealing.enabled) {
    await db.healthCheck.create({
      data: {
        websiteId: website.id,
        systemdState: readinessProbe.reachable ? "active" : "pending-activation",
        localPort: readinessProbe.reachable,
        localHttp: readinessProbe.reachable,
        publicHttp: false,
        ssl: false,
        dns: isPlatformSubdomain,
        databaseConnectivity: null,
        overallStatus: initialHealthStatus,
      },
    });
  }

  await db.auditLog.create({
    data: {
      actorUserId: actor.id,
      actorEmail: actor.email,
      actorRole: actor.role,
      action: "AI_ZERO_TERMINAL_PROVISION",
      resourceType: "Website",
      resourceId: website.id,
      domain: blueprint.domain,
      result: "SUCCESS",
      ipAddress: options.ipAddress ?? null,
      metadata: {
        stackId: blueprint.stackId,
        pinnedVersion: preset.pinnedVersion ?? null,
        workspace: organization.slug,
        applicationId: appRecord.id,
        autoSsl: blueprint.autoSsl,
        database: dbBlueprintRecord,
        backupCron,
        selfHealing: blueprint.selfHealing,
        readinessState: readinessProbe.reachable ? "LIVE_HEALTHY" : "CONFIGURED_AWAITING_RELEASE",
      },
    },
  });

  return {
    idempotentReplay: false,
    website: {
      id: website.id,
      name: website.name,
      domain: website.domain,
      runtime: website.runtime,
      documentRoot: website.documentRoot,
      port: website.applicationPort,
      status: website.status,
      healthStatus: website.healthStatus,
      gitRepo: website.gitRepo,
      gitBranch: website.gitBranch,
    },
    workspace: {
      id: organization.id,
      name: organization.name,
      slug: organization.slug,
    },
    domain: {
      id: domainRecord.id,
      domain: domainRecord.domain,
      sslEnabled: domainRecord.sslEnabled,
      sslStatus: domainRecord.sslStatus,
      dnsVerified: domainRecord.dnsVerified,
    },
    application: {
      id: appRecord.id,
      runtime: appRecord.runtime,
      securityProfile: blueprint.securityProfile,
      resources: blueprint.resources,
    },
    database: dbBlueprintRecord,
    backups: backupCron,
    selfHealing: blueprint.selfHealing,
    readiness: {
      state: readinessProbe.reachable
        ? ("LIVE_HEALTHY" as const)
        : ("CONFIGURED_AWAITING_RELEASE" as const),
      reachable: readinessProbe.reachable,
      httpStatus: readinessProbe.httpStatus,
      checkedUrl: readinessProbe.checkedUrl,
      checkedAt: readinessProbe.checkedAt,
      note: readinessProbe.reachable
        ? "Service responded 2xx on loopback readiness endpoint."
        : "Blueprint persisted in database; service will report HEALTHY only after release activation passes loopback HTTP readiness.",
    },
  };
}
