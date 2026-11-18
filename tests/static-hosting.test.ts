import { isolatedDbPath, teardownIsolatedDb } from "./helpers/isolated-db";
import { applyCurrentSchema } from "./helpers/apply-schema";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { createServer, request as httpRequest } from "node:http";
import { EventEmitter, once } from "node:events";
import { Resolver } from "node:dns/promises";
import https from "node:https";
import { PassThrough } from "node:stream";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { encode } from "next-auth/jwt";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { getStaticHostingStatus, reconcileStaticHostingRequests, staticPublishKey } from "@/lib/hosting/static-control";
import { STATIC_EDGE_ID, STATIC_EVIDENCE_TTL_MS, STATIC_MANIFEST, STATIC_MARKER_PATH, STATIC_LIMITS, staticHostingConfig } from "@/lib/hosting/static-config";
import { createStaticEdge } from "@/lib/hosting/static-edge";
import { selectStaticAssets } from "@/lib/hosting/static-source";
import { runAutomationTick } from "@/lib/orchestrator/engine";
import { orchestrator } from "@/lib/orchestrator/orchestrator";
import { GET, POST } from "@/app/api/deploy/static/route";
import { POST as WITHDRAW } from "@/app/api/deploy/static/[id]/withdraw/route";
import { POST as VERIFY } from "@/app/api/deploy/static/[id]/verify/route";
import type { AuthUser } from "@/lib/auth";

let root: string;
let edge: ReturnType<typeof createStaticEdge>;
let port: number;
const domain = "static-ci.test";
const base = "http://localhost:3051/api/deploy/static";
const sha = "f".repeat(40);
const treeSha = "a".repeat(40);
const testSignal = AbortSignal.timeout;

beforeAll(async () => {
  applyCurrentSchema(isolatedDbPath);
  root = await realpath(await mkdtemp(path.join(os.tmpdir(), "alo-static-")));
  vi.stubEnv("STATIC_HOSTING_DOMAIN", domain);
  vi.stubEnv("STATIC_HOSTING_ROOT", root);
  vi.stubEnv("STATIC_HOSTING_PUBLIC_IPV4", "");
  vi.stubEnv("STATIC_HOSTING_MAX_RESERVATIONS", "25");
  vi.stubEnv("APP_URL", "http://localhost:3051");
  edge = createStaticEdge(staticHostingConfig()!);
  edge.listen(0, "127.0.0.1");
  await once(edge, "listening");
  port = (edge.address() as { port: number }).port;
  vi.stubEnv("STATIC_HOSTING_EDGE_PORT", String(port));
}, 30_000);

afterEach(() => vi.restoreAllMocks());
afterAll(async () => {
  if (edge?.listening) { edge.close(); await once(edge, "close"); }
  if (root) await rm(root, { recursive: true, force: true });
  vi.unstubAllEnvs();
  await teardownIsolatedDb();
});

async function customer(maxSites = 2, enabled = true) {
  const nonce = randomUUID();
  const user = await db.user.create({ data: {
    email: `static-${nonce}@test.invalid`, emailVerified: new Date(), onboardingCompleted: true, role: { connect: { name: "CLIENT" } },
  } });
  const plan = await db.plan.create({ data: { name: `Static hosting ${nonce}`, priceCents: 0, maxSites, features: "[]" } });
  const sub = enabled ? await db.subscription.create({ data: { userId: user.id, planId: plan.id, currentPeriodEnd: new Date(Date.now() + 3_600_000) } }) : null;
  const actor: AuthUser = { id: user.id, role: "CLIENT", email: user.email, emailVerified: true, permissions: ["WEBSITE_CREATE", "WEBSITE_DEPLOY"] };
  return { user, plan, sub, actor };
}

