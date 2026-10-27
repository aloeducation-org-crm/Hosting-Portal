/**
 * Zero-Terminal Self-Hosted AI Agent Deployment Assistant (Server Logic)
 *
 * Bridges the verified catalog (`self-hosted-agents.ts`), host hardware check,
 * commercial/open-core license gates, and hardened Docker helper
 * (`alo-docker-helper run-hardened`).
 */

import os from "os";
import { randomBytes } from "crypto";
import { db } from "@/lib/db";
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
