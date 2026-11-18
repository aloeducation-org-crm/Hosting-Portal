#!/usr/bin/env node
/** Loopback acceptance of the packaged panel and standalone messaging worker.
 * Provider response fixtures are TCP services on loopback; no live sends are
 * possible. The launch env is assembled from scratch and never reads real keys. */
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { once } from "node:events";
import { copyFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as pause } from "node:timers/promises";
import { promisify } from "node:util";
import { PrismaLibSQL } from "@prisma/adapter-libsql";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const exec = promisify(execFile);
const repo = fileURLToPath(new URL("../", import.meta.url));
const standalone = path.join(repo, ".next/standalone");
const temp = await mkdtemp(path.join(os.tmpdir(), "alo-messaging-smoke-"));
const database = path.join(temp, "candidate.db");
const password = token();
const environment = {
  NODE_ENV: "production", DATABASE_URL: `file:${database}`, SIGNUP_APPROVAL_MODE: "pilot",
  NEXTAUTH_SECRET: token(), JWT_SECRET: token(), APP_ENCRYPTION_KEY: token(), INTERNAL_SECRET: token(),
  DEPLOY_INLINE_WORKER: "false", DEPLOY_DISABLE_BOOT_RESTORE: "true", DEPLOY_LOCAL_EXECUTION: "false",
};
const db = new PrismaClient({ adapter: new PrismaLibSQL({ url: environment.DATABASE_URL }) });
const providerRequests = [];
let panel, provider, panelLog = "";
function token() { return randomBytes(32).toString("hex"); }
async function listen(server) { server.listen(0, "127.0.0.1"); await once(server, "listening"); return server.address().port; }
async function stop(child) {
  if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return;
  const done = once(child, "exit");
  child.kill("SIGTERM");
  const timer = setTimeout(() => child.kill("SIGKILL"), 5000);
  try { await done; } finally { clearTimeout(timer); }
}