async function req(method: "GET" | "POST", user?: { email: string }, body?: unknown, url = base) {
  const headers = new Headers({ "content-type": "application/json" });
  if (user) headers.set("Cookie", `next-auth.session-token=${await encode({ token: { email: user.email }, secret: process.env.NEXTAUTH_SECRET! })}`);
  return new NextRequest(url, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
}

function payload(planId: string, label: string, repository = "octocat/Spoon-Knife") {
  return { planId, label, repository, requestId: randomUUID(), confirmPublish: true };
}

function readEdge(hostname: string, asset: string, method = "GET") {
  return new Promise<{ status: number; body: string; headers: NodeJS.Dict<string | string[]> }>((resolve, reject) => {
    const conn = httpRequest({ hostname: "127.0.0.1", port, path: asset, method, headers: { host: hostname }, signal: testSignal(5_000) }, (res) => {
      let body = "";
      res.setEncoding("utf8").on("data", (chunk) => { body += chunk; });
      res.on("end", () => resolve({ status: res.statusCode!, body, headers: res.headers }));
      res.on("error", reject);
    });
    conn.on("error", reject).end();
  });
}

function asset(path: string, text: string, mode = "100644") {
  const data = Buffer.from(text);
  return { path, type: "blob", size: data.length, mode, sha: createHash("sha1").update(`blob ${data.length}\0`).update(data).digest("hex"), content: data.toString("base64") };
}

const home = "<!doctype html><title>Fixture</title><h1>Verified static workload</h1>";
const fixture = [asset("index.html", home), asset("styles/base.css", "h1 { color: green; }"), asset(".env", "NOT_PUBLIC=fixture"), asset(".git/config", "not an asset")];

function githubBoundary({ corrupt = false, files = fixture }: { corrupt?: boolean; files?: typeof fixture } = {}) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = new URL(String(input));
    expect(url.origin).toBe("https://api.github.com");
    expect(init?.redirect).toBe("error");
    expect(new Headers(init?.headers).has("authorization")).toBe(false);
    const resource = url.pathname.split("/").slice(4).join("/");
    if (!resource) return Response.json({ full_name: "octocat/Spoon-Knife", private: false, default_branch: "main" });
    if (resource === "git/ref/heads/main") return Response.json({ ref: "refs/heads/main", object: { type: "commit", sha } });
    if (resource === `git/commits/${sha}`) return Response.json({ sha, tree: { sha: treeSha } });
    if (resource === `git/trees/${treeSha}`) return Response.json({ sha: treeSha, truncated: false, tree: files.map(({ path, type, mode, size, sha }) => ({ path, type, mode, size, sha })) });
    const file = files.find((entry) => resource === `git/blobs/${entry.sha}`);
    if (file && (file.path === "index.html" || file.path.startsWith("styles/"))) {
      return Response.json({ sha: file.sha, size: file.size, encoding: "base64", content: corrupt ? "aW5jb3JyZWN0" : file.content });
    }
    throw new Error("unexpected source read");
  });
}

async function submit(user: { email: string }, input: ReturnType<typeof payload>) {
  const res = await POST(await req("POST", user, input));
  expect((await res.clone().json()).message).toBe("Deployment request recorded");
  expect(res.status).toBe(202);
  return (await res.json()).data as { id: string; hostname: string; jobId: string | null };
}

async function attach(siteId: string) {
  await reconcileStaticHostingRequests(100);
  const site = await db.staticHostingSite.findUniqueOrThrow({ where: { id: siteId } });
  expect(site.initialJobId).toBeTruthy();
  return site.initialJobId!;
}

