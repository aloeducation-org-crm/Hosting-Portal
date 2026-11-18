import { createHash, randomBytes } from "node:crypto";
import type { PilotMessageChannel, PilotMessageState, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { apiError } from "@/lib/response";
import { isUnsafeDefaultSecret, env } from "@/lib/env";
import { sealSecretValue } from "@/lib/secret-store";
import { DAY, emailAddress, phoneNumber, PILOT_AUDIENCE_LIMIT, PILOT_DAILY_QUEUE_LIMIT, pilotOwnerId, smsText } from "./config";

interface Actor { id: string; email: string; role: string; emailVerified?: boolean }
const recipientView = { id: true, channel: true, address: true, consentAt: true, suppressedAt: true } as const;
export const UNSUBSCRIBE_PATH = "/api/messaging/unsubscribe";
export const unsubscribeTokenPattern = /^[a-zA-Z0-9_-]{43}$/;

function digest(token: string): string { return createHash("sha256").update(token).digest("hex"); }

export function canQueuePilotMessages(actor: { id: string; emailVerified?: boolean }): boolean {
  return actor.emailVerified === true && actor.id === pilotOwnerId();
}
function assertPilotOwner(actor: Actor) {
  if (!canQueuePilotMessages(actor)) throw apiError("Messaging is available only to the approved pilot account", "PILOT_ONLY", undefined, 403);
}
function operatorOwner(actor: Actor): string {
  if (actor.role !== "SUPER_ADMIN") throw apiError("Super administrator required", "FORBIDDEN", undefined, 403);
  const owner = pilotOwnerId();
  if (!owner) throw apiError("Select the pilot account in server configuration", "PILOT_NOT_CONFIGURED", undefined, 409);
  return owner;
}

export async function ownerCanSend(tx: Prisma.TransactionClient, ownerId: string): Promise<boolean> {
  const owner = await tx.user.findUnique({ where: { id: ownerId }, select: {
    isActive: true, isLocked: true, emailVerified: true, signupApprovalStatus: true,
  } });
  if (!owner?.isActive || owner.isLocked || !owner.emailVerified || owner.signupApprovalStatus !== "APPROVED") return false;
  // A configured ID and the future public-signup mode are not operator review.
  return !!await tx.auditLog.findFirst({ where: {
    actorRole: "SUPER_ADMIN", action: "USER_APPROVE", resourceType: "User", resourceId: ownerId, result: "SUCCESS",
  }, select: { id: true } });
}

export async function recordPilotConsent(actor: Actor, input: { channel: PilotMessageChannel; address: string; consentRef: string }) {
  const ownerId = operatorOwner(actor);
  const contact = (input.channel === "EMAIL" ? emailAddress : phoneNumber).safeParse(input.address);
  const consentRef = input.consentRef.trim();
  if (!contact.success || !consentRef || consentRef.length > 160) throw apiError("Provide a valid address and opt-in evidence reference", "VALIDATION_ERROR", undefined, 400);
  return db.$transaction(async (tx) => {
    if (!await ownerCanSend(tx, ownerId)) throw apiError("Approve and verify the pilot account first", "PILOT_NOT_APPROVED", undefined, 409);
    const prior = await tx.pilotRecipient.findUnique({
      where: { ownerId_channel_address: { ownerId, channel: input.channel, address: contact.data } }, select: recipientView,
    });
    if (prior?.suppressedAt) throw apiError("Recipient is suppressed; no reactivation is available during the pilot", "SUPPRESSED", undefined, 409);
    if (prior) return prior;
    if (await tx.pilotRecipient.count({ where: { ownerId, channel: input.channel } }) >= PILOT_AUDIENCE_LIMIT) {
      throw apiError("Pilot recipient limit reached", "AUDIENCE_LIMIT", undefined, 409);
    }
    let secret = {};
    if (input.channel === "EMAIL") {
      if (isUnsafeDefaultSecret(env.APP_ENCRYPTION_KEY) || env.APP_ENCRYPTION_KEY.length < 32) {
        throw apiError("Secure encryption is required for the pilot", "NOT_CONFIGURED", undefined, 503);
      }
      const token = randomBytes(32).toString("base64url");
      secret = { unsubscribeHash: digest(token), unsubscribeSecret: sealSecretValue(token) };
    }
    const recipient = await tx.pilotRecipient.create({
      data: { ownerId, channel: input.channel, address: contact.data, consentRef, ...secret }, select: recipientView,
    });
    await tx.auditLog.create({ data: {
      actorUserId: actor.id, actorRole: actor.role, action: "PILOT_CONSENT_RECORDED", resourceType: "PilotRecipient",
      resourceId: recipient.id, result: "SUCCESS", metadata: { channel: input.channel },
    } });
    return recipient;
  });
}

async function suppress(tx: Prisma.TransactionClient, where: Prisma.PilotRecipientWhereInput, actorId?: string) {
  const recipient = await tx.pilotRecipient.findFirst({ where, select: { id: true, suppressedAt: true, channel: true } });
  if (!recipient || recipient.suppressedAt) return;
  await tx.pilotRecipient.update({ where: { id: recipient.id }, data: { suppressedAt: new Date() } });
  await tx.auditLog.create({ data: {
    actorUserId: actorId, action: "PILOT_RECIPIENT_SUPPRESSED", resourceType: "PilotRecipient", resourceId: recipient.id,
    result: "SUCCESS", metadata: { channel: recipient.channel },
  } });
}
export function suppressPilotRecipient(actor: Actor, id: string) {
  const ownerId = operatorOwner(actor);
  return db.$transaction((tx) => suppress(tx, { id, ownerId }, actor.id));
}
export async function unsubscribePilotEmail(token: string) {
  if (!unsubscribeTokenPattern.test(token)) return;
  await db.$transaction((tx) => suppress(tx, { channel: "EMAIL", unsubscribeHash: digest(token) }));
}

async function assertQueueCapacity(tx: Prisma.TransactionClient, ownerId: string, channel: PilotMessageChannel, count: number) {
  const prior = await tx.pilotMessage.count({ where: { ownerId, channel, createdAt: { gt: new Date(Date.now() - DAY) } } });
  if (prior + count > PILOT_DAILY_QUEUE_LIMIT) throw apiError("Pilot queue limit reached; no messages were added", "PILOT_QUEUE_LIMIT", undefined, 429);
}

export async function queuePilotCampaign(actor: Actor, campaignId: string) {
  assertPilotOwner(actor);
  return db.$transaction(async (tx) => {
    if (!await ownerCanSend(tx, actor.id)) throw apiError("Pilot account cannot send", "FORBIDDEN", undefined, 403);
    const campaign = await tx.emailCampaign.findFirst({ where: { id: campaignId, userId: actor.id } });
    if (!campaign) throw apiError("Campaign not found", "NOT_FOUND", undefined, 404);
    if (await tx.pilotMessage.count({ where: { campaignId } })) return { campaign, duplicate: true };
    if (campaign.status !== "draft" || !campaign.textContent?.trim() || campaign.textContent.length > 50_000
      || !campaign.subject.trim() || campaign.subject.length > 200 || /[\x00-\x1f\x7f]/.test(campaign.subject)) {
      throw apiError("Use a plain-text draft with a valid subject; historical send records cannot be dispatched", "DRAFT_REQUIRED", undefined, 409);
    }
    const recipients = await tx.pilotRecipient.findMany({
      where: { ownerId: actor.id, channel: "EMAIL", suppressedAt: null }, select: { id: true },
      take: PILOT_AUDIENCE_LIMIT + 1,
    });
    if (!recipients.length || recipients.length > PILOT_AUDIENCE_LIMIT) {
      throw apiError("No approved pilot audience is available", "NO_OPT_IN_AUDIENCE", undefined, 409);
    }
    await assertQueueCapacity(tx, actor.id, "EMAIL", recipients.length);
    await tx.pilotMessage.createMany({ data: recipients.map(({ id }) => ({
      ownerId: actor.id, recipientId: id, campaignId, channel: "EMAIL", requestKey: `campaign:${campaignId}:${id}`,
    })) });
    const updated = await tx.emailCampaign.update({ where: { id: campaignId }, data: {
      status: "queued", recipientCount: recipients.length, sentCount: 0, sentAt: null,
    } });
    await tx.auditLog.create({ data: {
      actorUserId: actor.id, actorRole: actor.role, action: "PILOT_CAMPAIGN_QUEUED", resourceType: "EmailCampaign",
      resourceId: campaignId, result: "QUEUED", metadata: { count: recipients.length },
    } });
    return { campaign: updated, duplicate: false };
  });
}

export async function queuePilotSms(actor: Actor, input: { recipientId: string; text: string; requestId: string }) {
  assertPilotOwner(actor);
  const text = smsText.parse(input.text);
  const requestKey = `sms:${input.requestId}`;
  return db.$transaction(async (tx) => {
    if (!await ownerCanSend(tx, actor.id)) throw apiError("Pilot account cannot send", "FORBIDDEN", undefined, 403);
    const prior = await tx.pilotMessage.findUnique({ where: { ownerId_requestKey: { ownerId: actor.id, requestKey } } });
    if (prior) {
      if (prior.recipientId !== input.recipientId || prior.smsText !== text) throw apiError("Request ID already used with different content", "CONFLICT", undefined, 409);
      return { id: prior.id, state: prior.state, duplicate: true };
    }
    const contact = await tx.pilotRecipient.findFirst({ where: { id: input.recipientId, ownerId: actor.id, channel: "SMS", suppressedAt: null }, select: { id: true } });
    if (!contact) throw apiError("No opted-in pilot SMS recipient matches", "NOT_FOUND", undefined, 404);
    await assertQueueCapacity(tx, actor.id, "SMS", 1);
    const message = await tx.pilotMessage.create({
      data: { ownerId: actor.id, channel: "SMS", recipientId: contact.id, smsText: text, requestKey },
      select: { id: true, state: true },
    });
    await tx.auditLog.create({ data: {
      actorUserId: actor.id, actorRole: actor.role, action: "PILOT_SMS_QUEUED", resourceType: "PilotMessage",
      resourceId: message.id, result: "QUEUED",
    } });
    return { ...message, duplicate: false };
  });
}

export async function listPilotMessaging(actor: Actor) {
  const ownerId = pilotOwnerId();
  const canManage = !!ownerId && actor.role === "SUPER_ADMIN";
  const canQueue = canQueuePilotMessages(actor) && await ownerCanSend(db, actor.id);
  const enabled = !!ownerId && (canManage || canQueue);
  const [recipients, messages] = enabled ? await Promise.all([
    db.pilotRecipient.findMany({ where: { ownerId }, select: recipientView, orderBy: { consentAt: "desc" }, take: PILOT_AUDIENCE_LIMIT * 2 }),
    db.pilotMessage.findMany({ where: { ownerId }, orderBy: { createdAt: "desc" }, take: 40, select: {
      id: true, channel: true, state: true, reason: true, campaignId: true, createdAt: true,
      attempts: { orderBy: { createdAt: "asc" }, select: { provider: true, state: true, remoteId: true, httpStatus: true, blockedUntil: true } },
    } }),
  ]) : [[], []];
  return { enabled, canManage, canQueue, recipients, messages };
}

export function summarizePilotStates(rows: { state: PilotMessageState; _count: { _all: number } }[]) {
  let total = 0, pending = 0, accepted = 0, unknown = 0;
  for (const { state, _count: { _all } } of rows) {
    total += _all;
    if (state === "QUEUED" || state === "SUBMITTING") pending += _all;
    if (state === "ACCEPTED") accepted += _all;
    if (state === "UNKNOWN") unknown += _all;
  }
  return { total, pending, accepted, unknown };
}

/** Legacy counters are not delivery evidence. Read only worker-backed counts. */
export async function campaignDeliveryCounts(campaignIds: string[]) {
  const counts = new Map<string, ReturnType<typeof summarizePilotStates>>();
  if (!campaignIds.length) return counts;
  const rows = await db.pilotMessage.groupBy({ by: ["campaignId", "state"], where: { campaignId: { in: campaignIds } }, _count: { _all: true } });
  for (const id of campaignIds) {
    const matching = rows.filter((row) => row.campaignId === id);
    if (matching.length) counts.set(id, summarizePilotStates(matching));
  }
  return counts;
}
