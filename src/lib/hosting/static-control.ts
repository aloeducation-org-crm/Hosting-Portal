import { Prisma, type StaticHostingSite } from "@prisma/client";
import { z } from "zod";
import { isAdminRole, type AuthUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { validateRepositoryName } from "@/lib/deploy/github";
import { logger } from "@/lib/logger";
import { ACTIVE_STATES, TERMINAL_STATES, WorkerError, type JobState } from "@/lib/orchestrator/contracts";
import { scopesForUser } from "@/lib/orchestrator/workflows";
import { apiError } from "@/lib/response";
import { isStaticHostname, isStaticLabel, staticHostingConfig, STATIC_EVIDENCE_TTL_MS, STATIC_LIMITS, STATIC_SCOPES, SHA1, validStaticBranch } from "./static-config";


export const STATIC_RESOURCE = "StaticHostingSite";
export const STATIC_PUBLISH = "static-hosting-publish";
export const STATIC_VERIFY = "static-hosting-verify-https";
export const STATIC_WITHDRAW = "static-hosting-withdraw";
export const staticWithdrawKey = (id: string) => `${STATIC_WITHDRAW}:${id}`;
export const staticPublishKey = (id: string) => `${STATIC_PUBLISH}:${id}`;

export const staticRequest = z.strictObject({
  requestId: z.uuid(),
  repository: z.string().trim().max(240).refine((value) => {
    try { validateRepositoryName(value); return true; } catch { return false; }
  }, "Use a public GitHub owner/repository").transform((value) => validateRepositoryName(value).toLowerCase()),
  branch: z.string().trim().refine(validStaticBranch, "Use a supported GitHub branch name").optional(),
  label: z.string().trim().toLowerCase().refine(isStaticLabel, "Use up to 45 letters, numbers or hyphens, not a reserved hostname"),
  planId: z.uuid(),
  confirmPublish: z.literal(true),
});

async function activePlan(client: Pick<Prisma.TransactionClient, "subscription">, userId: string) {
  const now = new Date();
  return client.subscription.findFirst({
    where: { userId, status: "active", currentPeriodStart: { lte: now }, currentPeriodEnd: { gt: now }, plan: { isActive: true } },
    orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    select: { id: true, plan: { select: { id: true, name: true, maxSites: true } } },
  });
}

async function usedSlots(client: Pick<Prisma.TransactionClient, "website" | "staticHostingSite">, userId: string) {
  const websites = await client.website.count({ where: { ownerId: userId, deletedAt: null } });
  const staticSites = await client.staticHostingSite.count({ where: { ownerId: userId, withdrawnAt: null } });
  return websites + staticSites;
}

export function canRequestStatic(user: AuthUser) {
  return user.emailVerified === true && (user.role === "SUPER_ADMIN" ||
    ["WEBSITE_CREATE", "WEBSITE_DEPLOY"].every((permission) => user.permissions.includes(permission)));
}

export async function requestStaticSite(user: AuthUser, input: z.output<typeof staticRequest>) {
  if (!canRequestStatic(user)) throw apiError("A verified account with website create and deploy permissions is required.", "FORBIDDEN", undefined, 403);
  const config = staticHostingConfig();
  if (!config) throw apiError("Managed static hosting is not enabled on this installation.", "NOT_CONFIGURED", undefined, 503);
  const hostname = `${input.label}.${config.domain}`;
  try {
    return await db.$transaction(async (tx) => {
      const previous = await tx.staticHostingSite.findUnique({ where: { ownerId_requestId: { ownerId: user.id, requestId: input.requestId } } });
      if (previous) {
        if (previous.hostname !== hostname || previous.repository !== input.repository || previous.requestedRef !== (input.branch ?? null) || previous.planId !== input.planId) {
          throw apiError("This request ID was already used for different deployment details.", "IDEMPOTENCY_CONFLICT", undefined, 409);
        }
        return previous;
      }
      const subscription = await activePlan(tx, user.id);
      if (!subscription || subscription.plan.id !== input.planId) {
        throw apiError("Select your active hosting plan. New plans must be authorized in Billing before deployment.", "PLAN_REQUIRED", undefined, 402);
      }
      if (await usedSlots(tx, user.id) >= subscription.plan.maxSites) {
        throw apiError("Your plan has no website slots left.", "PLAN_LIMIT_EXCEEDED", undefined, 403);
      }
      if (await tx.staticHostingSite.count() >= config.maxReservations) {
        throw apiError("The managed static host is at its configured reservation limit.", "HOST_CAPACITY", undefined, 503);
      }
      if (await tx.staticHostingSite.findUnique({ where: { hostname }, select: { id: true } }) ||
          await tx.website.findUnique({ where: { domain: hostname }, select: { id: true } }) ||
          await tx.domain.findUnique({ where: { domain: hostname }, select: { id: true } }) ||
          await tx.site.findUnique({ where: { domainName: hostname }, select: { id: true } })) {
        throw apiError("That managed hostname is unavailable.", "HOSTNAME_UNAVAILABLE", undefined, 409);
      }
      const site = await tx.staticHostingSite.create({ data: {
        ownerId: user.id, planId: input.planId, subscriptionId: subscription.id, requestId: input.requestId,
        hostname, repository: input.repository, requestedRef: input.branch,
      } });
      // Consent, quota reservation and durable handoff commit together.
      await tx.auditLog.create({ data: {
        actorUserId: user.id, actorEmail: user.email, actorRole: user.role, action: "STATIC_HOSTING_REQUESTED",
        resourceType: STATIC_RESOURCE, resourceId: site.id, requestId: input.requestId, domain: hostname, result: "REQUESTED",
        metadata: { repository: site.repository, planId: site.planId, subscriptionId: site.subscriptionId, publicPublishConfirmed: true, newCharges: false },
      } });
      return site;
    }, { timeout: 10_000 });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw apiError("That managed hostname is unavailable.", "HOSTNAME_UNAVAILABLE", undefined, 409);
    }
    throw error;
  }
}

