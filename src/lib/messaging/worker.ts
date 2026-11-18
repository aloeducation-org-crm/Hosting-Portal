import type { PilotMessageState, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { needsSealing, openSecretValue } from "@/lib/secret-store";
import { ABANDONED_AFTER, DAY, MONTH, REQUEST_TIMEOUT, channelFor, smsText, type MessagingConfig, type ProviderRoute } from "./config";
import { ownerCanSend, summarizePilotStates, UNSUBSCRIBE_PATH, unsubscribeTokenPattern } from "./control";
import { submitMessage, type OutboundMessage, type SubmissionResult } from "./providers";

type Claim = { id: string; campaignId: string | null; attemptId: string; route: ProviderRoute; message: OutboundMessage };

async function updateCampaign(tx: Prisma.TransactionClient, campaignId: string | null) {
  if (!campaignId) return;
  const rows = await tx.pilotMessage.groupBy({ by: ["state"], where: { campaignId }, _count: { _all: true } });
  const { total, pending, accepted, unknown } = summarizePilotStates(rows);
  const status = pending ? "queued" : unknown ? "review" : accepted === total ? "accepted" : accepted ? "partial" : "not_sent";
  await tx.emailCampaign.updateMany({ where: { id: campaignId }, data: { status } });
}

async function finishWithoutAttempt(tx: Prisma.TransactionClient, item: { id: string; campaignId: string | null }, state: PilotMessageState, reason: string) {
  await tx.pilotMessage.update({ where: { id: item.id }, data: { state, reason } });
  await updateCampaign(tx, item.campaignId);
}

async function reserve(config: MessagingConfig, now: Date): Promise<Claim | "settled" | null> {
  return db.$transaction(async (tx) => {
    const item = await tx.pilotMessage.findFirst({
      where: { ownerId: config.ownerId, state: "QUEUED" }, orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      include: { recipient: true, campaign: true, attempts: { select: { provider: true, state: true } } },
    });
    if (!item) return null;
    if (item.attempts.some((attempt) => attempt.state !== "LIMIT")) {
      await finishWithoutAttempt(tx, item, "UNKNOWN", "PRIOR_ATTEMPT_REQUIRES_REVIEW");
      return "settled";
    }
    if (item.createdAt.getTime() + DAY <= now.getTime()) {
      await finishWithoutAttempt(tx, item, "EXPIRED", "QUEUE_WINDOW_EXPIRED");
      return "settled";
    }
    if (item.recipient.ownerId !== item.ownerId || item.recipient.channel !== item.channel || !await ownerCanSend(tx, item.ownerId)) {
      await finishWithoutAttempt(tx, item, "REJECTED", "PILOT_AUTHORIZATION_CHANGED");
      return "settled";
    }
    if (item.recipient.suppressedAt) {
      await finishWithoutAttempt(tx, item, "SUPPRESSED", "RECIPIENT_OPTED_OUT");
      return "settled";
    }
    let message: OutboundMessage | null = null;
    const to = item.recipient.address;
    if (item.channel === "SMS" && smsText.safeParse(item.smsText).success && item.smsText) {
      message = { channel: "SMS", id: item.id, to, text: item.smsText };
    } else if (item.channel === "EMAIL" && config.sender && config.publicOrigin && item.campaign?.userId === item.ownerId
      && item.campaign.textContent && item.recipient.unsubscribeSecret && !needsSealing(item.recipient.unsubscribeSecret)) {
      try {
        const token = openSecretValue(item.recipient.unsubscribeSecret);
        if (unsubscribeTokenPattern.test(token)) message = {
          channel: "EMAIL", id: item.id, to, subject: item.campaign.subject, text: item.campaign.textContent,
          sender: config.sender, unsubscribe: `${config.publicOrigin}${UNSUBSCRIBE_PATH}?token=${token}`,
        };
      } catch { /* no email may leave without an authenticated opt-out token */ }
    }
    if (!message) {
      await finishWithoutAttempt(tx, item, "REJECTED", "MESSAGE_OR_SENDER_NOT_CONFIGURED");
      return "settled";
    }

    for (const route of config.routes) {
      if (channelFor(route.provider) !== item.channel || route.validUntil.getTime() <= now.getTime() + REQUEST_TIMEOUT
        || item.attempts.some((attempt) => attempt.provider === route.provider)
        || ("allowedPrefix" in route && !to.startsWith(route.allowedPrefix))) continue;
      const provider = route.provider;
      if (await tx.pilotMessagingAttempt.findFirst({ where: { provider, blockedUntil: { gt: now } }, select: { id: true } })) continue;
      // All reservations consume quota, including rejected and uncertain sends;
      // a restart or key replacement cannot reset usage. Pad for enqueue timing.
      const budget = async (window: number) => tx.pilotMessagingAttempt.count({
        where: { provider, createdAt: { gte: new Date(now.getTime() - window - ABANDONED_AFTER) } },
      });
      if (await budget(DAY) >= route.dailyCap || await budget(MONTH) >= route.monthlyCap) continue;
      const locked = await tx.pilotMessage.updateMany({ where: { id: item.id, state: "QUEUED" }, data: { state: "SUBMITTING", reason: null, updatedAt: now } });
      if (locked.count !== 1) return null;
      const attempt = await tx.pilotMessagingAttempt.create({ data: { messageId: item.id, provider, createdAt: now } });
      return { id: item.id, campaignId: item.campaignId, attemptId: attempt.id, route, message };
    }
    await finishWithoutAttempt(tx, item, "NO_FREE_CAPACITY", "NO_APPROVED_FREE_ROUTE_AVAILABLE");
    return "settled";
  });
}

async function finish(claim: Claim, result: SubmissionResult, now: Date) {
  await db.$transaction(async (tx) => {
    const saved = await tx.pilotMessagingAttempt.updateMany({
      where: { id: claim.attemptId, state: "STARTED" }, data: {
        state: result.state, finishedAt: now, httpStatus: result.httpStatus,
        remoteId: result.state === "ACCEPTED" ? result.remoteId : undefined,
        blockedUntil: result.state === "LIMIT" ? new Date(now.getTime() + result.blockMs) : undefined,
      },
    });
    if (saved.count !== 1) return; // lease expired; never overwrite the uncertainty marker
    await tx.pilotMessage.update({ where: { id: claim.id }, data: {
      state: result.state === "LIMIT" ? "QUEUED" : result.state,
      reason: result.state === "UNKNOWN" ? "PROVIDER_ACCEPTANCE_UNCONFIRMED" : result.state === "REJECTED" ? "PROVIDER_REFUSED" : null,
    } });
    await updateCampaign(tx, claim.campaignId);
  });
}

/** Stale requests are NOT retryable. The provider may already have accepted them. */
export function recoverPilotSubmissions(now: Date) {
  return db.$transaction(async (tx) => {
    const stale = await tx.pilotMessage.findMany({
      where: { state: "SUBMITTING", updatedAt: { lte: new Date(now.getTime() - ABANDONED_AFTER) } },
      select: { id: true, campaignId: true }, take: 40,
    });
    for (const item of stale) {
      await tx.pilotMessagingAttempt.updateMany({ where: { messageId: item.id, state: "STARTED" }, data: { state: "UNKNOWN", finishedAt: now } });
      await finishWithoutAttempt(tx, item, "UNKNOWN", "WORKER_LOST_AFTER_RESERVATION");
    }
    return stale.length;
  });
}

/** Standalone outbox process only; no route or AI tool invokes this function. */
export async function runPilotMessagingTick(config: MessagingConfig, opts: {
  request?: typeof fetch; now?: () => Date; maxWork?: number; stopping?: () => boolean;
} = {}) {
  const clock = opts.now ?? (() => new Date());
  const recovered = await recoverPilotSubmissions(clock());
  let processed = 0;
  for (; processed < Math.min(10, opts.maxWork ?? 5) && !opts.stopping?.(); processed += 1) {
    const started = clock();
    const claim = await reserve(config, started);
    if (!claim) break;
    if (claim === "settled") continue;
    const result = clock().getTime() - started.getTime() >= ABANDONED_AFTER - REQUEST_TIMEOUT
      ? { state: "UNKNOWN" as const }
      : await submitMessage(claim.route, claim.message, opts.request);
    await finish(claim, result, clock());
  }
  return { processed, recovered };
}
