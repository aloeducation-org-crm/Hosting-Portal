import crypto from "node:crypto";
import { db } from "@/lib/db";
import { enqueueDeployment } from "./queue";
import { validateRepositoryName } from "./github";
import { verifyGitHubSignature } from "./signature";
import { decryptSecret } from "@/lib/encryption";

export { verifyGitHubSignature };

export interface WebhookResult {
  status: number;
  body: {
    result: string;
    reason?: string;
    deploymentId?: string | null;
    deliveryId?: string;
    signatureValid?: boolean;
  };
}

interface ParsedPush {
  repository: string;
  branch: string;
  sha: string;
  message: string;
  author: string;
  deleted: boolean;
  installationId: string | null;
}

function parsePush(payload: any): ParsedPush | null {
  if (!payload || typeof payload !== "object") return null;
  const ref = payload.ref;
  const sha = payload.after;
  const fullName = payload.repository?.full_name;
  if (typeof ref !== "string" || !ref.startsWith("refs/heads/")) return null;
  if (typeof sha !== "string" || !/^[0-9a-f]{40}$/.test(sha)) return null;
  let repository: string;
  try {
    repository = validateRepositoryName(String(fullName ?? ""));
  } catch {
    return null;
  }
  return {
    repository,
    branch: ref.slice("refs/heads/".length),
    sha,
    message: (String(payload.head_commit?.message ?? "").split("\n")[0] ?? "").slice(0, 500),
    author: String(payload.head_commit?.author?.name ?? payload.pusher?.name ?? "unknown").slice(0, 200),
    deleted: Boolean(payload.deleted),
    installationId: payload.installation?.id != null ? String(payload.installation.id) : null,
  };
}

function isUniqueViolation(error: unknown): boolean {
  return !!error && typeof error === "object" && "code" in error && (error as { code?: string }).code === "P2002";
}

/**
 * Verify -> deduplicate -> authorize -> enqueue.
 *
 * The payload never supplies a clone URL, filesystem path, command, branch
 * allowlist or destination: every one of those comes from the stored project.
 */