export async function staticSiteActor(site: Pick<StaticHostingSite, "ownerId" | "subscriptionId" | "planId">, options: { withdrawing?: boolean } = {}) {
  const account = await db.user.findUnique({ where: { id: site.ownerId }, include: { role: { include: { permissions: { include: { permission: true } } } } } });
  if (!account?.isActive || account.isLocked || !canRequestStatic({
    id: account.id, email: account.email, role: account.role.name,
    permissions: account.role.permissions.map((p) => p.permission.name), emailVerified: Boolean(account.emailVerified),
  })) throw new WorkerError("FORBIDDEN", "Website deployment access is no longer authorized for this account.", false);
  if (!options.withdrawing) {
    const subscription = await activePlan(db, site.ownerId);
    if (!subscription || subscription.id !== site.subscriptionId || subscription.plan.id !== site.planId || await usedSlots(db, site.ownerId) > subscription.plan.maxSites) {
      throw new WorkerError("FORBIDDEN", "The hosting plan, billing period or website quota changed. Contact the operator before retrying.", false);
    }
  }
  return { id: account.id, email: account.email, role: account.role.name,
    scopes: scopesForUser({ role: account.role.name, permissions: account.role.permissions.map((p) => p.permission.name) }) };
}

/** Replays a durable customer request if the worker stopped before creating or
 * linking its job. The operation job's unique key is the cross-process guard. */
export async function reconcileStaticHostingRequests(limit: number): Promise<number> {
  if (!staticHostingConfig()) return 0;
  const due = await db.staticHostingSite.findMany({ where: { initialJobId: null, queueError: null }, orderBy: { createdAt: "asc" }, take: limit });
  if (!due.length) return 0;
  const { orchestrator } = await import("@/lib/orchestrator/orchestrator");
  let attached = 0;
  for (const site of due) {
    try {
      const existing = await db.operationJob.findUnique({ where: { idempotencyKey: staticPublishKey(site.id) }, select: { id: true } });
      const jobId = existing?.id ?? (await orchestrator.enqueue({
        kind: "STATIC_HOSTING", type: STATIC_PUBLISH, actor: await staticSiteActor(site), input: { action: "publish", siteId: site.id },
        resourceType: STATIC_RESOURCE, resourceId: site.id, lockKey: `static-site:${site.id}`, idempotencyKey: staticPublishKey(site.id),
        correlationId: site.requestId,
      })).jobId;
      const linked = await db.staticHostingSite.updateMany({ where: { id: site.id, initialJobId: null }, data: { initialJobId: jobId } });
      attached += linked.count;
    } catch (error) {
      if (error instanceof WorkerError && error.code === "FORBIDDEN") {
        await db.staticHostingSite.updateMany({ where: { id: site.id, initialJobId: null }, data: { queueError: error.message } });
      } else logger.error({ siteId: site.id }, "could not attach a managed static hosting job; will retry");
    }
  }
  return attached;
}

