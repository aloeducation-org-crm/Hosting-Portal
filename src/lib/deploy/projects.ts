import crypto from "node:crypto";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { detectFramework, memoryReader, fsReader } from "./detect";
import fs from "node:fs/promises";
import { configFromDetection, validateDeployConfig } from "./config";
import {
  resolveToken,
  validateRepositoryName,
  getRepository,
  fetchRepoManifests,
  createWebhook,
  cloneUrlFor,
  type TokenSource,
} from "./github";
import { encryptSecret } from "@/lib/encryption";
import type { DetectionResult } from "./types";

export interface ImportInput {
  userId: string;
  repository: string;
  productionBranch?: string;
  previewBranches?: string[];
  connectionId?: string | null;
  autoDeploy?: boolean;
  /** Staging/local source override; never accepted from a webhook. */
  cloneUrlOverride?: string;
  port?: number;
  healthUrl?: string;
}

export interface ImportResult {
  project: any;
  website: any;
  detection: DetectionResult;
  webhook: { created: boolean; id?: string; reason?: string };
  warnings: string[];
}

export async function accessToken(connectionId?: string | null): Promise<TokenSource> {
  const connection = connectionId ? await db.gitConnection.findUnique({ where: { id: connectionId } }) : null;
  const source = await resolveToken(connection);
  if (!source.token) {
    throw new Error("No GitHub credentials available. Connect a GitHub account or configure a GitHub App/token first.");
  }
  return source;
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "app";
}

async function uniqueDomain(repository: string): Promise<string> {
  const suffix = (process.env.DEPLOY_DOMAIN_SUFFIX || "apps.alolabs.net").replace(/^\.+/, "");
  const base = slugify(repository.split("/").pop() ?? "app");
  for (let i = 0; i < 20; i++) {
    const candidate = i === 0 ? `${base}.${suffix}` : `${base}-${crypto.randomBytes(2).toString("hex")}.${suffix}`;
    const existing = await db.website.findUnique({ where: { domain: candidate } });
    if (!existing) return candidate;
  }
  throw new Error("Could not allocate a unique project domain");
}

async function allocatePort(): Promise<number> {
  const base = Number(process.env.DEPLOY_STATIC_PORT_BASE || 4100);
  const used = new Set((await db.gitProject.findMany({ select: { port: true } })).map((p) => p.port));
  for (let port = base; port < base + 200; port++) if (!used.has(port)) return port;
  throw new Error("No free deployment port available");
}

function runtimeFor(detection: DetectionResult): "STATIC" | "NODE" | "NEXTJS" | "PHP82" {
  if (detection.framework === "nextjs") return "NEXTJS";
  if (["static-html", "vite", "create-react-app"].includes(detection.framework)) return "STATIC";
  if (detection.language === "php") return "PHP82";
  return "NODE";
}

export async function importRepository(input: ImportInput): Promise<ImportResult> {
  const warnings: string[] = [];
  const repository = validateRepositoryName(input.repository);
  const source = input.cloneUrlOverride ? null : await accessToken(input.connectionId);

  let manifests: Record<string, string> = {};
  let detectionSource: ReturnType<typeof fsReader> | null = null;
  let branch = input.productionBranch || "main";
  let defaultBranch = branch;
  if (source?.token) {
    try {
      const info = await getRepository(source.token, repository);
      defaultBranch = input.productionBranch || info.defaultBranch;
      branch = defaultBranch;
      const result = await fetchRepoManifests(source.token, repository, branch);
      manifests = result.files;
      if (result.truncated) warnings.push("Repository tree is large; detection inspected the first 250 files");
    } catch (error) {
      warnings.push(`Could not read repository manifests: ${error instanceof Error ? error.message : "unknown error"}`);
    }
  } else if (input.cloneUrlOverride && input.cloneUrlOverride.startsWith("/")) {
    // Staging source: read the checked-out working tree so detection at import
    // is based on real manifests rather than an empty file set.
    try {
      const stat = await fs.stat(input.cloneUrlOverride);
      if (stat.isDirectory()) {
        detectionSource = fsReader(input.cloneUrlOverride);
        warnings.push("Detection read from the local staging checkout at import time");
      }
    } catch { /* fall through to deploy-time detection */ }
  } else {
    warnings.push("Detection will run again at deploy time from the checkout (no API manifests supplied)");
  }

  const detection = await detectFramework(detectionSource ?? memoryReader(manifests));
  const config = configFromDetection(detection);
  const port = input.port ?? (await allocatePort());
  config.port = port;
  if (["nextjs", "nestjs", "express", "fastify", "koa", "django", "fastapi", "flask", "laravel"].includes(detection.framework)) {
    config.serviceManager = "none"; // operator must wire pm2/systemd before enabling
    config.requiresApproval = true;
    warnings.push(`${detection.framework} needs an operator-configured service manager; automatic deploys stay paused until confirmed`);
  }

  const domain = await uniqueDomain(repository);
  const website = await db.website.create({
    data: {
      domain,
      name: repository,
      runtime: runtimeFor(detection),
      status: "ACTIVE",
      ownerId: input.userId,
      gitRepo: repository,
      gitBranch: branch,
      buildCommand: config.buildCmd,
      outputDirectory: config.outputDir,
      healthPath: config.healthPath,
      applicationPort: port,
    },
  });

  const secret = process.env.GITHUB_WEBHOOK_SECRET || "";
  const project = await db.gitProject.create({
    data: {
      websiteId: website.id,
      connectionId: input.connectionId ?? null,
      repository,
      // Token-free URL; the engine injects a short-lived token at checkout.
      cloneUrl: input.cloneUrlOverride || cloneUrlFor(repository, null),
      productionBranch: branch,
      previewBranches: JSON.stringify((input.previewBranches ?? []).slice(0, 20)),
      autoDeploy: input.autoDeploy ?? !config.requiresApproval,
      requiresApproval: config.requiresApproval,
      detection: JSON.stringify(detection),
      config: JSON.stringify(validateDeployConfig(config)),
      detectionStatus: detection.ambiguous ? "ambiguous" : "detected",
      healthPath: config.healthPath,
      healthUrl: input.healthUrl ?? null,
      serviceManager: config.serviceManager,
      port,
      webhookSecretEnc: secret ? encryptSecret(secret) : null,
      createdById: input.userId,
    },
  });

  let webhook: ImportResult["webhook"] = { created: false, reason: "GITHUB_WEBHOOK_SECRET or APP_URL not configured" };
  if (source?.token && secret && env.APP_URL) {
    try {
      const callbackUrl = `${env.APP_URL.replace(/\/$/, "")}/api/github/webhook`;
      const id = await createWebhook(source.token, repository, callbackUrl, secret);
      await db.gitProject.update({ where: { id: project.id }, data: { webhookId: id } });
      webhook = { created: true, id };
    } catch (error) {
      webhook = { created: false, reason: error instanceof Error ? error.message : "webhook creation failed" };
      warnings.push(`Webhook was NOT created automatically: ${webhook.reason}`);
    }
  }

  return { project, website, detection, webhook, warnings };
}

/** Never serialize stored credentials. */
export function publicConnection(connection: { id: string; mode: string; accountLogin: string; accountType: string | null; status: string; installationId: string | null; createdAt: Date }) {
  return {
    id: connection.id,
    mode: connection.mode,
    accountLogin: connection.accountLogin,
    accountType: connection.accountType,
    status: connection.status,
    installationId: connection.installationId,
    createdAt: connection.createdAt,
  };
}
