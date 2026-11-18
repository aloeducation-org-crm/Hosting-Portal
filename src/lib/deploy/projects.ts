import crypto from "node:crypto";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { detectFramework, memoryReader, fsReader } from "./detect";
import fs from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const execFileAsync = promisify(execFile);
import { configFromDetection, validateDeployConfig } from "./config";
import { isReservedServiceName } from "./host-settings";
import { allocateFreePort } from "./provision";
import {
  resolveToken,
  validateRepositoryName,
  getRepository,
  getCommit,
  fetchRepoManifests,
  createWebhook,
  cloneUrlFor,
  type TokenSource,
} from "./github";
import { encryptSecret } from "@/lib/encryption";
import type { AuthUser } from "@/lib/auth";
import { requireConnectionAccess, tokenForConnection, assertRepositoryAllowedForSource } from "./connections";
import type { DetectionResult } from "./types";

export interface ImportInput {
  userId: string;
  /** The authenticated caller. Required so the connection can be authorized. */
  user: AuthUser;
  repository: string;
  productionBranch?: string;
  previewBranches?: string[];
  connectionId?: string | null;
  autoDeploy?: boolean;
  /** Staging/local source override; never accepted from a webhook. */
  cloneUrlOverride?: string;
  port?: number;
  healthUrl?: string;
  domain?: string;
}

export interface ImportResult {
  project: any;
  website: any;
  detection: DetectionResult;
  webhook: { created: boolean; id?: string; reason?: string };
  warnings: string[];
}

/**
 * Resolve GitHub credentials for a caller.
 *
 * SEC-02: this used to accept any connection id and return a token for it. It
 * now requires the authenticated user, and a supplied connection id is
 * authorized through `requireConnectionAccess` before a token is minted. Kept as
 * a thin wrapper so existing call sites keep working while the ownership check
 * is impossible to forget.
 */
export async function accessToken(
  user: AuthUser,
  connectionId?: string | null,
  context: { route?: string } = {},
): Promise<TokenSource> {
  if (!connectionId) return tokenForConnection(null);
  const connection = await requireConnectionAccess(user, connectionId, context);
  return tokenForConnection(connection);
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

/**
 * Allocate a free application port.
 *
 * Delegates to `allocateFreePort`, which checks the database (GitProject ports
 * AND Website applicationPorts), the reserved platform port registry, and a
 * live OS-level TCP bind probe. The previous implementation only checked
 * GitProject ports, started at 4100, and could hand out a port an OS process
 * already owned. `DEPLOY_STATIC_PORT_BASE` (if set) is honored as the preferred
 * starting port, otherwise the host registry base (3062) is used.
 */
async function allocatePort(): Promise<number> {
  const preferred = Number(process.env.DEPLOY_STATIC_PORT_BASE || 0);
  return allocateFreePort(preferred > 0 ? preferred : undefined);
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
  const source = input.cloneUrlOverride
    ? null
    : await accessToken(input.user, input.connectionId, { route: "POST /api/deploy/projects" });

  let manifests: Record<string, string> = {};
  let detectionSource: ReturnType<typeof fsReader> | null = null;
  let branch = input.productionBranch || "main";
  let defaultBranch = branch;
  if (source?.token) {
    try {
      const info = await getRepository(source.token, repository);
      await assertRepositoryAllowedForSource(source, { private: info.private, fullName: repository });
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

  // Long-running Node runtimes are served by PM2 automatically: the panel
  // registers and restarts the process (see provision.ts / alo-app-helper), so
  // a GitHub push can deploy a Next.js/Node app end-to-end without an operator
  // wiring a service manager first. Non-Node runtimes (Python/PHP) still need
  // an operator-configured service manager, so they stay paused for approval.
  const NODE_SERVER_FRAMEWORKS = ["nextjs", "nuxt", "nestjs", "express", "fastify", "koa", "hono", "node"];
  if (NODE_SERVER_FRAMEWORKS.includes(detection.framework)) {
    config.serviceManager = "pm2";
    // Derive a safe PM2 app name, ensuring it never collides with a reserved
    // platform unit (e.g. a repo named "hosting" would otherwise map to the
    // control-plane "alo-hosting" process).
    let serviceName = `alo-${slugify(repository.split("/").pop() ?? "app")}`;
    let guard = 0;
    while (isReservedServiceName(serviceName) && guard < 5) {
      serviceName = `${serviceName}-app`;
      guard++;
    }
    config.serviceName = serviceName;
    config.requiresApproval = detection.ambiguous;
    warnings.push(`${detection.framework} will be served by a PM2 process managed by the panel`);
  } else if (["django", "fastapi", "flask", "python", "php-composer", "laravel"].includes(detection.framework)) {
    config.serviceManager = "none"; // operator must wire pm2/systemd before enabling
    config.requiresApproval = true;
    warnings.push(`${detection.framework} needs an operator-configured service manager; automatic deploys stay paused until confirmed`);
  }

  const domain = input.domain ?? (await uniqueDomain(repository));
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

  // Pin the exact commit at import time so the lifecycle workflow never deploys a moving branch.
  let commitSha: string | null = null;
  if (source?.token) {
    const commit = await getCommit(source.token, repository, branch).catch(() => null);
    commitSha = commit?.sha ?? null;
  } else if (input.cloneUrlOverride?.startsWith("/")) {
    const rev = await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: input.cloneUrlOverride }).catch(() => null);
    commitSha = rev?.stdout.trim() ?? null;
  }
  if (commitSha) await db.gitProject.update({ where: { id: project.id }, data: { lastCommitSha: commitSha } });
  if (input.domain) {
    await db.domain.upsert({ where: { domain }, create: { domain, websiteId: website.id, primary: true, nameservers: "[]", sslStatus: "NONE", dnsVerified: false }, update: {} });
  }

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

  return { project: { ...project, lastCommitSha: commitSha ?? project.lastCommitSha }, website, detection, webhook, warnings };
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