export async function handleGitHubWebhook(rawBody: string, headers: Headers): Promise<WebhookResult> {
  const event = headers.get("x-github-event") ?? "unknown";
  const deliveryId = headers.get("x-github-delivery");
  const signature = headers.get("x-hub-signature-256");
  const secret = process.env.GITHUB_WEBHOOK_SECRET || "";
  const payloadSha = crypto.createHash("sha256").update(rawBody).digest("hex");
  const common = { event, deliveryId: deliveryId ?? undefined };

  if (!deliveryId || !/^[A-Za-z0-9-]{1,100}$/.test(deliveryId)) {
    return { status: 400, body: { result: "rejected", reason: "missing or invalid X-GitHub-Delivery" } };
  }
  if (!secret) {
    return { status: 503, body: { result: "failed", reason: "GITHUB_WEBHOOK_SECRET is not configured" } };
  }
  // An App-level secret verifies all deliveries. For OAuth-created repository
  // hooks a project may have its own encrypted secret; the untrusted payload is
  // used ONLY to select that secret, never to authorize anything.
  const candidates = [secret];
  if (!verifyGitHubSignature(rawBody, signature, secret)) {
    try {
      const hint = JSON.parse(rawBody) as { repository?: { full_name?: string } };
      const repo = validateRepositoryName(String(hint.repository?.full_name ?? ""));
      const project = await db.gitProject.findFirst({ where: { repository: repo }, select: { webhookSecretEnc: true } });
      if (project?.webhookSecretEnc) candidates.push(decryptSecret(project.webhookSecretEnc));
    } catch { /* malformed payload simply has no extra candidate */ }
  }
  const signatureValid = candidates.some((candidate) => verifyGitHubSignature(rawBody, signature, candidate));
  if (!signatureValid) {
    await db.webhookDelivery
      .upsert({
        where: { deliveryId },
        create: { deliveryId, event, signatureValid: false, result: "rejected", reason: "invalid signature", payloadSha },
        update: { result: "rejected", reason: "invalid signature", signatureValid: false },
      })
      .catch(() => {});
    return { status: 401, body: { ...common, result: "rejected", reason: "invalid signature", signatureValid: false } };
  }

  // Reserve the delivery id. A repeated id is a retry/dedup case.
  let existing = await db.webhookDelivery.findUnique({ where: { deliveryId } });
  if (existing && existing.result !== "failed") {
    return {
      status: 200,
      body: { ...common, result: "duplicate", reason: "delivery already processed", deploymentId: existing.deploymentId, signatureValid: true },
    };
  }
  if (!existing) {
    try {
      existing = await db.webhookDelivery.create({
        data: { deliveryId, event, signatureValid: true, result: "processing", payloadSha },
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        const raced = await db.webhookDelivery.findUnique({ where: { deliveryId } });
        return { status: 200, body: { ...common, result: "duplicate", reason: "concurrent delivery", deploymentId: raced?.deploymentId, signatureValid: true } };
      }
      return { status: 500, body: { ...common, result: "failed", reason: "delivery ledger unavailable" } };
    }
  }

  const update = (data: Record<string, unknown>) =>
    db.webhookDelivery.update({ where: { deliveryId }, data: data as never }).catch(() => {});

  let payload: any;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    await update({ result: "failed", reason: "invalid JSON", repository: null });
    return { status: 400, body: { ...common, result: "failed", reason: "invalid JSON", signatureValid: true } };
  }

  const repository = typeof payload?.repository?.full_name === "string" ? String(payload.repository.full_name) : null;
  await update({ repository, action: typeof payload?.action === "string" ? payload.action : null, installationId: payload?.installation?.id != null ? String(payload.installation.id) : null });

  if (event === "ping") {
    await update({ result: "ignored", reason: "ping" });
    return { status: 200, body: { ...common, result: "ignored", reason: "ping", signatureValid: true } };
  }
  if (event === "pull_request") {
    await update({ result: "ignored", reason: "preview deployments are not enabled for this installation" });
    return { status: 200, body: { ...common, result: "ignored", reason: "preview deployments not enabled", signatureValid: true } };
  }
  if (event !== "push") {
    await update({ result: "ignored", reason: `unhandled event ${event}` });
    return { status: 200, body: { ...common, result: "ignored", reason: `unhandled event ${event}`, signatureValid: true } };
  }

  const push = parsePush(payload);
  if (!push) {
    await update({ result: "rejected", reason: "malformed push payload" });
    return { status: 400, body: { ...common, result: "rejected", reason: "malformed push payload", signatureValid: true } };
  }
  if (push.deleted) {
    await update({ result: "ignored", reason: "branch deleted" });
    return { status: 200, body: { ...common, result: "ignored", reason: "branch deleted", signatureValid: true } };
  }

  const project = await db.gitProject.findFirst({
    where: { repository: push.repository, productionBranch: push.branch },
  });
  if (!project) {
    await update({ result: "ignored", reason: `no project for ${push.repository}@${push.branch}` });
    return { status: 200, body: { ...common, result: "ignored", reason: "no project configured for this repository/branch", signatureValid: true } };
  }

  // Installation binding: a webhook signed with the right secret but carrying a
  // foreign installation id must not deploy.
  if (project.connectionId) {
    const connection = await db.gitConnection.findUnique({ where: { id: project.connectionId } });
    if (connection?.installationId && push.installationId && connection.installationId !== push.installationId) {
      await update({ result: "rejected", reason: "installation id does not match connection" });
      return { status: 403, body: { ...common, result: "rejected", reason: "installation mismatch", signatureValid: true } };
    }
  }

  if (!project.autoDeploy) {
    await update({ result: "ignored", reason: "automatic deployments disabled", projectId: project.id });
    return { status: 200, body: { ...common, result: "ignored", reason: "automatic deployments disabled", signatureValid: true } };
  }

  // Second dedup fence: GitHub occasionally sends the same push with a NEW
  // delivery id. Manual redeploys are exempt (trigger = manual).
  const recent = await db.deployment.findFirst({
    where: {
      projectId: project.id,
      commitHash: push.sha,
      trigger: "webhook",
      createdAt: { gte: new Date(Date.now() - 15 * 60_000) },
    },
    orderBy: { createdAt: "desc" },
  });
  if (recent) {
    await update({ result: "duplicate", reason: "commit already queued", projectId: project.id, deploymentId: recent.id });
    return { status: 200, body: { ...common, result: "duplicate", reason: "commit already queued", deploymentId: recent.id, signatureValid: true } };
  }

  try {
    const queued = await enqueueDeployment({
      projectId: project.id,
      commitSha: push.sha,
      commitMessage: push.message,
      commitAuthor: push.author,
      branch: push.branch,
      trigger: "webhook",
      deliveryId,
    });
    await update({ result: "queued", projectId: project.id, deploymentId: queued.deploymentId, reason: null });
    return { status: 202, body: { ...common, result: "queued", deploymentId: queued.deploymentId, signatureValid: true } };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "enqueue failed";
    await update({ result: "failed", reason: reason.slice(0, 300), projectId: project.id });
    return { status: 500, body: { ...common, result: "failed", reason: "could not queue deployment", signatureValid: true } };
  }
}
