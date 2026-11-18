#!/usr/bin/env node
/** Finite integration test of the actual standalone panel, worker and edge.
 * Creates its DB from schema only, binds loopback, reads public GitHub and
 * deletes the temporary DB and volume. Never reads a deployment DB URL. */
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { once } from "node:events";
import { copyFile, mkdir, mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { get } from "node:http";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import { createClient } from "@libsql/client";
import { PrismaLibSQL } from "@prisma/adapter-libsql";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const repo = process.argv[2] ?? "octocat/Spoon-Knife";
assert.match(repo, /^[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._-]*$/);
const root = fileURLToPath(new URL("../", import.meta.url));
const standalone = path.join(root, ".next/standalone");
const temp = await realpath(await mkdtemp(path.join(os.tmpdir(), "alo-static-smoke-")));
const children = [];
const exec = promisify(execFile);
const token = () => randomBytes(32).toString("hex");
const domain = "static-smoke.test";
const releaseRoot = path.join(temp, "releases");
const databaseUrl = `file:${path.join(temp, "candidate.db")}`;

async function port() {
  const server = createServer().listen(0, "127.0.0.1");
  await once(server, "listening");
  const number = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return number;
}

function start(program, env) {
  const child = spawn(process.execPath, [program], { cwd: temp, env, stdio: ["ignore", "pipe", "pipe"] });
  const status = { child, log: "", error: null };
  const append = (chunk) => { status.log = (status.log + String(chunk)).slice(-4000); };
  child.stdout.on("data", append);
  child.stderr.on("data", append);
  child.on("error", (error) => { status.error = error.message; });
  children.push(status);
  return status;
}

async function ready(service, probe) {
  for (let count = 0; count < 100; count++) {
    if (service.error || service.child.exitCode !== null) break;
    try { if (await probe()) return; } catch { /* short startup window */ }
    await delay(100);
  }
  throw new Error(`Standalone process did not become ready: ${service.error ?? service.log}`);
}

async function stop({ child }) {
  if (child.exitCode !== null || child.signalCode !== null || !child.pid) return;
  const done = once(child, "exit");
  child.kill("SIGTERM");
  const timeout = setTimeout(() => child.kill("SIGKILL"), 5_000);
  try { await done; } finally { clearTimeout(timeout); }
}

async function seed(env) {
  // Migrate a read-off-disk COPY of the tracked fixture, then take DDL only.
  // Starting the worker with a row copy could replay unrelated fixture jobs.
  const schema = path.join(temp, "schema.db");
  const backup = path.join(temp, "before-migrations.db");
  await copyFile(path.join(root, "db/custom.db"), schema);
  await copyFile(schema, backup);
  await exec(process.execPath, [path.join(root, "scripts/apply-deploy-schema.mjs"), "--allow-rebuild", "--backup", backup], {
    cwd: root, env: { ...env, DATABASE_URL: `file:${schema}` }, timeout: 30_000,
  });
  const template = createClient({ url: `file:${schema}` });
  const candidate = createClient({ url: databaseUrl });
  try {
    const ddl = await template.execute("SELECT sql FROM sqlite_schema WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' AND type IN ('table','index') ORDER BY CASE type WHEN 'table' THEN 0 ELSE 1 END");
    await candidate.batch(ddl.rows.map((row) => String(row.sql)), "write");
  } finally { template.close(); candidate.close(); }
  const db = new PrismaClient({ adapter: new PrismaLibSQL({ url: databaseUrl }) });
  try {
    const client = await db.role.create({ data: { name: "CLIENT", permissions: { create: ["WEBSITE_CREATE", "WEBSITE_DEPLOY"].map((name) => ({ permission: { create: { name } } })) } } });
    const admin = await db.role.create({ data: { name: "ADMIN" } });
    const password = token();
    const passwordHash = await bcrypt.hash(password, 10);
    const [first, second, operator] = await Promise.all([client, client, admin].map((role, index) => db.user.create({ data: {
      roleId: role.id, email: `static-smoke-${index}@example.test`, passwordHash, emailVerified: new Date(), onboardingCompleted: true,
    } })));
    const plan = await db.plan.create({ data: { name: "Disposable static plan", priceCents: 0, maxSites: 1, features: "[]" } });
    await db.subscription.create({ data: { userId: first.id, planId: plan.id, currentPeriodEnd: new Date(Date.now() + 3_600_000) } });
    return { first, second, operator, password, plan };
  } finally { await db.$disconnect(); }
}

try {
  const panelPort = await port();
  let edgePort = await port();
  while (edgePort === panelPort) edgePort = await port();
  const base = `http://127.0.0.1:${panelPort}`;
  const edgeUrl = `http://127.0.0.1:${edgePort}`;
  const staticEnv = { STATIC_HOSTING_DOMAIN: domain, STATIC_HOSTING_ROOT: releaseRoot, STATIC_HOSTING_EDGE_PORT: String(edgePort) };
  const env = {
    ...staticEnv, NODE_ENV: "production", APP_URL: base, NEXTAUTH_URL: base, DATABASE_URL: databaseUrl,
    NEXTAUTH_SECRET: token(), JWT_SECRET: token(), APP_ENCRYPTION_KEY: token(), INTERNAL_SECRET: token(),
    DEPLOY_INLINE_WORKER: "false", DEPLOY_DISABLE_BOOT_RESTORE: "true", DEPLOY_LOCAL_EXECUTION: "false",
    ORCHESTRATOR_HEARTBEAT_FILE: path.join(temp, "heartbeat.json"),
    ...(process.env.NODE_EXTRA_CA_CERTS ? { NODE_EXTRA_CA_CERTS: process.env.NODE_EXTRA_CA_CERTS } : {}),
  };
  const fixture = await seed(env);
  await mkdir(releaseRoot);
  // Run the copied edge bundle, not from a directory that can resolve app or
  // workspace dependencies. This mirrors the credential-free systemd unit.
  const edgeProgram = path.join(temp, "static-edge.cjs");
  await copyFile(path.join(standalone, "static-edge.cjs"), edgeProgram);
  const edge = start(edgeProgram, staticEnv);
  const panel = start(path.join(standalone, "server.js"), { ...env, PORT: String(panelPort), HOSTNAME: "127.0.0.1" });
  const fetchBounded = (url, options) => fetch(url, { redirect: "manual", signal: AbortSignal.timeout(5000), ...options });
  await Promise.all([
    ready(edge, async () => (await fetchBounded(edgeUrl)).status === 404),
    ready(panel, async () => (await fetchBounded(`${base}/api/csrf`)).status === 200),
  ]);

  async function login(email) {
    const res = await fetchBounded(`${base}/api/auth/login`, {
      method: "POST", headers: { "Content-Type": "application/json", Origin: base }, body: JSON.stringify({ email, password: fixture.password }),
    });
    assert.equal(res.status, 200, (await res.clone().json()).message);
    const session = res.headers.getSetCookie().find((value) => value.startsWith("next-auth.session-token="))?.split(";")[0];
    assert.ok(session, "Login did not set a session cookie");
    const csrf = (await fetchBounded(`${base}/api/csrf`, { headers: { Cookie: session } })).headers.getSetCookie()[0]?.split(";")[0];
    assert.ok(csrf?.startsWith("alo_csrf="));
    return { cookie: `${session}; ${csrf}`, csrf: csrf.slice("alo_csrf=".length).split(".")[0] };
  }

  async function api(path, session, data, csrf = true) {
    const res = await fetchBounded(`${base}${path}`, {
      method: data === undefined ? "GET" : "POST",
      headers: { Origin: base, ...(session ? { Cookie: session.cookie, ...(csrf ? { "X-ALO-CSRF": session.csrf } : {}) } : {}),
        ...(data === undefined ? {} : { "Content-Type": "application/json" }) },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }),
    });
    return { status: res.status, body: await res.json() };
  }

  const customer = await login(fixture.first.email);
  const stranger = await login(fixture.second.email);
  const operator = await login(fixture.operator.email);
  const route = "/api/deploy/static";
  assert.equal((await api(route)).status, 401);
  assert.equal((await fetchBounded(`${base}/deployments/static`, { headers: { Cookie: customer.cookie } })).status, 200);
  assert.equal((await fetchBounded(`${base}/automation/static-hosting`, { headers: { Cookie: operator.cookie } })).status, 200);
  const request = { planId: fixture.plan.id, label: "acceptance", repository: repo, requestId: randomUUID(), confirmPublish: true };
  assert.equal((await api(route, customer, request, false)).status, 403, "Mutation without CSRF was accepted");
  const accepted = await api(route, customer, request);
  assert.equal(accepted.status, 202, accepted.body.message);
  const { id, hostname, jobId } = accepted.body.data;
  assert.equal(jobId, null);
  assert.equal((await api(route, customer, request)).body.data.id, id);
  assert.equal((await api(route, customer, { ...request, label: "over-quota", requestId: randomUUID() })).status, 403);
  assert.equal((await api(route, stranger, { ...request, label: "no-plan", requestId: randomUUID() })).status, 402);
  assert.equal((await api(`${route}?scope=all`, stranger)).status, 403);

  async function runWorker() {
    await exec(process.execPath, [path.join(standalone, "automation-worker.cjs"), "--once"], { cwd: temp, env, timeout: 70_000 });
    const heartbeat = JSON.parse(await readFile(env.ORCHESTRATOR_HEARTBEAT_FILE, "utf8"));
    assert.equal(heartbeat.lastError, null);
    assert.ok(heartbeat.lastSuccessAt);
  }

  await runWorker();
  const status = (await api(route, customer)).body.data.sites[0];
  assert.equal(status.status, "SUCCESS", status.error ?? JSON.stringify(status.events));
  assert.equal(status.public.status, "NOT_CONFIGURED");
  assert.ok(!status.public.url);
  assert.equal((await api(route, stranger)).body.data.sites.length, 0);
  assert.equal((await api(`${route}?scope=all`, operator)).body.data.sites[0].ownerId, fixture.first.id);
  const readEdge = (asset) => new Promise((resolve, reject) => {
    // Node fetch normalizes Host to the socket address. Use node:http for the
    // same name-based routing that a real front proxy performs.
    const request = get(`${edgeUrl}${asset}`, { headers: { Host: hostname }, signal: AbortSignal.timeout(5_000) }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.once("end", () => resolve({ status: response.statusCode, body: Buffer.concat(chunks) }));
      response.once("error", reject);
    });
    request.once("error", reject);
  });
  const homepage = await readEdge("/");
  assert.equal(homepage.status, 200);
  const bytes = homepage.body;
  const checksum = createHash("sha256").update(bytes).digest("hex");
  const marker = JSON.parse((await readEdge("/.well-known/alo-static-release")).body.toString("utf8"));
  assert.equal(marker.siteId, id);
  assert.equal(marker.commitSha, status.commitSha);
  assert.equal(marker.indexSha256, checksum);

  const withdraw = `${route}/${id}/withdraw`;
  assert.equal((await api(withdraw, stranger, { confirmHostname: hostname })).status, 404);
  assert.equal((await api(withdraw, customer, { confirmHostname: "incorrect" })).status, 409);
  const withdrawal = await api(withdraw, customer, { confirmHostname: hostname });
  assert.equal(withdrawal.status, 202);
  await runWorker();
  assert.equal((await readEdge("/")).status, 404);
  assert.deepEqual(await readFile(path.join(releaseRoot, `.held-${id}`, "index.html")), bytes);
  const after = (await api(route, customer)).body.data;
  assert.equal(after.plan.usedSites, 0);
  assert.equal(after.sites[0].withdrawalStatus, "SUCCESS");
  assert.equal(after.sites[0].public, null);

  const db = createClient({ url: databaseUrl });
  try {
    const audit = await db.execute({ sql: "SELECT count(*) AS records FROM audit_logs WHERE action='STATIC_HOSTING_REQUESTED' AND resourceId=?", args: [id] });
    const charges = await db.execute("SELECT (SELECT count(*) FROM invoices) + (SELECT count(*) FROM orders) AS records");
    assert.equal(Number(audit.rows[0].records), 1);
    assert.equal(Number(charges.rows[0].records), 0);
  } finally { db.close(); }
  console.log(JSON.stringify({ ok: true, environment: "disposable loopback standalone processes", repo, commitSha: marker.commitSha,
    homepageSha256: checksum, files: marker.files, originHttp: 200, withdrawnOriginHttp: 404, jobId: status.jobId,
    withdrawalJobId: withdrawal.body.data.jobId, publicHttpsVerified: false, financialChanges: 0 }, null, 2));
} finally {
  await Promise.all(children.map(stop));
  await rm(temp, { recursive: true, force: true });
}