try {
  await copyFile(path.join(repo, "db/custom.db"), database);
  for (const migration of ["20261118183000_signup_approval", "20261118190000_pilot_messaging"]) {
    await exec(process.execPath, [path.join(repo, "scripts/apply-deploy-schema.mjs"), "--migration", migration], { env: environment, timeout: 20_000 });
  }
  const passwordHash = await bcrypt.hash(password, 10);
  await db.role.upsert({ where: { name: "ADMIN" }, create: { name: "ADMIN" }, update: {} });
  const [operator, admin] = await Promise.all(["SUPER_ADMIN", "ADMIN"].map((name, index) => db.user.create({ data: {
    role: { connect: { name } }, email: `smoke-${index}@pilot.test`, passwordHash, emailVerified: new Date(), onboardingCompleted: true,
  } })));
  const orders = await db.order.count(), invoices = await db.invoice.count();
  const freePort = createServer();
  const port = await listen(freePort);
  await new Promise((resolve) => freePort.close(resolve));
  const base = `http://127.0.0.1:${port}`;
  const send = (route, init = {}) => fetch(`${base}${route}`, { ...init, redirect: "error", signal: AbortSignal.timeout(8_000) });
  async function startPanel(pilotId = "") {
    panelLog = "";
    panel = spawn(process.execPath, [path.join(standalone, "server.js")], {
      cwd: temp, env: { ...environment, MESSAGING_PILOT_USER_ID: pilotId, APP_URL: base, NEXTAUTH_URL: base, HOSTNAME: "127.0.0.1", PORT: String(port) },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const log = (chunk) => { panelLog = (panelLog + chunk.toString()).slice(-3000); };
    panel.stdout.on("data", log); panel.stderr.on("data", log);
    panel.on("error", (error) => { panelLog = error.message; });
    for (let attempt = 0; attempt < 60 && panel.exitCode === null; attempt += 1) {
      try { if ((await send("/api/csrf")).ok) return; } catch { /* startup only */ }
      await pause(100);
    }
    throw new Error(`Standalone panel did not start: ${panelLog}`);
  }
  const login = (email) => send("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json", Origin: base }, body: JSON.stringify({ email, password }) });
  async function session(email) {
    const res = await login(email);
    assert.equal(res.status, 200, (await res.clone().json()).message);
    const cookie = res.headers.getSetCookie().find((value) => value.startsWith("next-auth.session-token="))?.split(";")[0];
    assert.ok(cookie);
    const csrf = (await send("/api/csrf", { headers: { Cookie: cookie } })).headers.getSetCookie()[0]?.split(";")[0];
    assert.ok(csrf?.startsWith("alo_csrf="));
    return { Cookie: `${cookie}; ${csrf}`, "X-ALO-CSRF": csrf.slice("alo_csrf=".length).split(".")[0], Origin: base };
  }
  async function api(route, headers, data, method = data ? "POST" : "GET") {
    const res = await send(route, { method, headers: { ...headers, ...(data && { "Content-Type": "application/json" }) }, body: data && JSON.stringify(data) });
    return { status: res.status, json: await res.json() };
  }
  await startPanel();
  const registration = await send("/api/auth/signup", {
    method: "POST", headers: { Origin: base, "Content-Type": "application/json" },
    body: JSON.stringify({ email: "sister-company@pilot.test", name: "Sister company test", password, role: "SUPER_ADMIN" }),
  });
  assert.equal(registration.status, 201);
  assert.equal(registration.headers.has("set-cookie"), false);
  const pilot = (await registration.json()).data;
  assert.equal(pilot.role, "CLIENT");
  assert.equal(pilot.approvalRequired, true);
  assert.equal(pilot.emailSent, false); // no real SMTP configured
  assert.equal(pilot.verificationToken, undefined); // never exposed in production
  assert.equal((await login(pilot.email)).status, 403);
  const ordinary = await session(admin.email), superAdmin = await session(operator.email);
  const usersPage = await send("/users", { headers: superAdmin });
  assert.equal(usersPage.status, 200);
  assert.ok((await usersPage.text()).includes("AdminUsersManager"), "The packaged user-review UI route was not mounted");
  const pending = await api("/api/users?review=pending", superAdmin);
  assert.equal(pending.json.data.canReviewSignup, true);
  assert.equal(pending.json.data.users.find((user) => user.id === pilot.id).emailVerified, null);
  const endpoint = "/api/admin/users/approve";
  const review = { userId: pilot.id, action: "approve" };
  assert.equal((await api(endpoint, ordinary, review, "PATCH")).status, 403);
  assert.equal((await api(endpoint, superAdmin, review, "PATCH")).status, 409);
  // Read the control token only from this disposable test DB instead of sending
  // SMTP or relaxing the production response contract.
  const emailProof = await db.verificationToken.findFirstOrThrow({ where: { userId: pilot.id, type: "EMAIL_VERIFICATION" } });
  const verified = await api("/api/auth/verify-email", { Origin: base }, { token: emailProof.token });
  assert.equal(verified.status, 200);
  assert.equal(verified.json.data.approvalRequired, true);
  assert.equal((await login(pilot.email)).status, 403);
  assert.equal((await api(endpoint, { Cookie: superAdmin.Cookie }, review, "PATCH")).json.error.code, "CSRF_INVALID");
  assert.equal((await api(endpoint, { ...superAdmin, Origin: "https://other.example.test" }, review, "PATCH")).status, 403);
  assert.equal((await api(endpoint, superAdmin, review, "PATCH")).status, 200);
  assert.equal((await db.user.findUniqueOrThrow({ where: { id: pilot.id } })).onboardingCompleted, false);
  assert.equal(await db.auditLog.count({ where: { resourceId: pilot.id, action: "USER_APPROVE", actorRole: "SUPER_ADMIN" } }), 1);
  const customer = await session(pilot.email);
  // The deployment operator selects the exact reviewed ID, not an address or
  // session claim. Restart only the disposable panel to reflect the change.
  await stop(panel);
  await startPanel(pilot.id);
  assert.equal((await send("/dashboard/marketing", { headers: customer })).status, 200);
  const msg = "/api/marketing/messages";
  const consent = async (channel, address) => {
    const result = await api(msg, superAdmin, { action: "record_consent", channel, address, consentRef: "SMOKE-NO-LIVE-SEND", optedIn: true });
    assert.equal(result.status, 200, result.json.message); return result.json.data.id;
  };
  await consent("EMAIL", "one@pilot.test"); await consent("EMAIL", "two@pilot.test");
  const phoneId = await consent("SMS", "+8801700000001");
  const payload = { action: "queue_sms", requestId: randomUUID(), recipientId: phoneId, text: "Pilot smoke test" };
  assert.equal((await api(msg, { Cookie: customer.Cookie }, payload)).status, 403);
  assert.equal((await api(msg, customer, payload)).status, 202);
  assert.equal((await api(msg, customer, payload)).status, 200);
  const email = await api("/api/marketing", customer, { action: "create_campaign", name: "Pilot smoke", subject: "Opted-in pilot", textContent: "Test only" });
  assert.equal(email.status, 201);
  assert.equal((await api("/api/marketing", customer, { action: "dispatch_campaign", campaignId: email.json.data.campaign.id })).status, 202);
  assert.equal(await db.pilotMessagingAttempt.count(), 0);

  provider = createServer(async (request, response) => {
    let raw = "";
    for await (const chunk of request) raw += chunk;
    const body = JSON.parse(raw);
    providerRequests.push({ hostname: request.headers["x-fixture-vendor"], body });
    response.setHeader("content-type", "application/json");
    if (request.url === "/v1/messages/send") {
      response.statusCode = 402;
      response.end(JSON.stringify({ status: "error", message: "You have exceeded your limit of [200] messages on your [free] plan. Upgrade to send more messages on https://httpsms.com/billing" }));
    } else if (request.url === "/api/v1/gateway/send-sms") {
      response.end(JSON.stringify({ data: { success: true, smsBatchId: "fake-sms-receipt", recipientCount: 1 } }));
    } else if (request.url === "/v3/smtp/email") {
      response.statusCode = 201;
      response.end(JSON.stringify({ messageId: "<fake-2@pilot.test>" }));
    } else if (request.url === "/emails") response.end(JSON.stringify({ id: "fake-1" }));
    else { response.statusCode = 500; response.end("unexpected fixture path"); }
  });
  const providerPort = await listen(provider);
  const hook = path.join(temp, "only-local.mjs");
  await writeFile(hook, `const transport = globalThis.fetch; globalThis.fetch = (input, init) => {
    const url = new URL(input);
    if (init?.redirect !== "error" || !["api.httpsms.com","api.textbee.dev","api.resend.com","api.brevo.com"].includes(url.hostname)) throw new Error("No live traffic permitted");
    return transport("http://127.0.0.1:${providerPort}" + url.pathname, { ...init, headers: { ...init.headers, "x-fixture-vendor": url.hostname } });
  };`);
  const approval = { hardCappedFree: true, dailyCap: 1, monthlyCap: 1, validUntil: new Date(Date.now() + 86_400_000).toISOString(), reviewRef: "TEST-ONLY" };
  const smsApproval = { ...approval, carrierOverageDisabled: true, allowedPrefix: "+8801" };
  const workerEnv = {
    ...environment, MESSAGING_PILOT_USER_ID: pilot.id, APP_URL: "https://pilot.test", MESSAGING_FREE_ROUTES: JSON.stringify({
      sender: { email: "sender@pilot.test", name: "Pilot", postalAddress: "Test office address" },
      routes: [
        { ...smsApproval, provider: "httpsms", from: "+8801700000000" },
        { ...smsApproval, provider: "textbee", deviceId: "a".repeat(24) },
        { ...approval, provider: "resend" }, { ...approval, provider: "brevo" },
      ],
    }),
    ...Object.fromEntries(["HTTPSMS", "TEXTBEE", "RESEND", "BREVO"].map((name) => [`MESSAGING_${name}_API_KEY`, "TEST-NO-PROVIDER-ACCESS"])),
  };
  const runWorker = () => exec(process.execPath, ["--import", hook, path.join(standalone, "messaging-worker.cjs"), "--once"], { cwd: temp, env: workerEnv, timeout: 25_000 });
  await runWorker();
  assert.deepEqual(providerRequests.map(({ hostname }) => hostname), ["api.httpsms.com", "api.textbee.dev", "api.resend.com", "api.brevo.com"]);
  const status = (await api("/api/marketing", customer)).json.data;
  assert.equal(status.metrics.totalAccepted, 2);
  assert.deepEqual(status.campaigns[0].delivery, { total: 2, accepted: 2, pending: 0, unknown: 0 });
  const unsubscribe = new URL(providerRequests[2].body.headers["List-Unsubscribe"].slice(1, -1));
  assert.equal(unsubscribe.pathname, "/api/messaging/unsubscribe");
  assert.equal(unsubscribe.origin, "https://pilot.test");
  const unsubPath = `${unsubscribe.pathname}${unsubscribe.search}`;
  const outside = { Origin: "https://mailbox.example.test" };
  const getUnsubscribe = await send(unsubPath, { headers: outside });
  assert.equal(getUnsubscribe.status, 200);
  assert.equal(getUnsubscribe.headers.get("cache-control"), "no-store");
  assert.equal(getUnsubscribe.headers.get("referrer-policy"), "no-referrer");
  assert.match(getUnsubscribe.headers.get("content-security-policy"), /default-src 'none'/);
  assert.equal(getUnsubscribe.headers.has("access-control-allow-origin"), false);
  const page = await getUnsubscribe.text();
  assert.ok(page.includes("Confirm unsubscribe"));
  assert.ok(!page.includes("@pilot.test"));
  assert.equal(await db.pilotRecipient.count({ where: { suppressedAt: { not: null } } }), 0);
  assert.equal((await send(`${unsubscribe.pathname}/unexpected`, { method: "POST", headers: outside })).status, 403);
  assert.equal((await send(`${unsubscribe.pathname}?token=invalid`, { method: "POST", headers: outside })).status, 400);
  const optOut = await send(unsubPath, {
    method: "POST", headers: { ...outside, Cookie: customer.Cookie }, body: "List-Unsubscribe=One-Click",
  });
  assert.equal(optOut.status, 200);
  assert.equal(optOut.headers.get("cache-control"), "no-store");
  assert.equal(optOut.headers.get("referrer-policy"), "no-referrer");
  assert.ok(!(await optOut.text()).includes(unsubscribe.searchParams.get("token")));
  assert.equal(await db.pilotRecipient.count({ where: { suppressedAt: { not: null } } }), 1);
  assert.equal((await send(unsubPath, { method: "POST", headers: outside })).status, 200);
  assert.equal(await db.auditLog.count({ where: { action: "PILOT_RECIPIENT_SUPPRESSED" } }), 1);
  assert.equal((await api(msg, customer, { ...payload, requestId: randomUUID() })).status, 202);
  await runWorker();
  assert.equal(providerRequests.length, 4);
  assert.equal(await db.pilotMessage.count({ where: { state: "NO_FREE_CAPACITY" } }), 1);
  assert.equal(await db.order.count(), orders);
  assert.equal(await db.invoice.count(), invoices);
  assert.equal((await api("/api/free-for-dev?source=jixserver", customer)).json.data.total, 463);
  console.log(JSON.stringify({ ok: true, signupApproval: "SUPER_ADMIN_ONLY", providerFixtureCalls: 4, workerAccepted: { email: 2, sms: 1 }, quotaExhaustedWithoutFallback: true, optOutRecorded: true, liveDeliveryVerified: false, ordersCreated: 0, invoicesCreated: 0 }, null, 2));
} finally {
  await stop(panel);
  if (provider?.listening) { provider.closeAllConnections(); await new Promise((resolve) => provider.close(resolve)); }
  await db.$disconnect();
  await rm(temp, { recursive: true, force: true });
}
