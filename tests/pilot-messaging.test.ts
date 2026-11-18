import { isolatedDbPath, teardownIsolatedDb } from "./helpers/isolated-db";
import { randomUUID } from "node:crypto";
import { execFile, execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { beforeAll, beforeEach, afterAll, afterEach, describe, it, expect, vi } from "vitest";
import { NextRequest } from "next/server";
import { encode } from "next-auth/jwt";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { ABANDONED_AFTER, DAY, MONTH, readMessagingConfig, smsText } from "@/lib/messaging/config";
import { queuePilotSms, queuePilotCampaign, recordPilotConsent } from "@/lib/messaging/control";
import { recoverPilotSubmissions, runPilotMessagingTick } from "@/lib/messaging/worker";
import { submitMessage } from "@/lib/messaging/providers";
import { GET as getMarketing, POST as postMarketing } from "@/app/api/marketing/route";
import { GET as list, POST as post } from "@/app/api/marketing/messages/route";
import { GET as confirmUnsubscribe, POST as unsubscribe } from "@/app/api/messaging/unsubscribe/route";
import { POST as directSmtp } from "@/app/api/email/send/route";
import { proxy } from "@/proxy";

vi.mock("@/lib/smtp", () => ({ sendEmail: vi.fn(async () => { throw new Error("SMTP fallback forbidden in tests"); }) }));

type Actor = { id: string; email: string; role: string; emailVerified: boolean };
let pilot: Actor, operator: Actor, other: Actor;
const reviewed = () => ({ hardCappedFree: true, validUntil: new Date(Date.now() + 6 * DAY).toISOString(), dailyCap: 1, monthlyCap: 3, reviewRef: "TEST-APPROVAL-NOT-LIVE" });
const plan = () => ({ sender: { email: "dispatch@test.invalid", name: "Test Pilot", postalAddress: "123 Test Address" }, routes: [
  { ...reviewed(), provider: "resend" }, { ...reviewed(), provider: "brevo" },
  { ...reviewed(), provider: "httpsms", carrierOverageDisabled: true, allowedPrefix: "+8801", from: "+8801700000001" },
  { ...reviewed(), provider: "textbee", carrierOverageDisabled: true, allowedPrefix: "+8801", deviceId: "a".repeat(24) },
] });
function configEnv(routes = plan()) {
  return {
    ...process.env, MESSAGING_PILOT_USER_ID: pilot.id, APP_URL: "https://pilot.test.invalid",
    MESSAGING_FREE_ROUTES: JSON.stringify(routes),
    MESSAGING_RESEND_API_KEY: "test-resend-no-access", MESSAGING_BREVO_API_KEY: "test-brevo-no-access",
    MESSAGING_HTTPSMS_API_KEY: "test-httpsms-no-access", MESSAGING_TEXTBEE_API_KEY: "test-textbee-no-access",
  };
}
function config(routes = plan()) { return readMessagingConfig(configEnv(routes))!; }
async function request(path: string, actor?: Actor, body?: object) {
  const headers = new Headers();
  if (body) headers.set("content-type", "application/json");
  if (actor) headers.set("cookie", `next-auth.session-token=${await encode({ token: { email: actor.email, sub: actor.id, role: actor.role, emailVerified: actor.emailVerified }, secret: env.NEXTAUTH_SECRET })}`);
  return new NextRequest(`http://localhost:3101${path}`, { headers, method: body ? "POST" : "GET", body: body && JSON.stringify(body) });
}
const contact = async (channel: "EMAIL" | "SMS", address = channel === "EMAIL" ? "recipient@test.invalid" : "+8801700000002") =>
  recordPilotConsent(operator, { channel, address, consentRef: "TEST-OPT-IN" });
const sms = (recipientId: string, text = "Pilot status notice", requestId = randomUUID()) => queuePilotSms(pilot, { recipientId, text, requestId });
async function draft(ownerId = pilot.id) {
  return db.emailCampaign.create({ data: { name: "Title", subject: "Pilot news", textContent: "Hello opted-in pilot", userId: ownerId } });
}
function fixtures(calls: string[] = []): typeof fetch {
  return async (url, init) => {
    calls.push(String(url));
    const payload = JSON.parse(String(init?.body));
    if (url === "https://api.httpsms.com/v1/messages/send") return Response.json({ status: "success", data: { id: "sdk-receipt", request_id: payload.request_id } });
    if (url === "https://api.textbee.dev/api/v1/gateway/send-sms") return Response.json({ data: { success: true, smsBatchId: "sms-batch", recipientCount: 1 } });
    if (url === "https://api.resend.com/emails") return Response.json({ id: "resend-receipt" });
    if (url === "https://api.brevo.com/v3/smtp/email") return Response.json({ messageId: "<brevo-receipt@test.invalid>" }, { status: 201 });
    throw new Error("No outbound network in this fixture");
  };
}

beforeAll(async () => {
  execFileSync(process.execPath, ["scripts/apply-deploy-schema.mjs", "--migration", "20261118190000_pilot_messaging"], { stdio: "pipe" });
  operator = { ...await db.user.findFirstOrThrow({ where: { role: { name: "SUPER_ADMIN" } } }), role: "SUPER_ADMIN", emailVerified: true };
  pilot = { ...await db.user.create({ data: { email: "pilot@test.invalid", role: { connect: { name: "CLIENT" } }, emailVerified: new Date(), signupApprovalStatus: "APPROVED" } }), role: "CLIENT", emailVerified: true };
  await db.auditLog.create({ data: { actorUserId: operator.id, actorRole: "SUPER_ADMIN", action: "USER_APPROVE", resourceType: "User", resourceId: pilot.id, result: "SUCCESS" } });
  other = { ...await db.user.create({ data: { email: "another@test.invalid", role: { connect: { name: "CLIENT" } }, emailVerified: new Date(), signupApprovalStatus: "APPROVED" } }), role: "CLIENT", emailVerified: true };
});
beforeEach(async () => {
  vi.stubEnv("MESSAGING_PILOT_USER_ID", pilot.id);
  await db.pilotMessagingAttempt.deleteMany();
  await db.pilotMessage.deleteMany();
  await db.pilotRecipient.deleteMany();
  await db.emailCampaign.deleteMany({ where: { userId: { in: [pilot.id, other.id] } } });
});
afterEach(vi.unstubAllEnvs);
afterAll(teardownIsolatedDb);

function child(log: string, args: string[] = []): Promise<number> {
  return new Promise((resolve, reject) => {
    execFile(process.execPath, ["--import", "tsx", "tests/helpers/pilot-worker-child.ts", log, ...args], {
      env: configEnv(), timeout: 30_000,
    }, (error, _stdout, stderr) => {
      if (error && typeof error.code !== "number") reject(error);
      else if (stderr && error?.code !== 77) reject(new Error(stderr));
      else resolve(typeof error?.code === "number" ? error.code : 0);
    });
  });
}

it("fails closed for absent or unsafe route approvals, including a carrier plan that can charge", () => {
  expect(readMessagingConfig({})).toBeNull();
  const bad = plan();
  bad.routes[2]!.carrierOverageDisabled = false;
  expect(() => config(bad)).toThrow(/no provider is enabled/);
  const increased = plan();
  increased.routes[0]!.dailyCap = 101;
  expect(() => config(increased)).toThrow();
  const duplicated = plan();
  duplicated.routes[1] = duplicated.routes[0]!;
  expect(() => config(duplicated)).toThrow();
  expect(() => readMessagingConfig({ ...configEnv(), APP_URL: "http://pilot.test.invalid" })).toThrow();
  expect(smsText.safeParse("ক".repeat(70)).success).toBe(true);
  expect(smsText.safeParse("ক".repeat(71)).success).toBe(false);
  expect(smsText.safeParse("a".repeat(160)).success).toBe(true);
  expect(smsText.safeParse("^".repeat(160)).success).toBe(false);
});

it("isolates the audience, enforces explicit opt-in, and cannot fall back to the platform SMTP relay", async () => {
  const approved = { action: "record_consent", channel: "SMS", address: "+8801700000002", consentRef: "TEST-42", optedIn: true };
  expect((await post(await request("/api/marketing/messages", pilot, approved))).status).toBe(403);
  expect((await post(await request("/api/marketing/messages", operator, { ...approved, optedIn: false }))).status).toBe(400);
  const recorded = await post(await request("/api/marketing/messages", operator, approved));
  expect(recorded.status).toBe(200);
  const recipientId = (await recorded.json()).data.id;
  const send = { action: "queue_sms", recipientId, requestId: randomUUID(), text: "Pilot notice" };
  expect((await post(await request("/api/marketing/messages", operator, send))).status).toBe(403);
  expect((await post(await request("/api/marketing/messages", other, send))).status).toBe(403);
  expect((await list(await request("/api/marketing/messages", other))).status).toBe(200);
  expect((await (await list(await request("/api/marketing/messages", other))).json()).data.recipients).toEqual([]);
  expect((await directSmtp(await request("/api/email/send", pilot, { to: approved.address, subject: "spam", text: "no" }))).status).toBe(403);
  expect((await post(await request("/api/marketing/messages", pilot, send))).status).toBe(202);
  expect((await post(await request("/api/marketing/messages", pilot, send))).status).toBe(200);
  expect((await post(await request("/api/marketing/messages", pilot, { ...send, text: "Different content" }))).status).toBe(409);
  expect(await db.pilotMessage.count()).toBe(1);
  expect(await db.pilotMessagingAttempt.count()).toBe(0); // request handler never sends
});

it("does not enroll an auto-approved public signup without the super-admin review receipt", async () => {
  vi.stubEnv("MESSAGING_PILOT_USER_ID", other.id);
  await expect(contact("EMAIL")).rejects.toMatchObject({ status: 409, error: { code: "PILOT_NOT_APPROVED" } });
});

it("uses one quota slot per attempt across concurrent processes and stops without paid fallback", async () => {
  const { id } = await contact("SMS");
  await sms(id, "First"); await sms(id, "Second"); await sms(id, "Third");
  const invoices = await db.invoice.count(), orders = await db.order.count();
  const log = join(dirname(isolatedDbPath), "provider-calls.log");
  expect(await Promise.all([child(log), child(log)])).toEqual([0, 0]);
  expect(readFileSync(log, "utf8").trim().split("\n").sort()).toEqual([
    "https://api.httpsms.com/v1/messages/send", "https://api.textbee.dev/api/v1/gateway/send-sms",
  ]);
  expect(await db.pilotMessage.count({ where: { state: "ACCEPTED" } })).toBe(2);
  expect(await db.pilotMessage.count({ where: { state: "NO_FREE_CAPACITY" } })).toBe(1);
  expect(await db.invoice.count()).toBe(invoices);
  expect(await db.order.count()).toBe(orders);
}, 35_000);

it("switches only after an explicit free-quota rejection and records both provider attempts", async () => {
  const { id } = await contact("SMS");
  const message = await sms(id);
  const calls: string[] = [];
  await runPilotMessagingTick(config(), { request: async (url, init) => {
    if (String(url).includes("httpsms")) {
      calls.push(String(url));
      expect(init?.redirect).toBe("error");
      return Response.json({ status: "error", message: "You have exceeded your limit of [200] messages on your [free] plan. Upgrade to send more messages on https://httpsms.com/billing" }, { status: 402 });
    }
    return fixtures(calls)(url, init);
  } });
  expect(calls).toHaveLength(2);
  expect(await db.pilotMessage.findUniqueOrThrow({ where: { id: message.id } })).toMatchObject({ state: "ACCEPTED" });
  const first = await db.pilotMessagingAttempt.findFirstOrThrow({ where: { messageId: message.id, provider: "httpsms" } });
  expect(first).toMatchObject({ state: "LIMIT", httpStatus: 402 });
  expect(first.blockedUntil?.getTime()).toBeGreaterThan(Date.now() + MONTH - 60_000);
});

it.each(["timeout", "redirect", "server error", "ambiguous 429", "malformed acceptance", "provider hold"])("does not repeat a submission after %s", async (scenario) => {
  const { id } = await contact("SMS");
  await sms(id);
  const provider = vi.fn(async () => {
    if (scenario === "timeout" || scenario === "redirect") throw new Error(scenario);
    if (scenario === "provider hold") return Response.json({ status: "error", message: "Account restricted" }, { status: 402 });
    if (scenario === "server error") return new Response("provider error", { status: 500 });
    if (scenario === "ambiguous 429") return new Response("too many requests", { status: 429 });
    return Response.json({ status: "success", data: { id: "not-correlated" } });
  });
  await runPilotMessagingTick(config(), { request: provider });
  await runPilotMessagingTick(config(), { request: provider });
  expect(provider).toHaveBeenCalledTimes(1);
  expect(await db.pilotMessage.count({ where: { state: "UNKNOWN" } })).toBe(1);
  expect(await db.pilotMessagingAttempt.count()).toBe(1);
});

it("treats a dead worker after request transmission as unknown and never requeues it", async () => {
  const { id } = await contact("SMS");
  await sms(id);
  const log = join(dirname(isolatedDbPath), "abandoned-provider-calls.log");
  expect(await child(log, ["abandon"])).toBe(77);
  expect(await db.pilotMessage.count({ where: { state: "SUBMITTING" } })).toBe(1);
  expect(await recoverPilotSubmissions(new Date(Date.now() + ABANDONED_AFTER + 100))).toBe(1);
  const spy = vi.fn(fixtures());
  await runPilotMessagingTick(config(), { request: spy });
  expect(spy).not.toHaveBeenCalled();
  expect(await db.pilotMessagingAttempt.findFirst()).toMatchObject({ state: "UNKNOWN" });
  expect(await db.pilotMessage.findFirst()).toMatchObject({ state: "UNKNOWN", reason: "WORKER_LOST_AFTER_RESERVATION" });
}, 35_000);

it("queues opted-in email idempotently, tracks only receipts and honors an unsubscribe before dispatch", async () => {
  const campaign = await draft();
  await db.newsletter.upsert({ where: { email: "not-consented@test.invalid" }, create: { email: "not-consented@test.invalid" }, update: {} });
  const dispatch = { action: "dispatch_campaign", campaignId: campaign.id };
  expect((await postMarketing(await request("/api/marketing", pilot, dispatch))).status).toBe(409);
  await contact("EMAIL", "first@test.invalid");
  await contact("EMAIL", "second@test.invalid");
  const notMyDraft = await draft(other.id);
  expect((await postMarketing(await request("/api/marketing", pilot, { ...dispatch, campaignId: notMyDraft.id }))).status).toBe(404);
  expect((await postMarketing(await request("/api/marketing", pilot, dispatch))).status).toBe(202);
  expect((await postMarketing(await request("/api/marketing", pilot, dispatch))).status).toBe(200);
  expect(await db.pilotMessage.count()).toBe(2);
  expect(await db.emailCampaign.findUniqueOrThrow({ where: { id: campaign.id } })).toMatchObject({ status: "queued", sentCount: 0, sentAt: null });
  let optOut = "", deliveredTo = "";
  await runPilotMessagingTick(config(), { maxWork: 1, request: async (url, init) => {
    expect(url).toBe("https://api.resend.com/emails");
    const body = JSON.parse(String(init?.body));
    expect(body.from).toBe("Test Pilot <dispatch@test.invalid>");
    expect(body.headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    optOut = body.headers["List-Unsubscribe"].slice(1, -1);
    expect(body.text).toContain(optOut);
    expect(body.text).toContain("123 Test Address");
    expect(body.to).toHaveLength(1);
    deliveredTo = body.to[0];
    return fixtures()(url, init);
  } });
  expect(confirmUnsubscribe(new NextRequest(optOut)).status).toBe(200);
  expect(await db.pilotRecipient.count({ where: { suppressedAt: { not: null } } })).toBe(0);
  expect((await unsubscribe(new NextRequest(optOut, { method: "POST", body: "List-Unsubscribe=One-Click" }))).status).toBe(200);
  expect(await db.pilotRecipient.findFirst({ where: { address: deliveredTo } })).toMatchObject({ suppressedAt: expect.any(Date) });
  const nextDraft = await draft();
  await queuePilotCampaign(pilot, nextDraft.id); // opted-out recipient excluded
  expect(await db.pilotMessage.count({ where: { campaignId: nextDraft.id } })).toBe(1);
  const followup = vi.fn(fixtures());
  await runPilotMessagingTick(config(), { request: followup, maxWork: 1 });
  expect(followup).toHaveBeenCalledTimes(1);
  expect(followup.mock.calls[0]?.[0]).toBe("https://api.brevo.com/v3/smtp/email");
  const history = (await (await getMarketing(await request("/api/marketing", pilot))).json()).data;
  expect(history.metrics.totalAccepted).toBe(2);
  expect(history.campaigns.find((row: { id: string }) => row.id === campaign.id)).toMatchObject({ status: "accepted", delivery: { accepted: 2, total: 2, unknown: 0 } });
  expect(history.subscribers).toEqual([]);
});

it("does not send newly suppressed, newly suspended or expired work", async () => {
  const { id } = await contact("SMS");
  const pending = await sms(id);
  const spy = vi.fn(fixtures());
  await post(await request("/api/marketing/messages", operator, { action: "suppress", recipientId: id }));
  await runPilotMessagingTick(config(), { request: spy });
  expect(await db.pilotMessage.findUnique({ where: { id: pending.id } })).toMatchObject({ state: "SUPPRESSED" });
  const second = await contact("SMS", "+8801700000009");
  await sms(second.id);
  await db.user.update({ where: { id: pilot.id }, data: { isActive: false } });
  try {
    await runPilotMessagingTick(config(), { request: spy });
    expect(await db.pilotMessage.count({ where: { state: "REJECTED" } })).toBe(1);
  } finally { await db.user.update({ where: { id: pilot.id }, data: { isActive: true } }); }
  await sms(second.id);
  await runPilotMessagingTick(config(), { request: spy, now: () => new Date(Date.now() + 2 * DAY) });
  expect(await db.pilotMessage.count({ where: { state: "EXPIRED" } })).toBe(1);
  expect(spy).not.toHaveBeenCalled();
});

it("recognizes only documented limits and never confuses an API receipt with delivery", async () => {
  const [resend, brevo, httpsms, textbee] = config().routes;
  const email = { channel: "EMAIL" as const, id: "message-test", to: "person@test.invalid", subject: "Pilot", text: "Test", unsubscribe: "https://pilot.test.invalid/unsubscribe", sender: config().sender! };
  expect(await submitMessage(resend, email, async () => Response.json({ name: "daily_quota_exceeded" }, { status: 429 }))).toMatchObject({ state: "LIMIT", blockMs: DAY });
  expect(await submitMessage(resend, email, async () => Response.json({ name: "monthly_quota_exceeded" }, { status: 429 }))).toMatchObject({ state: "LIMIT", blockMs: MONTH });
  expect(await submitMessage(resend, email, async () => Response.json({ name: "rate_limit_exceeded" }, { status: 429 }))).toMatchObject({ state: "UNKNOWN" });
  expect(await submitMessage(brevo, email, async () => Response.json({ code: "not_enough_credits" }, { status: 402 }))).toMatchObject({ state: "UNKNOWN" });
  const message = { channel: "SMS" as const, id: "message-test", to: "+8801700000002", text: "Test" };
  expect(await submitMessage(httpsms, message, async () => Response.json({ status: "error", message: "You have exceeded your limit of [200] messages on your [free] plan. Account frozen." }, { status: 402 }))).toMatchObject({ state: "UNKNOWN" });
  const limitShape = { hasReachedLimit: true, dailyRemaining: 0, monthlyRemaining: 50 };
  expect(await submitMessage(textbee, message, async () => Response.json(limitShape, { status: 429 }))).toMatchObject({ state: "UNKNOWN" });
  expect(await submitMessage(textbee, message, async () => Response.json({ ...limitShape, paymentHold: true }, { status: 429 }))).toMatchObject({ state: "UNKNOWN" });
});

it("leaves only the exact opt-out URL public, not the messaging control endpoints", async () => {
  expect((await proxy(await request("/api/marketing/messages"))).status).toBe(401);
  expect((await proxy(await request("/api/messaging/unsubscribe-sibling"))).status).toBe(401);
  expect((await proxy(await request("/api/messaging/unsubscribe"))).status).toBe(200);
});