export async function requestStaticHttpsCheck(user: AuthUser, siteId: string) {
  if (!canRequestStatic(user)) throw apiError("Website deploy access is required.", "FORBIDDEN", undefined, 403);
  const config = staticHostingConfig();
  if (!config?.publicIpv4) throw apiError("The operator has not configured public ingress verification.", "NOT_CONFIGURED", undefined, 503);
  const site = await db.staticHostingSite.findFirst({ where: { id: siteId, ownerId: user.id } });
  if (!site) throw apiError("Static site not found.", "NOT_FOUND", undefined, 404);
  const initial = site.initialJobId && await db.operationJob.findUnique({ where: { id: site.initialJobId }, select: { status: true } });
  if (site.withdrawnAt || !initial || initial.status !== "SUCCESS" || !isStaticHostname(site.hostname, config.domain)) {
    throw apiError("The local origin must first serve a verified release.", "ORIGIN_NOT_VERIFIED", undefined, 409);
  }
  const withdrawal = await db.operationJob.findUnique({ where: { idempotencyKey: staticWithdrawKey(siteId) }, select: { id: true } });
  if (withdrawal) throw apiError("This site has a withdrawal request.", "WITHDRAWAL_REQUESTED", undefined, 409);
  // Do not build an unbounded queue of checks while the worker is offline.
  // The minute key below collapses simultaneous requests from multiple panels.
  const pending = await db.operationJob.findFirst({
    where: { resourceType: STATIC_RESOURCE, resourceId: siteId, workerKind: "STATIC_HOSTING", type: STATIC_VERIFY, status: { in: [...ACTIVE_STATES] } },
    select: { id: true }, orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });
  if (pending) return { jobId: pending.id };
  const { orchestrator } = await import("@/lib/orchestrator/orchestrator");
  return orchestrator.enqueue({ kind: "STATIC_HOSTING", type: STATIC_VERIFY, input: { action: "verify-https", siteId },
    actor: { ...user, scopes: [...STATIC_SCOPES] }, resourceType: STATIC_RESOURCE, resourceId: siteId,
    lockKey: `static-site:${siteId}`, idempotencyKey: `${STATIC_VERIFY}:${siteId}:${Math.floor(Date.now() / 60_000)}`,
  });
}

export async function requestStaticWithdrawal(user: AuthUser, siteId: string, confirmHostname: string) {
  if (!canRequestStatic(user)) throw apiError("Website access is required.", "FORBIDDEN", undefined, 403);
  if (!staticHostingConfig()) throw apiError("Managed static hosting is disabled.", "NOT_CONFIGURED", undefined, 503);
  const site = await db.staticHostingSite.findFirst({ where: { id: siteId, ownerId: user.id } });
  if (!site) throw apiError("Static site not found.", "NOT_FOUND", undefined, 404);
  if (confirmHostname !== site.hostname) throw apiError("Confirm the exact hostname before withdrawing this release.", "CONFIRMATION_REQUIRED", undefined, 409);
  const initial = site.initialJobId && await db.operationJob.findUnique({ where: { id: site.initialJobId }, select: { status: true } });
  if (!site.queueError && (!initial || !TERMINAL_STATES.includes(initial.status as JobState))) {
    throw apiError("Wait for the initial deployment job to finish before withdrawing the site.", "DEPLOYMENT_ACTIVE", undefined, 409);
  }
  const { orchestrator } = await import("@/lib/orchestrator/orchestrator");
  return orchestrator.enqueue({ kind: "STATIC_HOSTING", type: STATIC_WITHDRAW, input: { action: "withdraw", siteId, confirmHostname },
    actor: { ...user, scopes: [...STATIC_SCOPES] }, resourceType: STATIC_RESOURCE, resourceId: siteId,
    lockKey: `static-site:${siteId}`, idempotencyKey: staticWithdrawKey(siteId),
  });
}

const evidenceSchema = z.object({
  commitSha: z.string().regex(SHA1), treeSha: z.string().regex(SHA1), originVerifiedAt: z.iso.datetime(),
  files: z.number().int().min(1).max(STATIC_LIMITS.files), bytes: z.number().int().min(1).max(STATIC_LIMITS.releaseBytes),
  public: z.object({
    status: z.enum(["NOT_CONFIGURED", "DNS_NOT_VERIFIED", "HTTPS_NOT_VERIFIED", "VERIFIED"]),
    checkedAt: z.iso.datetime(), ingressIpv4: z.ipv4().optional(), url: z.string().optional(),
  }),
});

function parseEvidence(text: string | null, site: Pick<StaticHostingSite, "commitSha" | "treeSha">) {
  try {
    const result = JSON.parse(text ?? "null")?.result;
    if (result?.ok !== true || result.verified !== true) return null;
    const evidence = evidenceSchema.safeParse(result.data);
    if (!evidence.success || evidence.data.commitSha !== site.commitSha || evidence.data.treeSha !== site.treeSha) return null;
    return evidence.data;
  } catch { return null; }
}

