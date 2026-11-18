import { lstat } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { db } from "@/lib/db";
import { defineWorker, ok, WorkerError } from "@/lib/orchestrator/contracts";
import { staticHostingConfig, isStaticHostname, STATIC_SCOPES } from "./static-config";
import { staticSiteActor, staticPublishKey, staticWithdrawKey, STATIC_RESOURCE, STATIC_PUBLISH, STATIC_VERIFY, STATIC_WITHDRAW } from "./static-control";
import { existingStaticRelease, holdStaticRelease, publishStaticRelease, verifyStaticOrigin, verifyStaticPublic, verifyStaticWithdrawal, type StaticPublicEvidence } from "./static-release";
import { pinStaticSource, type StaticSourcePin } from "./static-source";

const inputSchema = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("publish"), siteId: z.uuid() }),
  z.strictObject({ action: z.literal("verify-https"), siteId: z.uuid() }),
  z.strictObject({ action: z.literal("withdraw"), siteId: z.uuid(), confirmHostname: z.string().max(253) }),
]);

type StaticHostingResult = { withdrawnAt: string } | (StaticSourcePin & { originVerifiedAt: string; files: number; bytes: number; public: StaticPublicEvidence });

export const staticHostingWorker = defineWorker<z.output<typeof inputSchema>, StaticHostingResult>({
  kind: "STATIC_HOSTING",
  label: "Managed static hosting",
  description: "Pins public GitHub content, publishes validated static assets without running repository code, and verifies the edge's observed release.",
  execution: "EXTERNAL",
  maxRisk: "REVERSIBLE",
  riskForInput: (input) => input.action === "verify-https" ? "READ_ONLY" : "REVERSIBLE",
  requiredScopes: [...STATIC_SCOPES],
  retrySafe: true,
  defaultMaxAttempts: 3,
  defaultTimeoutMs: 180_000,
  inputSchema,
  async handler(input, ctx) {
    const { siteId, action } = input;
    const config = staticHostingConfig();
    if (!config) throw new WorkerError("NOT_CONFIGURED", "Managed static hosting is disabled.", false);
    const [site, job] = await Promise.all([
      db.staticHostingSite.findUnique({ where: { id: siteId } }),
      db.operationJob.findUnique({ where: { id: ctx.jobId }, select: { idempotencyKey: true, resourceId: true, resourceType: true, type: true, lockKey: true, attempts: true, leasedBy: true } }),
    ]);
    if (!site || site.ownerId !== ctx.actor?.id || job?.resourceType !== STATIC_RESOURCE || job.resourceId !== siteId || job.lockKey !== `static-site:${siteId}` ||
        (action === "publish" && (job.idempotencyKey !== staticPublishKey(siteId) || job.type !== STATIC_PUBLISH)) ||
        (action === "verify-https" && job.type !== STATIC_VERIFY) ||
        (action === "withdraw" && (job.idempotencyKey !== staticWithdrawKey(siteId) || job.type !== STATIC_WITHDRAW || input.confirmHostname !== site.hostname))) {
      throw new WorkerError("FORBIDDEN", "This job does not belong to an authorized hosting request.", false);
    }
    if (!isStaticHostname(site.hostname, config.domain)) throw new WorkerError("NOT_CONFIGURED", "The managed hosting zone has changed.", false);
    if (site.withdrawnAt && action !== "withdraw") throw new WorkerError("FORBIDDEN", "The site has been withdrawn.", false);
    await staticSiteActor(site, { withdrawing: action === "withdraw" });
    const checkLease = async () => {
      ctx.signal.throwIfAborted();
      const current = await db.operationJob.findFirst({ where: { id: ctx.jobId, leasedBy: job.leasedBy, attempts: job.attempts,
        status: "RUNNING", cancelledAt: null, leaseExpiresAt: { gt: new Date() } }, select: { id: true } });
      if (!current) throw new WorkerError("CANCELLED", "Deployment lease is no longer valid.", false);
    };
    let pin = site.commitSha && site.treeSha && site.sourceBranch ? { commitSha: site.commitSha, treeSha: site.treeSha, sourceBranch: site.sourceBranch } : null;
    if (action === "withdraw") {
      await ctx.progress(30, "Removing the confirmed hostname from the serving tree without deleting its assets");
      await checkLease();
      if (pin) await holdStaticRelease(config, { ...pin, siteId, hostname: site.hostname, repository: site.repository });
      else {
        const present = await lstat(path.join(config.root, site.hostname)).catch((error: NodeJS.ErrnoException) => {
          if (error.code === "ENOENT") return null;
          throw error;
        });
        if (present) throw new WorkerError("VERIFICATION_REQUIRED", "Refusing to move a release with unknown ownership.", false);
      }
      const withdrawnAt = await verifyStaticWithdrawal(config, site.hostname, ctx.signal);
      await checkLease();
      await db.staticHostingSite.updateMany({ where: { id: siteId, withdrawnAt: null }, data: { withdrawnAt } });
      return ok({ withdrawnAt }, "The static origin no longer serves the release; files were retained.", { evidence: `origin-404=${withdrawnAt}` });
    }
    if (!pin) {
      if (action !== "publish") throw new WorkerError("VERIFICATION_REQUIRED", "There is no pinned release to check.", false);
      await ctx.progress(10, "Resolving the public GitHub branch to an immutable commit");
      const observed = await pinStaticSource(site.repository, site.requestedRef, ctx.signal);
      await checkLease();
      await db.staticHostingSite.updateMany({ where: { id: site.id, commitSha: null, withdrawnAt: null }, data: observed });
      // First writer wins even if an expired worker resumes at the same time.
      const saved = await db.staticHostingSite.findUniqueOrThrow({ where: { id: site.id } });
      if (!saved.commitSha || !saved.treeSha || !saved.sourceBranch) throw new WorkerError("VERIFICATION_REQUIRED", "Could not persist the exact GitHub commit.", false);
      pin = { commitSha: saved.commitSha, treeSha: saved.treeSha, sourceBranch: saved.sourceBranch };
    }
    const release = { ...pin, siteId, hostname: site.hostname, repository: site.repository };
    await ctx.progress(30, action === "publish" ? "Validating and packaging build-free static assets" : "Reading the immutable release marker");
    const marker = action === "publish"
      ? await publishStaticRelease(config, release, ctx.signal, async () => { await staticSiteActor(site); await checkLease(); })
      : await existingStaticRelease(config, release);
    if (!marker) throw new WorkerError("VERIFICATION_REQUIRED", "The release was not found on the serving node.", false);
    await ctx.progress(70, "Checking the local edge's release marker and homepage bytes");
    let originVerifiedAt: string;
    try { originVerifiedAt = await verifyStaticOrigin(config, release, marker, ctx.signal); } catch (error) {
      if (action === "publish") {
        await checkLease();
        await holdStaticRelease(config, release);
        await ctx.progress(75, "Initial release removed from the serving tree after failed origin verification; kept for retry");
      }
      throw error;
    }
    await ctx.progress(90, "Checking public DNS and HTTPS when configured");
    const publicEvidence = await verifyStaticPublic(config, release, marker, ctx.signal);
    await checkLease();
    return ok({ ...pin, originVerifiedAt, files: marker.files, bytes: marker.bytes, public: publicEvidence },
      publicEvidence.status === "VERIFIED" ? "Origin and public HTTPS served the pinned static release" : "Static origin verified; public HTTPS is not verified",
      { evidence: `commit=${pin.commitSha}; origin=${originVerifiedAt}; https=${publicEvidence.status}` });
  },
});