describe("managed static hosting", () => {
  it("requires authentication, explicit publication consent, and a selected active entitlement", async () => {
    const { user, plan } = await customer(2, false);
    const input = payload(plan.id, "no-subscription");
    expect((await GET(await req("GET"))).status).toBe(401);
    expect((await POST(await req("POST", user, { ...input, confirmPublish: false }))).status).toBe(400);
    expect((await POST(await req("POST", user, { ...input, branch: "a/../b" }))).status).toBe(400);
    expect((await POST(await req("POST", user, { ...input, label: "admin" }))).status).toBe(400);
    expect((await POST(await req("POST", user, input))).status).toBe(402);
    expect(await db.staticHostingSite.count({ where: { ownerId: user.id } })).toBe(0);
    expect(await db.invoice.count({ where: { userId: user.id } })).toBe(0);
  });

  it("rejects a sibling content zone, private ingress or a full host", async () => {
    expect(staticHostingConfig({ ...process.env, APP_URL: "https://portal.example.co.uk", STATIC_HOSTING_DOMAIN: "sites.example.co.uk" })).toBeNull();
    expect(staticHostingConfig({ ...process.env, STATIC_HOSTING_DOMAIN: "co.uk" })).toBeNull();
    expect(staticHostingConfig({ ...process.env, STATIC_HOSTING_PUBLIC_IPV4: "192.168.1.1" })).toBeNull();
    expect(staticHostingConfig({ ...process.env, STATIC_HOSTING_PUBLIC_IPV4: "203.0.113.1" })).toBeNull();
    const { user, plan } = await customer();
    const count = await db.staticHostingSite.count();
    if (count === 0) await submit(user, payload(plan.id, "capacity-first"));
    try {
      process.env.STATIC_HOSTING_MAX_RESERVATIONS = String(await db.staticHostingSite.count());
      expect((await POST(await req("POST", user, payload(plan.id, "host-limit")))).status).toBe(503);
    } finally { process.env.STATIC_HOSTING_MAX_RESERVATIONS = "25"; }
  });

  it("serializes competing quota reservations and makes a replay idempotent", async () => {
    const { user, plan } = await customer(1);
    const one = payload(plan.id, "quota-one");
    const two = payload(plan.id, "quota-two");
    const requests = await Promise.all([req("POST", user, one), req("POST", user, two)]);
    const results = await Promise.all(requests.map(POST));
    expect(results.map((response) => response.status).sort()).toEqual([202, 403]);
    const winner = results[0]?.status === 202 ? one : two;
    const id = (await db.staticHostingSite.findFirstOrThrow({ where: { ownerId: user.id } })).id;
    expect((await submit(user, winner)).id).toBe(id);
    expect((await POST(await req("POST", user, { ...winner, label: "idempotency-conflict" }))).status).toBe(409);
    expect(await db.auditLog.count({ where: { action: "STATIC_HOSTING_REQUESTED", resourceId: id } })).toBe(1);
  });

  it("does not let another tenant read or claim a hostname", async () => {
    const { user, plan } = await customer();
    const stranger = await customer();
    const primary = await submit(user, payload(plan.id, "reserved-by-tenant"));
    expect((await POST(await req("POST", stranger.user, payload(stranger.plan.id, "reserved-by-tenant")))).status).toBe(409);
    const otherList = await GET(await req("GET", stranger.user));
    expect((await otherList.json()).data.sites).toEqual([]);
    expect((await GET(await req("GET", stranger.user, undefined, `${base}?scope=all`))).status).toBe(403);
    const request = await req("POST", stranger.user, undefined, `${base}/${primary.id}/verify`);
    const previous = process.env.STATIC_HOSTING_PUBLIC_IPV4;
    process.env.STATIC_HOSTING_PUBLIC_IPV4 = "1.1.1.1"; // validation only; no network job is created
    try { expect((await VERIFY(request, { params: Promise.resolve({ id: primary.id }) })).status).toBe(404); }
    finally { process.env.STATIC_HOSTING_PUBLIC_IPV4 = previous; }
  });

  it("hands off after a simulated interruption, serves real bytes, and withholds a public URL without evidence", async () => {
    const { user, plan, actor } = await customer();
    const fetchSpy = githubBoundary();
    const request = await submit(user, payload(plan.id, "verified-local"));
    expect(request.jobId).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect((await readEdge(request.hostname, "/")).status).toBe(404);
    const id = await attach(request.id);
    await db.staticHostingSite.update({ where: { id: request.id }, data: { initialJobId: null } });
    expect(await attach(request.id)).toBe(id);
    expect(await db.operationJob.count({ where: { idempotencyKey: staticPublishKey(request.id) } })).toBe(1);
    await orchestrator.runNext(`static-worker-${randomUUID()}`, { jobId: id });
    const job = await db.operationJob.findUniqueOrThrow({ where: { id } });
    expect(job.error, job.output ?? "").toBeNull();
    expect(job.status).toBe("SUCCESS");
    const homepage = await readEdge(request.hostname, "/");
    expect(homepage.status).toBe(200);
    expect(homepage.body).toBe(home);
    expect(homepage.headers["x-content-type-options"]).toBe("nosniff");
    expect((await readEdge(request.hostname, "/styles/base.css")).body).toContain("color: green");
    expect((await readEdge(request.hostname, "/", "HEAD")).body).toBe("");
    expect(JSON.parse((await readEdge(request.hostname, STATIC_MARKER_PATH)).body)).toMatchObject({ siteId: request.id, commitSha: sha, files: 2 });
    expect((await getStaticHostingStatus(actor)).sites[0]).toMatchObject({ id: request.id, status: "SUCCESS", originVerifiedAt: expect.any(String), public: { status: "NOT_CONFIGURED" } });
    expect(JSON.stringify(await getStaticHostingStatus(actor))).not.toContain("https://verified-local");
    expect(await db.invoice.count({ where: { userId: user.id } })).toBe(0);
  });

  it("never executes a static release in the legacy HTTP automation tick", async () => {
    const { user, plan } = await customer();
    const site = await submit(user, payload(plan.id, "worker-only"));
    const id = await attach(site.id);
    const spy = githubBoundary();
    const tick = await runAutomationTick({ workerId: "simulated-http-tick", kinds: ["STATIC_HOSTING"], maxJobs: 1 });
    expect(tick.ran).toEqual([]);
    expect(tick.staticRequests).toBe(0);
    expect(spy).not.toHaveBeenCalled();
    expect((await db.operationJob.findUniqueOrThrow({ where: { id } })).status).toBe("QUEUED");
  });

  it("publishes a URL only for fresh matching DNS and HTTPS evidence, and replaces it on a failed recheck", async () => {
    const { user, plan, actor } = await customer();
    githubBoundary();
    const ip = "1.1.1.1"; // mocked transport only: no connections to the sample addresses
    const dnsA = vi.spyOn(Resolver.prototype, "resolve4").mockResolvedValue([ip] as never);
    vi.spyOn(Resolver.prototype, "resolve6").mockResolvedValue([]);
    let reply: "matching" | "wrong-body" | "tls-failure" = "matching";
    let hostname: string;
    const request = vi.spyOn(https, "request").mockImplementation(((options: https.RequestOptions, cb: (res: unknown) => void) => {
      expect(options).toMatchObject({ hostname: ip, port: 443, servername: hostname, agent: false, rejectUnauthorized: true, headers: { Host: hostname } });
      expect(options.checkServerIdentity).toBeTypeOf("function");
      const outgoing = new EventEmitter() as EventEmitter & { end: () => void };
      outgoing.end = () => {
        if (reply === "tls-failure") { queueMicrotask(() => outgoing.emit("error", new Error("Untrusted test certificate"))); return; }
        void readEdge(hostname, options.path!).then(({ status, body }) => {
          const response = Object.assign(new PassThrough(), { statusCode: status, complete: true, headers: { "x-alo-static-edge": STATIC_EDGE_ID } });
          cb(response);
          response.end(options.path === "/" && reply === "wrong-body" ? "not the expected homepage" : body);
        }).catch((error) => outgoing.emit("error", error));
      };
      return outgoing;
    }) as typeof https.request);
    const originalIp = process.env.STATIC_HOSTING_PUBLIC_IPV4;
    try {
      process.env.STATIC_HOSTING_PUBLIC_IPV4 = ip;
      const site = await submit(user, payload(plan.id, "evidence-bound"));
      hostname = site.hostname;
      const id = await attach(site.id);
      await orchestrator.runNext("public-check-worker", { jobId: id });
      const status = async () => (await getStaticHostingStatus(actor)).sites[0]!;
      expect((await status()).public).toEqual({ status: "VERIFIED", checkedAt: expect.any(String), url: `https://${hostname}` });
      process.env.STATIC_HOSTING_PUBLIC_IPV4 = "8.8.8.8";
      expect((await status()).public).toEqual({ status: "CHECK_REQUIRED", checkedAt: expect.any(String) });
      process.env.STATIC_HOSTING_PUBLIC_IPV4 = ip;
      const realNow = Date.now();
      const clock = vi.spyOn(Date, "now").mockReturnValue(realNow + STATIC_EVIDENCE_TTL_MS + 1_000);
      try { expect((await status()).public?.status).toBe("CHECK_REQUIRED"); }
      finally { clock.mockRestore(); }
      const recheck = async (minutes: number) => {
        const clock = vi.spyOn(Date, "now").mockReturnValue(realNow + 60_000 * minutes);
        try {
          const accepted = await VERIFY(await req("POST", user), { params: Promise.resolve({ id: site.id }) });
          expect(accepted.status).toBe(202);
          const { jobId } = (await accepted.json()).data;
          const again = await VERIFY(await req("POST", user), { params: Promise.resolve({ id: site.id }) });
          expect((await again.json()).data.jobId).toBe(jobId);
          await orchestrator.runNext("public-recheck-worker", { jobId });
        } finally { clock.mockRestore(); }
      };
      reply = "wrong-body";
      await recheck(1);
      expect((await status()).public).toEqual({ status: "HTTPS_NOT_VERIFIED", checkedAt: expect.any(String) });
      reply = "tls-failure";
      await recheck(2);
      expect((await status()).public?.status).toBe("HTTPS_NOT_VERIFIED");
      request.mockClear();
      dnsA.mockResolvedValueOnce(["127.0.0.1"] as never);
      await recheck(3);
      expect((await status()).public).toEqual({ status: "DNS_NOT_VERIFIED", checkedAt: expect.any(String) });
      expect(request).not.toHaveBeenCalled();
      expect((await status()).originVerifiedAt).toBeTruthy();
    } finally { process.env.STATIC_HOSTING_PUBLIC_IPV4 = originalIp; }
  });

  it("recovers the persisted lease after a separate worker exits, with one claimant per site", async () => {
    const { user, plan, actor } = await customer();
    const site = await submit(user, payload(plan.id, "worker-restart"));
    const id = await attach(site.id);
    const competing = await orchestrator.enqueue({ kind: "STATIC_HOSTING", type: "static-hosting-verify-https", input: { action: "verify-https", siteId: site.id },
      actor: { ...actor, scopes: ["repo:read", "build:run", "release:write"] }, resourceType: "StaticHostingSite", resourceId: site.id, lockKey: `static-site:${site.id}` });
    const exec = promisify(execFile);
    const claims = await Promise.all([id, competing.jobId].map((job, index) =>
      exec(process.execPath, ["--import", "tsx", "tests/helpers/claim-job-child.ts", job, `exiting-worker-${index}`], { timeout: 10_000 })));
    expect(claims.map(({ stdout }) => JSON.parse(stdout).claimed).filter(Boolean)).toHaveLength(1);
    const winner = (await db.operationJob.findFirstOrThrow({ where: { lockKey: `static-site:${site.id}`, status: "RUNNING" } })).id;
    const second = winner === id ? competing.jobId : id;
    expect(await orchestrator.claimSpecific("replacement-before-expiry", second)).toBeNull();
    // A real process exited holding a lease. Advance expiry in the disposable DB
    // rather than wait three minutes for the lease to expire naturally.
    await db.operationJob.update({ where: { id: winner }, data: { leaseExpiresAt: new Date(0) } });
    expect((await orchestrator.recoverAbandoned()).jobIds).toContain(winner);
    await db.operationJob.update({ where: { id }, data: { availableAt: new Date(0) } });
    githubBoundary();
    expect(await orchestrator.runNext("replacement-worker", { jobId: id })).toBe(id);
    expect((await db.operationJob.findUniqueOrThrow({ where: { id } })).status).toBe("SUCCESS");
    expect((await readEdge(site.hostname, "/")).body).toBe(home);
  }, 20_000);

  it("withdraws only after exact owner confirmation and releases the slot while retaining bytes", async () => {
    const { user, plan, sub, actor } = await customer(1);
    const stranger = await customer();
    githubBoundary();
    const site = await submit(user, payload(plan.id, "withdrawn-by-owner"));
    const params = { params: Promise.resolve({ id: site.id }) };
    const id = await attach(site.id);
    await orchestrator.runNext("publisher", { jobId: id });
    expect((await readEdge(site.hostname, "/")).status).toBe(200);
    expect((await WITHDRAW(await req("POST", user, { confirmHostname: "wrong" }), params)).status).toBe(409);
    expect((await WITHDRAW(await req("POST", stranger.user, { confirmHostname: site.hostname }), params)).status).toBe(404);
    await db.subscription.update({ where: { id: sub!.id }, data: { status: "cancelled" } });
    const accepted = await WITHDRAW(await req("POST", user, { confirmHostname: site.hostname }), params);
    expect(accepted.status).toBe(202);
    const { jobId } = (await accepted.json()).data;
    const duplicate = await WITHDRAW(await req("POST", user, { confirmHostname: site.hostname }), params);
    expect((await duplicate.json()).data.jobId).toBe(jobId);
    await orchestrator.runNext("withdrawal-worker", { jobId });
    expect((await db.operationJob.findUniqueOrThrow({ where: { id: jobId } })).status).toBe("SUCCESS");
    expect((await readEdge(site.hostname, "/")).status).toBe(404);
    expect((await readEdge(site.hostname, STATIC_MARKER_PATH)).status).toBe(404);
    expect(await readFile(path.join(root, `.held-${site.id}`, "index.html"), "utf8")).toBe(home);
    await db.subscription.update({ where: { id: sub!.id }, data: { status: "active" } });
    expect((await getStaticHostingStatus(actor)).plan?.usedSites).toBe(0);
    expect((await getStaticHostingStatus(actor)).sites[0]).toMatchObject({ withdrawnAt: expect.any(String), public: null });
    expect((await POST(await req("POST", stranger.user, payload(stranger.plan.id, "withdrawn-by-owner")))).status).toBe(409);
  });

  it("rolls back an unhealthy first activation and retries the identical held release without re-reading GitHub", async () => {
    const { user, plan } = await customer();
    const broken = createServer((_, res) => res.writeHead(503).end());
    broken.listen(0, "127.0.0.1");
    await once(broken, "listening");
    const spy = githubBoundary();
    const site = await submit(user, payload(plan.id, "origin-retry"));
    const id = await attach(site.id);
    try {
      process.env.STATIC_HOSTING_EDGE_PORT = String((broken.address() as { port: number }).port);
      await orchestrator.runNext("failed-origin-worker", { jobId: id });
      expect((await db.operationJob.findUniqueOrThrow({ where: { id } })).status).toBe("RETRYING");
      expect((await readEdge(site.hostname, "/")).status).toBe(404);
      expect(await readFile(path.join(root, `.held-${site.id}`, "index.html"), "utf8")).toBe(home);
    } finally {
      process.env.STATIC_HOSTING_EDGE_PORT = String(port);
      broken.close();
      await once(broken, "close");
    }
    spy.mockClear();
    await db.operationJob.update({ where: { id }, data: { availableAt: new Date(0) } });
    await orchestrator.runNext("restarted-origin-worker", { jobId: id });
    expect(spy).not.toHaveBeenCalled();
    expect((await db.operationJob.findUniqueOrThrow({ where: { id } })).status).toBe("SUCCESS");
    expect((await readEdge(site.hostname, "/")).status).toBe(200);
  });

  it("does not publish a mismatched blob or a runtime project", async () => {
    const { user, plan } = await customer();
    const wrong = await submit(user, payload(plan.id, "corrupt-blob"));
    const spy = githubBoundary({ corrupt: true });
    const job = await attach(wrong.id);
    await orchestrator.runNext("bad-blob-worker", { jobId: job });
    expect((await db.operationJob.findUniqueOrThrow({ where: { id: job } })).lastError).toBe("VERIFICATION_REQUIRED");
    expect((await readEdge(wrong.hostname, "/")).status).toBe(404);
    expect((await readdir(root)).filter((name) => name.startsWith(".stage-") || name === wrong.hostname)).toEqual([]);
    spy.mockRestore();
    await expect(selectStaticAssets([...fixture, asset("package.json", "{}")])).rejects.toThrow("requires a build");
    await expect(selectStaticAssets([asset("index.html", home, "120000")])).rejects.toThrow("non-executable");
    await expect(selectStaticAssets([asset("index.html", home), { ...asset("big.png", "x"), size: STATIC_LIMITS.fileBytes + 1 }])).rejects.toThrow("size limit");
  });

  it("checks subscription revocation again at execution, before any provider request", async () => {
    const { user, plan, sub } = await customer();
    const saved = await submit(user, payload(plan.id, "cancelled-plan"));
    const id = await attach(saved.id);
    await db.subscription.update({ where: { id: sub!.id }, data: { status: "cancelled" } });
    const spy = githubBoundary();
    await orchestrator.runNext("cancelled-plan-worker", { jobId: id });
    expect(spy).not.toHaveBeenCalled();
    expect((await db.operationJob.findUniqueOrThrow({ where: { id } })).lastError).toBe("FORBIDDEN");
    expect((await readEdge(saved.hostname, "/")).status).toBe(404);
  });

  it("fails closed on foreign hosts, symlinks, staging paths and unsupported types", async () => {
    const demo = `jail-test.${domain}`;
    const dir = path.join(root, demo);
    await mkdir(dir);
    const external = path.join(root, "test-outside.txt");
    await writeFile(external, "private outside fixture");
    await symlink(external, path.join(dir, "outside.txt"));
    await writeFile(path.join(dir, ".env"), "private fixture");
    await writeFile(path.join(dir, "server.php"), "not a public file");
    for (const file of ["/outside.txt", "/.env", "/server.php", "/../test-outside.txt", "/%2e%2e/test-outside.txt", `/${STATIC_MANIFEST}`]) {
      expect((await readEdge(demo, file)).status, file).toBe(404);
    }
    expect((await readEdge(`jail-test.${domain}.invalid`, "/outside.txt")).status).toBe(404);
    expect((await readEdge(`.stage-test.${domain}`, "/index.html")).status).toBe(404);
    expect((await readEdge(demo, "/", "POST")).status).toBe(405);
  });

  it.skipIf(!process.env.LIVE_STATIC_FIXTURE_REPO)("reads real public GitHub, pins its commit, and serves it through the isolated edge", async () => {
    const { user, plan, actor } = await customer();
    const site = await submit(user, payload(plan.id, "live-github-rehearsal", process.env.LIVE_STATIC_FIXTURE_REPO!));
    const id = await attach(site.id);
    await orchestrator.runNext("live-github-acceptance", { jobId: id });
    const job = await db.operationJob.findUniqueOrThrow({ where: { id } });
    expect(job.error, job.output ?? "").toBeNull();
    expect(job.status).toBe("SUCCESS");
    const marker = JSON.parse((await readEdge(site.hostname, STATIC_MARKER_PATH)).body);
    const page = await readEdge(site.hostname, "/");
    expect(page.status).toBe(200);
    expect(createHash("sha256").update(page.body).digest("hex")).toBe(marker.indexSha256);
    expect(marker.commitSha).toMatch(/^[a-f0-9]{40}$/);
    expect((await getStaticHostingStatus(actor)).sites[0]?.public?.status).toBe("NOT_CONFIGURED");
    // An optional live rehearsal probes the edge only. This is not an
    // authenticated control-plane or commercial capacity benchmark.
    const latencies = await Promise.all(Array.from({ length: 500 }, async () => {
      const start = performance.now();
      const result = await readEdge(site.hostname, "/");
      expect(result.status).toBe(200);
      expect(result.body).toBe(page.body);
      return performance.now() - start;
    }));
    latencies.sort((a, b) => a - b);
    console.info(JSON.stringify({ scenario: "sandbox static origin burst", requests: 500, successes: latencies.length,
      p95Ms: Math.round(latencies[474]!), p99Ms: Math.round(latencies[494]!) }));
    console.info(JSON.stringify({ scenario: "scratch public GitHub to local static edge", site: site.hostname, jobId: id,
      repository: process.env.LIVE_STATIC_FIXTURE_REPO, commit: marker.commitSha, files: marker.files, homepageSha256: marker.indexSha256,
      originStatus: page.status, publicHttpsVerified: false }));
  }, 60_000);
});