const eventSchema = z.object({ at: z.iso.datetime(), percent: z.number().min(0).max(100), message: z.string().max(1000) });
function publicJobEvents(output: string | null | undefined) {
  try {
    const events: unknown = JSON.parse(output ?? "null")?.events;
    if (!Array.isArray(events)) return [];
    return events.slice(-20).flatMap((event) => {
      const parsed = eventSchema.safeParse(event);
      return parsed.success ? [parsed.data] : [];
    });
  } catch { return []; }
}

export async function getStaticHostingStatus(user: AuthUser, all = false) {
  if (all && (!isAdminRole(user.role) || !user.emailVerified)) throw apiError("Operator access required.", "FORBIDDEN", undefined, 403);
  const config = staticHostingConfig();
  if (!config) return { domain: null, publicCheckConfigured: false, canDeploy: false, limits: STATIC_LIMITS, plan: null, sites: [] };
  const sites = await db.staticHostingSite.findMany({ where: all ? {} : { ownerId: user.id }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 100 });
  const jobs = await db.operationJob.findMany({
    where: { OR: [{ id: { in: sites.flatMap((site) => site.initialJobId ? [site.initialJobId] : []) } },
      { idempotencyKey: { in: sites.map((site) => staticWithdrawKey(site.id)) } }] },
    select: { id: true, idempotencyKey: true, status: true, error: true, output: true, progress: true },
  });
  const jobById = new Map(jobs.map((job) => [job.id, job]));
  const jobByKey = new Map(jobs.map((job) => [job.idempotencyKey, job]));
  const subscription = all ? null : await activePlan(db, user.id);
  const slots = subscription ? await usedSlots(db, user.id) : 0;
  return { domain: config.domain, publicCheckConfigured: Boolean(config.publicIpv4), canDeploy: !all && canRequestStatic(user), limits: STATIC_LIMITS,
    plan: subscription ? { ...subscription.plan, usedSites: slots } : null,
    sites: await Promise.all(sites.map(async (site) => {
      const job = site.initialJobId ? jobById.get(site.initialJobId) : undefined;
      const withdrawal = jobByKey.get(staticWithdrawKey(site.id));
      const inZone = isStaticHostname(site.hostname, config.domain);
      const evidence = inZone && job?.status === "SUCCESS" ? parseEvidence(job.output, site) : null;
      const verification = evidence && config.publicIpv4 && !site.withdrawnAt ? await db.operationJob.findFirst({
        where: { resourceType: STATIC_RESOURCE, resourceId: site.id, type: STATIC_VERIFY, workerKind: "STATIC_HOSTING" },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { status: true, output: true, error: true },
      }) : null;
      const latest = verification?.status === "SUCCESS" ? parseEvidence(verification.output, site) : null;
      const withheld = site.withdrawnAt || withdrawal || (verification && TERMINAL_STATES.includes(verification.status as JobState) && !latest);
      const observed = withheld ? null : latest ?? evidence;
      const pub = observed?.public;
      const sameIngress = Boolean(config.publicIpv4 && pub?.ingressIpv4 === config.publicIpv4);
      const age = pub ? Date.now() - Date.parse(pub.checkedAt) : Infinity;
      const url = inZone && sameIngress && age >= 0 && age <= STATIC_EVIDENCE_TTL_MS && pub?.status === "VERIFIED" &&
        pub.url === `https://${site.hostname}` ? pub.url : null;
      const publicEvidence = pub ? {
        status: pub.status === "NOT_CONFIGURED" || (sameIngress && pub.status !== "VERIFIED") ? pub.status : url ? "VERIFIED" : "CHECK_REQUIRED",
        checkedAt: pub.checkedAt, ...(url ? { url } : {}),
      } : null;
      return { id: site.id, ...(all ? { ownerId: site.ownerId } : {}), hostname: site.hostname, repository: site.repository,
        branch: site.sourceBranch ?? site.requestedRef, commitSha: site.commitSha, jobId: site.initialJobId,
        status: job?.status ?? (site.queueError ? "FAILED" : "REQUESTED"), progress: job?.progress ?? 0, events: publicJobEvents(job?.output),
        error: site.queueError ?? job?.error ?? (job?.status === "DEAD_LETTER" ? "The worker stopped before completing this release." : null),
        originVerifiedAt: site.withdrawnAt ? null : (latest ?? evidence)?.originVerifiedAt ?? null, files: evidence?.files ?? null, bytes: evidence?.bytes ?? null,
        withdrawnAt: site.withdrawnAt?.toISOString() ?? null, withdrawalStatus: withdrawal?.status ?? null, withdrawalError: withdrawal?.error ?? null,
        public: publicEvidence, verificationJobStatus: verification?.status ?? null, verificationError: verification?.error ?? null,
      };
    })),
  };
}
